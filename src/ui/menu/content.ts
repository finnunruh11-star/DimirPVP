import type { MenuCategory, MatchMode } from '../../config/MatchConfig';

export interface MenuEntryCopy {
  label: string;
  detail: string;
  title: string;
  description: string;
}

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
    description: 'Take a party into the Swamp, the Mine, an Expedition, or a prepared Raid.',
  },
  workshop: {
    label: 'Workshop',
    detail: 'Training, authored fights, and memories',
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
  expedition: {
    label: 'Expedition',
    detail: 'A solo campaign of depth, retreat, and town',
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