// The microphone's samples, passed to the page in batches of 1,024 (recite/mic.ts). Nothing is kept or sent anywhere.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.batch = new Float32Array(1024);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.batch[this.filled++] = channel[i];
        if (this.filled === this.batch.length) {
          this.port.postMessage(this.batch.slice(0));
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCapture);
