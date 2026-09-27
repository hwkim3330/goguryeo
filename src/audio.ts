/**
 * Battle sound, synthesized: war drums (북) that quicken with the fighting, a bed of clashing
 * steel and shouting that swells with the melee near the camera, the hiss of volleys, the
 * rumble of cavalry, horns (각적) for the start and for a rout.
 */
export class BattleAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private bed!: GainNode;
  private rumble!: GainNode;
  private drumT = 0;
  muted = false;

  start(): void {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.55;
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp).connect(c.destination);
    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // Battle bed: band-passed noise, gain driven by the fighting.
    this.bed = this.loop(700, 0.9);
    this.rumble = this.loop(90, 0.5);
  }

  private loop(freq: number, q: number): GainNode {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.value = 0;
    s.connect(f).connect(g).connect(this.master);
    s.start();
    return g;
  }

  private hit(freq: number, dur: number, vol: number, type: OscillatorType = "sine", sweep = 0.5): void {
    const c = this.ctx;
    if (!c || this.muted) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(freq: number, dur: number, vol: number, q = 1): void {
    const c = this.ctx;
    if (!c || this.muted) return;
    const t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  horn(): void {
    const c = this.ctx;
    if (!c || this.muted) return;
    const t = c.currentTime;
    for (const [f, a] of [
      [146, 0.16],
      [220, 0.08],
    ]) {
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(f * 0.9, t);
      o.frequency.linearRampToValueAtTime(f, t + 0.4);
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 900;
      const g = c.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(a, t + 0.3);
      g.gain.setValueAtTime(a, t + 1.6);
      g.gain.linearRampToValueAtTime(0.001, t + 2.4);
      o.connect(lp).connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 2.5);
    }
  }

  volley(near: number): void {
    this.burst(3200, 1.2, 0.18 * near, 0.6);
  }

  /** Called each frame with how much is happening near the camera. */
  update(dt: number, melee: number, cavalry: number, intensity: number): void {
    const c = this.ctx;
    if (!c) return;
    const m = this.muted ? 0 : 1;
    this.bed.gain.setTargetAtTime(Math.min(0.5, melee * 0.02) * m, c.currentTime, 0.3);
    this.rumble.gain.setTargetAtTime(Math.min(0.6, cavalry * 0.012) * m, c.currentTime, 0.3);
    // Clangs.
    if (Math.random() < Math.min(0.9, melee * 0.02) * dt * 20) this.hit(1800 + Math.random() * 1600, 0.12, 0.06 * m, "square", 0.8);
    // Drums: a steady beat that quickens with the fighting.
    this.drumT -= dt;
    if (this.drumT <= 0) {
      const bpm = 60 + intensity * 70;
      this.drumT = 60 / bpm;
      this.hit(62, 0.45, 0.5 * m, "sine", 0.6);
      if (intensity > 0.4 && Math.random() < 0.5) setTimeout(() => this.hit(90, 0.25, 0.25 * m, "sine", 0.7), (30000 / bpm) | 0);
    }
  }
}
