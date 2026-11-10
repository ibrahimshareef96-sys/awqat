#!/usr/bin/env node
/**
 * Make it yours: gives the app your own id and name everywhere they are written, so a build of your own can sit beside
 * the original and go to the stores under your name. The guide is docs/guides/04-make-it-yours.md.
 *
 *   node scripts/make-it-yours.mjs --id com.example.myapp --name "My App" [--group group.com.example.myapp]
 *                                  [--scheme myapp] [--dry-run] [--force]
 *
 * It reads what the tree says now (capacitor.config.ts, the app's entitlements and Info.plist), so it can be run again
 * on a tree it has already renamed. Everything is worked out in memory first: if a place it expects is missing, it
 * stops before a single file is written. It works only inside the folder this script sits in, never follows a
 * symbolic link, and never touches node_modules, dist, build, .git, Pods or DerivedData.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync,
  rmdirSync, statSync, unlinkSync, writeSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Wrong input: nothing was read or written. Exit code 2. */
export class UsageError extends Error {}
/** The tree is not in the shape this script knows: nothing was written. Exit code 1. */
export class PatternError extends Error {}

export const USAGE = `Make it yours: give the app your own id and name.

  node scripts/make-it-yours.mjs --id com.example.myapp --name "My App" [options]

  --id <id>        Your reverse-domain app id, lowercase, such as com.example.myapp
  --name <name>    The name people see under the icon, 1 to 30 characters
  --group <group>  The iOS App Group (default: group.<id>)
  --scheme <word>  Also change the link scheme (default: left as it is)
  --dry-run        Print what would change and change nothing
  --force          Run even with uncommitted changes, or with no git history
  --help           Show this

Give at least one of --id, --name, --group or --scheme. Whatever you leave out stays as it is.
The guide: docs/guides/04-make-it-yours.md`;

const F = {
  capacitor: "capacitor.config.ts",
  indexHtml: "index.html",
  gradle: "android/app/build.gradle",
  proguard: "android/app/proguard-rules.pro",
  strings: "android/app/src/main/res/values/strings.xml",
  shortcuts: "android/app/src/main/res/xml/shortcuts.xml",
  coverFiles: "src/books/coverFiles.ts",
  linkParser: "src/app/widget.ts",
  pbxproj: "ios/App/App.xcodeproj/project.pbxproj",
  infoPlist: "ios/App/App/Info.plist",
  widgetsPlist: "ios/App/PersonalOSWidgets/Info.plist",
  appEntitlements: "ios/App/App/App.entitlements",
  widgetsEntitlements: "ios/App/PersonalOSWidgets/PersonalOSWidgets.entitlements",
  sharedStore: "ios/App/PersonalOSWidgets/Shared/SharedStore.swift",
};
const JAVA_MAIN = "android/app/src/main/java";
const JAVA_ROOTS = [JAVA_MAIN, "android/app/src/test/java", "android/app/src/androidTest/java"];
/** Where the id, the group and the scheme are looked for, and which kinds of file. */
const SCOPE = [
  { dir: "src", exts: [".ts", ".tsx"] },
  { dir: "test", exts: [".ts"] },
  { dir: "android/app", exts: [".java", ".kt", ".xml", ".gradle", ".pro"] },
  { dir: "ios/App", exts: [".swift", ".plist", ".entitlements", ".pbxproj", ".xcconfig"] },
];
const ROOT_FILES = [F.capacitor, F.indexHtml];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", "Pods", "DerivedData", ".gradle", "xcuserdata",
  "SourcePackages", ".build"]);
/** Copies that `npx cap sync` writes, and this script's own test (it names the original id on purpose). */
const SKIP_PATHS = new Set(["android/app/src/main/assets", "ios/App/App/public", "test/makeItYours.test.ts"]);
const MAX_BYTES = 4 * 1024 * 1024;

const JAVA_WORDS = new Set(("abstract assert boolean break byte case catch char class const continue default do double " +
  "else enum extends final finally float for goto if implements import instanceof int interface long native new package " +
  "private protected public return short static strictfp super switch synchronized this throw throws transient try void " +
  "volatile while true false null").split(" "));
/** Folder names Windows refuses: the id becomes folders, and a fork may be cloned there. */
const DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
const KNOWN_SCHEMES = new Set(("http https file ftp mailto tel sms data javascript intent content about blob geo market ws " +
  "wss capacitor ionic app android ios").split(" "));

// ---------------------------------------------------------------------------------------------------------------------
// Checking what was typed. Each returns a sentence saying what is wrong, or null when the value is fine.

/** A typed value as it is safe to print back: quoted, with anything a terminal would act on written out. */
const quoted = (value) => JSON.stringify(String(value));

