/**
 * Talk inside the app (v0.8, 27 Oct): the orb opens the Talk sheet and a talk starts there, with no browser page.
 *
 * The first time, the sheet asks for the passphrase; the Worker answers a session (talk/worker.ts) that is kept in a
 * file the system never backs up (talk/session.ts), and the passphrase itself is never kept. After that every tap:
 * the microphone is asked for first (so a long prompt holds no minutes), then the Worker reserves the talk and hands
 * over ElevenLabs' WebRTC token and the variables the agent starts with, then the voice library (talk/sdk.ts, loaded
 * only now) connects. Once connected the Worker is told (again, if the first word was lost), so the talk is never given
 * back; one that never connects is given back (the Worker's sweep does the same after 2 minutes if even that is lost).
 * A session the Worker no longer knows is dropped and the passphrase asked for again; one for a Worker no longer in
 * Settings is signed out there and dropped.
 *
 * Every start is its own attempt: a callback or a late answer from an earlier one is ignored, a session that comes back
 * after its attempt ended is closed at once, and a voice session that would not end is tried again the next time
 * anything stops or starts. Every sign-in is its own ticket: only the latest one's answer is taken, and a good answer
 * is kept even when the sheet closed meanwhile. Closing the sheet, or the app going to the background, ends the talk,
 * except while Android's microphone prompt is up (it pauses the app). Outside the installed app (a browser), Talk opens
 * the Worker's own voice page instead.
 */
import { isNative, platform } from "../device.ts";
import { deviceWord } from "../ui/deviceWord.ts";
import { workerUrl } from "../voice.ts";
import { openTalk as openTalkPage } from "../app/voiceActions.ts";
import { hooks, setNotice, state, today, type TalkPhase } from "../app/state.ts";
import { heardHim, logFromTalk, startTalkLog, undoFromTalk } from "../app/talkLog.ts";
import { healthNow } from "../app/bodyActions.ts";
import { lifeText } from "./life.ts";
import { homeIntentions } from "../review/muhasabah.ts";
import { askMicrophone, micRefused } from "./mic.ts";
import { loadConversation } from "./sdk.ts";
import { QUIET, SILENT, bandsOf, loudness, type VoiceSignal } from "./signal.ts";
import { clearSession, readSession, sessionToken, writeSession, type TalkSession } from "./session.ts";
import { cleanShown } from "./text.ts";
import { weatherFor, type Weather } from "./weather.ts";
import { markTalk, signIn, signOut, startTalk, type Started } from "./worker.ts";

export const TALK_TEXT = {
  connecting: "Connecting.",
  listening: "Listening.",
  speaking: "Speaking.",
  working: "Working on it.",
  ended: "Talk ended.",
  dropped: "The talk dropped. Try again.",
  micRefused: "Allow the microphone for Awqat in Settings, then try again.",
  micBusy: "The microphone is in use by another app. Try again when it is free.",
  noMic: "No microphone was found.",
  connect: "Could not connect. Voice may be blocked on this network.",
  signedOut: "You are signed out. Sign in again with your passphrase.",
  audio: "Something went wrong with the audio.",
  stillOn: "The talk may still be on. Close Talk to end it for sure.",
};

/** ElevenLabs' audio worklet, shipped inside the app (vite.config.ts): the page's policy loads scripts from itself only. */
export const WORKLETS = { rawAudioProcessor: "/talk-worklets/raw-audio-processor.js" };

/** A tap on End this soon after Talk, before the Worker answered, is the second half of a double tap: ignored. */
const END_GRACE_MS = 700;
/** "connected" is sent again after these waits if the Worker did not take it. */
const CONNECTED_RETRIES_MS = [2000, 10000];
const CAPTION_MAX = 400;

interface VoiceSession {
  endSession(): Promise<void>;
  setMicMuted?(muted: boolean): void;
  getInputVolume?(): number;
  getOutputVolume?(): number;
  getInputByteFrequencyData?(): Uint8Array;
  getOutputByteFrequencyData?(): Uint8Array;
}

/** One start: its Worker and session, the call it reserved, the voice session once there, and where it stands. */
interface Attempt {
  worker: string;
  session: string;
  callId: string | null;
  voice: VoiceSession | null;
  connected: boolean;
  ended: boolean;
  /** The microphone prompt is up (on Android it pauses the app, which must not end the talk). */
  asking: boolean;
  startedAt: number;
  /** What the agent was doing before a tool ran, to go back to after. */
  mode: "listening" | "speaking";
}

let attempt: Attempt | null = null;
/** A voice session whose end failed: ended again on the next stop or start. */
let lingering: VoiceSession | null = null;
/** The sign-in being checked; a later one replaces it, so an earlier answer is never taken for a later one's. */
let signing: object | null = null;
/** When End was last tapped: Talk tapped this soon after is the second half of a double tap (the button changed). */
let endedAt = 0;

