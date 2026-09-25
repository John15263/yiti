// Microphone capture for the live tutor: mono, 16 kHz, 16-bit PCM, ~100 ms per message.
class VoiceCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ratio = sampleRate / (options.processorOptions?.target || 16000);
    this.chunk = options.processorOptions?.chunk || 1600;
    this.pending = new Float32Array(0);
    this.position = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    const merged = new Float32Array(this.pending.length + input.length);
    merged.set(this.pending); merged.set(input, this.pending.length);
    const taken = [];
    // Linear interpolation keeps the pitch right whatever rate the device gives us.
    while (this.position + this.ratio < merged.length) {
      const index = Math.floor(this.position), next = Math.min(index + 1, merged.length - 1);
      const weight = this.position - index;
      taken.push(merged[index] * (1 - weight) + merged[next] * weight);
      this.position += this.ratio;
    }
    const consumed = Math.floor(this.position);
    this.pending = merged.subarray(consumed);
    this.position -= consumed;
    if (!taken.length) return true;
    const samples = new Int16Array(taken.length);
    for (let i = 0; i < taken.length; i++) {
      const value = Math.max(-1, Math.min(1, taken[i]));
      samples[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
    }
    this.buffered = this.buffered ? concat(this.buffered, samples) : samples;
    while (this.buffered.length >= this.chunk) {
      const slice = this.buffered.slice(0, this.chunk);
      this.buffered = this.buffered.slice(this.chunk);
      this.port.postMessage(slice.buffer, [slice.buffer]);
    }
    return true;
  }
}
function concat(a, b) {
  const out = new Int16Array(a.length + b.length);
  out.set(a); out.set(b, a.length);
  return out;
}
registerProcessor('voice-capture', VoiceCapture);
