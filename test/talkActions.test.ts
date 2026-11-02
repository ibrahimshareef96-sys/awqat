// @vitest-environment happy-dom
// Talking inside the app: the passphrase once, then the microphone, the Worker's talk, and ElevenLabs over WebRTC, all
// in the app's own sheet. A talk that never connects is given back; a late answer from an ended attempt is let go;
// the session goes only to the Worker it came from and is dropped when that Worker no longer knows it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  startTalk: vi.fn(),
  markTalk: vi.fn(),
  signOut: vi.fn(async () => true),
  readSession: vi.fn(async () => null as null | { worker: string; token: string }),
  writeSession: vi.fn(async () => true),
  clearSession: vi.fn(async () => true),
  askMicrophone: vi.fn(async () => undefined),
  startSession: vi.fn(),
  weatherFor: vi.fn(async () => null as unknown),
  platform: "android",
}));
vi.mock("../src/talk/weather.ts", async (actual) => ({ ...(await actual<typeof import("../src/talk/weather.ts")>()),
  weatherFor: mocks.weatherFor }));
vi.mock("../src/talk/worker.ts", async (actual) => ({ ...(await actual<typeof import("../src/talk/worker.ts")>()),
  signIn: mocks.signIn, startTalk: mocks.startTalk, markTalk: mocks.markTalk, signOut: mocks.signOut }));
vi.mock("../src/talk/session.ts", async (actual) => ({ ...(await actual<typeof import("../src/talk/session.ts")>()),
  readSession: mocks.readSession, writeSession: mocks.writeSession, clearSession: mocks.clearSession }));
vi.mock("../src/talk/mic.ts", async (actual) => ({ ...(await actual<typeof import("../src/talk/mic.ts")>()),
  askMicrophone: mocks.askMicrophone }));
vi.mock("../src/talk/sdk.ts", () => ({ loadConversation: async () => ({ startSession: mocks.startSession }) }));
vi.mock("../src/device.ts", () => ({ isNative: () => true, platform: () => mocks.platform }));
vi.mock("../src/store.ts", () => ({ KEYS: { settings: "settings" }, write: vi.fn(async () => true), read: vi.fn(),
  keepAside: vi.fn() }));
vi.mock("@capacitor/browser", () => ({ Browser: { open: vi.fn() } }));

import { hooks, state } from "../src/app/state.ts";
import { TALK_TEXT, WORKLETS, endTalk, openTalk, pauseTalk, readyTalk, signOutOfTalk, startAgain, stopTalk, talkSignIn,
  talkSignal, talkUnderWay, toggleMute } from "../src/talk/talk.ts";
import { QUIET, SILENT } from "../src/talk/signal.ts";

const WORKER = "https://os.example.com";
const SESSION = "s".repeat(43);
const CALL = "0b7d3c62-4f1e-4c55-9a51-2d3e4f5a6b7c";
const STARTED = { ok: true, callId: CALL, conversationToken: "tok.en", variables: { channel: "app" } };

interface Fake {
  options: Record<string, any>;
  endSession: ReturnType<typeof vi.fn>;
  setMicMuted: ReturnType<typeof vi.fn>;
}

/** A pending promise to settle by hand, for a call still on its way. */
function pending<T>(): { promise: Promise<T>; settle: (value: T) => void } {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((done) => { settle = done; });
  return { promise, settle };
}

/** The fake SDK's last session: its options (the callbacks) and its controls. */
let last: Fake | null = null;