const current = (mine: Attempt): boolean => attempt === mine && !mine.ended;
/** The phase as it is now (a call, so a check made before an await is not taken as still true after it). */
const phaseNow = (): TalkPhase => state.talk.phase;
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function show(phase: TalkPhase, message: string, caption = state.talk.caption): void {
  state.talk = { ...state.talk, phase, message, caption };
  hooks.paintTalk();
}

/** No talk going: this attempt ends (any later callback from it is ignored), and End now closes the sheet. */
function idle(message: string): void {
  if (attempt !== null) attempt.ended = true;
  attempt = null;
  state.talk = { ...state.talk, muted: false };
  show("idle", message);
}

function giveBack(mine: Attempt): void {
  if (mine.callId !== null && !mine.connected) void markTalk(mine.worker, mine.session, "abandon", mine.callId);
}

/** Tells the Worker the talk connected, again after a wait if it did not take it, while the talk is on. */
async function reportConnected(mine: Attempt): Promise<void> {
  for (const wait of [0, ...CONNECTED_RETRIES_MS]) {
    if (wait > 0) await delay(wait);
    if (!current(mine) || mine.callId === null) return;
    if (await markTalk(mine.worker, mine.session, "connected", mine.callId)) return;
  }
}

/** Ends a voice session; one that will not end is kept to try again. */
async function endVoice(voice: VoiceSession | null): Promise<boolean> {
  if (voice === null) return true;
  try {
    await voice.endSession();
    return true;
  } catch {
    lingering = voice;
    return false;
  }
}

async function endLingering(): Promise<void> {
  const voice = lingering;
  lingering = null;
  await endVoice(voice);
}

function micMessage(error: unknown): string {
  if (micRefused(error)) return TALK_TEXT.micRefused;
  const name = error !== null && typeof error === "object" ? (error as { name?: unknown }).name : "";
  return name === "NotReadableError" || name === "AbortError" ? TALK_TEXT.micBusy : TALK_TEXT.noMic;
}

/** Forgets the session here; false when its file is there and could not be removed. */
async function forgetSession(): Promise<boolean> {
  state.talk = { ...state.talk, session: null };
  return clearSession();
}

/**
 * The session for the Worker in Settings, reading its file once per run. A session for another Worker (the address in
 * Settings changed) is signed out there and dropped, so it never lingers as a live sign-in nobody holds.
 */
async function currentSession(worker: string): Promise<string | null> {
  if (!state.talk.sessionRead) {
    const kept = await readSession();
    state.talk = { ...state.talk, session: state.talk.session ?? kept, sessionRead: true };
  }
  const session: TalkSession | null = state.talk.session;
  if (session !== null && worker !== "" && session.worker !== worker) {
    void signOut(session.worker, session.token).then((reached) => {
      if (reached) return;
      setNotice("Your old Worker could not be reached to end its Talk sign-in, so it stays valid there for up to 30 days.");
      hooks.softRender();
    });
    await forgetSession();
  }
  return sessionToken(state.talk.session, worker);
}

function callbacks(mine: Attempt) {
  const back = (): void => show(mine.mode, mine.mode === "speaking" ? TALK_TEXT.speaking : TALK_TEXT.listening);
  return {
    onConnect: () => {
      if (!current(mine)) return;
      mine.connected = true;
      void reportConnected(mine);
      show("listening", TALK_TEXT.listening);
    },
    onModeChange: ({ mode }: { mode: string }) => {
      if (!current(mine) || !mine.connected) return;
      mine.mode = mode === "speaking" ? "speaking" : "listening";
      back();
    },
    onAgentToolRequest: () => {
      if (current(mine)) show("working", TALK_TEXT.working);
    },
    onAgentToolResponse: () => {
      if (current(mine)) back();
    },
    onMessage: ({ message, role }: { message: string; role: string }) => {
      const words = cleanShown(message, CAPTION_MAX);
      if (current(mine) && words !== "") {
        if (role === "user") heardHim(words);
        show(state.talk.phase, state.talk.message, role === "user" ? cleanShown(`You: ${words}`, CAPTION_MAX) : words);
      }
    },
    onDisconnect: (details?: { reason?: string }) => {
      if (!current(mine)) return;
      giveBack(mine);
      idle(details?.reason === "error" ? TALK_TEXT.dropped : TALK_TEXT.ended);
    },
    onError: () => {
      if (current(mine)) show(state.talk.phase, TALK_TEXT.audio);
    },
  };
}