export function idProblem(id) {
  if (typeof id !== "string" || id.length === 0) return "The id is empty.";
  if (id.length > 100) return "The id is longer than 100 characters.";
  const parts = id.split(".");
  if (parts.length < 2) return `${quoted(id)} needs at least two parts with a dot between them, such as com.example.myapp.`;
  for (const part of parts) {
    if (!/^[a-z][a-z0-9_]*$/.test(part)) {
      return `${quoted(part || "(empty)")} is not a valid part of an id: use lowercase letters, digits and underscores, starting with a letter.`;
    }
    if (SKIP_DIRS.has(part)) return `"${part}" is a folder name build tools keep for themselves, so it cannot be part of an id.`;
    if (JAVA_WORDS.has(part)) return `"${part}" is a Java keyword, so it cannot be part of an id.`;
    if (DEVICE_NAMES.test(part)) return `"${part}" is a name Windows keeps for itself, so it cannot be a folder in the id.`;
  }
  return null;
}

export function nameProblem(name) {
  if (typeof name !== "string" || name.length === 0) return "The name is empty.";
  if (name !== name.normalize("NFC")) return "The name is not in its normal Unicode form. Type it again in plain characters.";
  const length = Array.from(name).length;
  if (length > 30) return `The name is ${length} characters; 30 is the most.`;
  if (/["'`<>&\\]/.test(name)) return "The name cannot hold quotes, angle brackets, an ampersand or a backslash.";
  if (/[${}%]/.test(name)) return "The name cannot hold a dollar sign, a percent sign or curly brackets: they mean something in the files it is written to.";
  if (/[\p{C}\p{Zl}\p{Zp}]/u.test(name)) return "The name holds a character that cannot be printed.";
  if (/[^\S ]|\p{Z}(?<! )/u.test(name)) return "The only space allowed in the name is the ordinary one.";
  if (name.includes("*/") || name.includes("/*")) return "The name cannot hold the marks that open or close a comment.";
  if (name !== name.trim() || name.includes("  ")) return "The name cannot start or end with a space, or hold two in a row.";
  if (/^[@?]/.test(name)) return "The name cannot start with @ or ?: Android reads those as something else.";
  return null;
}

export function groupProblem(group) {
  if (typeof group !== "string" || !/^group\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(group)) {
    return `${quoted(group)} is not an App Group id: it starts with "group." and then holds letters, digits, dots and hyphens.`;
  }
  return group.length > 120 ? "The App Group id is longer than 120 characters." : null;
}

export function schemeProblem(scheme) {
  if (typeof scheme !== "string" || !/^[a-z][a-z0-9]{1,31}$/.test(scheme)) {
    return `${quoted(scheme)} is not a link scheme this script will write: 2 to 32 lowercase letters and digits, starting with a letter.`;
  }
  return KNOWN_SCHEMES.has(scheme) ? `"${scheme}" already belongs to something else. Pick a word of your own.` : null;
}

export function accentProblem(accent) {
  return typeof accent === "string" && /^#[0-9a-fA-F]{6}$/.test(accent) ? null : `${quoted(accent)} is not a colour like #E2CC9A.`;
}

const VALUE_FLAGS = new Map([["--id", "id"], ["--name", "name"], ["--group", "group"], ["--scheme", "scheme"], ["--accent", "accent"]]);
const SWITCHES = new Map([["--dry-run", "dryRun"], ["--force", "force"], ["--help", "help"], ["-h", "help"]]);

/** The command line as an object. Throws UsageError for anything it does not know. */
export function parseArgs(argv) {
  const options = { dryRun: false, force: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].startsWith("--") && argv[i].includes("=")
      ? [argv[i].slice(0, argv[i].indexOf("=")), argv[i].slice(argv[i].indexOf("=") + 1)] : [argv[i], undefined];
    if (SWITCHES.has(flag) && inline === undefined) { options[SWITCHES.get(flag)] = true; continue; }
    const key = VALUE_FLAGS.get(flag);
    if (!key) throw new UsageError(`Unknown option ${quoted(argv[i])}. Run with --help to see the options.`);
    if (key in options) throw new UsageError(`${flag} was given twice.`);
    const value = inline ?? argv[i += 1];
    if (value === undefined || (inline === undefined && value.startsWith("--"))) throw new UsageError(`${flag} needs a value after it.`);
    options[key] = value;
  }
  return options;
}

/** Refuses bad values before anything is read. */
export function checkOptions(options) {
  const checks = [["id", idProblem], ["name", nameProblem], ["group", groupProblem], ["scheme", schemeProblem], ["accent", accentProblem]];
  for (const [key, problem] of checks) {
    const said = key in options ? problem(options[key]) : null;
    if (said) throw new UsageError(said);
  }
  if ("accent" in options) {
    throw new UsageError("--accent is not applied by this script. The accent colour is written in more than one place " +
      "(two style sheets, the voice orb, the Android widgets and the iOS widgets), so one swap would leave the app in " +
      'two colours. The guide lists each place: docs/guides/04-make-it-yours.md, "Colours".');
  }
  if (!["id", "name", "group", "scheme"].some((key) => key in options)) {
    throw new UsageError("Nothing to do: give --id, --name, --group or --scheme. Run with --help to see the options.");
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// What the tree says now, and what it should say next.

function first(text, pattern, what, file) {
  const match = pattern.exec(text ?? "");
  if (!match) throw new PatternError(`${file}: could not find ${what}. The file is not in the shape this script knows.`);
  return match[1];
}

/** The id, name, App Group and link scheme as the files have them now. `read(path)` gives a file's text, or null. */
export function currentIdentity(read) {
  const config = read(F.capacitor);
  if (config === null) throw new PatternError(`${F.capacitor} is missing: run this from a copy of the app's repository.`);
  const groups = /<key>com\.apple\.security\.application-groups<\/key>\s*<array>([\s\S]*?)<\/array>/;
  const schemes = /<key>CFBundleURLSchemes<\/key>\s*<array>([\s\S]*?)<\/array>/;
  const one = /^\s*<string>([^<]+)<\/string>\s*$/;
  const identity = {
    id: first(config, /\bappId:\s*"([^"]+)"/, "appId", F.capacitor),
    name: first(config, /\bappName:\s*"([^"]+)"/, "appName", F.capacitor),
    group: first(first(read(F.appEntitlements), groups, "the App Group", F.appEntitlements), one, "one App Group", F.appEntitlements),
    scheme: first(first(read(F.infoPlist), schemes, "the link scheme", F.infoPlist), one, "one link scheme", F.infoPlist),
  };
  if (!/^[A-Za-z][\w]*(\.[A-Za-z][\w]*)+$/.test(identity.id)) throw new PatternError(`${F.capacitor}: appId "${identity.id}" is not an id this script can move.`);
  if (!/^[A-Za-z][A-Za-z0-9+.-]*$/.test(identity.scheme)) throw new PatternError(`${F.infoPlist}: "${identity.scheme}" is not a link scheme.`);
  return identity;
}

/** What the tree should say after the run. A group nobody chose follows the id, unless the tree's group was set by hand. */
export function nextIdentity(cur, options) {
  const id = options.id ?? cur.id;
  const followsId = cur.group === `group.${cur.id}`;
  return {
    id,
    name: options.name ?? cur.name,
    group: options.group ?? (followsId ? `group.${id}` : cur.group),
    scheme: options.scheme ?? cur.scheme,
  };
}

const same = (a, b) => a.id === b.id && a.name === b.name && a.group === b.group && a.scheme === b.scheme;

// ---------------------------------------------------------------------------------------------------------------------
// The words to find. An id is matched whole: never inside a longer id, and the group before it, so neither eats the other.

const rx = (text) => text.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
const asWritten = (id) => id.replaceAll(".", "\\.");
const upper = (name) => name.toUpperCase();
const idSource = (id) => `(?<![\\w.-])${rx(id)}(?![\\w-])`;
const groupSource = (group) => `(?<![\\w.-])${rx(group)}(?![\\w-]|\\.\\w)`;
const schemeSource = (scheme) => `(?<![A-Za-z0-9+.-])${rx(scheme)}://`;
const schemeInRegexSource = (scheme) => `(?<![A-Za-z0-9+.-])${rx(scheme)}:\\\\/\\\\/`;
/** The name as a word of its own: not part of a longer word, a key such as "name-cache" or a file such as "name.json". */
const nameSource = (name) => `(?<![\\p{L}\\p{N}_]|[\\p{L}\\p{N}_][-.])${rx(name)}(?![\\p{L}\\p{N}_]|[-.][\\p{L}\\p{N}_])`;

/** Ids, groups and links a name must never be changed inside ("com.example.sabr" holds the word "sabr"). */
function shields(cur, next) {
  return [cur, next].flatMap((who) => [
    groupSource(who.group), `(?<![\\w.-])${rx(who.id)}(?:\\.[\\w.]*)?(?![\\w-])`, schemeSource(who.scheme), schemeInRegexSource(who.scheme),
  ]);
}

let memo = null;
function wordsFor(cur, next) {
  if (memo && memo.cur === cur && memo.next === next) return memo.words;
  const shield = shields(cur, next).join("|");
  const words = {
    tokens: new RegExp([`(?<group>${groupSource(cur.group)})`, `(?<id>${idSource(cur.id)})`, `(?<idInRegex>${idSource(asWritten(cur.id))})`,
      `(?<link>${schemeSource(cur.scheme)})`, `(?<linkInRegex>${schemeInRegexSource(cur.scheme)})`].join("|"), "g"),
    rename: new RegExp(`(?<keep>${shield})|(?<name>${nameSource(cur.name)})`, "gu"),
    taken: new RegExp(`(?<keep>${shield}|${nameSource(cur.name)})|(?<name>${nameSource(next.name)})`, "gu"),
    left: new RegExp(`(?<keep>${shield}|${nameSource(next.name)})|(?<name>${nameSource(cur.name)})`, "gu"),
  };
  memo = { cur, next, words };
  return words;
}

/** The id, the App Group and the link scheme, wherever they are written in a file. The name is not touched here. */
export function rewriteTokens(text, cur, next) {
  return text.replace(wordsFor(cur, next).tokens, (...args) => {
    const found = args.at(-1);
    if (found.group !== undefined) return next.group;
    if (found.id !== undefined) return next.id;
    if (found.idInRegex !== undefined) return asWritten(next.id);
    return found.link !== undefined ? `${next.scheme}://` : `${next.scheme}:\\/\\/`;
  });
}

/** The scheme the iOS app registers, in the app's Info.plist. */
export function rewritePlistScheme(text, cur, next) {
  return text.replace(/(<key>CFBundleURLSchemes<\/key>\s*<array>)([\s\S]*?)(<\/array>)/, (_all, open, body, close) =>
    open + body.replaceAll(`<string>${cur.scheme}</string>`, `<string>${next.scheme}</string>`) + close);
}

// ---------------------------------------------------------------------------------------------------------------------
// The name, only where a person reads it.

const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;
/** A quoted piece of one line: "...", '...' or `...`, or a template that runs on past the end of the line. */
const QUOTED = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*(?:`|$)/g;
const PLIST_SHOWN = /(<key>(?:CFBundleDisplayName|CFBundleName|\w*UsageDescription)<\/key>\s*<string>)([^<]*)(<\/string>)/g;

/** Which rule a file's name follows, or null when the name in it is left alone (comments, docs, credits, licences). */
export function nameKind(file) {
  if (file === F.capacitor) return "config";
  if (file === F.indexHtml) return "title";
  if (/^android\/app\/src\/main\/res\/values[^/]*\/strings\.xml$/.test(file)) return "strings";
  if (file.startsWith("ios/App/") && file.endsWith(".plist")) return "plist";
  return /\.(ts|tsx|swift|java|kt)$/.test(file) ? "code" : null;
}

function inCode(text, change) {
  return text.replace(/^.*$/gm, (line) => (COMMENT_LINE.test(line) ? line : line.replace(QUOTED, change)));
}

/** Runs `change` over every piece of `text` a person reads, and returns the text with those pieces replaced. */
function mapShown(kind, text, change) {
  const middle = (_all, open, value, close) => open + change(value) + close;
  if (kind === "config") return text.replace(/(\bappName:\s*")([^"]*)(")/, middle);
  if (kind === "title") return text.replace(/(<title>)([^<]*)(<\/title>)/, middle);
  if (kind === "strings") return text.replace(/(<string\b[^>]*>)([^<]*)(<\/string>)/g, middle);
  if (kind === "plist") return text.replace(PLIST_SHOWN, middle);
  return kind === "code" ? inCode(text, change) : text;
}

/** The name in one file, by that file's rule. Ids, groups and links inside the same text are stepped over. */
export function renameShown(file, text, cur, next) {
  const kind = nameKind(file);
  if (kind === null || cur.name === next.name || !text.includes(cur.name) && !text.includes(upper(cur.name))) return text;
  const { rename } = wordsFor(cur, next);
  const swap = (piece) => piece.replace(rename, (...args) => (args.at(-1).name !== undefined ? next.name : args[0]));
  // A label set in capitals (the Today widget's) stays in capitals.
  const capitals = kind === "strings" && upper(cur.name) !== cur.name;
  return mapShown(kind, text, (piece) => (capitals && piece === upper(cur.name) ? upper(next.name) : swap(piece)));
}

function found(pattern, piece) {
  pattern.lastIndex = 0;
  for (const match of piece.matchAll(pattern)) if (match.groups.name !== undefined) return true;
  return false;
}

/** True when the new name is already a word this file shows: a later rename could not tell the two apart. */
export function nameTaken(file, text, cur, next) {
  const kind = nameKind(file);
  if (kind === null || cur.name === next.name) return false;
  const { taken } = wordsFor(cur, next);
  let hit = false;
  mapShown(kind, text, (piece) => {
    if (found(taken, piece)) hit = true;
    if (kind === "strings" && piece === upper(next.name) && piece !== upper(cur.name)) hit = true;
    return piece;
  });
  return hit;
}

/** Lines of code that still say the old name outside a comment: a string this script could not see into. */
export function nameLeftOn(file, text, cur, next) {
  if (nameKind(file) !== "code" || cur.name === next.name || !text.includes(cur.name)) return [];
  const { left } = wordsFor(cur, next);
  return text.split("\n").flatMap((line, i) => (!COMMENT_LINE.test(line) && found(left, line) ? [i + 1] : []));
}

/** One file's new text: the id, group and scheme everywhere in it, then the name where it is shown. */
export function transformFile(file, text, cur, next) {
  const tokens = rewriteTokens(text, cur, next);
  const scheme = file === F.infoPlist ? rewritePlistScheme(tokens, cur, next) : tokens;
  return renameShown(file, scheme, cur, next);
}

/** Where a file lives after the run: Java and Kotlin sources follow the id, everything else stays put. */
export function destination(file, cur, next) {
  for (const root of JAVA_ROOTS) {
    const from = `${root}/${cur.id.replaceAll(".", "/")}/`;
    if (file.startsWith(from)) return `${root}/${next.id.replaceAll(".", "/")}/${file.slice(from.length)}`;
  }
  return file;
}

// ---------------------------------------------------------------------------------------------------------------------
// The places that must be there. A refactor that moves one makes the run stop, instead of renaming half an app.

function idChecks(cur) {
  const id = rx(cur.id);
  return [
    [F.gradle, new RegExp(`\\bnamespace\\s*=?\\s*["']${id}["']`), "namespace"],
    [F.gradle, new RegExp(`\\bapplicationId\\s*=?\\s*["']${id}["']`), "applicationId"],
    [F.proguard, new RegExp(`-keep class ${id}\\.`), "a -keep rule for the app's own classes"],
    [F.strings, new RegExp(`<string name="package_name">${id}</string>`), "package_name"],
    [F.strings, new RegExp(`<string name="custom_url_scheme">${id}</string>`), "custom_url_scheme"],
    [F.shortcuts, new RegExp(`android:targetPackage="${id}"`), "targetPackage"],
    [F.shortcuts, new RegExp(`android:targetClass="${id}\\.`), "targetClass"],
    [F.coverFiles, new RegExp(`\\bOWN_FOLDER\\s*=\\s*/.*\\\\/${rx(asWritten(cur.id))}\\\\/`), "the id inside OWN_FOLDER"],
    [F.pbxproj, new RegExp(`PRODUCT_BUNDLE_IDENTIFIER = "?${id}"?;`), "the app target's bundle id"],
    [F.pbxproj, new RegExp(`PRODUCT_BUNDLE_IDENTIFIER = "?${id}\\.[\\w.-]+"?;`), "the widgets target's bundle id"],
  ];
}

function otherChecks(cur) {
  const group = rx(cur.group);
  const name = rx(cur.name);
  const link = `${rx(cur.scheme)}://`;
  return {
    group: [
      [F.appEntitlements, new RegExp(`<string>${group}</string>`), "the App Group"],
      [F.widgetsEntitlements, new RegExp(`<string>${group}</string>`), "the App Group"],
      [F.sharedStore, new RegExp(`"${group}"`), "the App Group"],
    ],
    name: [
      [F.indexHtml, new RegExp(`<title>${name}</title>`), "the page title"],
      [F.strings, new RegExp(`<string name="app_name">${name}</string>`), "app_name"],
      [F.strings, new RegExp(`<string name="title_activity_main">${name}</string>`), "title_activity_main"],
      [F.infoPlist, new RegExp(`<key>CFBundleDisplayName</key>\\s*<string>${name}</string>`), "CFBundleDisplayName"],
      [F.widgetsPlist, new RegExp(`<key>CFBundleDisplayName</key>\\s*<string>${name}</string>`), "CFBundleDisplayName"],
    ],
    scheme: [
      [F.linkParser, new RegExp(`${rx(cur.scheme)}:(\\\\/\\\\/|//)`), "the link the app follows"],
      [F.shortcuts, new RegExp(`android:data="${link}`), "the shortcuts' links"],
    ],
  };
}

/** Every expected place that is missing, as sentences. `texts` maps each file in scope to its text now. */
export function missingPlaces(texts, cur, next) {
  const other = otherChecks(cur);
  const checks = [
    ...(cur.id !== next.id ? idChecks(cur) : []), ...(cur.group !== next.group ? other.group : []),
    ...(cur.name !== next.name ? other.name : []), ...(cur.scheme !== next.scheme ? other.scheme : []),
  ];
  const missing = checks.flatMap(([file, pattern, what]) => (pattern.test(texts.get(file) ?? "") ? [] : [`${file}: could not find ${what}.`]));
  const files = [...texts.keys()];
  const own = `${JAVA_MAIN}/${cur.id.replaceAll(".", "/")}/`;
  const link = `${cur.scheme}://`;
  if (cur.id !== next.id) {
    const sources = files.filter((file) => /\.(java|kt)$/.test(file) && destination(file, cur, next) !== file);
    if (!sources.some((file) => file.startsWith(own))) missing.push(`${own}: no Java sources found where the id says they are.`);
    const line = new RegExp(`^\\s*package\\s+${rx(cur.id)}(\\.[\\w.]+)?\\s*;?\\s*$`, "m");
    missing.push(...sources.filter((file) => !line.test(texts.get(file))).map((file) => `${file}: its package line does not start with ${cur.id}.`));
  }
  if (cur.scheme !== next.scheme) {
    if (!files.some((file) => file.startsWith(own) && texts.get(file).includes(link))) missing.push(`${own}: no ${link} link in the Android code.`);
    if (!files.some((file) => file.endsWith(".swift") && texts.get(file).includes(link))) missing.push(`ios/App: no ${link} link in the Swift code.`);
  }
  return missing;
}

/** New values that are already written somewhere: taking one would make the next rename change the wrong things. */
export function alreadyTaken(texts, cur, next) {
  const taken = [];
  const without = (text, ...words) => words.reduce((rest, word) => rest.split(word).join(""), text);
  const check = (changed, pattern, masks, say) => {
    if (!changed) return;
    const file = [...texts.keys()].find((name) => pattern.test(without(texts.get(name), ...masks)));
    if (file) taken.push(say(file));
  };
  check(cur.id !== next.id, new RegExp(`${idSource(next.id)}|${idSource(asWritten(next.id))}`), [cur.group, cur.id, asWritten(cur.id)],
    (file) => `The id ${next.id} is already written in ${file} (a library or part of the app uses it). Pick another.`);
  check(cur.group !== next.group, new RegExp(groupSource(next.group)), [cur.group],
    (file) => `The App Group ${next.group} is already written in ${file}. Pick another.`);
  check(cur.scheme !== next.scheme, new RegExp(`${schemeSource(next.scheme)}|${schemeInRegexSource(next.scheme)}`), [`${cur.scheme}://`, `${cur.scheme}:\\/\\/`],
    (file) => `The link scheme ${next.scheme}:// is already written in ${file}. Pick another.`);
  const shown = [...texts.keys()].find((file) => nameTaken(file, texts.get(file), cur, next));
  if (shown) {
    taken.push(`"${next.name}" is already a word the app shows (${shown}), so a later rename could not tell your name from ` +
      "that word. Pick a name the app does not already use, or change the name by hand in the places the guide lists.");
  }
  return taken;
}

/** Anything of the old identity still written after the change: the proof that nothing was half done. */
export function leftBehind(after, cur, next) {
  const strip = (text, words) => words.reduce((rest, word) => (word ? rest.split(word).join("") : rest), text);
  const left = [];
  for (const [file, text] of after) {
    const rest = strip(text, [next.group, next.id, asWritten(next.id), `${next.scheme}://`, `${next.scheme}:\\/\\/`, cur.group === next.group ? cur.group : ""]);
    if (cur.id !== next.id && (rest.includes(cur.id) || rest.includes(asWritten(cur.id)))) left.push(`${file}: still says ${cur.id}.`);
    if (cur.group !== next.group && strip(text, [next.group]).includes(cur.group)) left.push(`${file}: still says ${cur.group}.`);
    if (cur.scheme !== next.scheme && new RegExp(`${schemeSource(cur.scheme)}|${schemeInRegexSource(cur.scheme)}`).test(rest)) {
      left.push(`${file}: still says ${cur.scheme}://.`);
    }
  }
  return left;
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading the tree. Every path is checked to be inside the repository, and no symbolic link is ever followed.

const posix = (file) => file.split(path.sep).join("/");

/** The absolute path of `file` inside `root`, refused if it leaves `root` or passes through a symbolic link. */
export function inside(root, file) {
  const absolute = path.resolve(root, file);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) throw new PatternError(`${file} is outside the repository.`);
  let step = root;
  for (const part of path.relative(root, absolute).split(path.sep).filter(Boolean)) {
    step = path.join(step, part);
    let link = false;
    try { link = lstatSync(step).isSymbolicLink(); } catch (error) { if (error.code === "ENOENT") break; throw error; }
    if (link) throw new PatternError(`${posix(path.relative(root, step))} is a symbolic link. This script never follows links.`);
  }
  return absolute;
}

function walk(root, dir, exts, files, links) {
  let entries;
  try { entries = readdirSync(inside(root, dir), { withFileTypes: true }); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const file = `${dir}/${entry.name}`;
    if (SKIP_PATHS.has(file)) continue;
    if (entry.isSymbolicLink()) links.push(file);
    else if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(root, file, exts, files, links); }
    else if (entry.isFile() && exts.includes(path.extname(entry.name))) files.push(file);
  }
}

