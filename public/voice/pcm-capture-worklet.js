/**
 * Microphone tap for the voice session.
 *
 * Runs on the audio rendering thread and does one thing: hands raw mono PCM
 * back to the page in fixed-size frames. Segmentation, level metering and
 * encoding all happen on the main thread in AudioCaptureService, where they
 * can be unit-tested; nothing here is worth the complexity of testing a
 * worklet.
 *
 * Served as a static file rather than a blob: URL so it loads under the
 * app's `script-src 'self'` policy — worklet modules are governed by
 * script-src, not worker-src.
 */
const FRAME_SIZE = 1024;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(FRAME_SIZE);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      this.frame[this.filled++] = channel[i];
      if (this.filled === FRAME_SIZE) {
        // Transferred, not copied: a fresh frame replaces it.
        this.port.postMessage(this.frame, [this.frame.buffer]);
        this.frame = new Float32Array(FRAME_SIZE);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
