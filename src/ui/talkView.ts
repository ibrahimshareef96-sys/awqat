/**
 * The Talk sheet (talk/talk.ts runs the talk): the passphrase form the first time, then the orb, what the agent is
 * doing, the last words said, mute and End. During a talk the sheet is changed in place, the same elements keeping
 * focus and a screen reader's place; only a change of layout (the form, a talk, no Worker) redraws its body.
 *
 * Motion: the speaking orb (ui/voiceOrb.ts) is a canvas that ripples with the user's voice and blooms gold with the agent's;
 * this file only places it. Under prefers-reduced-motion it is drawn still and the state shows in words.
 */
import type { TalkPhase } from "../app/state.ts";
import { esc, icon } from "./html.ts";

export interface TalkModel {
  /** The Worker's address, or "" when none is set. */
  worker: string;
  phase: TalkPhase;
  message: string;
  caption: string;
  muted: boolean;
  /** What the assistant last logged in this talk, or what became of an Undo, or "". */
  logged: string;
  /** There is a log of this talk still to take back. */
  canUndo?: boolean;
  /** "phone" or "iPad", for the words. */
  device: string;
}

type Layout = "noworker" | "signin" | "talk";

const ACTIVE: ReadonlySet<TalkPhase> = new Set(["listening", "speaking", "working"]);
/** The orb's canvas, in CSS pixels (the canvas itself is drawn at the screen's pixel ratio). */
const ORB_SIZE = 200;

function layoutOf(model: TalkModel): Layout {
  if (!model.worker) return "noworker";
  return model.phase === "signin" || model.phase === "signing" ? "signin" : "talk";
}

/** The main button: Talk when none is going, Cancel while connecting, End during a talk, Ending while it stops. */
function mainButton(phase: TalkPhase): { label: string; action: string; disabled: boolean } {
  if (phase === "idle") return { label: "Talk", action: "talk-start", disabled: false };
  if (phase === "connecting") return { label: "Cancel", action: "talk-end", disabled: false };
  if (phase === "ending") return { label: "Ending", action: "talk-end", disabled: true };
  return { label: "End", action: "talk-end", disabled: false };
}

function muteLabel(muted: boolean): string {
  return muted ? "Unmute the microphone" : "Mute the microphone";
}

/** The Worker's host, so the form says where the passphrase goes. */
function hostOf(worker: string): string {
  try {
    return new URL(worker).host;
  } catch {
    return worker;
  }
}

function signinBody(model: TalkModel): string {
  const checking = model.phase === "signing";
  const words = model.message || `Sign in once to ${hostOf(model.worker)} with your passphrase. This ${model.device} ` +
    "remembers it for 30 days.";
  return `<p id="talk-signin-note" class="text center" role="status">${esc(words)}</p>` +
    `<form id="talk-signin" class="talk-signin" data-form="talk-signin"><input id="talk-passphrase" class="field" name="passphrase" ` +
    `type="password" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" ` +
    `maxlength="1024" required aria-label="Passphrase" placeholder="Passphrase" data-autofocus` +
    `${checking ? " disabled" : ""}><div class="row-buttons center"><button type="submit" class="pill solid"` +
    `${checking ? " disabled" : ""}>${checking ? "Checking" : "Sign in"}</button><button type="button" class="pill" ` +
    `data-go="close">Close</button></div></form>`;
}

function talkBody(model: TalkModel): string {
  const main = mainButton(model.phase);
  const live = ACTIVE.has(model.phase);
  return `<p id="talk-status" class="text center" role="status" aria-live="polite">${esc(model.message)}</p>` +
    `<p id="talk-caption" class="small center talk-caption" aria-live="polite">${esc(model.caption)}</p>` +
    `<div id="talk-logged" class="talk-logged"${model.logged ? "" : " hidden"}><span id="talk-logged-line" class="small" role="status">${esc(model.logged)}</span>` +
    `<button type="button" id="talk-undo" class="ghost-link" data-action="talk-undo"${model.canUndo ? "" : " hidden"}>Undo</button></div>` +
    `<div class="row-buttons center"><button type="button" id="talk-mute" class="pill talk-mute" data-action="talk-mute" ` +
    `aria-pressed="${model.muted}" aria-label="${muteLabel(model.muted)}"${live ? "" : " disabled"}>` +
    `${icon(model.muted ? "micOff" : "mic", 18)}</button><button type="button" id="talk-main" class="pill solid" ` +
    `data-action="${main.action}" data-autofocus${main.disabled ? " disabled" : ""}>${main.label}</button><button type="button" ` +
    `class="pill" data-go="close">Close</button></div>`;
}

