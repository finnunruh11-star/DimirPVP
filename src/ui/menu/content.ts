import type { MenuCategory, MatchMode } from '../../config/MatchConfig';
import type { RaidBossKind } from '../../pve/swamprun';

export interface MenuEntryCopy {
  label: string;
  detail: string;
  title: string;
  description: string;
}

export const CATEGORY_COPY: Record<MenuCategory, MenuEntryCopy> = {
  versus: {
    label: 'PvP',
    detail: 'Duels against people or the machine',
    title: 'THE DUELLING TABLE',
    description: 'Fight against another player, online, or against an AI-controlled mage.',
  },
  adventures: {
    label: 'PvE',
    detail: 'Persistent runs into hostile places',
    title: 'THE WAY OUT',
    description: 'Take a party into the Swamp, the Mine, an Expedition, or a prepared Raid.',
  },
  workshop: {
    label: 'Workshop',
    detail: 'Training and fight Setups',
    title: 'THE WORKBENCH',
    description: 'Test builds, construct scenarios, or reopen a fight saved to disk.',
  },
};

export const MODE_COPY: Record<MatchMode, MenuEntryCopy> = {
  ai: {
    label: 'AI Duel',
    detail: 'One human against a configurable AI table',
    title: 'AI DUEL',
    description: 'Build your mage, choose the table, and fight opponents controlled by the game.',
  },
  hotseat: {
    label: 'Hotseat',
    detail: 'Local couch coop on the same device',
    title: 'HOTSEAT',
    description: 'Draft each local mage in private, then share the battlefield in teams or free-for-all.',
  },
  online: {
    label: 'Online',
    detail: 'Host or join a match',
    title: 'ONLINE TABLE',
    description: 'Connect through a room code. The host decides the rules; every player plays a mage.',
  },
  training: {
    label: 'Training Lab',
    detail: 'A solo field with editable targets',
    title: 'TRAINING LAB',
    description: 'Enter the sandbox with one build, then spawn targets and inspect interactions freely.',
  },
  swamprun: {
    label: 'Swamprun',
    detail: 'Endless survival run',
    title: 'THE SWAMP',
    description: 'Survive fresh combats at increasing depth. Spend shared gold between waves and keep what the party earns.',
  },
  expedition: {
    label: 'Expedition',
    detail: 'Swamps but you get upgrades each time to go deeper',
    title: 'EXPEDITION',
    description: 'Push deeper without field shops, choose when to retreat, then spend personal gold and recruit in town.',
  },
  minerun: {
    label: 'Mine Run',
    detail: 'Map an endless maze of concealed rooms',
    title: 'THE MINE',
    description: 'Chart branching tunnels, manage tools and traps, and decide which hostile rooms are worth entering.',
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
    detail: 'Requires 2+ party members / execution marks / damage cap',
    title: 'THE REAPER',
    description: 'Requires at least two party members. A slow executioner that leashes and marks prey before its killing clap. Each entity can deal at most 10 damage to it per round. It ignores physical damage and shadow; light remains effective.',
  },
  deathknightSpear: {
    label: 'Deathknight',
    detail: '125 HP / long spear reach / relentless pressure',
    title: 'THE DEATHKNIGHT',
    description: 'A massive armoured spear fighter with 125 HP, long reach, and high movement. It resists ordinary steel, shadow, and heat; light, cleansing, and healing effects exploit its weaknesses.',
  },
};