function readText(root, file) {
  const absolute = inside(root, file);
  try {
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.size > MAX_BYTES) return null;
    const text = readFileSync(absolute, "utf8");
    return text.includes("\u0000") ? null : text;
  } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

/** Every file in scope with its text now, and the symbolic links that were stepped over. */
export function readScope(root) {
  const files = [];
  const links = [];
  for (const { dir, exts } of SCOPE) walk(root, dir, exts, files, links);
  const texts = new Map();
  for (const file of [...ROOT_FILES, ...files]) {
    const text = readText(root, file);
    if (text !== null) texts.set(file, text);
  }
  return { texts, links };
}

/**
 * The whole change, worked out without writing anything. Throws PatternError when a place is missing, a new value is
 * already taken, a file would be overwritten, or something of the old identity would be left behind.
 */
export function buildPlan(root, cur, next) {
  const { texts, links } = readScope(root);
  const stop = (lines) => { if (lines.length) throw new PatternError(`${lines.join("\n")}\nNothing was changed.`); };
  stop(missingPlaces(texts, cur, next));
  stop(alreadyTaken(texts, cur, next));
  const changes = [];
  const after = new Map();
  const leftovers = [];
  for (const [file, before] of texts) {
    const text = transformFile(file, before, cur, next);
    const to = destination(file, cur, next);
    after.set(to, text);
    leftovers.push(...nameLeftOn(file, text, cur, next).map((line) => `${to}:${line}`));
    if (text !== before || to !== file) changes.push({ from: file, to, before, after: text });
  }
  stop(leftBehind(after, cur, next));
  const moving = new Set(changes.map((change) => change.from));
  stop(changes.filter((change) => change.to !== change.from && !moving.has(change.to) && existsSync(inside(root, change.to)))
    .map((change) => `${change.to} already exists, so ${change.from} cannot move there.`));
  return { changes, leftovers, links };
}

