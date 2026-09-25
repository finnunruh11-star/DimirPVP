// Which walkable place an id names, and what lives there beyond the map
// itself: roaming packs that start fights, and hidden secrets. Towns carry
// neither; the forest and the wilds fill them in.

import type { ExitDef, LocaleDef, LocaleModel } from '../../world/locale';
import type { EncounterSpawn, EncounterZone } from './encounters';
import { resolveForest } from './forest';
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
}

export interface Secret {
  id: string;
  x: number;
  y: number;
  /** Tiles away it can be noticed from (a light widens this). */
  reveal: number;
  label: string;
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
   * world tile), the clock runs while the party walks, and the sun and the
   * sandstorms of the desert apply.
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
  /** Lift the fog off the whole map. */
  revealAll?: boolean;
}

export type LocaleTravel =
  | { t: 'world'; notice?: string }
  | { t: 'locale'; locale: string; at?: { x: number; y: number }; notice?: string }
  | { t: 'fight'; pack: WildPack; then: { locale: string; at?: { x: number; y: number } }; fleeTo?: { locale: string; at?: { x: number; y: number } } }
  | { t: 'stay'; notice: string };

type Resolver = (run: ExplorationRun, id: string) => ResolvedLocale | null;

const resolvers: Resolver[] = [
  (_run, id) => {
    const def = townById(id);
    return def ? { def, kind: 'town', zone: 'capitol', depth: 1, packs: [], secrets: [] } : null;
  },
  resolveForest,
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
