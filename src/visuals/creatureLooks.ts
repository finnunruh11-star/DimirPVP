import type { MineEnemyKind } from '../pve/minerun';
import type { EnemyKind } from '../pve/swamprun';
import type { CreatureBody, CreatureDetail, CreatureLook } from './creatures';

export const MINE_LOOKS: Record<MineEnemyKind, CreatureLook> = {
  rockling: { body: 'construct', color: 0x929783 },
  kobold: { body: 'kobold', color: 0xafa076, detail: 'horns' },
  'elite-kobold': { body: 'kobold', color: 0xb6a169, accent: 0xdca450, detail: 'spear' },
  golem: { body: 'construct', color: 0x88909a, accent: 0x83e5dc },
  sentinel: { body: 'construct', color: 0x979eac, accent: 0x73c7ea },
  'magma-sentinel': { body: 'construct', color: 0x695458, accent: 0xffbc57 },
  'earth-elemental': { body: 'construct', color: 0x928663, accent: 0xa1bc79, detail: 'spikes' },
  pftlhb: { body: 'eye', color: 0x69617d, accent: 0xf0bf6f },
  'cavern-bat': { body: 'bat', color: 0x8b799a },
  'red-dragonborn': { body: 'humanoid', color: 0xb66155, detail: 'horns' },
  'black-dragonborn': { body: 'humanoid', color: 0x626473, accent: 0x8fd37e, detail: 'horns' },
  bandit: { body: 'humanoid', color: 0x8e887d },
  'bandit-archer': { body: 'humanoid', color: 0x84966c, detail: 'bow' },
  'bandit-captain': { body: 'humanoid', color: 0xad746e, detail: 'spear' },
  'sand-stalker': { body: 'reptile', color: 0xb7a36e },
  sandworm: { body: 'worm', color: 0xc4a674 },
  rabbit: { body: 'rabbit', color: 0xc7bda4, accent: 0xd18f97 },
  slime: { body: 'slime', color: 0x82bc64 },
  'slime-red': { body: 'slime', color: 0xcc695c },
  'slime-blue': { body: 'slime', color: 0x639fcd },
  'slime-black': { body: 'slime', color: 0x696171 },
  'slime-white': { body: 'slime', color: 0xd6d8c8 },
  boar: { body: 'boar', color: 0x9d8068 },
  wolf: { body: 'wolf', color: 0x939dab },
  lion: { body: 'cat', color: 0xd0ae73, accent: 0x977058, detail: 'mane' },
  lioness: { body: 'cat', color: 0xd0ae73 },
  crab: { body: 'crab', color: 0xc17d69 },
  faeri: { body: 'fairy', color: 0x84a99b, accent: 0xe1c5df },
  crocodile: { body: 'reptile', color: 0x7c9863 },
  siren: { body: 'spirit', color: 0x68adb0, accent: 0xe1bfc3 },
  'spellcaster-spirit': { body: 'spirit', color: 0x7c9fba, detail: 'staff' },
  thornback: { body: 'boar', color: 0x82a075, accent: 0xd8cca4, detail: 'spikes' },
  'marsh-toad': { body: 'toad', color: 0x98a85b, accent: 0xc7889a },
  'water-spirit': { body: 'spirit', color: 0x6fb6ce },
  'small-spider': { body: 'spider', color: 0x947a78, accent: 0xdcad75 },
  'huge-spider': { body: 'spider', color: 0x8e7088, accent: 0xe4b887 },
  'gigantuan-spider': { body: 'spider', color: 0x686d83, accent: 0xe19c88 },
  'spider-egg': { body: 'egg', color: 0xd1c5ae, accent: 0x908481 },
  hydra: { body: 'hydra', color: 0x77a278, accent: 0xe7bd70 },
};