// ---------------------------------------------------------------------------------------------------------------------
// Writing. Each file is written beside itself and renamed into place, so a file is never left half written; if a step
// fails, the files already done are put back.

function writeAtomic(absolute, text, mode) {
  mkdirSync(path.dirname(absolute), { recursive: true });
  const temp = path.join(path.dirname(absolute), `.${path.basename(absolute)}.${randomBytes(6).toString("hex")}.tmp`);
  const handle = openSync(temp, "wx", mode);
  try {
    writeSync(handle, text, null, "utf8");
    fsyncSync(handle);
  } catch (error) {
    closeSync(handle);
    unlinkSync(temp);
    throw error;
  }
  closeSync(handle);
  try {
    renameSync(temp, absolute);
  } catch (error) {
    unlinkSync(temp);
    throw error;
  }
}

function pruneEmpty(root, file) {
  const top = JAVA_ROOTS.find((javaRoot) => file.startsWith(`${javaRoot}/`));
  if (!top) return;
  for (let dir = path.posix.dirname(file); dir !== top && dir.startsWith(`${top}/`); dir = path.posix.dirname(dir)) {
    try {
      if (readdirSync(inside(root, dir)).length > 0) return;
      rmdirSync(inside(root, dir));
    } catch { return; }
  }
}

function putBack(root, done) {
  for (const step of done.reverse()) {
    try {
      if (step.before === null) unlinkSync(inside(root, step.file));
      else writeAtomic(inside(root, step.file), step.before, step.mode);
    } catch { /* The first failure is the one reported; git has the rest. */ }
  }
}

