// Which walkable place an id names, and what lives there beyond the map
// itself: roaming packs that start fights, and hidden secrets. Towns carry
// neither; the wilds and the open world fill them in.

import type { ExitDef, LocaleDef, LocaleModel } from '../../world/locale';
import type { EncounterSpawn, EncounterZone } from './encounters';
import { resolveOpenWorld } from './openWorld';
import type { ExplorationRun } from './run';
import { townById } from './towns';
import { resolveWilds } from './wilds';

export type LocaleKind = 'town' | 'forest' | 'wilds' | 'world';

export interface WildPack {
  id: string;
  x: number;
  y: number;
  /** Tiles the pack notices the party from. */
  sight: number;
  depth: number;
  spawns?: EncounterSpawn[];
  label: string;
  /** Tint for the pack's marker figure. */
  tint: number;
  elite?: boolean;
  /** The roster and arena its fight uses, when not the place's own. */
  zone?: EncounterZone;
  /** Chase speed in tiles per second, when not the place's default. */
  pace?: number;
  /** Already on the party's trail: it chases from the start and never settles. */
  hunting?: boolean;
  /** Asleep until a traveller comes within `wakeTiles` (half that sneaking) or something wakes it. */
  asleep?: boolean;
  wakeTiles?: number;
}

/** What a secret looks like on the ground; plain secrets glint. */
export type SecretLook = 'herb' | 'cache' | 'stash' | 'trinket';

export interface Secret {
  id: string;
  x: number;
  y: number;
  /** Tiles away it can be noticed from (a light widens this). */
  reveal: number;
  label: string;
  /** Milliseconds E must be held to take it; taken at a press when absent. */
  hold?: number;
  look?: SecretLook;
  /** A herb patch shows the herb it grows. */
  herb?: string;
}

export interface ResolvedLocale {
  def: LocaleDef;
  kind: LocaleKind;
  zone: EncounterZone;
  depth: number;
  packs: WildPack[];
  secrets: Secret[];
  /** Line shown under the place name in the HUD. */
  subtitle?: string;
  /** What searching a secret yields; it is only ever searched once. */
  search?: (run: ExplorationRun, secret: Secret) => SecretResult;
  /** Exits that lead somewhere other than the overworld. */
  travel?: (run: ExplorationRun, exit: ExitDef) => LocaleTravel;
  /** Runs once each time the party arrives. */
  onEnter?: (run: ExplorationRun) => void;
  /** Hide the map under fog in chunks of this many tiles until walked. */
  fogChunk?: number;
  /** Named places announced (and rewarded) the first time the fog lifts off them. */
  landmarks?: Landmark[];
  /** A model built ahead of time, for maps too big to rebuild on every visit. */
  model?: LocaleModel;
  /**
   * The whole world on foot: the fog is the run's explored map (one chunk per
   * world tile), the clock runs while the party walks, and the sandstorms of
   * the desert apply.
   */
  world?: boolean;
}

export interface Landmark {
  id: string;
  x: number;
  y: number;
  name: string;
}

export interface SecretResult {
  message: string;
  /** A guardian that must be fought first; the secret stays hidden until it falls. */
  fight?: WildPack;
  /** The fight springs out of the find itself. */
  trap?: boolean;
  /** Taking it makes noise: each sleeper this close wakes at this chance. */
  wake?: { tiles: number; chance: number };
  /** Lift the fog off the whole map. */
  revealAll?: boolean;
}

export type LocaleTravel =
  | { t: 'world'; notice?: string }
  | { t: 'locale'; locale: string; at?: { x: number; y: number }; notice?: string }
  | { t: 'fight'; pack: WildPack; then: { locale: string; at?: { x: number; y: number } }; fleeTo?: { locale: string; at?: { x: number; y: number } } }
  | { t: 'dungeon'; place: string }
  | { t: 'stay'; notice: string };

type Resolver = (run: ExplorationRun, id: string) => ResolvedLocale | null;

const resolvers: Resolver[] = [
  (_run, id) => {
    const def = townById(id);
    return def ? { def, kind: 'town', zone: 'capitol', depth: 1, packs: [], secrets: [] } : null;
  },
  resolveWilds,
  resolveOpenWorld,
];

/** Let other modules (forest, wilds) teach the resolver new places. */
export function registerLocaleResolver(resolver: Resolver): void {
  resolvers.push(resolver);
}

export function resolveLocale(run: ExplorationRun, id: string): ResolvedLocale | null {
  for (const resolver of resolvers) {
    const found = resolver(run, id);
    if (found) return found;
  }
  return null;
}
