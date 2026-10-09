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
  detail: 'Look up what any combination of words casts',
  title: 'SPELLBOOK',
  description: 'Browse every spell in the active catalogues without starting a match.',
};

export const CATEGORY_COPY: Record<MenuCategory, MenuEntryCopy> = {
  versus: {
    label: 'Versus',
    detail: 'Duels against people or the machine',
    title: 'THE DUELLING TABLE',
    description: 'Settle a compact battle locally, online, or against an AI-controlled mage.',
  },
  adventures: {
    label: 'Adventures',
    detail: 'Persistent runs into hostile places',
    title: 'THE WAY OUT',
    description: 'Take a party into the Swamp, the Mine, or a prepared Raid.',
  },
  workshop: {
    label: 'Workshop',
    detail: 'Training, authored fights, and memories',
    title: 'THE WORKBENCH',
    description: 'Test builds, construct scenarios, or reopen a fight saved to disk.',
  },
};

export const MODE_COPY: Record<MatchMode, MenuEntryCopy> = {
  tutorial: {
    label: 'Guided Tutorial',
    detail: 'Learn the game by playing one short fight',
    title: 'GUIDED TUTORIAL',
    description: 'A scripted fight that walks you through the controls, spell combining and targeting, the inventory and its debuff list, reading the stack, and commanding a summon. Arrows and prompts point at what to do next.',
  },
  ai: {
    label: 'AI Duel',
    detail: 'One human against a configurable AI table',
    title: 'AI DUEL',
    description: 'Build your mage, choose the table, and fight opponents controlled by the game.',
  },
  hotseat: {
    label: 'Hotseat',
    detail: 'Two to four local seats',
    title: 'HOTSEAT',
    description: 'Draft each local mage in private, then share the battlefield in teams or free-for-all.',
  },
  online: {
    label: 'Online',
    detail: 'Host or join a deterministic match',
    title: 'ONLINE TABLE',
    description: 'Connect through a room code. The host owns the rules; every player owns a mage.',
  },
  training: {
    label: 'Training Lab',
    detail: 'A solo field with editable targets',
    title: 'TRAINING LAB',
    description: 'Enter the sandbox with one build, then spawn targets and inspect interactions freely.',
  },
  swamprun: {
    label: 'Swamprun',
    detail: 'Endless survival, supplies, and escalating horrors',
    title: 'THE SWAMP',
    description: 'Survive fresh combats at increasing depth. Spend shared gold between waves and keep what the party earns.',
  },
  minerun: {
    label: 'Mine Run',
    detail: 'Map an endless maze of concealed rooms',
    title: 'THE MINE',
    description: 'Chart branching tunnels, manage tools and traps, and decide which hostile rooms are worth entering.',
  },
  exploration: {
    label: 'Exploration',
    detail: 'An open world of cities, roads and wilds',
    title: 'THE WIDE WORLD',
    description: 'Set out from Kerusai with five silver. Plan routes on the travel map, deal with what you find on the way, and break off a fight by whichever edge you can reach. Progress is saved as you go.',
  },
  raid: {
    label: 'Raid',
    detail: 'Prepare a party for one selected boss',
    title: 'RAID TABLE',
    description: 'Choose the target, tune the party, prepare on reforming effigies, and summon the boss when ready.',
  },
  scenario: {
    label: 'Scenario Lab',
    detail: 'Construct and save an authored combat',
    title: 'SCENARIO LAB',
    description: 'Open a blank fight, place a roster, set its equipment and words, then save the result.',
  },
  memory: {
    label: 'Memory',
    detail: 'Load an exact fight from a scenario file',
    title: 'MEMORY',
    description: 'Choose a saved scenario and resume its roster, positions, resources, and turn order.',
  },
};

export const PREP_COPY = {
  quick: {
    label: 'Quick Start',
    detail: 'Flat reliable attributes, no starting draft',
    title: 'QUICK START',
    description: 'Enter the first wave immediately with even attributes and no opening equipment decision.',
  },
  custom: {
    label: 'Rolled Kit',
    detail: 'Assign rolled attributes and draft starting gear',
    title: 'ROLLED KIT',
    description: 'Shape each human mage from a rolled attribute set, then choose one opening item.',
  },
  creative: {
    label: 'Creative Kit',
    detail: 'Set attributes directly and choose any equipment',
    title: 'CREATIVE KIT',
    description: 'Build without price, rarity, quantity, or carry restrictions before the run begins.',
  },
} as const;

export const RAID_BOSS_COPY: Record<RaidBossKind, MenuEntryCopy> = {
  lich: {
    label: 'Lich',
    detail: 'Commander / revives once / rejects most control',
    title: 'THE LICH',
    description: 'A calculating undead commander with 30 HP and high sanity. It ignores most physical attacks and debuffs, commands the dead, and revives once at half health. Light is its clearest weakness.',
  },
  reaper: {
    label: 'Reaper',
    detail: 'Execution marks / damage cap / physical immunity',
    title: 'THE REAPER',
    description: 'A slow executioner that leashes and marks prey before its killing clap. Each entity can deal at most 10 damage to it per round. It ignores physical damage and shadow; light remains effective.',
  },
  deathknightSpear: {
    label: 'Deathknight',
    detail: '125 HP / long spear reach / relentless pressure',
    title: 'THE DEATHKNIGHT',
    description: 'A massive armoured spear fighter with 125 HP, long reach, and high movement. It resists ordinary steel, shadow, and heat; light, cleansing, and healing effects exploit its weaknesses.',
  },
};

/** Short names that fit a chip. */
const BLOODMOON_LABELS: Record<BossId, string> = {
  goblins: 'Snazzlegob',
  minion: 'Evil Minion',
  rock: 'Big Rock',
  zargarg: 'Zargarg',
  dragon: 'Dragon',
  crusade: 'Crusade',
  baral: 'Baral',
  lillith: 'Lillith',
  planetar: 'Planetar',
  selga: 'Mini Selga',
};

export function raidTargetCopy(target: RaidTarget): MenuEntryCopy {
  if (!isBloodmoonRaid(target)) return RAID_BOSS_COPY[target];
  const boss = BOSSES[target];
  const written = bossRoster(target, 1).some((unit) => unit.kind !== BOSS_STAND_IN);
  return {
    label: BLOODMOON_LABELS[target],
    detail: `Bloodmoon ${roman(boss.tier)} / ${boss.color}`,
    title: boss.name.toUpperCase(),
    description: `Bloodmoon ${roman(boss.tier)}, ${boss.color}. Summoned with everything it brings and scaled to the party, just as when its bloodmoon rises.${written ? '' : ' Not written yet: a zombie wears its shape.'}`,
  };
}