/** Writes the plan. Returns nothing; throws after putting back what it had written if a step fails. */
export function applyPlan(root, plan) {
  const done = [];
  try {
    for (const change of plan.changes) {
      const mode = statSync(inside(root, change.from)).mode & 0o777;
      const target = inside(root, change.to);
      const was = existsSync(target) ? readFileSync(target, "utf8") : null;
      writeAtomic(target, change.after, mode);
      done.push({ file: change.to, before: was, mode });
    }
    for (const change of plan.changes.filter((one) => one.to !== one.from && !plan.changes.some((other) => other.to === one.from))) {
      unlinkSync(inside(root, change.from));
      done.push({ file: change.from, before: change.before, mode: 0o644 });
    }
  } catch (error) {
    putBack(root, done);
    throw new PatternError(`Could not write the change (${error.message}). The files already written were put back.`);
  }
  for (const change of plan.changes) if (change.to !== change.from) pruneEmpty(root, change.from);
}

// ---------------------------------------------------------------------------------------------------------------------
// The command.

/** "clean", "dirty", or "none" when `root` is not the top of a git repository (or git is not installed). */
export function treeState(root) {
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  try {
    if (realpathSync(git(["rev-parse", "--show-toplevel"]).trim()) !== root) return "none";
    // Read only: no index refresh written, and no file-watcher program from the repository's own config is started.
    return git(["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"]).trim() === "" ? "clean" : "dirty";
  } catch { return "none"; }
}

