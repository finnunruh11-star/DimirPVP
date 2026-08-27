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
    detail: 'Duels against players or AI',
    title: 'PVP',
    description: 'Duel another player locally, online, or against AI.',
  },
  adventures: {
    label: 'PvE',
    detail: 'Persistent runs against AI enemies',
    title: 'PVE',
    description: 'Take a party into Swamprun, Mine Run, Expedition or Raid.',
  },
  workshop: {
    label: 'Workshop',
    detail: 'Training and authored fights',
    title: 'WORKSHOP',
    description: 'Test builds, author scenarios, or load a saved fight.',
  },
};

export const MODE_COPY: Record<MatchMode, MenuEntryCopy> = {
  ai: {
    label: 'AI Duel',
    detail: '1 human vs AI',
    title: 'AI DUEL',
    description: 'Build a mage and fight AI opponents.',
  },
  hotseat: {
    label: 'Hotseat',
    detail: 'Local multiplayer, one device',
    title: 'HOTSEAT',
    description: 'Draft each local mage privately, then fight in teams or free-for-all.',
  },
  online: {
    label: 'Online',
    detail: 'Host or join with a room code',
    title: 'ONLINE',
    description: 'Connect by room code. The host sets the rules. Each player controls 1 mage.',
  },
  training: {
    label: 'Training Lab',
    detail: 'Solo sandbox with spawnable targets',
    title: 'TRAINING LAB',
    description: 'Test one build against targets you spawn and edit.',
  },
  swamprun: {
    label: 'Swamprun',
    detail: 'Endless wave survival',
    title: 'SWAMPRUN',
    description: 'Survive escalating waves. Shared gold, shop between waves.',
  },
  expedition: {
    label: 'Expedition',
    detail: 'Swamprun with permanent upgrades',
    title: 'EXPEDITION',
    description: 'No field shops. Retreat when you choose, then spend personal gold and recruit in town.',
  },
  minerun: {
    label: 'Mine Run',
    detail: 'Endless maze of hidden rooms',
    title: 'MINE RUN',
    description: 'Map branching tunnels. Manage tools and traps. Choose which rooms to enter.',
  },
  raid: {
    label: 'Raid',
    detail: '1 boss, prepared party',
    title: 'RAID',
    description: 'Pick a boss, prepare on respawning effigies, summon when ready.',
  },
  scenario: {
    label: 'Scenario Lab',
    detail: 'Author and save a fight',
    title: 'SCENARIO LAB',
    description: 'Place a roster, set equipment and words, save to file.',
  },
  memory: {
    label: 'Memory',
    detail: 'Load a saved fight',
    title: 'MEMORY',
    description: 'Resume a saved scenario with its roster, positions, resources and turn order.',
  },
};

export const PREP_COPY = {
  quick: {
    label: 'Quick Start',
    detail: 'Flat attributes, no starting gear',
    title: 'QUICK START',
    description: 'Start immediately with even attributes and no opening item.',
  },
  custom: {
    label: 'Rolled Kit',
    detail: 'Rolled attributes, 1 starting item',
    title: 'ROLLED KIT',
    description: 'Assign rolled attributes, then draft 1 opening item.',
  },
  creative: {
    label: 'Creative Kit',
    detail: 'Set attributes and gear freely',
    title: 'CREATIVE KIT',
    description: 'No price, rarity, quantity or carry limits.',
  },
} as const;

export const RAID_BOSS_COPY: Record<RaidBossKind, MenuEntryCopy> = {
  lich: {
    label: 'Lich',
    detail: '30 HP. Revives once. Immunity to debuffs.',
    title: 'LICH',
    description: '30 HP, 80 sanity, move 6cm. Immunity to pierce, slashing, shadow and all debuffs. Resist shatter and heat. Weak to light. Commands other undead. Revives once at half HP.',
  },
  reaper: {
    label: 'Reaper',
    detail: 'Requires 2+ players. 33 HP. 10 damage cap per source.',
    title: 'REAPER',
    description: 'Requires 2+ party members. 33 HP, immune to sanity damage, move 6cm. Max 10 damage per entity per round. Immunity to pierce, slashing, shatter, shadow and all debuffs. Resist heat. Weak to light. Leashes and marks targets, then executes all marks.',
  },
  deathknightSpear: {
    label: 'Deathknight',
    detail: '125 HP. 5cm reach. Move 12cm.',
    title: 'DEATHKNIGHT',
    description: '125 HP, 99 sanity, move 12cm. 2d10 pierce at 5cm reach. Resist pierce, slashing, shadow and heat. Weak to light, cleansing and healing.',
  },
};