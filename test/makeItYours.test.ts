// scripts/make-it-yours.mjs: what it accepts, what each file's rewrite does, and a whole run against a copy of the
// tree in a temporary folder. The script is never run against this repository itself.
import { spawnSync } from "node:child_process";
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  accentProblem, alreadyTaken, checkOptions, currentIdentity, destination, groupProblem, idProblem, leftBehind, missingPlaces,
  nameLeftOn, nameProblem, nameTaken, nextIdentity, parseArgs, renameShown, rewritePlistScheme, rewriteTokens, schemeProblem,
  transformFile, UsageError,
} from "../scripts/make-it-yours.mjs";
import type { Identity } from "../scripts/make-it-yours.mjs";

const OLD: Identity = { id: "app.awqat", name: "Awqat", group: "group.app.awqat", scheme: "awqat" };
const SABR: Identity = { id: "com.example.sabr", name: "Sabr", group: "group.com.example.sabr", scheme: "awqat" };

describe("what it accepts", () => {
  it("takes a lowercase reverse-domain id", () => {
    for (const id of ["com.example.sabr", "app.sabr", "org.example.my_app2", "a.b.c.d"]) expect(idProblem(id)).toBeNull();
  });

  it("refuses ids that are not one", () => {
    for (const id of ["", "sabr", "Com.example.sabr", "com.example.Sabr", "com..sabr", ".com.sabr", "com.sabr.", "com.1sabr", "com._sabr",
      "com.example.sabr-app", "com.example/sabr", "com.example.sabr/../x", "../../etc", "com.example.sabr;rm", "com.example.s abr",
      "com.example.class", "com.int.sabr", "new.example.sabr", "com.example.null", "com.nul.sabr", "com.example.com1", "com.example.build", "com.dist.sabr",
      `com.${"a".repeat(100)}`]) {
      expect(idProblem(id), id).not.toBeNull();
    }
    expect(idProblem(undefined)).not.toBeNull();
  });

  it("takes a name of 1 to 30 printable characters", () => {
    for (const name of ["Sabr", "My App", "A", "Sabr 2", "Sabr: calm days", "وقت", "x".repeat(30)]) expect(nameProblem(name), name).toBeNull();
  });

  it("refuses names that would break a file they are written to", () => {
    for (const name of ["", "x".repeat(31), 'Sa"br', "Sa'br", "Sa`br", "<Sabr>", "Sabr & Co", "Sa\\br", "${x}", "Sa$br", "100%", "{Sabr}",
      " Sabr", "Sabr ", "My  App", "Sa\nbr", "Sa\tbr", "Sa\u0000br", "Sa‮br", "Sa br", "@string/x", "?attr", "a */ b", "/* a"]) {
      expect(nameProblem(name), JSON.stringify(name)).not.toBeNull();
    }
  });

  it("checks the App Group, the link scheme and a colour", () => {
    expect(groupProblem("group.com.example.sabr")).toBeNull();
    for (const group of ["com.example.sabr", "group.", "group.com..sabr", "group.com/sabr", "group.com.example.sabr\n"]) expect(groupProblem(group), group).not.toBeNull();
    expect(schemeProblem("sabr")).toBeNull();
    for (const scheme of ["Sabr", "s", "1sabr", "sa-br", "sabr://", "https", "javascript", "file"]) expect(schemeProblem(scheme), scheme).not.toBeNull();
    expect(accentProblem("#E2CC9A")).toBeNull();
    for (const accent of ["E2CC9A", "#E2C", "#GGGGGG", "red", "#E2CC9A;"]) expect(accentProblem(accent), accent).not.toBeNull();
  });

  it("reads the command line", () => {
    expect(parseArgs(["--id", "com.example.sabr", "--name", "Sabr", "--dry-run"]))
      .toEqual({ id: "com.example.sabr", name: "Sabr", dryRun: true, force: false, help: false });
    expect(parseArgs(["--id=com.example.sabr", "--force"])).toMatchObject({ id: "com.example.sabr", force: true });
    for (const argv of [["--id"], ["--nope"], ["sabr"], ["--id", "a.b", "--id", "c.d"], ["--name", "--dry-run"], ["--dry-run=yes"]]) {
      expect(() => parseArgs(argv), argv.join(" ")).toThrow(UsageError);
    }
  });

  it("refuses bad values, an empty request, and --accent with its reason", () => {
    const base = { dryRun: false, force: false, help: false };
    expect(() => checkOptions({ ...base, id: "com.example.sabr", name: "Sabr" })).not.toThrow();
    expect(() => checkOptions({ ...base })).toThrow(UsageError);
    expect(() => checkOptions({ ...base, id: "Sabr" })).toThrow(UsageError);
    expect(() => checkOptions({ ...base, id: "com.example.sabr", accent: "blue" })).toThrow(/not a colour/);
    expect(() => checkOptions({ ...base, id: "com.example.sabr", accent: "#112233" })).toThrow(/more than one place/);
  });
});

