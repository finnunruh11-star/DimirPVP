/**
 * Authored audio files. Any name listed here replaces its procedural recipe
 * once decoded; names left out keep their synthesised fallback.
 *
 * Short effects are decoded into memory. Music is far too long for that, so it
 * streams from a media element instead (see `AudioEngine.playMusic`).
 */
import deathUrl from '../Sounds/Death.mp3';
import drainUrl from '../Sounds/drain.mp3';
import explodeUrl from '../Sounds/explode.mp3';
import fireUrl from '../Sounds/Fire.mp3';
import genericSpellUrl from '../Sounds/GenericSpell.mp3';
import hitUrl from '../Sounds/Hit.mp3';
import oozeUrl from '../Sounds/Ooze.mp3';
import shatterUrl from '../Sounds/Shatter.mp3';
import slashUrl from '../Sounds/Slash.mp3';
import thunderclapUrl from '../Sounds/Thunderclap.mp3';
import zapUrl from '../Sounds/Zap.mp3';
import combatMusicUrl from '../Sounds/Background Music.mp3';
import menuMusicUrl from '../Sounds/MenuBackground.mp3';
import type { SoundName } from './sounds';

export const SOUND_FILES: Partial<Record<SoundName, string>> = {
  'unit.death': deathUrl,
  'spell.drain': drainUrl,
  'spell.corrosive': oozeUrl,
  'spell.explode': explodeUrl,
  'spell.fire': fireUrl,
  'spell.cast': genericSpellUrl,
  'hit.physical': hitUrl,
  'spell.shatter': shatterUrl,
  'melee.slash': slashUrl,
  'spell.thunder': thunderclapUrl,
  'spell.lightning': zapUrl,
};

export type MusicTrack = 'menu' | 'combat';

export const MUSIC_FILES: Record<MusicTrack, string> = {
  menu: menuMusicUrl,
  combat: combatMusicUrl,
};