export const ENEMY_LOOKS: Partial<Record<EnemyKind, CreatureLook>> = {
  specter: { body: 'spirit', color: 0x87a8aa },
  lich: { body: 'spirit', color: 0x829aac, detail: 'crown' },
  ghast: { body: 'humanoid', color: 0x99a591, detail: 'horns' },
  soldierDemon: { body: 'humanoid', color: 0xc67864, detail: 'horns' },
  beastDemon: { body: 'wolf', color: 0xa26365, detail: 'spikes' },
  oni: { body: 'humanoid', color: 0xb1799b, detail: 'horns' },
  deathknightSpear: { body: 'humanoid', color: 0x788793, accent: 0x93d0cd, detail: 'spear' },
  goblinChief: { body: 'goblin', color: 0x7da964, detail: 'crown' },
  goblinRaider: { body: 'goblin', color: 0x7da964, detail: 'club' },
  goblinShaman: { body: 'goblin', color: 0x7da964, detail: 'staff' },
  baral: { body: 'humanoid', color: 0x779ab2, detail: 'staff' },
  denialArtifact: { body: 'relic', color: 0x88a8b7, accent: 0xe1d299 },
  baralDrake: { body: 'bat', color: 0x79a2b4 },
  lillith: { body: 'humanoid', color: 0x7a4aa6, accent: 0xd2a8ff },
  lillithCopy: { body: 'humanoid', color: 0x7a4aa6, accent: 0xd2a8ff },
  lillithOrb: { body: 'relic', color: 0x55307a, accent: 0xff86e0 },
};

export const SUMMON_LOOKS: Record<string, CreatureLook> = {};
function group(body: CreatureBody, color: number, kinds: string, detail: CreatureDetail = 'none'): void {
  for (const kind of kinds.split(' ')) {
    const blood = /blood|gorged|leech|marrow/.test(kind);
    SUMMON_LOOKS[kind] = { body, color: blood ? 0xac7180 : color, accent: blood ? 0xf0c6a1 : 0xd4dbac, detail };
  }
}

group('spider', 0x929366, 'gag-mite blood-tick rivet-beetle bore-beetle veil-spider web-lurker gag-spider');
group('slime', 0x827766, 'tar-slime blood-slime');
group('spirit', 0x87aaa1, 'ghost caustic-fume hushwraith mistweaver murk-wisp siphon-wraith muttering-shade shatter-wisp figment candlewight stormmind-wisp undine drowner riptide-spirit geyser kettle-spirit siren thundercloud cinder-shade wailing-shade ashcloud pyre-wraith haunt ball-lightning hellspark shackle-wraith');
group('construct', 0x919889, 'slag-brute clay-warden shardling grave-colossus dread-sentinel gloom-brute glass-warden bone-thrower leech-brute blood-warden marrow-colossus bulwark');
group('humanoid', 0x91a58b, 'blight-walker fetter-ghoul drowned-thrall blood-wight remnant sand-cadett blade-dervish leech-dervish blood-harvester standardbearer');
group('humanoid', 0x8bab9a, 'archer barb-archer plague-archer hexbow-phantom hush-archer pin-archer hooked-archer marrow-archer thorn-archer', 'bow');
group('humanoid', 0x8fabb6, 'phantom-lancer mirror-lancer mirror-knight stake-warden leech-harpooner gaoler', 'spear');
group('spirit', 0x9fa686, 'binder rot-herald blood-herald orzhov-sandpriest', 'staff');
group('wolf', 0x909a81, 'lockjaw bonegnawer mare bloodfang-stalker grave-stalker bloodjaw');
group('wolf', 0x9ea9b2, 'shardhound', 'spikes');
group('insect', 0xb8b57b, 'drill-wasp plague-moth blood-gnat');
group('worm', 0x95987c, 'neural-leech thought-leech lamprey-vortex lamprey shade-leech night-leech hush-leech shroud-leech storm-eel umbral-coil nerve-coil live-wire gag-leech fetter-leech');
group('wheel', 0xa5a78e, 'grindstone hex-wheel tide-clock spinning-top bloodmill leech-wheel');
group('toad', 0x94a467, 'blight-toad gorged-toad');
group('worm', 0x899c7f, 'gorging-maw abyssal-maw');
group('fairy', 0x9bb6b5, 'hush-sprite');
group('bat', 0x8b799a, 'gloom-bat vampire-bat');
group('eye', 0x9c93b3, 'synapse abyssal-eye brine-synapse');
group('relic', 0x9ea58b, 'sentry needle-sentry blood-idol warding-obelisk silencing-spike');
group('plant', 0x81a579, 'thorn-fiend thornbinder desertblight', 'spikes');
group('crab', 0xb5a079, 'scorpion');
group('reptile', 0x88a273, 'basilisk');
group('relic', 0x9b9fa8, 'fault-idol mourning-bell bone-reliquary');
group('spirit', 0x889eb0, 'hex-vortex');
group('humanoid', 0x8da697, 'puppeteer', 'staff');
group('spirit', 0x8f7a9e, 'requiem', 'crown');
group('humanoid', 0x4a4458, 'fetch');
group('humanoid', 0xb8c878, 'shard-dervish');
group('plant', 0x7a6e5a, 'charnel-root', 'spikes');
group('bat', 0xe0603a, 'brand-imp');
group('eye', 0xd1475c, 'migraine');
// Stop: clockwork, glass and stilled spirits.
group('spirit', 0xb8dcef, 'hush-warden still-warden glass-wraith');
group('construct', 0x9fc4d6, 'clockwork-jailer shatterwarden clockwork-ballista hourglass-golem');
group('wheel', 0xa8c8d8, 'second-hand pendulum mirage-clock gyroscope');
group('relic', 0xa8d8e8, 'stasis-bell');
group('humanoid', 0x9cbdd0, 'pinning-clockwork clockhand-duelist', 'spear');
group('insect', 0xb0d4e4, 'silent-needle');
// Reality: doubles and dreaming tides.
group('humanoid', 0xd46bb0, 'doppelganger');
group('spirit', 0x6fa8e8, 'elsewhere-tide dream-tide');
// Desecrate: plague, bone and blood.
group('slime', 0x6e8d4d, 'plague-mother');
group('spirit', 0x6e4d7d, 'gravecaller', 'staff');
group('humanoid', 0x7a6e5a, 'plague-saint nail-priest', 'staff');
group('relic', 0x8b7f6a, 'blood-altar ossuary-bell');
group('construct', 0x9b8f7a, 'bone-colossus');
group('humanoid', 0x7f9a5a, 'acid-lancer bloodspike', 'spear');
group('humanoid', 0x9b8f7a, 'ossified-thrower', 'bow');
group('toad', 0x9b8f7a, 'bone-spitter');
group('worm', 0x8a6a6a, 'leech-mother soul-leech');
group('wolf', 0x9b8f7a, 'marrow-drinker');

