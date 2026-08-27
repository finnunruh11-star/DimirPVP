/**
 * Procedural audio engine. Every sound is synthesised at runtime from
 * oscillators and noise, so the game ships with no audio assets. Sounds that
 * later get authored samples can be overridden through `registerSample`.
 *
 * Nothing here touches the Web Audio API until the first `unlock()` or play
 * call, which keeps headless test runs (and blocked-autoplay browsers) quiet.
 */

const STORAGE_KEY = 'dimir-audio';

export type AudioBus = 'ui' | 'sfx';

export interface ToneOpts {
  type?: OscillatorType;
  /** Starting frequency in Hz. */
  freq: number;
  /** Glide target; omitted means a steady pitch. */
  freqTo?: number;
  /** Offset from the voice start, in seconds. */
  start?: number;
  dur: number;
  gain?: number;
  attack?: number;
  /** 0..1 share of this voice routed to the shared reverb. */
  reverb?: number;
  /** -1 hard left, 1 hard right. */
  pan?: number;
  glide?: 'exp' | 'lin';
}

export interface NoiseOpts {
  kind?: 'white' | 'brown';
  start?: number;
  dur: number;
  gain?: number;
  attack?: number;
  filter?: BiquadFilterType;
  freq?: number;
  freqTo?: number;
  q?: number;
  reverb?: number;
  pan?: number;
  /** Random amplitude chopping, used for crackle and bubbling. */
  flicker?: { rate: number; depth: number };
}

/** The drawing tools a sound recipe gets. */
export interface SynthKit {
  readonly ctx: AudioContext;
  /** Absolute context time this voice starts at. */
  readonly t: number;
  tone(opts: ToneOpts): void;
  noise(opts: NoiseOpts): void;
  rand(min: number, max: number): number;
}

interface AudioPrefs {
  master: number;
  muted: boolean;
}

const DEFAULT_PREFS: AudioPrefs = { master: 0.7, muted: false };

