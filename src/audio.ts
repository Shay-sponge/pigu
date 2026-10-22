export class SlapAudio {
  private context: AudioContext | null = null;
  enabled = false;

  async unlock() {
    if (!this.enabled) return;
    try {
      this.context ??= new AudioContext();
      if (this.context.state === 'suspended') await this.context.resume();
    } catch { this.context = null; }
  }

  play(strength: number) {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    const ctx = this.context, now = ctx.currentTime;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.17), ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      const t = i / ctx.sampleRate;
      samples[i] = (Math.random() * 2 - 1) * Math.exp(-t * 65);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 650 + strength * 600;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0.025 + strength * 0.04;
    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(now);
    noise.onended = () => { noise.disconnect(); filter.disconnect(); gain.disconnect(); };
    const thump = ctx.createOscillator();
    const envelope = ctx.createGain();
    thump.frequency.setValueAtTime(155, now);
    thump.frequency.exponentialRampToValueAtTime(48, now + 0.12);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(0.025 + strength * 0.035, now + 0.005);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.19);
    thump.connect(envelope).connect(ctx.destination);
    thump.start(now);
    thump.stop(now + 0.2);
    thump.onended = () => { thump.disconnect(); envelope.disconnect(); };
  }

  get state() { return this.context?.state ?? 'locked'; }
}