describe("what the tree says now and next", () => {
  const files: Record<string, string> = {
    "capacitor.config.ts": 'const config = {\n  appId: "app.awqat",\n  appName: "Awqat",\n};',
    "ios/App/App/App.entitlements": "<key>com.apple.security.application-groups</key>\n<array>\n\t<string>group.app.awqat</string>\n</array>",
    "ios/App/App/Info.plist": "<key>CFBundleURLSchemes</key>\n<array>\n\t<string>awqat</string>\n</array>",
  };

  it("reads the id, name, group and scheme from the files", () => {
    expect(currentIdentity((file) => files[file] ?? null)).toEqual(OLD);
    expect(() => currentIdentity(() => null)).toThrow(/capacitor\.config\.ts is missing/);
    expect(() => currentIdentity((file) => (file === "capacitor.config.ts" ? "nothing here" : files[file] ?? null))).toThrow(/could not find appId/);
  });

  it("lets the group follow the id unless it was set by hand", () => {
    expect(nextIdentity(OLD, { id: "com.example.sabr", name: "Sabr" })).toEqual(SABR);
    expect(nextIdentity(OLD, { name: "Sabr" })).toEqual({ ...OLD, name: "Sabr" });
    expect(nextIdentity({ ...OLD, group: "group.shared.example" }, { id: "com.example.sabr" }).group).toBe("group.shared.example");
    expect(nextIdentity(OLD, { id: "com.example.sabr", group: "group.example.shared", scheme: "sabr" }))
      .toMatchObject({ group: "group.example.shared", scheme: "sabr" });
  });
});

describe("the id, the group and the scheme in a file", () => {
  it("changes the id whole, and never inside a longer word", () => {
    expect(rewriteTokens('namespace = "app.awqat"\napplicationId "app.awqat"', OLD, SABR))
      .toBe('namespace = "com.example.sabr"\napplicationId "com.example.sabr"');
    expect(rewriteTokens("-keep class app.awqat.WidgetBridgePlugin { *; }", OLD, SABR)).toBe("-keep class com.example.sabr.WidgetBridgePlugin { *; }");
    expect(rewriteTokens("package app.awqat;\nimport app.awqat.live.Thing;", OLD, SABR)).toBe("package com.example.sabr;\nimport com.example.sabr.live.Thing;");
    expect(rewriteTokens("PRODUCT_BUNDLE_IDENTIFIER = app.awqat.widgets;", OLD, SABR)).toBe("PRODUCT_BUNDLE_IDENTIFIER = com.example.sabr.widgets;");
    expect(rewriteTokens('"/data/user/0/app.awqat.evil/cache/a.jpg"', OLD, SABR)).toBe('"/data/user/0/com.example.sabr.evil/cache/a.jpg"');
    for (const kept of ["myapp.awqat", "app.awqatx", "x.app.awqat", "app-awqat", "app.awqat-two"]) expect(rewriteTokens(kept, OLD, SABR)).toBe(kept);
  });

  it("changes the App Group as one word, to the group asked for", () => {
    const shared = { ...SABR, group: "group.example.shared" };
    expect(rewriteTokens("<string>group.app.awqat</string>", OLD, SABR)).toBe("<string>group.com.example.sabr</string>");
    expect(rewriteTokens('private static let group = "group.app.awqat"', OLD, shared)).toBe('private static let group = "group.example.shared"');
    expect(rewriteTokens("group.app.awqat and app.awqat", OLD, { ...SABR, group: OLD.group })).toBe("group.app.awqat and com.example.sabr");
  });

  it("escapes the id where it sits inside a regular expression", () => {
    const line = String.raw`const OWN_FOLDER = /^\/(data\/user\/\d+|data\/data)\/app\.awqat\/(cache|files)\//;`;
    const out = rewriteTokens(line, OLD, SABR);
    expect(out).toBe(String.raw`const OWN_FOLDER = /^\/(data\/user\/\d+|data\/data)\/com\.example\.sabr\/(cache|files)\//;`);
    const own = new RegExp(/= \/(.*)\/;$/.exec(out)?.[1] ?? "never");
    expect(own.test("/data/user/0/com.example.sabr/cache/a.jpg")).toBe(true);
    expect(own.test("/data/user/0/comXexampleXsabr/cache/a.jpg")).toBe(false);
    expect(own.test("/data/user/0/app.awqat/cache/a.jpg")).toBe(false);
  });

  it("leaves the link scheme alone unless one is asked for", () => {
    const java = 'static final String FAITH_LINK = "awqat://go/faith";';
    const ts = String.raw`const match = /^awqat:\/\/go\/([A-Za-z0-9:-]+)$/.exec(url);`;
    expect(rewriteTokens(java, OLD, SABR)).toBe(java);
    const linked = { ...SABR, scheme: "sabr" };
    expect(rewriteTokens(java, OLD, linked)).toBe('static final String FAITH_LINK = "sabr://go/faith";');
    expect(rewriteTokens(ts, OLD, linked)).toBe(String.raw`const match = /^sabr:\/\/go\/([A-Za-z0-9:-]+)$/.exec(url);`);
    expect(rewriteTokens("myawqat://go/faith", OLD, linked)).toBe("myawqat://go/faith");
    const plist = "<key>CFBundleURLName</key>\n<string>awqat</string>\n<key>CFBundleURLSchemes</key>\n<array>\n\t<string>awqat</string>\n</array>";
    expect(rewritePlistScheme(plist, OLD, linked))
      .toBe("<key>CFBundleURLName</key>\n<string>awqat</string>\n<key>CFBundleURLSchemes</key>\n<array>\n\t<string>sabr</string>\n</array>");
  });

  it("moves Java sources with the id and nothing else", () => {
    expect(destination("android/app/src/main/java/app/awqat/MainActivity.java", OLD, SABR)).toBe("android/app/src/main/java/com/example/sabr/MainActivity.java");
    expect(destination("android/app/src/test/java/app/awqat/live/LiveDataTest.java", OLD, SABR)).toBe("android/app/src/test/java/com/example/sabr/live/LiveDataTest.java");
    for (const file of ["android/app/src/androidTest/java/com/getcapacitor/myapp/ExampleInstrumentedTest.java", "src/app/widget.ts",
      "android/app/src/main/java/app/awqatx/Other.java"]) expect(destination(file, OLD, SABR)).toBe(file);
  });
});

