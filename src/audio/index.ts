/**
 * Public audio surface. Call sites only ever name a sound; routing, throttling
 * and synthesis stay inside this module.
 */
import { MUSIC_FILES, SOUND_FILES, type MusicTrack } from './assets';
import { audioEngine, type AudioBus } from './engine';
import { RECIPES, type SoundName } from './sounds';

export type { SoundName } from './sounds';
export type { MusicTrack } from './assets';

/** Music sits well under the effects bus so combat readouts stay legible. */
const MUSIC_GAIN = 0.32;

/** Sounds that fire in bursts need their own collapse window. */
const THROTTLE_MS: Partial<Record<SoundName, number>> = {
  // A fast mouse sweep crosses many controls; without a wide window the blips
  // overlap into a wash that trails the cursor.
  'ui.hover': 60,
  'ui.click': 20,
  'hit.physical': 55,
  'hit.slash': 55,
  'hit.pierce': 55,
  'spell.impact': 55,
  'spell.lightning': 90,
  'spell.shatter': 70,
  'spell.thunder': 220,
  'spell.explode': 160,
  'unit.death': 120,
};

function busFor(name: SoundName): AudioBus {
  return name.startsWith('ui.') || name.startsWith('dice.') ? 'ui' : 'sfx';
}

/** Level trims for authored files that are hotter than the rest of the set. */
const SOUND_GAIN: Partial<Record<SoundName, number>> = {
  'unit.death': 0.5,
  'spell.lightning': 0.45,
  'spell.thunder': 0.85,
  'spell.shatter': 0.35,
  'spell.impact': 0.35,
  'hit.physical': 0.7,
  'hit.slash': 0.72,
  'hit.pierce': 0.72,
  'melee.swing': 0.8,
  'melee.contact': 0.85,
  'bow.draw': 0.9,
};

export interface PlayOpts {
  /** Extra level trim for this one play, 0..1. */
  gain?: number;
  /** Seconds to delay the voice; used to stagger multi-target impacts. */
  delay?: number;
}

export function playSound(name: SoundName, opts: PlayOpts = {}): void {
  audioEngine.play(name, busFor(name), RECIPES[name], {
    throttleMs: THROTTLE_MS[name] ?? 45,
    gain: opts.gain ?? SOUND_GAIN[name],
    delay: opts.delay,
  });
}

/** Resume the audio context. Safe to call on every input event. */
export function unlockAudio(): void {
  audioEngine.unlock();
  void loadSamples();
}

let loading: Promise<void> | null = null;

/** Decode the authored effects once, as soon as a context exists. */
function loadSamples(): Promise<void> {
  loading ??= Promise.all(
    Object.entries(SOUND_FILES).map(([name, url]) => audioEngine.registerSample(name, url)),
  ).then(() => undefined);
  return loading;
}

/** Loop a music bed. Held until the first gesture if audio is not up yet. */
export function playMusic(track: MusicTrack): void {
  audioEngine.playMusic(MUSIC_FILES[track], MUSIC_GAIN);
}

export function stopMusic(): void {
  audioEngine.stopMusic();
}

export function audioVolume(): number {
  return audioEngine.volume;
}

export function setAudioVolume(value: number): void {
  audioEngine.setVolume(value);
}

export function isAudioMuted(): boolean {
  return audioEngine.muted;
}

export function setAudioMuted(muted: boolean): void {
  audioEngine.setMuted(muted);
}

/**
 * Swap a procedural recipe for an authored file at runtime. Leading and
 * trailing silence is trimmed automatically.
 */
export function loadSoundSample(name: SoundName, url: string): Promise<void> {
  return audioEngine.registerSample(name, url);
}
