/**
 * The microphone for recitation: its sound in tenths of a second at 16 kHz, from an audio worklet shipped in the app
 * (public/recite/pcm-capture.js; a worklet from a blob would be refused by the page's policy). The sound goes only to
 * the speech worker on this device.
 */
import { FRAME, resample } from "./audio.ts";

export interface Capture { stop(): void }

export async function startCapture(onFrame: (frame: Float32Array) => void): Promise<Capture> {
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("No microphone"), { name: "NotFoundError" });
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const context = new AudioContext();
  const stopAll = (): void => {
    for (const track of stream.getTracks()) track.stop();
    void context.close().catch(() => undefined);
  };
  try {
    await context.audioWorklet.addModule(new URL("recite/pcm-capture.js", document.baseURI).href);
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, "pcm-capture");
    // Silent, but joined to the speakers' end of the graph: some web views only run a node that leads somewhere.
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(node).connect(mute).connect(context.destination);
    const perTenth = Math.round(context.sampleRate / 10);
    let pending: Float32Array[] = [];
    let held = 0;
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      pending = [...pending, event.data];
      held += event.data.length;
      while (held >= perTenth) {
        const joined = new Float32Array(held);
        let at = 0;
        for (const chunk of pending) { joined.set(chunk, at); at += chunk.length; }
        const tenth = resample(joined.subarray(0, perTenth), context.sampleRate);
        const rest = joined.slice(perTenth);
        pending = rest.length ? [rest] : [];
        held = rest.length;
        onFrame(tenth.length === FRAME ? tenth : Float32Array.from({ length: FRAME }, (_, i) => tenth[i] ?? 0));
      }
    };
    await context.resume();
    return { stop: stopAll };
  } catch (error) {
    stopAll();
    throw error;
  }
}