function readPrefs(): AudioPrefs {
  if (typeof window === 'undefined') return { ...DEFAULT_PREFS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<AudioPrefs>;
    return {
      master: typeof parsed.master === 'number' ? Math.min(1, Math.max(0, parsed.master)) : DEFAULT_PREFS.master,
      muted: parsed.muted === true,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function writePrefs(prefs: AudioPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // A blocked preference store should never block audio or gameplay.
  }
}

/** Per-bus trims so UI chrome never fights the combat layer. */
const BUS_GAIN: Record<AudioBus, number> = { ui: 0.55, sfx: 0.9 };

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Record<AudioBus, GainNode> | null = null;
  private reverbIn: GainNode | null = null;
  private noiseBuffers: Record<'white' | 'brown', AudioBuffer> | null = null;
  private samples = new Map<string, AudioBuffer>();
  private music: { el: HTMLAudioElement; gain: GainNode; url: string } | null = null;
  private desiredMusic: { url: string; volume: number } | null = null;
  private prefs = readPrefs();
  private lastPlayed = new Map<string, number>();
  private failed = false;
  private warmed = false;

  get muted(): boolean {
    return this.prefs.muted;
  }

  get volume(): number {
    return this.prefs.master;
  }

  setVolume(value: number): void {
    this.prefs.master = Math.min(1, Math.max(0, value));
    this.prefs.muted = this.prefs.master === 0;
    writePrefs(this.prefs);
    this.applyMaster();
  }

  setMuted(muted: boolean): void {
    this.prefs.muted = muted;
    writePrefs(this.prefs);
    this.applyMaster();
  }

  /**
   * Build and start the context. Must be called from a real user gesture:
   * a context created outside one starts suspended, and a suspended context
   * has a frozen `currentTime` that would stall every scheduled voice.
   */
  unlock(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
    if (this.warmed) return;
    this.warmed = true;
    // Kick the output device so the first audible sound is not stuck behind
    // hardware spin-up, which is what makes an initial click feel late.
    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    source.connect(ctx.destination);
    source.start(0);
    this.startMusic();
  }

  /**
   * Decode `url` and use it for `name` instead of the procedural recipe. Any
   * container the browser can decode works: WAV, OGG, MP3, FLAC. Leading and
   * trailing silence is trimmed on load, so a padded export still feels instant.
   */
  async registerSample(name: string, url: string): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const response = await fetch(url);
      const decoded = await ctx.decodeAudioData(await response.arrayBuffer());
      this.samples.set(name, trimSilence(ctx, decoded));
    } catch {
      // Keep the procedural fallback when a sample cannot be loaded.
    }
  }

  /** Loop `url` as the current music bed, crossfading out whatever was playing. */
  playMusic(url: string, volume: number): void {
    if (this.desiredMusic?.url === url) return;
    this.desiredMusic = { url, volume };
    this.startMusic();
  }

  stopMusic(fade = 0.6): void {
    this.desiredMusic = null;
    const music = this.music;
    if (!music || !this.ctx) return;
    this.music = null;
    music.gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + fade);
    setTimeout(() => {
      music.el.pause();
      music.el.removeAttribute('src');
      music.gain.disconnect();
    }, fade * 1000 + 80);
  }

  /**
   * Music can be requested before the first gesture, when there is no context
   * to play it through; the request is held and started by `unlock`.
   */
  private startMusic(): void {
    const ctx = this.ctx;
    const wanted = this.desiredMusic;
    if (!ctx || ctx.state !== 'running' || !wanted) return;
    if (this.music?.url === wanted.url) return;
    this.stopMusic();
    this.desiredMusic = wanted;
    try {
      const el = new Audio(wanted.url);
      el.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      ctx.createMediaElementSource(el).connect(gain);
      gain.connect(this.master!);
      gain.gain.linearRampToValueAtTime(wanted.volume, ctx.currentTime + 1.2);
      void el.play().catch(() => undefined);
      this.music = { el, gain, url: wanted.url };
    } catch {
      // Music is optional; a failure here must not disturb the effects bus.
    }
  }

  hasSample(name: string): boolean {
    return this.samples.has(name);
  }

  /**
   * Play `name` on `bus`. `throttleMs` collapses repeats of the same sound
   * fired in one frame (area damage hitting six targets, for example).
   */
  play(
    name: string,
    bus: AudioBus,
    recipe: (kit: SynthKit) => void,
    opts: { throttleMs?: number; gain?: number; delay?: number } = {},
  ): void {
    // Never build the context here: `play` is reached from hover, which is not
    // a user gesture, and that would leave a permanently suspended context.
    const ctx = this.ctx;
    if (!ctx || this.prefs.muted || this.prefs.master <= 0) return;
    if (ctx.state !== 'running') {
      void ctx.resume().catch(() => undefined);
      return;
    }

    // Throttle on the wall clock, not the audio clock, which can stall.
    const now = performance.now();
    const last = this.lastPlayed.get(name);
    if (last !== undefined && now - last < (opts.throttleMs ?? 45)) return;
    this.lastPlayed.set(name, now);

    const start = ctx.currentTime + (opts.delay ?? 0);
    const destination = this.buses![bus];
    const voice = ctx.createGain();
    voice.gain.value = opts.gain ?? 1;
    voice.connect(destination);

    const sample = this.samples.get(name);
    if (sample) {
      const source = ctx.createBufferSource();
      source.buffer = sample;
      source.connect(voice);
      source.start(start);
      source.onended = () => voice.disconnect();
      return;
    }

    try {
      const span = { end: start };
      recipe(this.makeKit(ctx, start, voice, span));
      // Release the voice once its longest component has rung out.
      const ms = Math.max(0, span.end - ctx.currentTime + 0.25) * 1000;
      setTimeout(() => voice.disconnect(), ms);
    } catch {
      voice.disconnect();
      // A malformed recipe must never take the frame down with it.
    }
  }

  private makeKit(ctx: AudioContext, t: number, out: GainNode, span: { end: number }): SynthKit {
    const engine = this;
    return {
      ctx,
      t,
      rand: (min, max) => min + Math.random() * (max - min),
      tone(opts) {
        const start = t + (opts.start ?? 0);
        const end = start + opts.dur;
        span.end = Math.max(span.end, end);
        const osc = ctx.createOscillator();
        osc.type = opts.type ?? 'sine';
        osc.frequency.setValueAtTime(opts.freq, start);
        if (opts.freqTo !== undefined && opts.freqTo !== opts.freq) {
          if ((opts.glide ?? 'exp') === 'exp') {
            osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqTo), end);
          } else {
            osc.frequency.linearRampToValueAtTime(opts.freqTo, end);
          }
        }
        const node = engine.envelope(ctx, start, opts.dur, opts.gain ?? 0.4, opts.attack ?? 0.005);
        osc.connect(node);
        engine.route(node, out, opts.reverb ?? 0, opts.pan ?? 0, start);
        osc.start(start);
        osc.stop(end + 0.02);
        osc.onended = () => node.disconnect();
      },
      noise(opts) {
        const start = t + (opts.start ?? 0);
        const end = start + opts.dur;
        span.end = Math.max(span.end, end);
        const source = ctx.createBufferSource();
        source.buffer = engine.noiseBuffers![opts.kind ?? 'white'];
        source.loop = true;
        let head: AudioNode = source;
        if (opts.filter) {
          const filter = ctx.createBiquadFilter();
          filter.type = opts.filter;
          filter.frequency.setValueAtTime(opts.freq ?? 1000, start);
          if (opts.freqTo !== undefined) {
            filter.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqTo), end);
          }
          if (opts.q !== undefined) filter.Q.value = opts.q;
          source.connect(filter);
          head = filter;
        }
        const node = engine.envelope(ctx, start, opts.dur, opts.gain ?? 0.3, opts.attack ?? 0.004);
        if (opts.flicker) {
          const step = 1 / opts.flicker.rate;
          const depth = Math.min(1, Math.max(0, opts.flicker.depth));
          for (let at = start; at < end; at += step) {
            node.gain.setValueAtTime((opts.gain ?? 0.3) * (1 - depth * Math.random()), at);
          }
          node.gain.exponentialRampToValueAtTime(0.0001, end);
        }
        head.connect(node);
        engine.route(node, out, opts.reverb ?? 0, opts.pan ?? 0, start);
        source.start(start);
        source.stop(end + 0.02);
        source.onended = () => node.disconnect();
      },
    };
  }

  /** A percussive attack/decay envelope; exponential decay reads as natural. */
  private envelope(ctx: AudioContext, start: number, dur: number, peak: number, attack: number): GainNode {
    const node = ctx.createGain();
    const rise = Math.min(attack, dur * 0.5);
    node.gain.setValueAtTime(0.0001, start);
    node.gain.linearRampToValueAtTime(peak, start + rise);
    node.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    return node;
  }

  private route(node: AudioNode, out: GainNode, reverb: number, pan: number, start: number): void {
    const ctx = this.ctx!;
    let tail: AudioNode = node;
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(Math.min(1, Math.max(-1, pan)), start);
      node.connect(panner);
      tail = panner;
    }
    tail.connect(out);
    if (reverb > 0 && this.reverbIn) {
      const send = ctx.createGain();
      send.gain.value = reverb;
      tail.connect(send);
      send.connect(this.reverbIn);
    }
  }

  private applyMaster(): void {
    if (!this.master || !this.ctx) return;
    this.master.gain.setTargetAtTime(this.prefs.muted ? 0 : this.prefs.master, this.ctx.currentTime, 0.02);
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (this.failed || typeof window === 'undefined' || typeof window.AudioContext !== 'function') return null;
    try {
      const ctx = new window.AudioContext({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.noiseBuffers = { white: makeNoise(ctx, 'white'), brown: makeNoise(ctx, 'brown') };

      // Glue bus: catches stacked simultaneous hits instead of clipping them.
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.knee.value = 22;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.2;
      compressor.connect(ctx.destination);

      const master = ctx.createGain();
      master.gain.value = this.prefs.muted ? 0 : this.prefs.master;
      master.connect(compressor);
      this.master = master;

      const convolver = ctx.createConvolver();
      convolver.buffer = makeImpulse(ctx, 0.75, 4.2);
      const reverbIn = ctx.createGain();
      reverbIn.gain.value = 1;
      const reverbOut = ctx.createGain();
      // Kept low deliberately: a loud tail smears the attack and everything
      // starts to feel late even when it is scheduled on time.
      reverbOut.gain.value = 0.22;
      reverbIn.connect(convolver);
      convolver.connect(reverbOut);
      reverbOut.connect(master);
      this.reverbIn = reverbIn;

      const makeBus = (gain: number): GainNode => {
        const node = ctx.createGain();
        node.gain.value = gain;
        node.connect(master);
        return node;
      };
      this.buses = { ui: makeBus(BUS_GAIN.ui), sfx: makeBus(BUS_GAIN.sfx) };
      return ctx;
    } catch {
      this.failed = true;
      return null;
    }
  }
}

/**
 * Strip leading and trailing near-silence. Exported audio is routinely padded,
 * and that padding reads as latency when the sound is meant to be a hit.
 */
function trimSilence(ctx: AudioContext, buffer: AudioBuffer, threshold = 0.0025): AudioBuffer {
  const channels = buffer.numberOfChannels;
  let first = buffer.length;
  let last = -1;
  for (let c = 0; c < channels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < buffer.length; i += 1) {
      if (Math.abs(data[i]) < threshold) continue;
      if (i < first) first = i;
      if (i > last) last = i;
    }
  }
  if (last < first) return buffer;
  // Leave a few ms either side so the transient is never clipped.
  const pad = Math.floor(buffer.sampleRate * 0.004);
  const start = Math.max(0, first - pad);
  const end = Math.min(buffer.length, last + pad + 1);
  if (start === 0 && end === buffer.length) return buffer;
  const trimmed = ctx.createBuffer(channels, end - start, buffer.sampleRate);
  for (let c = 0; c < channels; c += 1) {
    trimmed.getChannelData(c).set(buffer.getChannelData(c).subarray(start, end));
  }
  return trimmed;
}

function makeNoise(ctx: AudioContext, kind: 'white' | 'brown'): AudioBuffer {
  const length = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  if (kind === 'white') {
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
  // Brown noise: integrated white noise, weighted back to unity gain.
  let last = 0;
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  return buffer;
}

/** Synthetic impulse response: decaying stereo noise reads as a stone room. */
function makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
    }
  }
  return buffer;
}

export const audioEngine = new AudioEngine();
