/**
 * The microphone, asked for before a talk is reserved (so a long permission prompt holds no talk minutes), then let go
 * at once: the voice library opens its own. The system's own prompt appears the first time (iOS: the purpose string in
 * Info.plist; Android: RECORD_AUDIO, asked by Capacitor's web view when the page wants the microphone).
 */
export async function askMicrophone(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("No microphone"), { name: "NotFoundError" });
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) track.stop();
}

/** The person said no to the microphone (now or before), as against there being none. */
export function micRefused(error: unknown): boolean {
  const name = error !== null && typeof error === "object" ? (error as { name?: unknown }).name : "";
  return name === "NotAllowedError" || name === "SecurityError";
}
