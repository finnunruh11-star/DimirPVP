/**
 * The synthesised sound catalogue. Each recipe layers a transient, a body and
 * (where it helps) a tail, which is what separates a designed sound effect from
 * a bare beep. Small per-play randomisation keeps repeats from sounding robotic.
 *
 * Recipes must never read game RNG — audio is presentation only and must not
 * touch lockstep determinism.
 */
import type { SynthKit } from './engine';

export type SoundName = keyof typeof RECIPES;

export const RECIPES = {
  // ---- Interface ----
  'ui.hover': (k: SynthKit) => {
    k.tone({ type: 'sine', freq: k.rand(620, 700), dur: 0.045, gain: 0.07, attack: 0.004 });
  },
  'ui.click': (k: SynthKit) => {
    k.noise({ dur: 0.032, gain: 0.3, filter: 'highpass', freq: 1900, attack: 0.001 });
    k.tone({ type: 'triangle', freq: 1250, freqTo: 620, dur: 0.045, gain: 0.11 });
  },
  'ui.confirm': (k: SynthKit) => {
    k.tone({ type: 'triangle', freq: 523, dur: 0.09, gain: 0.16, reverb: 0.15 });
    k.tone({ type: 'triangle', freq: 784, start: 0.068, dur: 0.17, gain: 0.15, reverb: 0.25 });
  },
  'ui.back': (k: SynthKit) => {
    k.tone({ type: 'triangle', freq: 494, dur: 0.08, gain: 0.14, reverb: 0.12 });
    k.tone({ type: 'triangle', freq: 330, start: 0.06, dur: 0.15, gain: 0.13, reverb: 0.2 });
  },
  'ui.deny': (k: SynthKit) => {
    // Two close saws beat against each other, which reads as a refusal buzz.
    k.tone({ type: 'sawtooth', freq: 142, freqTo: 118, dur: 0.17, gain: 0.1 });
    k.tone({ type: 'sawtooth', freq: 149, freqTo: 121, dur: 0.17, gain: 0.08 });
  },
  'ui.open': (k: SynthKit) => {
    k.noise({ dur: 0.2, gain: 0.16, filter: 'lowpass', freq: 380, freqTo: 2600, reverb: 0.2 });
    k.tone({ type: 'triangle', freq: 300, freqTo: 520, dur: 0.16, gain: 0.08 });
  },
  'ui.close': (k: SynthKit) => {
    k.noise({ dur: 0.18, gain: 0.16, filter: 'lowpass', freq: 2400, freqTo: 320, reverb: 0.15 });
    k.tone({ type: 'triangle', freq: 480, freqTo: 240, dur: 0.14, gain: 0.08 });
  },

  // ---- Dice ----
  'dice.roll': (k: SynthKit) => {
    // Clacks that slow down, the way real dice settle.
    let at = 0;
    let gap = 0.045;
    for (let i = 0; i < 6; i += 1) {
      k.noise({
        start: at,
        dur: 0.035,
        gain: 0.22 - i * 0.02,
        filter: 'bandpass',
        freq: k.rand(1900, 3400),
        q: 2.4,
        pan: k.rand(-0.5, 0.5),
        reverb: 0.18,
      });
      at += gap;
      gap *= 1.28;
    }
  },
  'dice.crit': (k: SynthKit) => {
    k.tone({ type: 'triangle', freq: 988, dur: 0.5, gain: 0.16, reverb: 0.5 });
    k.tone({ type: 'sine', freq: 1976, dur: 0.42, gain: 0.07, reverb: 0.45 });
    k.noise({ dur: 0.05, gain: 0.16, filter: 'highpass', freq: 4000 });
  },
  'dice.fumble': (k: SynthKit) => {
    k.tone({ type: 'sine', freq: 180, freqTo: 82, dur: 0.4, gain: 0.28, reverb: 0.3 });
    k.noise({ dur: 0.14, gain: 0.16, filter: 'lowpass', freq: 700 });
  },

  // ---- Impacts ----
  'hit.physical': (k: SynthKit) => {
    k.noise({ dur: 0.05, gain: 0.4, filter: 'lowpass', freq: 1300, attack: 0.001 });
    k.tone({ type: 'sine', freq: k.rand(160, 190), freqTo: 55, dur: 0.19, gain: 0.45 });
    k.noise({ kind: 'brown', dur: 0.13, gain: 0.18, filter: 'lowpass', freq: 700, reverb: 0.2 });
  },
  'hit.crit': (k: SynthKit) => {
    k.noise({ dur: 0.06, gain: 0.5, filter: 'highpass', freq: 900, attack: 0.001 });
    k.tone({ type: 'sine', freq: 220, freqTo: 48, dur: 0.28, gain: 0.5 });
    k.tone({ type: 'triangle', freq: 1320, freqTo: 660, dur: 0.22, gain: 0.1, reverb: 0.4 });
  },
  'melee.slash': (k: SynthKit) => {
    k.noise({ dur: 0.16, gain: 0.32, filter: 'bandpass', freq: 3600, freqTo: 700, q: 1.4, attack: 0.006 });
    k.tone({ type: 'triangle', freq: 2100, freqTo: 900, dur: 0.1, gain: 0.06, reverb: 0.25 });
  },
  'hit.block': (k: SynthKit) => {
    k.noise({ dur: 0.035, gain: 0.34, filter: 'highpass', freq: 2600, attack: 0.001 });
    k.tone({ type: 'triangle', freq: 1150, dur: 0.16, gain: 0.12, reverb: 0.3 });
    k.tone({ type: 'triangle', freq: 1668, dur: 0.12, gain: 0.08, reverb: 0.3 });
  },

  // ---- Magic ----
  'spell.cast': (k: SynthKit) => {
    k.tone({ type: 'sine', freq: 300, freqTo: 900, dur: 0.3, gain: 0.11, attack: 0.012, reverb: 0.25 });
    k.tone({ type: 'sine', freq: 303, freqTo: 906, dur: 0.3, gain: 0.09, attack: 0.012, reverb: 0.25 });
    k.noise({ dur: 0.26, gain: 0.1, filter: 'bandpass', freq: 900, freqTo: 3200, q: 3, attack: 0.015, reverb: 0.3 });
  },
  'spell.impact': (k: SynthKit) => {
    k.noise({ dur: 0.07, gain: 0.32, filter: 'bandpass', freq: 1600, q: 1.2, attack: 0.001 });
    k.tone({ type: 'sine', freq: 240, freqTo: 62, dur: 0.26, gain: 0.34, reverb: 0.3 });
    k.tone({ type: 'triangle', freq: 880, freqTo: 300, dur: 0.18, gain: 0.08, reverb: 0.35 });
  },
  'spell.corrosive': (k: SynthKit) => {
    // Bubbling: scattered short blips over a fizz bed.
    for (let i = 0; i < 5; i += 1) {
      k.tone({
        type: 'sine',
        freq: k.rand(170, 300),
        freqTo: k.rand(380, 560),
        start: i * 0.055 + k.rand(0, 0.02),
        dur: 0.07,
        gain: 0.13,
        reverb: 0.2,
      });
    }
    k.noise({ dur: 0.42, gain: 0.12, filter: 'bandpass', freq: 2600, q: 1.8, flicker: { rate: 34, depth: 0.75 } });
  },
  'spell.fire': (k: SynthKit) => {
    k.noise({ kind: 'brown', dur: 0.5, gain: 0.38, filter: 'lowpass', freq: 950, freqTo: 380, flicker: { rate: 24, depth: 0.5 }, reverb: 0.2 });
    k.noise({ dur: 0.24, gain: 0.16, filter: 'bandpass', freq: 420, freqTo: 1900, q: 1.2, attack: 0.006 });
  },
  'spell.lightning': (k: SynthKit) => {
    k.noise({ dur: 0.12, gain: 0.5, filter: 'highpass', freq: 2100, attack: 0.001, flicker: { rate: 90, depth: 0.8 } });
    k.noise({ dur: 0.45, gain: 0.26, filter: 'bandpass', freq: 1300, q: 1.1, flicker: { rate: 42, depth: 0.9 }, reverb: 0.5 });
    k.tone({ type: 'sine', freq: 112, freqTo: 38, dur: 0.7, gain: 0.42, reverb: 0.35 });
  },
  'spell.thunder': (k: SynthKit) => {
    k.noise({ dur: 0.09, gain: 0.6, filter: 'highpass', freq: 1600, attack: 0.001, flicker: { rate: 120, depth: 0.7 } });
    k.tone({ type: 'sine', freq: 90, freqTo: 30, dur: 0.9, gain: 0.55, reverb: 0.4 });
    k.noise({ kind: 'brown', dur: 0.85, gain: 0.34, filter: 'lowpass', freq: 700, freqTo: 120, flicker: { rate: 18, depth: 0.55 }, reverb: 0.5 });
  },
  'spell.explode': (k: SynthKit) => {
    k.noise({ dur: 0.06, gain: 0.55, filter: 'highpass', freq: 1200, attack: 0.001 });
    k.tone({ type: 'sine', freq: 150, freqTo: 32, dur: 0.5, gain: 0.55, reverb: 0.3 });
    k.noise({ kind: 'brown', dur: 0.6, gain: 0.36, filter: 'lowpass', freq: 1100, freqTo: 160, reverb: 0.45 });
  },
  'spell.shatter': (k: SynthKit) => {
    k.noise({ dur: 0.04, gain: 0.4, filter: 'highpass', freq: 3200, attack: 0.001 });
    for (let i = 0; i < 3; i += 1) {
      k.noise({
        start: i * 0.035,
        dur: k.rand(0.06, 0.13),
        gain: 0.2,
        filter: 'bandpass',
        freq: k.rand(4200, 7200),
        q: 8,
        pan: k.rand(-0.6, 0.6),
        reverb: 0.4,
      });
    }
    k.noise({ dur: 0.34, gain: 0.1, filter: 'bandpass', freq: 5200, q: 2, reverb: 0.55 });
  },
  'spell.heal': (k: SynthKit) => {
    const steps = [523, 659, 784];
    steps.forEach((freq, i) => {
      k.tone({ type: 'triangle', freq, start: i * 0.06, dur: 0.32, gain: 0.13, attack: 0.008, reverb: 0.3 });
    });
    k.tone({ type: 'sine', freq: 1568, start: 0.12, dur: 0.36, gain: 0.05, attack: 0.02, reverb: 0.35 });
  },
  'spell.drain': (k: SynthKit) => {
    k.noise({ dur: 0.45, gain: 0.2, filter: 'bandpass', freq: 1900, freqTo: 320, q: 2.2, reverb: 0.35 });
    k.tone({ type: 'sine', freq: 430, freqTo: 110, dur: 0.5, gain: 0.16, reverb: 0.35 });
  },
  'spell.psychic': (k: SynthKit) => {
    // Detuned pair beating against itself: unsettling rather than percussive.
    k.tone({ type: 'sine', freq: 331, freqTo: 214, dur: 0.55, gain: 0.15, attack: 0.012, reverb: 0.35 });
    k.tone({ type: 'sine', freq: 338, freqTo: 219, dur: 0.55, gain: 0.13, attack: 0.012, reverb: 0.35 });
    k.tone({ type: 'sine', freq: 2400, freqTo: 3100, dur: 0.4, gain: 0.035, attack: 0.04, reverb: 0.35 });
  },
  'spell.vanish': (k: SynthKit) => {
    k.noise({ dur: 0.24, gain: 0.22, filter: 'bandpass', freq: 2600, freqTo: 420, q: 2, reverb: 0.45 });
    k.tone({ type: 'sine', freq: 900, freqTo: 180, dur: 0.26, gain: 0.14 });
  },
  'spell.blink': (k: SynthKit) => {
    k.tone({ type: 'sine', freq: 1800, freqTo: 200, dur: 0.16, gain: 0.2 });
    k.noise({ dur: 0.12, gain: 0.18, filter: 'highpass', freq: 1600, reverb: 0.3 });
  },
  'spell.summon': (k: SynthKit) => {
    k.noise({ dur: 0.04, gain: 0.18, filter: 'highpass', freq: 1400, attack: 0.001 });
    k.noise({ dur: 0.32, gain: 0.22, filter: 'lowpass', freq: 220, freqTo: 1600, attack: 0.05, reverb: 0.25 });
    k.tone({ type: 'triangle', freq: 160, freqTo: 420, dur: 0.3, gain: 0.14, attack: 0.03, reverb: 0.25 });
  },
  'spell.pull': (k: SynthKit) => {
    k.noise({ dur: 0.32, gain: 0.2, filter: 'bandpass', freq: 380, freqTo: 2200, q: 2, attack: 0.02, reverb: 0.2 });
    k.tone({ type: 'sine', freq: 120, freqTo: 460, dur: 0.3, gain: 0.16, attack: 0.008 });
  },
  'move.dash': (k: SynthKit) => {
    k.noise({ dur: 0.12, gain: 0.24, filter: 'bandpass', freq: 500, freqTo: 2200, q: 1.3, attack: 0.02 });
    k.noise({ start: 0.1, dur: 0.16, gain: 0.18, filter: 'bandpass', freq: 2000, freqTo: 420, q: 1.3 });
  },
  'unit.death': (k: SynthKit) => {
    k.tone({ type: 'sine', freq: 185, freqTo: 44, dur: 0.9, gain: 0.34, reverb: 0.5 });
    k.noise({ kind: 'brown', dur: 0.8, gain: 0.2, filter: 'lowpass', freq: 520, freqTo: 110, reverb: 0.5 });
    k.tone({ type: 'sine', freq: 92, freqTo: 40, dur: 0.26, gain: 0.36 });
  },
  'turn.start': (k: SynthKit) => {
    k.tone({ type: 'triangle', freq: 392, dur: 0.16, gain: 0.1, reverb: 0.3 });
    k.tone({ type: 'triangle', freq: 588, start: 0.09, dur: 0.24, gain: 0.09, reverb: 0.35 });
  },
} satisfies Record<string, (kit: SynthKit) => void>;