/** Today as the app knows it, for the agent's {{life}} (talk/life.ts); "" if it cannot be put together, never a throw. */
function lifeNow(weather: Weather | null): string {
  try {
    // A guessed place is said to be one, so the assistant never tells the user Makkah's times are theirs.
    const place = state.place.source === "default" ? `${state.place.label}, as no place is set yet` : state.place.label;
    return lifeText({ now: new Date(), today: today(), tz: state.place.tz, place, days: state.days,
      log: state.log, adhkar: state.adhkar, agenda: state.agenda, library: state.library, weather, quran: state.quran,
      learn: state.learn, body: state.body, health: state.settings.assistantHealth ? healthNow() : null, money: state.settings.assistantMoney ? state.money : null,
      intentions: homeIntentions(state.reviews, today())?.intentions ?? [] });
  } catch {
    return "";
  }
}

/** The tools that run here in the app, for this talk only: a call from one that has ended saves nothing. */
function clientTools(mine: Attempt) {
  return {
    log_to_app: (args: unknown): Promise<string> | string =>
      current(mine) ? logFromTalk(args) : "Not saved: the talk has ended.",
    undo_log: (): Promise<string> | string => (current(mine) ? undoFromTalk() : "The talk has ended."),
  };
}

async function connect(mine: Attempt, reply: Started, life: string): Promise<void> {
  let voice: VoiceSession;
  try {
    const Conversation = await loadConversation();
    if (!current(mine)) return giveBack(mine);
    voice = await Conversation.startSession({ conversationToken: reply.conversationToken, connectionType: "webrtc",
      dynamicVariables: { ...reply.variables, life }, workletPaths: WORKLETS, clientTools: clientTools(mine),
      ...callbacks(mine) }) as unknown as VoiceSession;
  } catch (error) {
    if (current(mine)) {
      giveBack(mine);
      idle(micRefused(error) ? TALK_TEXT.micRefused : TALK_TEXT.connect);
    }
    return;
  }
  if (!current(mine)) {
    void endVoice(voice);
    return;
  }
  mine.voice = voice;
}

/**
 * A talk from the top: the attempt claimed at once (so a second tap, or the sheet closing, sees it), any voice session
 * left from before ended, then the microphone, the Worker's reservation and ElevenLabs.
 */
async function begin(worker: string, session: string): Promise<void> {
  const mine: Attempt = { worker, session, callId: null, voice: null, connected: false, ended: false, asking: false,
    startedAt: Date.now(), mode: "listening" };
  const old = attempt;
  if (old !== null) {
    old.ended = true;
    giveBack(old);
    void endVoice(old.voice);
  }
  attempt = mine;
  state.talk = { ...state.talk, muted: false };
  startTalkLog();
  show("connecting", TALK_TEXT.connecting, "");
  await endLingering();
  if (!current(mine)) return;
  mine.asking = true;
  try {
    await askMicrophone();
  } catch (error) {
    mine.asking = false;
    if (current(mine)) idle(micMessage(error));
    return;
  }
  mine.asking = false;
  if (!current(mine)) return;
  // Asked beside the Worker's reservation, and never for longer than its short deadline (talk/weather.ts).
  const weather = weatherFor(state.place);
  const reply = await startTalk(worker, session);
  if (!current(mine)) {
    if (reply.ok) void markTalk(worker, session, "abandon", reply.callId);
    return;
  }
  if (!reply.ok) {
    if (reply.status === 401) {
      attempt = null;
      await forgetSession();
      return show("signin", TALK_TEXT.signedOut);
    }
    return idle(reply.error);
  }
  mine.callId = reply.callId;
  const life = lifeNow(await weather);
  if (!current(mine)) return giveBack(mine);
  await connect(mine, reply, life);
}

/** The Talk sheet opened: a talk starts at once, or the passphrase is asked for first. */
export async function openTalk(): Promise<void> {
  if (!isNative()) return openTalkPage();
  const worker = workerUrl(state.settings.voiceUrl);
  if (!worker) return show("idle", "");
  const session = await currentSession(worker);
  if (state.sheet !== "talk") return;
  // A sign-in still being checked (the sheet was closed and opened again) shows as checking, not as an open form.
  if (session === null) {
    return signing !== null ? show("signing", "") : show("signin", phaseNow() === "signin" ? state.talk.message : "");
  }
  await begin(worker, session);
}

/** Talk again from the sheet, after a talk ended; a tap just after End (a double tap) is ignored. */
export async function startAgain(): Promise<void> {
  if (attempt !== null || state.sheet !== "talk" || Date.now() - endedAt < END_GRACE_MS) return;
  await openTalk();
}

/**
 * The passphrase from the sheet's form: sent once, never kept. Only the latest sign-in's answer is taken; a good one is
 * kept even if the sheet closed meanwhile, and starts the talk when the sheet is still open for it.
 */