function connectable(): void {
  mocks.startSession.mockImplementation(async (options: Record<string, any>) => {
    last = { options, endSession: vi.fn(async () => undefined), setMicMuted: vi.fn() };
    return { endSession: last.endSession, setMicMuted: last.setMicMuted, getInputVolume: () => 0.2, getOutputVolume: () => 0.4 };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  last = null;
  connectable();
  mocks.readSession.mockResolvedValue({ worker: WORKER, token: SESSION });
  mocks.startTalk.mockResolvedValue(STARTED);
  mocks.weatherFor.mockResolvedValue(null);
  state.settings = { ...state.settings, voiceUrl: WORKER };
  state.sheet = "talk";
  state.talk = { phase: "idle", message: "", caption: "", muted: false, logged: "", session: null, sessionRead: false };
  hooks.paintTalk = vi.fn();
  hooks.closeSheet = vi.fn();
  hooks.render = vi.fn();
  hooks.softRender = vi.fn();
  state.notice = "";
  mocks.signOut.mockResolvedValue(true);
  mocks.markTalk.mockResolvedValue(true);
  mocks.platform = "android";
});

afterEach(async () => {
  // Each test starts with no talk going and nothing left to end.
  await stopTalk();
  await stopTalk();
});

describe("signing in once", () => {
  it("asks for the passphrase when there is no session, and asks for nothing else", async () => {
    mocks.readSession.mockResolvedValue(null);
    await openTalk();
    expect(state.talk.phase).toBe("signin");
    expect(mocks.askMicrophone).not.toHaveBeenCalled();
    expect(mocks.startTalk).not.toHaveBeenCalled();
  });

  it("keeps the session in its file and starts the talk at once", async () => {
    mocks.readSession.mockResolvedValue(null);
    mocks.signIn.mockResolvedValue({ ok: true, token: SESSION });
    await openTalk();
    await talkSignIn("my passphrase");
    expect(mocks.signIn).toHaveBeenCalledWith(WORKER, "my passphrase");
    expect(mocks.writeSession).toHaveBeenCalledWith({ worker: WORKER, token: SESSION });
    expect(mocks.startTalk).toHaveBeenCalledWith(WORKER, SESSION);
    expect(mocks.startSession).toHaveBeenCalledTimes(1);
    expect(last?.options).toMatchObject({ conversationToken: "tok.en", connectionType: "webrtc",
      dynamicVariables: { channel: "app" }, workletPaths: WORKLETS });
    expect(JSON.stringify(state.talk)).not.toContain("my passphrase");
  });

  it("starts the agent with today from the app ({{life}}) beside the Worker's variables, weather included", async () => {
    mocks.weatherFor.mockResolvedValue({ at: Date.now(), place: "Dubai",
      now: { temp: 30.4, feels: 34.6, humidity: 70, wind: 14.7, code: 0 }, days: [{ high: 32, low: 26, rain: 0, code: 0 }] });
    await openTalk();
    const variables = last?.options.dynamicVariables as Record<string, string>;
    expect(variables.channel).toBe("app");
    expect(variables.life).toContain("Today is ");
    expect(variables.life).toContain("Weather for Dubai: now 30 degrees, feels like 35, clear");
    expect(mocks.weatherFor).toHaveBeenCalledWith(state.place);
  });

  it("gives the talk back when it is ended while the weather is still being asked", async () => {
    const weather = pending<unknown>();
    mocks.weatherFor.mockReturnValue(weather.promise);
    const opening = openTalk();
    await vi.waitFor(() => expect(mocks.startTalk).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    await stopTalk();
    weather.settle(null);
    await opening;
    expect(mocks.startSession).not.toHaveBeenCalled();
    expect(mocks.markTalk).toHaveBeenCalledWith(WORKER, SESSION, "abandon", CALL);
  });

  it("stays on the form with the Worker's own words for a wrong passphrase, keeping nothing", async () => {
    mocks.readSession.mockResolvedValue(null);
    mocks.signIn.mockResolvedValue({ ok: false, status: 401, error: "That passphrase did not match. 4 tries left." });
    await openTalk();
    await talkSignIn("not it");
    expect(state.talk.phase).toBe("signin");
    expect(state.talk.message).toBe("That passphrase did not match. 4 tries left.");
    expect(mocks.writeSession).not.toHaveBeenCalled();
    expect(mocks.startTalk).not.toHaveBeenCalled();
  });

  it("still talks when the session could not be kept, and says it will ask again next time", async () => {
    mocks.readSession.mockResolvedValue(null);
    mocks.signIn.mockResolvedValue({ ok: true, token: SESSION });
    mocks.writeSession.mockResolvedValueOnce(false);
    await openTalk();
    await talkSignIn("my passphrase");
    expect(mocks.startTalk).toHaveBeenCalled();
    expect(state.talk.session).toEqual({ worker: WORKER, token: SESSION });
  });

  it("never hands the session to another Worker than the one it came from", async () => {
    state.settings = { ...state.settings, voiceUrl: "https://other.example.com" };
    await openTalk();
    expect(state.talk.phase).toBe("signin");
    expect(mocks.startTalk).not.toHaveBeenCalled();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
});

describe("Talk opened by a link (a widget, a shortcut, Siri)", () => {
  it("waits for the Talk button: no microphone, no talk, until it is tapped", async () => {
    state.talk = { ...state.talk, message: TALK_TEXT.ended, caption: "You: the last words" };
    readyTalk();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.talk).toMatchObject({ phase: "idle", message: TALK_TEXT.ready, caption: "" });
    expect(mocks.askMicrophone).not.toHaveBeenCalled();
    expect(mocks.startTalk).not.toHaveBeenCalled();
    expect(mocks.startSession).not.toHaveBeenCalled();
    await startAgain();
    expect(mocks.askMicrophone).toHaveBeenCalledTimes(1);
    expect(mocks.startSession).toHaveBeenCalledTimes(1);
  });

  it("leaves a sign-in form or a talk already going as it is", async () => {
    state.talk = { ...state.talk, phase: "signin", message: "Sign in once." };
    readyTalk();
    expect(state.talk).toMatchObject({ phase: "signin", message: "Sign in once." });
    state.talk = { ...state.talk, phase: "idle", message: "" };
    await openTalk();
    const going = state.talk.phase;
    readyTalk();
    expect(state.talk.phase).toBe(going);
    expect(mocks.startSession).toHaveBeenCalledTimes(1);
  });

  it("says when a talk is under way, so no link can end it", async () => {
    expect(talkUnderWay()).toBe(false);
    await openTalk();
    expect(talkUnderWay()).toBe(true);
    await stopTalk();
    expect(talkUnderWay()).toBe(false);
  });
});

describe("a talk", () => {
  it("asks for the microphone first; a refusal says how to allow it and reserves nothing", async () => {
    mocks.askMicrophone.mockRejectedValueOnce(Object.assign(new Error("no"), { name: "NotAllowedError" }));
    await openTalk();
    expect(state.talk.phase).toBe("idle");
    expect(state.talk.message).toBe(TALK_TEXT.micRefused);
    expect(mocks.startTalk).not.toHaveBeenCalled();
  });

  it("drops a session the Worker no longer knows and asks for the passphrase again", async () => {
    mocks.startTalk.mockResolvedValueOnce({ ok: false, status: 401, error: "You are signed out." });
    await openTalk();
    expect(mocks.clearSession).toHaveBeenCalled();
    expect(state.talk.session).toBeNull();
    expect(state.talk.phase).toBe("signin");
    expect(state.talk.message).toBe(TALK_TEXT.signedOut);
  });

  it("says the Worker's refusal plainly (a call going, ElevenLabs), and connects nothing", async () => {
    mocks.startTalk.mockResolvedValueOnce({ ok: false, status: 502, error: "ElevenLabs would not start the talk." });
    await openTalk();
    expect(state.talk).toMatchObject({ phase: "idle", message: "ElevenLabs would not start the talk." });
    expect(mocks.startSession).not.toHaveBeenCalled();
  });

  it("tells the Worker once it connected, and follows the agent: listening, speaking, working, what was said", async () => {
    await openTalk();
    expect(state.talk.phase).toBe("connecting");
    last!.options.onConnect();
    expect(mocks.markTalk).toHaveBeenCalledWith(WORKER, SESSION, "connected", CALL);
    expect(state.talk).toMatchObject({ phase: "listening", message: TALK_TEXT.listening });
    last!.options.onModeChange({ mode: "speaking" });
    expect(state.talk.phase).toBe("speaking");
    last!.options.onAgentToolRequest();
    expect(state.talk.phase).toBe("working");
    last!.options.onMessage({ message: "What is on today?", role: "user" });
    expect(state.talk.caption).toBe("You: What is on today?");
    last!.options.onMessage({ message: "Two meetings.", role: "agent" });
    expect(state.talk.caption).toBe("Two meetings.");
    last!.options.onDisconnect({ reason: "user" });
    expect(state.talk).toMatchObject({ phase: "idle", message: TALK_TEXT.ended });
    expect(mocks.markTalk).not.toHaveBeenCalledWith(WORKER, SESSION, "abandon", CALL);
  });

  it("gives the talk back when it could not connect, or dropped before it did", async () => {
    mocks.startSession.mockRejectedValueOnce(new Error("ice failed"));
    await openTalk();
    expect(mocks.markTalk).toHaveBeenCalledWith(WORKER, SESSION, "abandon", CALL);
    expect(state.talk).toMatchObject({ phase: "idle", message: TALK_TEXT.connect });
    vi.clearAllMocks();
    connectable();
    await startAgain();
    last!.options.onDisconnect({ reason: "error" });
    expect(mocks.markTalk).toHaveBeenCalledWith(WORKER, SESSION, "abandon", CALL);
    expect(state.talk.message).toBe(TALK_TEXT.dropped);
  });

  it("ends: a talk not yet connected is given back, the session closed, and End then closes the sheet", async () => {
    await openTalk();
    await endTalk();
    expect(mocks.markTalk).toHaveBeenCalledWith(WORKER, SESSION, "abandon", CALL);
    expect(last!.endSession).toHaveBeenCalled();
    expect(state.talk).toMatchObject({ phase: "idle", message: TALK_TEXT.ended });
    await endTalk();
    expect(hooks.closeSheet).toHaveBeenCalled();
  });

  it("lets go of a late answer from a talk that was stopped: given back, never connected", async () => {
    const late = pending<typeof STARTED>();
    mocks.startTalk.mockReturnValueOnce(late.promise);
    const opening = openTalk();
    await vi.waitFor(() => expect(mocks.startTalk).toHaveBeenCalled());
    await stopTalk();
    late.settle(STARTED);
    await opening;
    expect(mocks.markTalk).toHaveBeenCalledWith(WORKER, SESSION, "abandon", CALL);
    expect(mocks.startSession).not.toHaveBeenCalled();
  });

  it("closes a session that comes back after its talk was stopped", async () => {
    const late = pending<Record<string, unknown>>();
    const endSession = vi.fn(async () => undefined);
    mocks.startSession.mockReturnValueOnce(late.promise);
    const opening = openTalk();
    await vi.waitFor(() => expect(mocks.startSession).toHaveBeenCalled());
    await stopTalk();
    late.settle({ endSession, setMicMuted: vi.fn() });
    await opening;
    expect(endSession).toHaveBeenCalled();
  });

  it("tells the orb what it hears: nothing before a talk, the user's voice gone while muted, a failing meter as silence", async () => {
    expect(talkSignal()).toEqual(QUIET);
    const loudBins = new Uint8Array(1024).fill(200);
    mocks.startSession.mockImplementationOnce(async (options: Record<string, any>) => {
      last = { options, endSession: vi.fn(async () => undefined), setMicMuted: vi.fn() };
      return { endSession: last.endSession, setMicMuted: last.setMicMuted, getInputVolume: () => 0.3,
        getOutputVolume: () => { throw new Error("meter gone"); }, getInputByteFrequencyData: () => loudBins };
    });
    await openTalk();
    last!.options.onConnect();
    const heard = talkSignal();
    expect(heard.him).toBeGreaterThan(0.5);
    expect(heard.himBands[0]).toBeGreaterThan(0.7);
    expect(heard.agent).toBe(0);
    expect(heard.agentBands).toEqual(SILENT);
    toggleMute();
    expect(talkSignal()).toMatchObject({ him: 0, himBands: SILENT });
  });

  it("mutes and unmutes the microphone", async () => {
    await openTalk();
    last!.options.onConnect();
    toggleMute();
    expect(last!.setMicMuted).toHaveBeenLastCalledWith(true);
    expect(state.talk.muted).toBe(true);
    toggleMute();
    expect(last!.setMicMuted).toHaveBeenLastCalledWith(false);
  });
});

describe("signing out of Talk", () => {
  it("tells the Worker, removes the file and forgets the session", async () => {
    await openTalk();
    await stopTalk();
    await signOutOfTalk();
    expect(mocks.signOut).toHaveBeenCalledWith(WORKER, SESSION);
    expect(mocks.clearSession).toHaveBeenCalled();
    expect(state.talk.session).toBeNull();
    expect(state.notice).toBe("Signed out of Talk on this phone.");
  });

  it("says when the saved sign-in could not be deleted here", async () => {
    mocks.clearSession.mockResolvedValueOnce(false);
    await openTalk();
    await stopTalk();
    await signOutOfTalk();
    expect(state.notice).toMatch(/could not delete its saved sign-in/);
  });

  it("says plainly when the Worker could not be told, and how to end the sign-in there", async () => {
    mocks.signOut.mockResolvedValueOnce(false);
    await openTalk();
    await stopTalk();
    await signOutOfTalk();
    expect(mocks.clearSession).toHaveBeenCalled();
    expect(state.notice).toMatch(/could not be reached.*up to 30 days.*passphrase/);
  });
});

describe("what a phone does mid-talk", () => {
  it("goes on through Android's microphone prompt, which pauses the app (code review HIGH)", async () => {
    const asked = pending<undefined>();
    mocks.askMicrophone.mockReturnValueOnce(asked.promise);
    const opening = openTalk();
    await vi.waitFor(() => expect(mocks.askMicrophone).toHaveBeenCalled());
    await pauseTalk();
    asked.settle(undefined);
    await opening;
    expect(mocks.startTalk).toHaveBeenCalled();
    expect(state.talk.phase).toBe("connecting");
  });

  it("on iOS, where the prompt does not pause the app, going to the background then still ends the talk", async () => {
    mocks.platform = "ios";
    const asked = pending<undefined>();
    mocks.askMicrophone.mockReturnValueOnce(asked.promise);
    const opening = openTalk();
    await vi.waitFor(() => expect(mocks.askMicrophone).toHaveBeenCalled());
    await pauseTalk();
    asked.settle(undefined);
    await opening;
    expect(mocks.startTalk).not.toHaveBeenCalled();
  });

  it("starts nothing when the sheet closed while an old voice session was still being ended (round 2 MEDIUM)", async () => {
    await openTalk();
    last!.options.onConnect();
    const stuck = last!;
    stuck.endSession.mockRejectedValueOnce(new Error("busy"));
    await endTalk();
    const slow = pending<undefined>();
    stuck.endSession.mockReturnValueOnce(slow.promise);
    vi.clearAllMocks();
    connectable();
    await new Promise((resolve) => setTimeout(resolve, 760));
    const again = startAgain();
    await vi.waitFor(() => expect(state.talk.phase).toBe("connecting"));
    await stopTalk();
    slow.settle(undefined);
    await again;
    expect(mocks.askMicrophone).not.toHaveBeenCalled();
    expect(mocks.startTalk).not.toHaveBeenCalled();
  });

  it("ignores Talk tapped again just after End (a double tap), then takes a later tap", async () => {
    await openTalk();
    last!.options.onConnect();
    await endTalk();
    vi.clearAllMocks();
    connectable();
    await startAgain();
    expect(mocks.startTalk).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 760));
    await startAgain();
    expect(mocks.startTalk).toHaveBeenCalled();
  });

  it("stops a talk when the app goes to the background at any other time", async () => {
    await openTalk();
    last!.options.onConnect();
    await pauseTalk();
    expect(last!.endSession).toHaveBeenCalled();
    expect(state.talk.phase).toBe("idle");
  });

  it("tries again to end a voice session that would not end, the next time anything stops or starts", async () => {
    await openTalk();
    last!.options.onConnect();
    const stuck = last!;
    stuck.endSession.mockRejectedValueOnce(new Error("busy"));
    await endTalk();
    expect(state.talk.message).toBe(TALK_TEXT.stillOn);
    await stopTalk();
    expect(stuck.endSession).toHaveBeenCalledTimes(2);
  });

  it("sends 'connected' again when it did not reach the Worker, so a live talk is never given back", async () => {
    vi.useFakeTimers();
    try {
      mocks.markTalk.mockResolvedValueOnce(false).mockResolvedValue(true);
      await openTalk();
      last!.options.onConnect();
      await vi.advanceTimersByTimeAsync(2100);
      const connected = mocks.markTalk.mock.calls.filter((call) => call[2] === "connected");
      expect(connected).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores the second half of a double tap on Talk, which lands on Cancel", async () => {
    const reserved = pending<typeof STARTED>();
    mocks.startTalk.mockReturnValueOnce(reserved.promise);
    const opening = openTalk();
    await vi.waitFor(() => expect(mocks.startTalk).toHaveBeenCalled());
    await endTalk();
    expect(state.talk.phase).toBe("connecting");
    reserved.settle(STARTED);
    await opening;
    expect(mocks.startSession).toHaveBeenCalled();
  });

  it("says when the microphone is busy with another app, rather than missing", async () => {
    mocks.askMicrophone.mockRejectedValueOnce(Object.assign(new Error("busy"), { name: "NotReadableError" }));
    await openTalk();
    expect(state.talk.message).toBe(TALK_TEXT.micBusy);
  });

  it("takes only the latest sign-in's answer: an earlier one coming back late is let go", async () => {
    mocks.readSession.mockResolvedValue(null);
    const first = pending<{ ok: false; status: number; error: string }>();
    mocks.signIn.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ ok: true, token: SESSION });
    await openTalk();
    const one = talkSignIn("typo");
    state.talk = { ...state.talk, phase: "signin" };
    await talkSignIn("my passphrase");
    first.settle({ ok: false, status: 401, error: "That passphrase did not match." });
    await one;
    expect(state.talk.message).not.toBe("That passphrase did not match.");
    expect(mocks.writeSession).toHaveBeenCalledWith({ worker: WORKER, token: SESSION });
  });
});