export type PlaceholderSpriteKind = `pixel-${string}`;
export const PLACEHOLDER_LOOKS: Record<PlaceholderSpriteKind, CreatureLook> = {};
const LOOKS: Record<string, CreatureLook | undefined> = { ...SUMMON_LOOKS, ...ENEMY_LOOKS, ...MINE_LOOKS };

function register(look: CreatureLook): PlaceholderSpriteKind {
  const key: PlaceholderSpriteKind = `pixel-${look.body}-${look.color.toString(16)}-${(look.accent ?? 0xdccb80).toString(16)}-${look.detail ?? 'none'}-${look.heads ?? 3}`;
  PLACEHOLDER_LOOKS[key] = look;
  return key;
}

const KEYS: Record<string, PlaceholderSpriteKind> = {};
for (const [kind, look] of Object.entries(LOOKS)) if (look) KEYS[kind] = register(look);
for (const heads of [3, 4, 5, 6]) KEYS[`hydra-${heads}`] = register({ ...MINE_LOOKS.hydra, heads });
for (const kind of ['sentinel', 'magma-sentinel'] as const) {
  for (const [role, accent] of Object.entries({ tank: 0xe6b676, healer: 0xa4deba, dps: 0xed9073 })) {
    KEYS[`${kind}-${role}`] = register({ ...MINE_LOOKS[kind], accent });
  }
}

export function placeholderSpriteFor(kind: string | null | undefined, heads?: number, role?: string): PlaceholderSpriteKind | null {
  if (!kind) return null;
  if (kind === 'hydra') return KEYS[`hydra-${Math.max(3, Math.min(6, Math.floor(heads ?? 3)))}`];
  return KEYS[`${kind}-${role}`] ?? KEYS[kind] ?? null;
}