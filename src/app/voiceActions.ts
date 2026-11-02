/**
 * The Worker's address in Settings, and Talk outside the installed app: in a browser the Worker's own voice page
 * opens in a new tab. In the installed app Talk runs inside the app (talk/talk.ts, since v0.8).
 */
import { Browser } from "@capacitor/browser";
import { isNative } from "../device.ts";
import { cleanWorkerUrl, talkPage, workerUrl } from "../voice.ts";
import { KEYS } from "../store.ts";
import { hooks, save, setNotice, state } from "./state.ts";

export const VOICE_MESSAGES = {
  noWorker: "Add your Worker's address in Settings, under Voice, to talk to your OS.",
  badWorker: "That is not a Worker address. It looks like https://your-worker.your-name.workers.dev",
  failed: "The voice page could not be opened just now.",
  saved: "Voice address saved.",
};

export async function openTalk(): Promise<void> {
  const worker = workerUrl(state.settings.voiceUrl);
  if (!worker) {
    setNotice(VOICE_MESSAGES.noWorker);
    return hooks.render();
  }
  try {
    if (isNative()) await Browser.open({ url: talkPage(worker), presentationStyle: "popover", toolbarColor: "#121219" });
    else window.open(talkPage(worker), "_blank", "noopener");
    hooks.closeSheet(true);
  } catch {
    setNotice(VOICE_MESSAGES.failed);
    hooks.render();
  }
}

/** The Worker's address from Settings: empty goes back to the one built in. Saved once, however often it is sent. */
export async function setWorker(value: string): Promise<void> {
  const clean = cleanWorkerUrl(value);
  if (value.trim() && !clean) {
    setNotice(VOICE_MESSAGES.badWorker);
    return hooks.softRender();
  }
  if (clean === state.settings.voiceUrl) return;
  state.settings = { ...state.settings, voiceUrl: clean };
  if (await save(KEYS.settings, state.settings)) setNotice(VOICE_MESSAGES.saved);
  hooks.softRender();
}
