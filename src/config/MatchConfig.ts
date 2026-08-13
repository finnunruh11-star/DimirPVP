import type { MageClass } from '../core/Classes';
import type { Scenario } from '../core/Scenario';
import type { WordId } from '../core/Words';
import type { Net } from '../net/Net';
import type { RaidBossKind } from '../pve/swamprun';
import { LOADOUT_SIZE } from './constants';

export type MatchMode =
  | 'hotseat'
  | 'ai'
  | 'online'
  | 'training'
  | 'swamprun'
  | 'expedition'
  | 'minerun'
  | 'raid'
  | 'scenario'
  | 'memory';

export type SwampPrepMode = 'quick' | 'custom' | 'creative';
export type MenuCategory = 'versus' | 'adventures' | 'workshop';
export type SessionRole = 'local' | 'host' | 'guest';
export type TeamFormat = 'teams' | 'ffa';

export interface ModeCapability {
  category: MenuCategory;
  roles: readonly SessionRole[];
  seats: readonly [min: number, max: number];
  allowAi: boolean;
  formats: readonly TeamFormat[];
  prepModes: readonly SwampPrepMode[];
  loadoutSize: number;
  usesBuild: boolean;
  usesContentPacks: boolean;
  requiresRaidBoss: boolean;
}

export const MODE_CAPABILITIES = {
  ai: {
    category: 'versus', roles: ['local'], seats: [2, 4], allowAi: true,
    formats: ['teams', 'ffa'], prepModes: [], loadoutSize: LOADOUT_SIZE,
    usesBuild: true, usesContentPacks: true, requiresRaidBoss: false,
  },
  hotseat: {
    category: 'versus', roles: ['local'], seats: [2, 4], allowAi: true,
    formats: ['teams', 'ffa'], prepModes: [], loadoutSize: LOADOUT_SIZE,
    usesBuild: true, usesContentPacks: true, requiresRaidBoss: false,
  },
  online: {
    category: 'versus', roles: ['host', 'guest'], seats: [2, 4], allowAi: true,
    formats: ['teams', 'ffa'], prepModes: [], loadoutSize: LOADOUT_SIZE,
    usesBuild: true, usesContentPacks: true, requiresRaidBoss: false,
  },
  training: {
    category: 'workshop', roles: ['local'], seats: [1, 1], allowAi: false,
    formats: [], prepModes: [], loadoutSize: LOADOUT_SIZE,
    usesBuild: true, usesContentPacks: true, requiresRaidBoss: false,
  },
  swamprun: {
    category: 'adventures', roles: ['local', 'host', 'guest'], seats: [1, 4], allowAi: true,
    formats: [], prepModes: ['quick', 'custom', 'creative'], loadoutSize: LOADOUT_SIZE,
    usesBuild: true, usesContentPacks: true, requiresRaidBoss: false,
  },
  expedition: {
    category: 'adventures', roles: ['local'], seats: [1, 1], allowAi: false,
    formats: [], prepModes: [], loadoutSize: 3,
    usesBuild: true, usesContentPacks: true, requiresRaidBoss: false,
  },
  minerun: {
    category: 'adventures', roles: ['local', 'host', 'guest'], seats: [1, 4], allowAi: true,
    formats: [], prepModes: ['quick', 'custom', 'creative'], loadoutSize: LOADOUT_SIZE,
    usesBuild: true, usesContentPacks: true, requiresRaidBoss: false,
  },
  raid: {
    category: 'adventures', roles: ['local', 'host', 'guest'], seats: [1, 4], allowAi: true,
    formats: [], prepModes: ['quick', 'custom', 'creative'], loadoutSize: LOADOUT_SIZE,
    usesBuild: true, usesContentPacks: true, requiresRaidBoss: true,
  },
  scenario: {
    category: 'workshop', roles: ['local'], seats: [1, 4], allowAi: true,
    formats: ['teams', 'ffa'], prepModes: [], loadoutSize: LOADOUT_SIZE,
    usesBuild: true, usesContentPacks: true, requiresRaidBoss: false,
  },
  memory: {
    category: 'workshop', roles: ['local'], seats: [1, 1], allowAi: false,
    formats: [], prepModes: [], loadoutSize: 0,
    usesBuild: false, usesContentPacks: false, requiresRaidBoss: false,
  },
} as const satisfies Record<MatchMode, ModeCapability>;

export function isPveRunMode(mode: MatchMode): boolean {
  return mode === 'swamprun' || mode === 'expedition' || mode === 'minerun' || mode === 'raid';
}

export function isScenarioMode(mode: MatchMode): boolean {
  return mode === 'scenario' || mode === 'memory';
}

export function usesSwampPrep(mode: MatchMode): boolean {
  return mode === 'swamprun' || mode === 'minerun' || mode === 'raid';
}

/** Which toggleable item catalogues the draft draws from. */
export interface ItemSetSelection {
  original: boolean;
  finns: boolean;
  dlc: boolean;
}

/** One combatant's seat in a match (used for N-player teamfights / battle royale). */
export interface SeatConfig {
  name: string;
  /** Team number; seats sharing a team fight together. FFA = every seat its own team. */
  team: number;
  isAI: boolean;
  loadout: WordId[];
  /** Chosen class (Objects / Life / Hexcraft). Defaults applied downstream. */
  mageClass?: MageClass;
}

export interface MatchConfig {
  mode: MatchMode;
  loadouts: [WordId[], WordId[]];
  /** Swamprun pre-combat character preparation. */
  swampPrepMode?: SwampPrepMode;
  /** Single boss selected for a one-fight Raid. */
  raidBoss?: RaidBossKind;
  /** Classes for the classic two-mage layout (parallel to `loadouts`). */
  classes?: [MageClass, MageClass];
  /** Optional explicit seat list for N-player matches (up to four). */
  seats?: SeatConfig[];
  /** Item sets enabled for the draft (defaults to original only). */
  itemSets?: ItemSetSelection;
  /** Online play: the live connection to the opponent (lockstep relay). */
  net?: Net;
  /** Online play: which team this client controls. */
  localTeam?: number;
  /** Online play: which seat index this client controls (zero-based). */
  localSeat?: number;
  /** Online play: shared RNG seed so every peer simulates identically. */
  seed?: number;
  /** Memory mode: the saved fight to rebuild instead of drafting a new one. */
  scenario?: Scenario;
}