function checkTree(root, force) {
  const state = treeState(root);
  if (state === "clean" || force) return;
  throw new UsageError(state === "dirty"
    ? "There are uncommitted changes. Commit or stash them first, so this change can be undone on its own, or pass --force."
    : "This folder has no git history of its own, so the change could not be undone. Pass --force to go ahead anyway.");
}

function repoRoot() {
  return realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
}

function describe(cur, next) {
  const row = (label, a, b) => `  ${label.padEnd(8)}${a === b ? `${a} (stays)` : `${a}  to  ${b}`}`;
  return [row("id", cur.id, next.id), row("name", cur.name, next.name), row("group", cur.group, next.group),
    row("scheme", `${cur.scheme}://`, `${next.scheme}://`)].join("\n");
}

function report(plan, dryRun) {
  const lines = plan.changes.map((change) => (change.to === change.from
    ? `  ${dryRun ? "would change" : "changed"}  ${change.from}`
    : `  ${dryRun ? "would move" : "moved"}    ${change.from}  to  ${change.to}`));
  if (plan.links.length) lines.push("", "Symbolic links were stepped over, not followed:", ...plan.links.map((link) => `  ${link}`));
  if (plan.leftovers.length) {
    lines.push("", "These lines still say the old name in a place this script does not read into. Check them by hand:",
      ...plan.leftovers.map((left) => `  ${left}`));
  }
  return lines.join("\n");
}