export async function talkSignIn(passphrase: string): Promise<void> {
  const worker = workerUrl(state.settings.voiceUrl);
  if (phaseNow() !== "signin" || !worker || passphrase === "") return;
  const ticket = {};
  signing = ticket;
  show("signing", "");
  const answer = await signIn(worker, passphrase);
  if (signing !== ticket) return;
  signing = null;
  // Waiting for it: the sheet still open on the form, for the Worker the passphrase went to.
  const waiting = state.sheet === "talk" && (phaseNow() === "signing" || phaseNow() === "signin") &&
    workerUrl(state.settings.voiceUrl) === worker;
  if (!answer.ok) {
    if (waiting) show("signin", answer.error);
    return;
  }
  const session = { worker, token: answer.token };
  state.talk = { ...state.talk, session, sessionRead: true };
  if (!(await writeSession(session))) {
    setNotice(`Signed in for now. This ${deviceWord()} could not keep it, so Talk will ask again next time.`);
  }
  if (waiting && state.sheet === "talk") await begin(worker, answer.token);
  else if (phaseNow() === "signing") state.talk = { ...state.talk, phase: "idle" };
}

/** End (or Cancel): stops the talk going; with none going, closes the sheet. A double tap's second half is ignored. */
export async function endTalk(): Promise<void> {
  const mine = attempt;
  if (mine === null) return hooks.closeSheet();
  if (mine.callId === null && Date.now() - mine.startedAt < END_GRACE_MS) return;
  await stopTalk();
  endedAt = Date.now();
}

/** Stops whatever talk is going, quietly: the sheet closing. A voice session that would not end before is ended now. */
export async function stopTalk(): Promise<void> {
  const mine = attempt;
  if (mine === null) return endLingering();
  giveBack(mine);
  mine.ended = true;
  show("ending", state.talk.message);
  const ended = await endVoice(mine.voice);
  if (attempt === mine) {
    attempt = null;
    state.talk = { ...state.talk, muted: false };
    show("idle", ended ? TALK_TEXT.ended : TALK_TEXT.stillOn);
  }
}

/**
 * The app went to the background: the talk ends, unless the pause is Android's own microphone prompt (on iOS the
 * prompt never pauses the app, so a pause there is a real one).
 */
export async function pauseTalk(): Promise<void> {
  if (attempt?.asking && platform() === "android") return;
  await stopTalk();
}

export function toggleMute(): void {
  const voice = attempt?.voice;
  if (!voice?.setMicMuted || attempt === null || !attempt.connected) return;
  const muted = !state.talk.muted;
  voice.setMicMuted(muted);
  state.talk = { ...state.talk, muted };
  hooks.paintTalk();
}

/** One meter of the voice session, or nothing when it is missing or fails: the orb is decoration, the talk goes on. */
function meter<T>(read: () => T | undefined): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/**
 * What the speaking orb hears right now: the user's voice (nothing while muted) and the agent's, each with its bands. Each
 * meter is read on its own, so one that fails reads as silence without silencing the others.
 */
export function talkSignal(): VoiceSignal {
  const voice = attempt?.voice;
  if (!voice) return QUIET;
  const muted = state.talk.muted;
  return {
    him: muted ? 0 : loudness(meter(() => voice.getInputVolume?.())),
    agent: loudness(meter(() => voice.getOutputVolume?.())),
    himBands: muted ? SILENT : bandsOf(meter(() => voice.getInputByteFrequencyData?.())),
    agentBands: bandsOf(meter(() => voice.getOutputByteFrequencyData?.())),
  };
}

/** Whether this device holds a Talk session for the Worker in Settings (Settings' Voice card). */
export function signedInToTalk(): boolean {
  return sessionToken(state.talk.session, workerUrl(state.settings.voiceUrl)) !== null;
}

/** Reads the kept session once, for Settings, without starting anything. */
export async function loadTalkSession(): Promise<void> {
  if (!isNative() || state.talk.sessionRead) return;
  const kept = await readSession();
  state.talk = { ...state.talk, session: state.talk.session ?? kept, sessionRead: true };
}

/**
 * Signs this device out of Talk: forgotten here first (a Talk opened meanwhile asks for the passphrase), then the
 * Worker is told; when it cannot be reached, the notice says the sign-in stays valid there and how to end it.
 */
export async function signOutOfTalk(): Promise<void> {
  const session = state.talk.session;
  signing = null;
  await stopTalk();
  const removed = await forgetSession();
  const device = deviceWord();
  const reached = session === null || await signOut(session.worker, session.token);
  const said = reached ? `Signed out of Talk on this ${device}.` : `Signed out on this ${device}. Your Worker could not ` +
    "be reached, so that sign-in stays valid there for up to 30 days; changing the passphrase on the server ends it now.";
  const stuck = removed ? "" : ` This ${device} could not delete its saved sign-in, so sign out again after the app ` +
    "restarts.";
  setNotice(`${said}${stuck}`);
  hooks.softRender();
}
