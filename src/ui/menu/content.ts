import type { MenuCategory, MatchMode } from '../../config/MatchConfig';
import { BOSS_STAND_IN, BOSSES, bossRoster, roman, type BossId } from '../../pve/exploration/bloodmoon';
import { isBloodmoonRaid, type RaidTarget } from '../../pve/raidTargets';
import type { RaidBossKind } from '../../pve/swamprun';

export interface MenuEntryCopy {
  label: string;
  detail: string;
  title: string;
  description: string;
}

/** Standalone main-menu entry that is not a match category. */
export const SPELLBOOK_COPY: MenuEntryCopy = {
  label: 'Spellbook',
  detail: 'Look up any spell',
  title: 'SPELLBOOK',
  description: '',
};

export const CATEGORY_COPY: Record<MenuCategory, MenuEntryCopy> = {
  versus: {
    label: 'Versus',
    detail: 'AI, hotseat or online',
    title: 'VERSUS',
    description: '',
  },
  adventures: {
    label: 'Adventures',
    detail: 'Exploration, Swamprun, Mine Run, Raid',
    title: 'ADVENTURES',
    description: '',
  },
  workshop: {
    label: 'Workshop',
    detail: 'Tutorial, training and scenarios',
    title: 'WORKSHOP',
    description: '',
  },
};

export const MODE_COPY: Record<MatchMode, MenuEntryCopy> = {
  tutorial: {
    label: 'Tutorial',
    detail: 'One scripted fight',
    title: 'TUTORIAL',
    description: 'Controls, spells, inventory, the stack and summons.',
  },
  ai: {
    label: 'AI Duel',
    detail: 'You against AI opponents',
    title: 'AI DUEL',
    description: '',
  },
  hotseat: {
    label: 'Hotseat',
    detail: '2-4 players on one device',
    title: 'HOTSEAT',
    description: 'Teams or free-for-all.',
  },
  online: {
    label: 'Online',
    detail: 'Host or join with a room code',
    title: 'ONLINE',
    description: 'The host sets the rules.',
  },
  training: {
    label: 'Training Lab',
    detail: 'Solo sandbox with editable targets',
    title: 'TRAINING LAB',
    description: '',
  },
  swamprun: {
    label: 'Swamprun',
    detail: 'Endless waves',
    title: 'SWAMPRUN',
    description: 'Shared gold. Shop between waves.',
  },
  minerun: {
    label: 'Mine Run',
    detail: 'Endless maze of rooms',
    title: 'MINE RUN',
    description: 'Tunnels, traps, ore and fights.',
  },
  exploration: {
    label: 'Exploration',
    detail: 'Open world',
    title: 'EXPLORATION',
    description: 'Start in Kerusai with 5 silver.',
  },
  raid: {
    label: 'Raid',
    detail: 'One boss',
    title: 'RAID',
    description: '',
  },
  scenario: {
    label: 'Scenario Lab',
    detail: 'Build and save a fight',
    title: 'SCENARIO LAB',
    description: '',
  },
  memory: {
    label: 'Load Scenario',
    detail: 'Open a scenario file',
    title: 'LOAD SCENARIO',
    description: '',
  },
};

export const PREP_COPY = {
  quick: {
    label: 'Quick Start',
    detail: 'Even stats, no starting item',
    title: 'QUICK START',
    description: 'Even stats, no starting item.',
  },
  custom: {
    label: 'Rolled Stats',
    detail: 'Assign rolled stats, pick one item',
    title: 'ROLLED STATS',
    description: 'Assign rolled stats, pick one item.',
  },
  creative: {
    label: 'Creative',
    detail: 'Any stats, any items',
    title: 'CREATIVE',
    description: 'No price, rarity or weight limits.',
  },
} as const;

export const RAID_BOSS_COPY: Record<RaidBossKind, MenuEntryCopy> = {
  lich: {
    label: 'Lich',
    detail: '30 HP / revives once / commands the dead',
    title: 'LICH',
    description: '30 HP, high sanity. Ignores most physical attacks and debuffs. Revives once at half health. Weak to light.',
  },
  reaper: {
    label: 'Reaper',
    detail: 'Marks and executes / damage cap',
    title: 'REAPER',
    description: 'Slow. Marks a target, then executes it. Takes at most 10 damage per attacker per round. Immune to physical damage and shadow.',
  },
  deathknightSpear: {
    label: 'Deathknight',
    detail: '125 HP / long reach / fast',
    title: 'DEATHKNIGHT',
    description: '125 HP, long reach, fast. Resists steel, shadow and heat. Weak to light, cleansing and healing.',
  },
};

/** Short names that fit a chip. */
const BLOODMOON_LABELS: Record<BossId, string> = {
  goblins: 'Snazzlegob',
  rock: 'G Moay',
  crusade: 'The Crusading Crusaders',
  baral: 'Baral',
  lillith: 'Lillith',
};

export function raidTargetCopy(target: RaidTarget): MenuEntryCopy {
  if (!isBloodmoonRaid(target)) return RAID_BOSS_COPY[target];
  const boss = BOSSES[target];
  const written = bossRoster(target, 1).some((unit) => unit.kind !== BOSS_STAND_IN);
  return {
    label: BLOODMOON_LABELS[target],
    detail: `Bloodmoon ${roman(boss.tier)} / ${boss.color}`,
    title: boss.name.toUpperCase(),
    description: `Bloodmoon ${roman(boss.tier)}, ${boss.color}.${written ? '' : ' Not finished: a zombie stands in.'}`,
  };
}