describe("the name, only where a person reads it", () => {
  const strings = "android/app/src/main/res/values/strings.xml";

  it("renames Android's strings and keeps a capital label in capitals", () => {
    const xml = '<string name="app_name">Awqat</string>\n<string name="widget_today_label">AWQAT</string>\n' +
      '<string name="talk_tile_label">Talk to Awqat</string>\n<string name="package_name">app.awqat</string>';
    expect(renameShown(strings, xml, OLD, SABR)).toBe('<string name="app_name">Sabr</string>\n<string name="widget_today_label">SABR</string>\n' +
      '<string name="talk_tile_label">Talk to Sabr</string>\n<string name="package_name">app.awqat</string>');
  });

  it("renames strings in code and leaves comments, type names and ids", () => {
    const swift = '/// "Talk to Awqat": the app opens on the Talk sheet.\nstruct TalkToAwqatIntent: AppIntent {\n' +
      '    static let title: LocalizedStringResource = "Talk to Awqat"\n    // Awqat says this.\n}';
    expect(renameShown("ios/App/App/AwqatIntents.swift", swift, OLD, SABR)).toBe('/// "Talk to Awqat": the app opens on the Talk sheet.\n' +
      'struct TalkToAwqatIntent: AppIntent {\n    static let title: LocalizedStringResource = "Talk to Sabr"\n    // Awqat says this.\n}');
    const ts = "  mic: () => \"The microphone is off for Awqat. Turn it on in the phone's Settings, Apps, Awqat, Permissions.\",\n" +
      "/** Awqat: boots the state. */\n    `</div><p class=\"foot\">Awqat 0.19, open source (MIT) · ` +\n      `Awqat.</p>`";
    expect(renameShown("src/ui/views.ts", ts, OLD, SABR)).toBe("  mic: () => \"The microphone is off for Sabr. Turn it on in the phone's Settings, Apps, Sabr, Permissions.\",\n" +
      "/** Awqat: boots the state. */\n    `</div><p class=\"foot\">Sabr 0.19, open source (MIT) · ` +\n      `Sabr.</p>`");
  });

  it("never changes a name that sits inside an id, a group or a link", () => {
    const cur: Identity = { id: "com.example.sabr", name: "sabr", group: "group.com.example.sabr", scheme: "sabr" };
    const next = { ...cur, name: "Noor" };
    const ts = 'expect(uri("/data/user/0/com.example.sabr/cache/a.jpg")).toBe("sabr://go/faith"); say("Open sabr once");';
    expect(renameShown("test/coverFiles.test.ts", ts, cur, next))
      .toBe('expect(uri("/data/user/0/com.example.sabr/cache/a.jpg")).toBe("sabr://go/faith"); say("Open Noor once");');
    const xml = '<string name="package_name">com.example.sabr</string>\n<string name="app_name">sabr</string>';
    expect(renameShown(strings, xml, cur, next)).toBe('<string name="package_name">com.example.sabr</string>\n<string name="app_name">Noor</string>');
  });

  it("leaves a key or a file name that only starts with the name", () => {
    const ts = 'const key = "Awqat-cache"; const file = "Awqat.v1"; const tail = "old-Awqat"; say("Open Awqat. Then wait, Awqat-wide.");';
    expect(renameShown("src/store.ts", ts, OLD, SABR))
      .toBe('const key = "Awqat-cache"; const file = "Awqat.v1"; const tail = "old-Awqat"; say("Open Sabr. Then wait, Awqat-wide.");');
  });

  it("renames the config, the page title and the plist values people see", () => {
    expect(renameShown("capacitor.config.ts", '  /** Awqat, as it is set up. */\n  appName: "Awqat",', OLD, SABR))
      .toBe('  /** Awqat, as it is set up. */\n  appName: "Sabr",');
    expect(renameShown("index.html", "<title>Awqat</title>", OLD, SABR)).toBe("<title>Sabr</title>");
    const plist = "<!-- Awqat asks. -->\n<key>CFBundleDisplayName</key>\n\t<string>Awqat</string>\n<key>NSPhotoLibraryAddUsageDescription</key>\n" +
      "\t<string>Awqat never saves photos.</string>\n<key>CFBundleURLName</key>\n\t<string>Awqat</string>";
    expect(renameShown("ios/App/App/Info.plist", plist, OLD, SABR)).toBe("<!-- Awqat asks. -->\n<key>CFBundleDisplayName</key>\n\t<string>Sabr</string>\n" +
      "<key>NSPhotoLibraryAddUsageDescription</key>\n\t<string>Sabr never saves photos.</string>\n<key>CFBundleURLName</key>\n\t<string>Awqat</string>");
  });

  it("leaves docs, licences, credits, style sheets and the privacy page alone", () => {
    for (const file of ["README.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "docs/backend.md", "src/ui/app.css", "public/privacypolicy.html", "brand/README.md"]) {
      expect(renameShown(file, "Awqat is built by Itqan Studio", OLD, SABR)).toBe("Awqat is built by Itqan Studio");
    }
  });

  it("knows a new name the app already shows, and a line it could not read into", () => {
    const xml = '<string name="app_name">Awqat</string>\n<string name="shortcut_talk">Talk</string>\n<string name="prayer_day_label">TODAY</string>';
    expect(nameTaken(strings, xml, OLD, { ...SABR, name: "Talk" })).toBe(true);
    expect(nameTaken(strings, xml, OLD, { ...SABR, name: "Today" })).toBe(true);
    expect(nameTaken(strings, xml, OLD, SABR)).toBe(false);
    expect(nameTaken(strings, xml, OLD, { ...SABR, name: "Awqat Pro" })).toBe(false);
    const ts = "const a = `first line\n  Awqat on a line with no quote\n  last`;\n// Awqat in a comment";
    expect(nameLeftOn("src/ui/x.ts", renameShown("src/ui/x.ts", ts, OLD, SABR), OLD, SABR)).toEqual([2]);
    expect(nameLeftOn("src/ui/x.ts", 'say("Awqat Pro")', OLD, { ...SABR, name: "Awqat Pro" })).toEqual([]);
  });

  it("can be run again: a renamed file renames once more", () => {
    const noor: Identity = { id: "org.example.noor", name: "Noor", group: "group.org.example.noor", scheme: "noor" };
    const xml = '<string name="app_name">Awqat</string>\n<string name="package_name">app.awqat</string>\n<string name="widget_today_label">AWQAT</string>';
    const once = transformFile(strings, xml, OLD, SABR);
    expect(transformFile(strings, once, SABR, noor))
      .toBe('<string name="app_name">Noor</string>\n<string name="package_name">org.example.noor</string>\n<string name="widget_today_label">NOOR</string>');
    expect(transformFile(strings, once, SABR, SABR)).toBe(once);
  });
});

describe("the guards around a run", () => {
  it("lists the places that are missing", () => {
    const texts = new Map([["android/app/build.gradle", 'namespace = "app.awqat"']]);
    const missing = missingPlaces(texts, OLD, SABR);
    expect(missing).toContain("android/app/build.gradle: could not find applicationId.");
    expect(missing.some((line) => line.startsWith("src/books/coverFiles.ts:"))).toBe(true);
    expect(missing.some((line) => line.includes("no Java sources"))).toBe(true);
    expect(missingPlaces(texts, OLD, OLD)).toEqual([]);
  });

  it("refuses a new id, group or scheme that is already written", () => {
    const texts = new Map([["android/app/src/main/java/app/awqat/A.java", 'package app.awqat;\nimport com.getcapacitor.Plugin;\nString s = "awqat://go/x https://example.com";']]);
    expect(alreadyTaken(texts, OLD, { ...SABR, id: "com.getcapacitor" })).toHaveLength(1);
    expect(alreadyTaken(texts, OLD, { ...SABR, scheme: "https" })).toHaveLength(1);
    expect(alreadyTaken(texts, OLD, SABR)).toEqual([]);
    // Going back to a shorter id is not a clash with the longer one it is part of.
    const longer = new Map([["android/app/src/main/java/app/awqat/pro/A.java", "package app.awqat.pro;"]]);
    expect(alreadyTaken(longer, { ...OLD, id: "app.awqat.pro" }, { ...OLD, id: "app.awqat" })).toEqual([]);
  });

  it("notices anything of the old id, group or scheme left behind", () => {
    const linked = { ...SABR, scheme: "sabr" };
    expect(leftBehind(new Map([["a.xml", "com.example.sabr and group.com.example.sabr and sabr://go"]]), OLD, linked)).toEqual([]);
    expect(leftBehind(new Map([["a.xml", "xapp.awqat"]]), OLD, linked)).toEqual(["a.xml: still says app.awqat."]);
    expect(leftBehind(new Map([["a.ts", "awqat://go/faith"]]), OLD, linked)).toEqual(["a.ts: still says awqat://."]);
    expect(leftBehind(new Map([["a.ts", "group.app.awqat"]]), OLD, linked)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// A whole run, in a copy of the tree under the system's temporary folder.

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const KINDS = new Set([".ts", ".tsx", ".java", ".kt", ".xml", ".gradle", ".pro", ".swift", ".plist", ".entitlements", ".pbxproj", ".xcconfig", ".html", ".mjs"]);
const NOT_COPIED = new Set(["node_modules", "dist", "build", ".git", "Pods", "DerivedData", ".gradle", "xcuserdata", "assets", "public", "fixtures"]);
const COPIED = ["capacitor.config.ts", "index.html", "scripts/make-it-yours.mjs", "src", "test", "android/app", "ios/App"];
const JAVA = "android/app/src/main/java";

let scratch = "";
let pristine = "";
let made = 0;

function copyTree(from: string, to: string): void {
  const wanted = (source: string): boolean => !NOT_COPIED.has(basename(source)) && (lstatSync(source).isDirectory() || KINDS.has(extname(source)));
  cpSync(from, to, { recursive: true, filter: wanted });
}

/** A fresh copy of the tree to run in, never this repository. */
function freshCopy(): string {
  made += 1;
  const dir = join(scratch, `copy-${made}`);
  cpSync(pristine, dir, { recursive: true });
  return dir;
}

function run(dir: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  if (!dir.startsWith(scratch + sep) || dir.startsWith(realpathSync(REPO) + sep)) throw new Error("The script runs only in a temporary copy.");
  const result = spawnSync(process.execPath, [join(dir, "scripts", "make-it-yours.mjs"), ...args], { cwd: dir, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function listFiles(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) return [];
    return entry.isDirectory() ? listFiles(full, base) : [relative(base, full).split(sep).join("/")];
  });
}

const snapshot = (dir: string): Map<string, string> => new Map(listFiles(dir).sort().map((file) => [file, readFileSync(join(dir, file), "utf8")]));
const read = (dir: string, file: string): string => readFileSync(join(dir, file), "utf8");
const identityOf = (dir: string): Identity => currentIdentity((file) => (existsSync(join(dir, file)) ? read(dir, file) : null));
/** Files of the copy that hold `word`, leaving out this test, which the script skips on purpose. */
const holding = (dir: string, word: string, under: string[]): string[] => listFiles(dir)
  .filter((file) => under.some((prefix) => file === prefix || file.startsWith(`${prefix}/`)) && file !== "test/makeItYours.test.ts")
  .filter((file) => read(dir, file).includes(word));
const NATIVE = ["android", "ios", "capacitor.config.ts", "src/books/coverFiles.ts"];
const git = (dir: string, args: string[]): number | null =>
  spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" }).status;

describe("a whole run in a temporary copy", { timeout: 60_000 }, () => {
  let was: Identity = OLD;
  /** Two made-up identities that are not the tree's own, so the test also holds in a fork that was already renamed. */
  let one: Identity = SABR;
  let two: Identity = SABR;

  beforeAll(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), "make-it-yours-")));
    pristine = join(scratch, "pristine");
    for (const part of COPIED) {
      mkdirSync(dirname(join(pristine, part)), { recursive: true });
      copyTree(join(REPO, part), join(pristine, part));
    }
    was = identityOf(pristine);
    const made = [
      { id: "com.example.sabr", name: "Sabr", group: "group.com.example.sabr", scheme: "sabr" },
      { id: "org.example.noor_app", name: "Noor Days", group: "group.org.example.shared", scheme: "noor" },
      { id: "net.example.rahma", name: "Rahma", group: "group.net.example.rahma", scheme: "rahma" },
    ].filter((who) => who.id !== was.id && who.name !== was.name && who.scheme !== was.scheme);
    [one, two] = [made[0] ?? SABR, made[1] ?? SABR];
  });

  afterAll(() => {
    if (scratch.startsWith(realpathSync(tmpdir()) + sep)) rmSync(scratch, { recursive: true, force: true });
  });

  it("renames the id, the group and the name, and moves the Java folder", () => {
    const dir = freshCopy();
    const result = run(dir, ["--id", one.id, "--name", one.name, "--force"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(holding(dir, was.id, NATIVE)).toEqual([]);
    expect(holding(dir, was.id, ["src", "test"])).toEqual([]);
    expect(identityOf(dir)).toEqual({ id: one.id, name: one.name, group: `group.${one.id}`, scheme: was.scheme });

    const javaDir = join(dir, JAVA, ...one.id.split("."));
    const sources = readdirSync(javaDir).filter((file) => file.endsWith(".java"));
    expect(sources).toContain("MainActivity.java");
    expect(existsSync(join(dir, JAVA, ...was.id.split(".")))).toBe(false);
    for (const file of sources) expect(read(javaDir, file), file).toMatch(new RegExp(`^package ${one.id.replaceAll(".", "\\.")};$`, "m"));
    expect(existsSync(join(dir, "android/app/src/test/java", ...one.id.split(".")))).toBe(true);
    expect(result.stdout).toContain(`${JAVA}/${one.id.replaceAll(".", "/")}/MainActivity.java`);

    expect(read(dir, "android/app/build.gradle")).toContain(`namespace = "${one.id}"`);
    expect(read(dir, "android/app/build.gradle")).toContain(`applicationId "${one.id}"`);
    expect(read(dir, "android/app/proguard-rules.pro")).toContain(`-keep class ${one.id}.WidgetBridgePlugin`);
    expect(read(dir, "android/app/src/main/res/xml/shortcuts.xml")).toContain(`android:targetClass="${one.id}.MainActivity"`);
    expect(read(dir, "android/app/src/main/res/xml/shortcuts.xml")).toContain(`android:targetPackage="${one.id}"`);
    expect(read(dir, "android/app/src/main/res/xml/shortcuts.xml")).toContain(`android:data="${was.scheme}://go/talk"`);
    const project = read(dir, "ios/App/App.xcodeproj/project.pbxproj");
    expect(project).toContain(`PRODUCT_BUNDLE_IDENTIFIER = ${one.id};`);
    expect(project).toContain(`PRODUCT_BUNDLE_IDENTIFIER = ${one.id}.widgets;`);
    for (const file of ["ios/App/App/App.entitlements", "ios/App/PersonalOSWidgets/PersonalOSWidgets.entitlements"]) {
      expect(read(dir, file)).toContain(`<string>group.${one.id}</string>`);
    }
    expect(read(dir, "ios/App/PersonalOSWidgets/Shared/SharedStore.swift")).toContain(`"group.${one.id}"`);

    const strings = read(dir, "android/app/src/main/res/values/strings.xml");
    expect(strings).toContain(`<string name="app_name">${one.name}</string>`);
    expect(strings).toContain(`<string name="package_name">${one.id}</string>`);
    expect(strings).not.toContain(was.name);
    expect(strings).not.toContain(was.name.toUpperCase());
    expect(read(dir, "index.html")).toContain(`<title>${one.name}</title>`);
    expect(read(dir, "ios/App/App/Info.plist")).toMatch(new RegExp(`<key>CFBundleDisplayName</key>\\s*<string>${one.name}</string>`));
    expect(read(dir, "ios/App/PersonalOSWidgets/Info.plist")).toContain(`<string>${one.name}</string>`);
    expect(read(dir, "ios/App/PersonalOSWidgets/TalkControl.swift")).toContain(`.displayName("Talk to ${one.name}")`);
    // Comments keep the name they were written with.
    expect(read(javaDir, "TalkTileService.java")).toContain(`Talk to ${was.name}`);
  });

  it("writes an OWN_FOLDER that matches the new id's folders and not the old one's", () => {
    const dir = freshCopy();
    expect(run(dir, ["--id", one.id, "--force"]).status).toBe(0);
    const source = /const OWN_FOLDER = \/(.+)\/;/.exec(read(dir, "src/books/coverFiles.ts"))?.[1];
    expect(source).toBeDefined();
    const own = new RegExp(source ?? "never");
    expect(own.test(`/data/user/0/${one.id}/cache/IMG_1.jpg`)).toBe(true);
    expect(own.test(`/storage/emulated/0/Android/data/${one.id}/files/Pictures/a.jpg`)).toBe(true);
    expect(own.test(`/data/user/0/${was.id}/cache/IMG_1.jpg`)).toBe(false);
    expect(own.test(`/data/user/0/${one.id.replaceAll(".", "x")}/cache/IMG_1.jpg`)).toBe(false);
    expect(own.test(`/data/user/0/${one.id}.evil/cache/IMG_1.jpg`)).toBe(false);
  });

  it("runs again on a tree it already renamed, with a group and a scheme of its own", () => {
    const dir = freshCopy();
    expect(run(dir, ["--id", one.id, "--name", one.name, "--force"]).status).toBe(0);
    const again = run(dir, ["--id", two.id, "--name", two.name, "--group", two.group, "--scheme", two.scheme, "--force"]);
    expect(again.stderr).toBe("");
    expect(again.status).toBe(0);
    expect(identityOf(dir)).toEqual(two);
    for (const word of [was.id, one.id, `${was.scheme}://`, `${was.scheme}:\\/\\/`]) expect(holding(dir, word, [...NATIVE, "src", "test"]), word).toEqual([]);
    expect(existsSync(join(dir, JAVA, ...two.id.split("."), "MainActivity.java"))).toBe(true);
    expect(existsSync(join(dir, JAVA, ...one.id.split(".")))).toBe(false);
    expect(read(dir, "android/app/src/main/res/values/strings.xml")).toContain(`<string name="app_name">${two.name}</string>`);
    expect(read(dir, "android/app/src/main/res/values/strings.xml")).not.toContain(one.name);
    expect(read(dir, "android/app/src/main/res/xml/shortcuts.xml")).toContain(`android:data="${two.scheme}://go/talk"`);
    expect(read(dir, "ios/App/App/Info.plist")).toMatch(new RegExp(`<key>CFBundleURLSchemes</key>\\s*<array>\\s*<string>${two.scheme}</string>`));
    expect(read(dir, "src/app/widget.ts")).toContain(`${two.scheme}:\\/\\/go\\/`);
    expect(read(dir, "ios/App/PersonalOSWidgets/Shared/SharedStore.swift")).toContain(`"${two.group}"`);

    const settled = snapshot(dir);
    const same = run(dir, ["--id", two.id, "--name", two.name, "--group", two.group, "--scheme", two.scheme, "--force"]);
    expect(same.status).toBe(0);
    expect(same.stdout).toContain("Nothing to change");
    expect(snapshot(dir)).toEqual(settled);
  });

  it("changes nothing on a dry run, and prints the plan", () => {
    const dir = freshCopy();
    const before = snapshot(dir);
    const result = run(dir, ["--id", one.id, "--name", one.name, "--scheme", one.scheme, "--dry-run"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("would change  capacitor.config.ts");
    expect(result.stdout).toContain(`would move    ${JAVA}/${was.id.replaceAll(".", "/")}/MainActivity.java`);
    expect(result.stdout).toContain("Nothing was changed.");
    expect(snapshot(dir)).toEqual(before);
    expect(listFiles(dir).filter((file) => file.endsWith(".tmp"))).toEqual([]);
  });

  it("refuses bad input and leaves the tree as it was", () => {
    const dir = freshCopy();
    const before = snapshot(dir);
    const refused: string[][] = [
      ["--id", "Sabr", "--name", one.name], ["--id", "com.example.class", "--name", one.name], ["--id", "../../outside", "--name", one.name],
      ["--id", "com.example/sabr", "--name", one.name], ["--id", one.id, "--name", "<b>Sabr</b>"], ["--id", one.id, "--name", 'Sa"br'],
      ["--id", one.id, "--name", "x".repeat(31)], ["--id", one.id, "--name", one.name, "--group", "com.example.sabr"],
      ["--id", one.id, "--name", one.name, "--scheme", "https"], ["--id", one.id, "--name", one.name, "--accent", "red"],
      ["--id", one.id, "--name", one.name, "--accent", "#112233"], ["--id", one.id, "--nope"], [],
    ];
    for (const args of refused) {
      const result = run(dir, [...args, "--force"]);
      expect(result.status, args.join(" ")).toBe(2);
      expect(result.stderr.trim(), args.join(" ")).not.toBe("");
    }
    expect(snapshot(dir)).toEqual(before);
  });

  it("refuses a name or an id the tree already uses for something else", () => {
    const dir = freshCopy();
    const before = snapshot(dir);
    const name = run(dir, ["--name", "Talk", "--force"]);
    expect(name.status).toBe(1);
    expect(name.stderr).toContain("already a word the app shows");
    const id = run(dir, ["--id", "com.getcapacitor", "--force"]);
    expect(id.status).toBe(1);
    expect(id.stderr).toContain("already written");
    expect(snapshot(dir)).toEqual(before);
  });

  it("stops before writing when an expected place is missing", () => {
    const dir = freshCopy();
    const gradle = join(dir, "android/app/build.gradle");
    writeFileSync(gradle, read(dir, "android/app/build.gradle").replace(/applicationId\s+"[^"]+"/, "applicationId project.appId"));
    const before = snapshot(dir);
    const result = run(dir, ["--id", one.id, "--name", one.name, "--force"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("android/app/build.gradle: could not find applicationId.");
    expect(result.stderr).toContain("Nothing was changed.");
    expect(snapshot(dir)).toEqual(before);
  });

  it("never follows a symbolic link out of the tree", () => {
    const dir = freshCopy();
    const outside = join(scratch, `outside-${made}`);
    mkdirSync(outside);
    const secret = `export const id = "${was.id}";\n`;
    writeFileSync(join(outside, "secret.ts"), secret);
    symlinkSync(outside, join(dir, "src", "linked"), "dir");
    const result = run(dir, ["--id", one.id, "--name", one.name, "--force"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("src/linked");
    expect(readFileSync(join(outside, "secret.ts"), "utf8")).toBe(secret);

    const other = freshCopy();
    rmSync(join(other, "android/app/build.gradle"));
    writeFileSync(join(outside, "build.gradle"), `namespace = "${was.id}"\napplicationId "${was.id}"\n`);
    symlinkSync(join(outside, "build.gradle"), join(other, "android/app/build.gradle"));
    expect(run(other, ["--id", one.id, "--name", one.name, "--force"]).status).toBe(1);
    expect(readFileSync(join(outside, "build.gradle"), "utf8")).toContain(was.id);
  });

  it("refuses uncommitted changes unless forced, and runs on a clean tree", () => {
    const dir = freshCopy();
    const bare = run(dir, ["--id", one.id, "--name", one.name]);
    expect(bare.status).toBe(2);
    expect(bare.stderr).toContain("no git history");
    if (git(dir, ["init", "-q"]) !== 0) return; // No git on this machine: the rest cannot be shown.
    const dirty = run(dir, ["--id", one.id, "--name", one.name]);
    expect(dirty.status).toBe(2);
    expect(dirty.stderr).toContain("uncommitted changes");
    expect(identityOf(dir)).toEqual(was);
    if (git(dir, ["add", "-A"]) !== 0 || git(dir, ["commit", "-q", "--no-verify", "-m", "start"]) !== 0) return;
    expect(run(dir, ["--id", one.id, "--name", one.name]).status).toBe(0);
    expect(identityOf(dir).id).toBe(one.id);
  });
});