function noWorkerBody(): string {
  return `<p class="text center">Talking to your OS needs your Worker's address. Add it in Settings, under Voice.</p>` +
    `<div class="row-buttons center"><button type="button" class="pill solid" data-go="settings">Settings</button>` +
    `<button type="button" class="pill" data-go="close">Close</button></div>`;
}

function bodyOf(model: TalkModel, layout: Layout): string {
  return layout === "signin" ? signinBody(model) : layout === "talk" ? talkBody(model) : noWorkerBody();
}

export function talkSheet(model: TalkModel): string {
  const layout = layoutOf(model);
  return `<section class="sheet" role="dialog" aria-modal="true" aria-label="Talk"><div class="sheet-inner">` +
    `<div class="talk-orb" data-state="${model.phase}"><canvas class="voice-orb" width="${ORB_SIZE}" ` +
    `height="${ORB_SIZE}" aria-hidden="true"></canvas></div><div id="talk-body" data-layout="${layout}">` +
    `${bodyOf(model, layout)}</div></div></section>`;
}

/** Updates the open Talk sheet to the model: in place, or its body redrawn when the layout changed. */
export function paintTalk(model: TalkModel, root: Document = document): void {
  const body = root.getElementById("talk-body");
  if (body === null) return;
  root.querySelector(".talk-orb")?.setAttribute("data-state", model.phase);
  const layout = layoutOf(model);
  if (body.dataset.layout !== layout) {
    body.dataset.layout = layout;
    body.innerHTML = bodyOf(model, layout);
    (body.querySelector("[data-autofocus]") as HTMLElement | null)?.focus({ preventScroll: true });
    return;
  }
  if (layout === "signin") {
    const checking = model.phase === "signing";
    const note = root.getElementById("talk-signin-note");
    if (note) note.textContent = model.message || note.textContent;
    const input = root.getElementById("talk-passphrase") as HTMLInputElement | null;
    if (input) input.disabled = checking;
    const submit = body.querySelector("button[type=submit]") as HTMLButtonElement | null;
    if (submit) {
      submit.disabled = checking;
      submit.textContent = checking ? "Checking" : "Sign in";
    }
    // A disabled field lost focus while it was checked: after a wrong try it gets it back, ready to type again.
    if (!checking && input && (root.activeElement === null || root.activeElement === root.body)) {
      input.focus({ preventScroll: true });
    }
    return;
  }
  if (layout !== "talk") return;
  const status = root.getElementById("talk-status");
  if (status) status.textContent = model.message;
  const caption = root.getElementById("talk-caption");
  if (caption) caption.textContent = model.caption;
  const logged = root.getElementById("talk-logged");
  if (logged) logged.hidden = !model.logged;
  const loggedLine = root.getElementById("talk-logged-line");
  if (loggedLine) loggedLine.textContent = model.logged;
  const undoButton = root.getElementById("talk-undo");
  if (undoButton) undoButton.hidden = !model.canUndo;
  const mute = root.getElementById("talk-mute") as HTMLButtonElement | null;
  if (mute) {
    mute.disabled = !ACTIVE.has(model.phase);
    mute.setAttribute("aria-pressed", String(model.muted));
    mute.setAttribute("aria-label", muteLabel(model.muted));
    mute.innerHTML = icon(model.muted ? "micOff" : "mic", 18);
  }
  const main = root.getElementById("talk-main") as HTMLButtonElement | null;
  if (main) {
    const next = mainButton(model.phase);
    main.textContent = next.label;
    main.dataset.action = next.action;
    main.disabled = next.disabled;
    // A disabled button lost focus while the talk ended: it gets it back, so the keyboard and VoiceOver stay here.
    if (!next.disabled && (root.activeElement === null || root.activeElement === root.body)) {
      main.focus({ preventScroll: true });
    }
  }
}