function nextSteps(next) {
  const steps = [
    "npm run build, then npx cap sync: it rewrites the copies of the config inside android/ and ios/.",
    "npm run typecheck and npm test.",
    "In Xcode, set your own team on both targets and check the App Group under Signing and Capabilities.",
    "The icon, the colours, the privacy policy and the store checklist are by hand: docs/guides/04-make-it-yours.md.",
  ];
  if (next.id.includes("_")) steps.push(`Apple does not allow an underscore in a bundle id: change ${next.id} for the two iOS targets in Xcode.`);
  return `Next:\n${steps.map((step, i) => `  ${i + 1}. ${step}`).join("\n")}`;
}

/** Runs the command and returns its exit code: 0 done, 1 the tree is not as expected, 2 the input was refused. */
export function main(argv, out = console) {
  try {
    const options = parseArgs(argv);
    if (options.help) { out.log(USAGE); return 0; }
    checkOptions(options);
    const root = repoRoot();
    const cur = currentIdentity((file) => readText(root, file));
    const next = nextIdentity(cur, options);
    if (!("group" in options)) { const said = groupProblem(next.group); if (said) throw new UsageError(said); }
    out.log(`Make it yours${options.dryRun ? " (dry run: nothing will be changed)" : ""}\n${describe(cur, next)}\n`);
    if (same(cur, next)) { out.log("The tree already says all of this. Nothing to change."); return 0; }
    if (!options.dryRun) checkTree(root, options.force);
    const plan = buildPlan(root, cur, next);
    if (!options.dryRun) applyPlan(root, plan);
    out.log(report(plan, options.dryRun));
    out.log(`\n${plan.changes.length} files ${options.dryRun ? "would change. Nothing was changed." : "changed."}`);
    if (!options.dryRun) out.log(`\n${nextSteps(next)}`);
    return 0;
  } catch (error) {
    // A file that cannot be read or a folder that cannot be listed: said plainly. Anything else is a bug and is thrown.
    const known = error instanceof UsageError || error instanceof PatternError || typeof error?.code === "string";
    if (!known) throw error;
    out.error(error.message);
    return error instanceof UsageError ? 2 : 1;
  }
}

function isMain() {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (isMain()) process.exitCode = main(process.argv.slice(2));