describe("a sign-in still being checked", () => {
  it("shows as checking, not as an open form, when the sheet is closed and opened again", async () => {
    mocks.readSession.mockResolvedValue(null);
    const answer = pending<{ ok: true; token: string }>();
    mocks.signIn.mockReturnValueOnce(answer.promise);
    await openTalk();
    const signing = talkSignIn("my passphrase");
    await openTalk();
    expect(state.talk.phase).toBe("signing");
    answer.settle({ ok: true, token: SESSION });
    await signing;
    expect(mocks.startTalk).toHaveBeenCalledWith(WORKER, SESSION);
  });

  it("keeps a good answer but starts no talk when Settings moved to another Worker meanwhile", async () => {
    mocks.readSession.mockResolvedValue(null);
    const answer = pending<{ ok: true; token: string }>();
    mocks.signIn.mockReturnValueOnce(answer.promise);
    await openTalk();
    const signing = talkSignIn("my passphrase");
    state.settings = { ...state.settings, voiceUrl: "https://other.example.com" };
    answer.settle({ ok: true, token: SESSION });
    await signing;
    expect(mocks.writeSession).toHaveBeenCalledWith({ worker: WORKER, token: SESSION });
    expect(mocks.startTalk).not.toHaveBeenCalled();
  });
});

describe("keeping sessions tidy", () => {
  it("keeps a good sign-in even when the sheet closed while it was checked, starting nothing", async () => {
    mocks.readSession.mockResolvedValue(null);
    const answer = pending<{ ok: true; token: string }>();
    mocks.signIn.mockReturnValueOnce(answer.promise);
    await openTalk();
    const signing = talkSignIn("my passphrase");
    state.sheet = null;
    await stopTalk();
    answer.settle({ ok: true, token: SESSION });
    await signing;
    expect(mocks.writeSession).toHaveBeenCalledWith({ worker: WORKER, token: SESSION });
    expect(mocks.startTalk).not.toHaveBeenCalled();
  });

  it("signs the old Worker's session out when Talk opens for another Worker", async () => {
    state.settings = { ...state.settings, voiceUrl: "https://other.example.com" };
    await openTalk();
    expect(mocks.signOut).toHaveBeenCalledWith(WORKER, SESSION);
    expect(mocks.clearSession).toHaveBeenCalled();
    expect(state.talk.session).toBeNull();
    expect(state.talk.phase).toBe("signin");
  });

  it("shows what the agent says without invisible or direction-changing characters, cut short", async () => {
    await openTalk();
    last!.options.onConnect();
    const hidden = [0x202e, 0x200b, 0x2066].map((code) => String.fromCodePoint(code)).join("");
    last!.options.onMessage({ message: `Two${hidden} meetings\n${"x".repeat(900)}`, role: "agent" });
    expect(state.talk.caption.startsWith("Two meetings ")).toBe(true);
    expect(state.talk.caption.length).toBeLessThanOrEqual(400);
  });
});
