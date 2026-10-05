// A walkable place: a town, the open wilds, or the country round a spot of the
// map, walked on foot. The player walks the map, talks to keepers at their
// doors, searches secrets, sneaks, and meets roaming packs, which hand off to
// GameScene exactly like a road fight. On foot, walking costs no time; what each
// traveller does does (see area.ts).

import Phaser from 'phaser';
import { playMusic, playSound } from '../audio';
import { GAME_HEIGHT, GAME_WIDTH } from '../config/constants';
import type { ExplorationOpening, MatchConfig } from '../config/MatchConfig';
import type { MageClass } from '../core/Classes';
import { getItem, isRangedWeapon, type ItemId } from '../core/Items';
import type { Mage } from '../core/Mage';
import { comboKey, isModifierWord, spellDisplayName, WORDS, type WordId } from '../core/Words';
import { rollAmbush } from '../pve/exploration/ambush';
import {
  AREA_HOURS, areaBoundsOf, areaHours, areaLead, gapLabel, hoursBehind, inAreaBounds, leaveArea, memberHours, restOver, restTogether,
  spendAreaTime, waitInArea,
} from '../pve/exploration/area';
import { advanceHours, isNight, spanLabel } from '../pve/exploration/clock';
import { MAX_PARTY } from '../pve/exploration/coop';
import { applyCreation, STARTER_WEAPONS, type CreationPick } from '../pve/exploration/creation';
import { ARMS_LODGE, armsPending, enterLodge, gateRefusal, lodgeWaiting, starterPicks, takeStarterWeapon, weaponsShared } from '../pve/exploration/arms';
import { inDesert, isSandstorm, STORM_SIGHT, stormHoursLeft } from '../pve/exploration/desert';
import { dungeonCombat, DUNGEONS } from '../pve/exploration/dungeons';
import { hashString, memberIn, moneyLabel, partyOf, rest, roomPrice, withMember } from '../pve/exploration/economy';
import { campOutcome, innOutcome, leaveOutcome, type CampCall } from '../pve/exploration/council';
import { shopById } from '../pve/exploration/shops';
import { describeSpawns, packPace, rollEncounter, spawnTint, type EncounterKind } from '../pve/exploration/encounters';
import { pickEvent } from '../pve/exploration/events';
import { isExplored, packExplored, unpackExplored } from '../pve/exploration/explored';
import {
  BIND_SPEED, FIELD_RULES, fieldCombos, fieldHealAmount, fieldSpellMana, isStraightAttack, MAX_FIELD_WORDS, MELEE_AMBUSH_TILES,
  reachTiles, SNEAK_SIGHT, SNEAK_SPEED, VEIL_SIGHT, type FieldEffect, type FieldRule,
} from '../pve/exploration/fieldWords';
import { localActions, type ExplorationActions } from '../pve/exploration/intents';
import { resolveLocale, type ResolvedLocale, type Secret, type WildPack } from '../pve/exploration/locales';
import { cellWorldTile, OPEN_WORLD_ID, openWorldCell, openWorldMainland, openWorldPace, WORLD_SCALE } from '../pve/exploration/openWorld';
import { stepDice, type ExplorationRun } from '../pve/exploration/run';
import { saveRun } from '../pve/exploration/save';
import { sceneSalt, stageScene } from '../pve/exploration/scenes';
import {
  findSearchTarget,
  pickedOver,
  resolveSearch,
  SEARCH_HOURS,
  searchBonus,
  searchShelves,
  searchSite,
  type SearchResolution,
  type SearchTarget,
} from '../pve/exploration/search';
import { shortRestRisk, SHORT_REST_HOURS, takeShortRest, type RestSite, type ShortRestOutcome } from '../pve/exploration/shortRest';
import { siteDone, siteWokeFlag } from '../pve/exploration/site';
import { bloodmoonCombat, bloodmoonDue, bloodmoonFight } from '../pve/exploration/bloodmoon';
import { parseRestNap, type RestNap } from '../pve/exploration/nap';
import { createWorld, describeTile, placeById, START_PLACE, type Place } from '../pve/exploration/world';
import { ENEMY_DEFS } from '../pve/swamprun';
import { ADVENTURE_SPELL_SETS, casterReach, getSpell, setActiveSpellSets } from '../spells/registry';
import {
  createCreatureAnims, CREATURE_FRAME_RATIO, creatureFacesRight, creatureSpriteFor, creatureTexture, preloadCreatureSprites,
} from '../world/creatureSprite';
import { TILE_PX, TILE_SCALE } from '../world/kenney';
import { buildLocaleModel, type ExitDef, type Keeper, type LocaleModel } from '../world/locale';
import { bufferTexture, LocaleView, preloadLocaleAssets } from '../world/localeRender';
import { createMageAnims, MAGE_FIRST_FRAME, MAGE_IDLE, MAGE_RUN, preloadMageFrames } from '../world/mageSprite';
import type { Cell } from '../world/pathfind';
import { PixelBuffer } from '../world/pixels';
import { feetFit, Walker, WALK_SPEED } from '../world/walker';
import { awaken } from '../ui/pve/CreationFlow';
import type { ArmoryState } from '../ui/pve/ArmoryHall';
import type { InnHooks } from '../ui/pve/ShopView';
import type { SearchRollResult } from '../ui/pve/SearchView';
import { isReducedMotion } from '../ui/cabinet/motion';
import { ensureGlowTextures, GLOW } from '../visuals/glowTextures';
import { ParticleFx } from '../visuals/ParticleFx';
import { siteDebris, siteTexture } from '../world/siteArt';
import { Dice } from '../core/Dice';
import { AdventureSession, HOST_SEAT } from '../net/AdventureSession';
import { startAdventureFight } from '../net/adventureFight';
import { parseWildPack } from '../net/fightWire';
import { awakenParty, claimTravellers } from '../net/partySetup';
import type { ExplorationEntry } from './ExplorationScene';
import type { HudOwner, LocaleHudScene } from './LocaleHudScene';

export interface LocaleEntry {
  run: ExplorationRun;
  locale: string;
  /** Arrive on this cell instead of the map's spawn. */
  at?: Cell;
  notice?: string;
  /** Milliseconds before roaming packs may engage (after breaking off a fight). */
  grace?: number;
}

const HOLD_VERB: Record<string, string> = { herb: 'Pick', cache: 'Search', stash: 'Take', trinket: 'Pick up' };
const SITE_DONE = 'All done here. Head back to the travel map whenever you are ready.';

interface PackState {
  pack: WildPack;
  sprite: Phaser.GameObjects.Sprite;
  marker: Phaser.GameObjects.Text;
  idleAnim: string;
  runAnim: string;
  /** The figure's art faces right unflipped. */
  facesRight: boolean;
  /** Tint when nothing holds it; null for creature art shown as drawn. */
  restTint: number | null;
  /** Height of the '!' over its feet, px. */
  lift: number;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  wanderX: number;
  wanderY: number;
  chasing: boolean;
  /** It has the party in sight right now. */
  sees: boolean;
  /** Scene time until which Bind holds it to a crawl. */
  slowUntil: number;
  bound: boolean;
  /** Chase speed, tiles per second. */
  pace: number;
  /** On the party's trail from the start (an ambush); gives up only when it loses them. */
  hunting: boolean;
  /** How long a hunting pack has been unable to find the party, ms. */
  lostMs: number;
  /** Host: some traveller is near enough for it to move this frame. */
  active?: boolean;
  /** Guest: where the host last said it stands. */
  tx?: number;
  ty?: number;
  /** Asleep: it neither sees nor moves until something wakes it. */
  asleep: boolean;
  /** Scene time the next "z" drifts up off it. */
  zzzAt: number;
  breath?: Phaser.Tweens.Tween;
}

/** Another traveller of an online party, as this client sees them. */
interface Companion {
  seat: number;
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  /** Where they last said they stand (feet, world px). */
  tx: number;
  ty: number;
  moving: boolean;
  sneaking: boolean;
  /** Scene time of their last report. */
  seen: number;
  /** Host: the world tile their ambush roll was last made for, and the cell their fog was last lifted around. */
  tile: string;
  cell: string;
}

/** Someone the packs can go after. */
interface Traveller {
  x: number;
  y: number;
  sneaking: boolean;
  veiled: boolean;
}

const CLASS_TINT: Record<MageClass, number> = { objects: 0xffe2b0, life: 0xc2ffc8, hexcraft: 0xe0c8ff };
/** Online positions and packs go out this often, ms. */
const LINK_MS = 100;
/** A guest waits this long for the host to settle a search, ms. */
const REPLY_MS = 10_000;
/** The camera may look this far past the edge of the area, px. */
const AREA_MARGIN = TILE_PX * 4;
/** Standing this close to the edge of the area offers the way back to the map, tiles. */
const EDGE_TILES = 1.4;

/** A guest's ambush reaches no further than this, tiles (the longest spell reach with room to spare). */
const GUEST_REACH_TILES = 16;
/** Online: how close to someone's rest a traveller must stand to join it, tiles. */
const CAMP_REACH_TILES = 2.5;

const INTERACT_RANGE = 1.45;
const PACK_SPEED = 2.8;
const WORD_KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'];
/** Packs this many tiles away hold still; nobody is there to see them move. */
const PACK_ACTIVE_TILES = 30;
/** World tiles walked after a fight or an ambush before the next ambush may roll. */
const AMBUSH_COOLDOWN = 3;
/** An ambush turns up this many tiles from the party. */
const AMBUSH_NEAR = 9;
const AMBUSH_FAR = 12;
/** A hunting pack gives up after this long without finding a veiled party, or beyond this many tiles. */
const HUNT_LOST_MS = 2000;
const HUNT_LOST_TILES = 24;

const RULE_TEXT: Record<FieldEffect, string> = {
  veil: 'hide',
  bind: 'slow packs',
  mind: 'read packs',
  heal: 'heal the party',
};

export class LocaleScene extends Phaser.Scene implements HudOwner {
  private run!: ExplorationRun;
  private place!: ResolvedLocale;
  private model!: LocaleModel;
  private view?: LocaleView;
  private walker?: Walker;
  private hud?: LocaleHudScene;
  private notice = '';
  private ready = false;
  private busy = false;
  private leaving = false;
  private savedAt = 0;
  private savedCell = '';
  private graceMs = 0;
  private blockedLastFrame = true;
  private packs: PackState[] = [];
  private secretSprites = new Map<string, Phaser.GameObjects.Image>();
  private fog?: Phaser.GameObjects.Graphics;
  private fogSeen = new Set<string>();
  private fogCell = '';
  /** On foot across the world: the run's explored map, kept unpacked while walking. */
  private exploredMask?: Uint8Array;
  private keys?: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd' | 'e' | 'space' | 'enter' | 'i' | 'esc' | 'f' | 'c' | 'g' | 'r' | 'z' | 'x' | 't' | 'm', Phaser.Input.Keyboard.Key>;
  private wordKeys: Phaser.Input.Keyboard.Key[] = [];
  /** The leader as last read, for charges, mana and class. */
  private leader?: Mage;
  /** The leader's own words, in loadout order (the modifier aside). */
  private words: WordId[] = [];
  /** Words picked for the next spell, in the order picked. */
  private picked: WordId[] = [];
  /** Which of the leader's spells are straight attacks, by combo key. */
  private attacks = new Map<string, boolean>();
  /** Weapon reach for an ambush, in tiles, and why it cannot be used (if it cannot). */
  private strikeTiles = MELEE_AMBUSH_TILES;
  private strikeRanged = false;
  private strikeBlocked: string | null = null;
  private veilUntil = 0;
  private mindUntil = 0;
  private mindView?: { gfx: Phaser.GameObjects.Graphics; labels: Map<PackState, Phaser.GameObjects.Text> };
  private barAt = 0;
  private sneaking = false;
  /** The party member this player walks as; null means the leader (solo). */
  private member: MageClass | null = null;
  /** The online Adventure this scene is part of, if any. */
  private session: AdventureSession | null = null;
  /** The host's announcement of this scene, which guests report back against. */
  private sceneTag = 0;
  private companions = new Map<number, Companion>();
  private linkAt = 0;
  /** Guest: what the last position report said, and when it went. */
  private sentPos = '';
  private sentPosAt = 0;
  /** The classes that have fallen. */
  private fallen = new Set<MageClass>();
  private leveling = false;
  /** Times the gate guard has turned an unarmed party back, for his next line. */
  private gateTries = 0;
  /** The rest last seen starting, so it starts once on this screen. */
  private campSeen = '';
  /** A small fire where someone sat down to rest. */
  private campMark?: { key: string; fire: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text };
  /** Host: choices put to guests, by id, waiting on the answer of the guest in `seat`. */
  private asks = new Map<number, { seat: number; settle: (choice: number) => void }>();
  private askSeq = 0;
  /** Guest: choices the host put to this player, waiting for the screen to be free. */
  private askQueue: Record<string, unknown>[] = [];
  private answering = false;
  /** Host: ambushes already rolled here, so two travellers on one tile meet one pack. */
  private rolledAmbushes = new Set<string>();
  /** Host: when each guest's veil runs out, scene time. */
  private seatVeils = new Map<number, number>();
  /** The day the packs on the ground belong to. */
  private packDay = 0;
  /** Guest: the party's explored map as last taken into this client's fog. */
  private exploredSeen = '';
  // ---- The country on foot ----
  private readonly world = createWorld();
  private worldTile = '';
  /** On foot: the square of ground the party may walk, px, and the veil drawn over the rest. */
  private areaRect?: { x0: number; y0: number; x1: number; y1: number };
  private areaVeil?: Phaser.GameObjects.Graphics;
  /** World tiles still to walk before an ambush may roll. */
  private ambushCooldown = 0;
  private hudAt = 0;
  /** Extra tiles a carried light lets the party notice secrets from. */
  private lightBonus = 0;
  private particles?: ParticleFx;
  private shadows: { sprite: Phaser.GameObjects.Sprite; shadow: Phaser.GameObjects.Image }[] = [];
  private dustMs = 0;
  /** The find E is being held on, and for how long. */
  private holdId = '';
  private holdMs = 0;
  private holdRing?: Phaser.GameObjects.Graphics;
  /** Everything the party came to this site for is done. */
  private siteFinished = false;
  /** Presses and holds from the touch controls, read like keys. */
  private taps = new Set<string>();
  private touchHold = false;
  private glintAt = 0;
  private nightShade?: Phaser.GameObjects.Rectangle;
  private storm?: { vignette: Phaser.GameObjects.Image; haze: Phaser.GameObjects.Rectangle; streaks: Phaser.GameObjects.TileSprite };

  constructor() {
    super('Locale');
  }

  preload(): void {
    preloadLocaleAssets(this);
    preloadMageFrames(this);
    preloadCreatureSprites(this);
  }

  create(entry: LocaleEntry): void {
    this.ready = false;
    this.busy = false;
    this.leaving = false;
    this.blockedLastFrame = true;
    this.hud = undefined;
    this.packs = [];
    this.secretSprites = new Map();
    this.veilUntil = 0;
    this.mindUntil = 0;
    this.mindView = undefined;
    this.picked = [];
    this.attacks = new Map();
    this.barAt = 0;
    this.sneaking = false;
    this.worldTile = '';
    this.ambushCooldown = AMBUSH_COOLDOWN;
    this.hudAt = 0;
    this.nightShade = undefined;
    this.storm = undefined;
    this.run = entry.run;
    this.notice = entry.notice ?? '';
    this.graceMs = entry.grace ?? 0;
    this.member = null;
    this.session = null;
    this.sceneTag = 0;
    this.companions = new Map();
    this.linkAt = 0;
    this.sentPos = '';
    this.sentPosAt = 0;
    this.fallen = new Set();
    this.leveling = false;
    this.asks = new Map();
    this.askSeq = 0;
    this.askQueue = [];
    this.answering = false;
    this.areaRect = undefined;
    this.areaVeil = undefined;
    this.rolledAmbushes = new Set();
    this.seatVeils = new Map();
    this.packDay = entry.run.day;
    this.exploredSeen = '';
    this.shadows = [];
    this.dustMs = 0;
    this.holdId = '';
    this.holdMs = 0;
    this.holdRing = undefined;
    this.siteFinished = false;
    this.taps = new Set();
    this.touchHold = false;
    this.campSeen = '';
    this.campMark = undefined;
    ensureGlowTextures(this);
    this.particles = new ParticleFx(this, () => isReducedMotion());
    // Exploration fights cast from every catalogue; the field offers the same spells.
    setActiveSpellSets(ADVENTURE_SPELL_SETS);
    // On foot the party walks the country round where it set out.
    if (entry.locale === OPEN_WORLD_ID && !this.run.area) {
      const from = entry.at ?? (this.run.locale?.id === OPEN_WORLD_ID ? this.run.locale : null);
      this.run.area = { tile: from ? cellWorldTile(from) : { ...this.run.pos }, spent: {} };
    }
    let place = resolveLocale(this.run, entry.locale);
    if (!place) {
      this.scene.start('Exploration', { run: this.run, notice: 'That place cannot be entered yet.' } satisfies ExplorationEntry);
      return;
    }
    this.place = place;
    this.cameras.main.setBackgroundColor(0x0b0d0a);
    createMageAnims(this);
    createCreatureAnims(this);
    this.model = place.model ?? buildLocaleModel(place.def);
    this.view = new LocaleView(this, this.model, { stream: !!place.world });

    const stored = this.run.locale?.id === place.def.id ? this.run.locale : null;
    // Out in the world a spot that no longer stands open moves to the nearest open ground of its world tile.
    const settle = (cell: Cell | null | undefined): Cell | null =>
      !cell ? null : !this.model.blocked(cell.x, cell.y) ? cell : place?.world ? openWorldCell(cellWorldTile(cell)) : null;
    const candidates = [settle(entry.at), settle(stored), place.def.spawn].filter((cell): cell is Cell => !!cell);
    const start = candidates.find((cell) => !this.model.blocked(cell.x, cell.y)) ?? place.def.spawn;
    const area = place.world ? this.run.area : null;
    if (area && !inAreaBounds(areaBoundsOf(area), cellWorldTile(start))) {
      // Standing outside its own area: the walk is round where the party really is.
      area.tile = cellWorldTile(start);
      place = resolveLocale(this.run, entry.locale) ?? place;
      this.place = place;
    }
    if (area) {
      const bounds = areaBoundsOf(area);
      const span = WORLD_SCALE * TILE_PX;
      this.areaRect = { x0: bounds.x0 * span, y0: bounds.y0 * span, x1: (bounds.x1 + 1) * span, y1: (bounds.y1 + 1) * span };
    }
    // On foot the ground past the area's edge counts as blocked, for steps and for paths alike.
    this.walker = new Walker(this, start, this.model.w, this.model.h, (x, y) => this.model.blocked(x, y) || !this.cellInArea(x, y));
    this.addShadow(this.walker.sprite, 0.7);

    const cam = this.cameras.main;
    const rect = this.areaRect;
    if (rect) {
      const x = Math.max(0, rect.x0 - AREA_MARGIN);
      const y = Math.max(0, rect.y0 - AREA_MARGIN);
      cam.setBounds(x, y, Math.min(this.view.worldWidth, rect.x1 + AREA_MARGIN) - x, Math.min(this.view.worldHeight, rect.y1 + AREA_MARGIN) - y);
    } else {
      cam.setBounds(0, 0, this.view.worldWidth, this.view.worldHeight);
    }
    cam.startFollow(this.walker.sprite, true, 0.18, 0.18);
    cam.setRoundPixels(true);
    cam.fadeIn(260, 0, 0, 0);
    this.view.stream(new Phaser.Geom.Rectangle(this.walker.x - GAME_WIDTH / 2, this.walker.y - GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT));

    this.run.locale = { id: place.def.id, x: start.x, y: start.y };
    if (place.kind === 'town') this.run.lastTown = place.def.id;
    if (place.world) this.syncWorldTile();
    place.onEnter?.(this.run);
    saveRun(this.run);

    this.spawnPacks();
    this.placeSecrets();
    this.refreshSite();
    this.setupFog();
    this.drawAreaVeil();
    // Online messages may arrive the moment the session binds: the packs and secrets are down by then.
    this.joinSession(place.def.id, start, entry);
    this.readLeader();
    if (place.world) this.setupWorldOverlays();

    const kb = this.input.keyboard;
    if (kb) {
      this.keys = kb.addKeys({
        up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT',
        w: 'W', a: 'A', s: 'S', d: 'D',
        e: 'E', space: 'SPACE', enter: 'ENTER', i: 'I', esc: 'ESC', f: 'F', c: 'C', g: 'G', r: 'R', z: 'Z', x: 'X', t: 'T', m: 'M',
      }) as LocaleScene['keys'];
      this.wordKeys = WORD_KEYS.map((key) => kb.addKey(key));
    }
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => this.onPointer(pointer));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off(Phaser.Input.Events.POINTER_DOWN);
      // Choices still out with guests lapse with the scene they were asked in.
      for (const ask of [...this.asks.values()]) ask.settle(-1);
      this.particles?.destroy();
      this.particles = undefined;
      this.view?.destroy();
      this.view = undefined;
      this.scene.stop('LocaleHud');
    });
    playMusic('menu');
    this.scene.launch('LocaleHud', { owner: this });
  }

  /** A touch control pressed a button: read on the next frame like its key. */
  tap(button: string): void {
    this.taps.add(button);
  }

  /** The touch act button is held down (for finds that take a moment). */
  setTouchHold(on: boolean): void {
    this.touchHold = on;
  }

  onHudReady(hud: LocaleHudScene): void {
    this.hud = hud;
    hud.setMember(this.member);
    this.refreshHud();
    const words = this.words.length ? `1-${this.words.length}: pick words  R: cast     ` : '';
    const ambush = this.packs.length ? 'F: ambush     C: sneak     ' : '';
    const search = this.place.world ? 'G: search     T: wait     M: travel map     ' : '';
    const lead = this.guest && !this.place.world ? 'The host leads the way     ' : '';
    hud.setHint(`${lead}WASD / arrows or click: walk     E: act     ${words}${ambush}${search}Z: rest     I: pack     Esc: menu`);
    hud.setMapExit(!!this.place.world);
    this.refreshWordBar();
    void (async () => {
      if (this.session) await this.setUpOnline(hud, this.session);
      else if (this.run.creating) await this.createParty();
      if (this.notice) hud.toast(this.notice, 5200);
      if (this.siteFinished) hud.toast(SITE_DONE, 4200);
      await this.settleLevels();
      this.session?.reportArrival();
      this.ready = true;
      if (this.session) this.onCouncil();
      void this.answerAsks();
    })();
  }

  /** Online: take this scene's messages, tell the guests where the party is, and follow the host's run. */
  private joinSession(locale: string, at: Cell, entry: LocaleEntry): void {
    const session = AdventureSession.current;
    this.session = session;
    if (!session) return;
    this.member = session.member;
    this.makeCompanions(session, at);
    // Listeners go in before binding: messages that waited for this scene arrive at once.
    const offs = [
      session.on('x-run', () => this.onRunChanged()),
      session.on('x-changed', () => this.onRunChanged()),
      session.on('x-council', () => this.onCouncil()),
      session.on('x-news', (message) => {
        if (typeof message.text === 'string') this.hud?.toast(message.text, 3600);
      }),
      ...(session.isHost
        ? [
          session.on('x-pos', (message) => this.onCompanionMoved(message)),
          session.on('x-act', (message) => this.onCompanionAct(message)),
        ]
        : [
          session.on('x-live', (message) => this.onLive(message)),
          session.on('x-pack+', (message) => this.onPackAdded(message)),
          session.on('x-pack-', (message) => this.onPackGone(message)),
          session.on('x-toast', (message) => {
            if (typeof message.text === 'string') this.hud?.toast(message.text.slice(0, 240), 3200);
          }),
          session.on('x-pause', (message) => this.hud?.setPrompt(message.on === true ? 'The host paused the game.' : null)),
          session.on('x-sleep', (message) => {
            const nap = parseRestNap(message.nap);
            if (!nap) return;
            this.hud?.closeWindow();
            void this.hud?.sleep(nap);
          }),
          session.on('x-note', (message) => {
            if (message.to === session.localSeat && typeof message.text === 'string') this.hud?.toast(message.text.slice(0, 240), 4200);
          }),
          session.on('x-ask', (message) => {
            if (message.to !== session.localSeat) return;
            this.askQueue.push(message);
            void this.answerAsks();
          }),
        ]),
    ];
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const off of offs) off();
      session.unbind(this);
    });
    session.bind(this);
    if (!session.isHost) return;
    session.adopt(this.run);
    this.sceneTag = session.go('Locale', { locale, at, notice: entry.notice, grace: entry.grace });
  }

  /** Another player changed the run (or the host sent it afresh): redraw what shows it. */
  private onRunChanged(): void {
    this.readLeader();
    this.refreshHud();
    this.hud?.refreshWindow();
    for (const [id, image] of this.secretSprites) {
      if (!this.run.flags.includes(`secret:${id}`)) continue;
      this.takeAway(id, image);
    }
    this.refreshSite();
    if (this.guest && this.run.day !== this.packDay) this.newDay();
    if (this.guest) this.adoptSeen();
    if (this.guest && this.ready && !this.leaving && !this.hud?.modalOpen) void this.settleLevels();
  }

  /** Online: everyone has a traveller before anything happens; a new party also picks its words. */
  private async setUpOnline(hud: LocaleHudScene, session: AdventureSession): Promise<void> {
    const choose = hud.choose.bind(hud);
    const prompt = (text: string | null): void => hud.setPrompt(text);
    if (session.roster.some((member) => !member)) await claimTravellers(session, this.run, choose, prompt);
    this.member = session.member;
    hud.setMember(this.member);
    this.readLeader();
    if (this.run.creating) await awakenParty(session, this.run, hud.awaken.bind(hud), isReducedMotion(), prompt);
    this.readLeader();
    this.refreshHud();
    if (session.isHost) await session.arrivals(this.sceneTag);
  }

  /** The windows' way of changing the run for this player. */
  private actions(): ExplorationActions {
    return this.session?.actions() ?? localActions(this.run, this.member);
  }

  /** A fresh run: the voice in each traveller's head asks for two words and a way of doing things. */
  private async createParty(): Promise<void> {
    const hud = this.hud;
    if (!hud) return;
    const picks: CreationPick[] = [];
    for (const mage of partyOf(this.run)) {
      const who = this.run.party.entities.length > 1 ? mage.name : undefined;
      picks.push(await awaken(hud.awaken.bind(hud), this.run, mage.mageClass, isReducedMotion(), who));
    }
    if (!applyCreation(this.run, picks)) return;
    this.readLeader();
    this.changed();
  }

  private refreshHud(): void {
    if (this.session) {
      this.paintCompanions();
      this.hud?.setCouncil(this.councilLines(this.session));
    }
    if (this.place.world) {
      const { x, y } = this.run.pos;
      const storm = isSandstorm(this.run) && inDesert(this.world, x, y);
      const weather = storm ? `Sandstorm (${Math.ceil(stormHoursLeft(this.run))} h)` : '';
      this.hud?.refresh(this.run, describeTile(this.world, x, y), [weather, this.areaLine()].filter(Boolean).join('  ·  '));
      return;
    }
    this.hud?.refresh(this.run, this.place.def.name, this.place.subtitle ?? '');
  }

  /** On foot: how long the party has been out, and who has kept it out longest. */
  private areaLine(): string {
    const area = this.run.area;
    if (!area) return '';
    const hours = areaHours(area);
    if (hours <= 0) return 'On foot: no time spent';
    const lead = this.run.party.entities.length > 1 ? areaLead(area) : null;
    const who = lead ? memberIn(this.run, lead.member)?.name : undefined;
    const me = this.leader?.mageClass;
    const behind = me && lead ? hoursBehind(area, me) : 0;
    return `On foot ${spanLabel(hours)}${who ? ` (${who})` : ''}${behind > 0 ? `  ·  You: ${gapLabel(behind)} behind (T: wait)` : ''}`;
  }

  /** On foot, online: who is behind the one furthest ahead on their own time, and by how much. */
  private laggards(session: AdventureSession): { seat: number; hours: number }[] {
    const area = this.place.world ? this.run.area : null;
    if (!area) return [];
    return session.roster.flatMap((member, seat) => {
      const hours = member ? hoursBehind(area, member) : 0;
      return hours > 1e-6 ? [{ seat, hours }] : [];
    });
  }

  private changed(): void {
    if (this.session) this.session.changed();
    else saveRun(this.run);
    this.refreshHud();
  }

  private async settleLevels(): Promise<void> {
    if (!this.hud || this.run.pendingLevels <= 0 || this.leveling) return;
    this.leveling = true;
    if (await this.hud.levelUps(this.run, this.actions())) this.changed();
    this.leveling = false;
    this.readLeader();
  }

  // ---------------------------------------------------------------------------
  //  FRAME
  // ---------------------------------------------------------------------------

  update(_time: number, delta: number): void {
    const keys = this.keys;
    const pressed = {
      act: !!keys && (Phaser.Input.Keyboard.JustDown(keys.e) || Phaser.Input.Keyboard.JustDown(keys.space) || Phaser.Input.Keyboard.JustDown(keys.enter)),
      pack: !!keys && Phaser.Input.Keyboard.JustDown(keys.i),
      menu: !!keys && Phaser.Input.Keyboard.JustDown(keys.esc),
      strike: !!keys && Phaser.Input.Keyboard.JustDown(keys.f),
      sneak: !!keys && Phaser.Input.Keyboard.JustDown(keys.c),
      search: !!keys && Phaser.Input.Keyboard.JustDown(keys.g),
      cast: !!keys && Phaser.Input.Keyboard.JustDown(keys.r),
      rest: !!keys && Phaser.Input.Keyboard.JustDown(keys.z),
      refuse: !!keys && Phaser.Input.Keyboard.JustDown(keys.x),
      wait: !!keys && Phaser.Input.Keyboard.JustDown(keys.t),
      map: !!keys && Phaser.Input.Keyboard.JustDown(keys.m),
      word: this.wordKeys.findIndex((key) => Phaser.Input.Keyboard.JustDown(key)),
    };
    this.view?.stream(this.cameras.main.worldView);
    const walker = this.walker;
    const session = this.session;
    const blocked = !walker || !this.ready || this.leaving || this.busy || !!this.hud?.modalOpen || !!session?.paused;
    // The press that closed a window still reads as just-down on the first free frame.
    const settling = this.blockedLastFrame;
    this.blockedLastFrame = blocked;
    // Nothing but an open window holds the bloodmoon back.
    if (!blocked && !this.guest && bloodmoonDue(this.run)) {
      this.riseBloodmoon();
      return;
    }
    if (!walker || blocked) {
      walker?.update(delta, { x: 0, y: 0 });
      // Online the world goes on while a player looks through a pack or a shop.
      if (walker && session && this.ready && !this.leaving && !this.busy && !session.paused) this.simulate(delta);
      this.updateLink(delta);
      this.updateShadows();
      this.updateSleepers();
      this.taps.clear();
      if (this.holdId) this.endHold();
      return;
    }
    if (settling) {
      pressed.act = pressed.pack = pressed.menu = pressed.strike = pressed.sneak = pressed.search = pressed.cast = pressed.rest = pressed.refuse = pressed.wait = pressed.map = false;
      pressed.word = -1;
    }
    // The touch controls press the same buttons the keys do.
    if (this.taps.has('act')) pressed.act = true;
    if (this.taps.has('pack')) pressed.pack = true;
    if (this.taps.has('menu')) pressed.menu = true;
    if (this.taps.has('strike')) pressed.strike = true;
    if (this.taps.has('sneak')) pressed.sneak = true;
    if (this.taps.has('search')) pressed.search = true;
    if (this.taps.has('cast')) pressed.cast = true;
    if (this.taps.has('rest')) pressed.rest = true;
    if (this.taps.has('map')) pressed.map = true;
    this.taps.clear();
    const steer = {
      x: (keys && (keys.right.isDown || keys.d.isDown) ? 1 : 0) - (keys && (keys.left.isDown || keys.a.isDown) ? 1 : 0),
      y: (keys && (keys.down.isDown || keys.s.isDown) ? 1 : 0) - (keys && (keys.up.isDown || keys.w.isDown) ? 1 : 0),
    };
    // Sitting down for a rest: nobody walks off mid-rest.
    const sitting = this.sitting();
    if (sitting) {
      steer.x = 0;
      steer.y = 0;
      walker.stop();
    }
    walker.update(delta, steer);
    this.simulate(delta);
    this.updateLink(delta);
    this.updateShadows();
    this.updateSleepers();
    this.kickDust(delta);
    if (this.leaving || this.busy) return;
    if (sitting) {
      this.hud?.setPrompt(this.sitPrompt());
      if (this.holdId) this.endHold();
      if (pressed.rest) void this.shortRest();
      else if (pressed.refuse) this.refuseCamp();
      else if (pressed.pack) void this.openPack();
      else if (pressed.menu) void this.openMenu();
      this.persistPosition();
      return;
    }
    if (pressed.refuse && this.refuseCamp()) pressed.act = false;
    const camp = this.campToJoin();
    if (camp) {
      this.hud?.setPrompt(`[E] Join ${camp}'s rest     [X] Keep going`);
      if (pressed.act) {
        this.session?.say({ op: 'camp-answer', answer: 'join' });
        playSound('travel.rest');
        return;
      }
    }
    this.updateSecrets();
    this.updateStealth();
    this.updateMindView();

    const keeper = this.nearestKeeper();
    const secret = keeper ? null : this.nearestSecret(1.3);
    const exit = keeper || secret ? null : this.model.exitAt(walker.cell.x, walker.cell.y);
    const target = keeper || secret || exit ? null : this.spellTarget();
    const prey = keeper || secret || exit || target ? null : this.preyWithin(this.strikeTiles, !this.strikeRanged);
    const edge = keeper || secret || exit || target || prey ? false : this.atAreaEdge();
    const home = !keeper && !secret && !exit && !target && !prey && !edge && this.siteFinished;
    // A find that takes a moment is taken by holding E by it, standing still.
    const holdable = secret?.hold ? secret : null;
    const holding = !!holdable && !settling && steer.x === 0 && steer.y === 0
      && (this.touchHold || (!!keys && (keys.e.isDown || keys.space.isDown)));
    this.updateHold(holding ? holdable : null, delta);
    if (!camp) this.hud?.setPrompt(
      keeper ? `[E] Talk: ${keeper.name}`
        : holdable ? `[Hold E] ${HOLD_VERB[holdable.look ?? 'trinket']}: ${holdable.label}`
        : secret ? `[E] Search: ${secret.label}`
        : exit ? this.leavePrompt(exit.label)
        : target ? `[R] ${spellDisplayName(this.picked)}: ${target.pack.label}`
        : prey ? `[F] Ambush: ${prey.pack.label}`
        : edge ? this.leavePrompt('Back to the travel map')
        : home ? this.leavePrompt('Head back to the travel map')
        : null,
    );
    if (pressed.act) {
      if (keeper) void this.openShop(keeper);
      else if (secret && !secret.hold) void this.search(secret);
      else if (exit) void this.useExit(exit);
      else if (edge || home) this.wantToLeaveOnFoot();
    } else if (pressed.strike) {
      this.strike();
    } else if (pressed.word >= 0) {
      this.pick(pressed.word);
    } else if (pressed.cast) {
      void this.cast();
    } else if (pressed.sneak) {
      this.toggleSneak();
    } else if (pressed.search && this.place.world) {
      void this.openSearch();
    } else if (pressed.wait && this.place.world) {
      this.waitAbout();
    } else if (pressed.map && this.place.world) {
      this.wantToLeaveOnFoot();
    } else if (pressed.rest) {
      void this.shortRest();
    } else if (pressed.pack) {
      void this.openPack();
    } else if (pressed.menu && this.picked.length) {
      this.picked = [];
      playSound('ui.back');
      this.refreshWordBar();
    } else if (pressed.menu) {
      void this.openMenu();
    }
    this.persistPosition();
  }

  /** One frame of the world: the weather and the fog, and the packs wherever this client runs them. */
  private simulate(delta: number): void {
    if (this.place.world) this.updateWorld(delta);
    this.updateFog();
    // A guest's packs are the host's, as the host last saw them.
    if (!this.guest) this.updatePacks(delta);
  }

  private persistPosition(): void {
    const walker = this.walker;
    if (!walker || walker.isMoving || this.guest) return;
    const cell = walker.cell;
    const key = `${cell.x},${cell.y}`;
    if (key === this.savedCell || this.time.now - this.savedAt < 800) return;
    this.savedCell = key;
    this.savedAt = this.time.now;
    this.run.locale = { id: this.place.def.id, x: cell.x, y: cell.y };
    if (this.place.world) this.syncWorldTile();
    saveRun(this.run);
  }

  // ---------------------------------------------------------------------------
  //  INTERACTION
  // ---------------------------------------------------------------------------

  private distanceTo(x: number, y: number): number {
    const walker = this.walker!;
    return Math.hypot(walker.x - (x + 0.5) * TILE_PX, walker.y - (y + 0.8) * TILE_PX) / TILE_PX;
  }

  private nearestKeeper(): Keeper | null {
    let best: Keeper | null = null;
    let bestDistance = INTERACT_RANGE;
    for (const keeper of this.model.keepers) {
      const distance = this.distanceTo(keeper.x, keeper.y);
      if (distance <= bestDistance) {
        best = keeper;
        bestDistance = distance;
      }
    }
    return best;
  }

  private nearestSecret(range: number): Secret | null {
    return this.place.secrets.find((s) => !this.run.flags.includes(`secret:${s.id}`) && this.distanceTo(s.x, s.y) <= range) ?? null;
  }

  private async openShop(keeper: Keeper): Promise<void> {
    if (!this.hud) return;
    if (keeper.shop === ARMS_LODGE && armsPending(this.run)) {
      await this.openArmory(keeper);
      return;
    }
    // Alone the world waits while you shop; online it goes on around you.
    const hold = !this.session;
    if (hold) this.busy = true;
    this.walker?.stop();
    this.hud.setPrompt(null);
    const rested = (nap: RestNap): void => {
      if (this.session?.isHost) this.session.send({ k: 'x-sleep', nap });
    };
    await this.hud.openShop(this.run, keeper.shop, this.place.def.id, () => this.changed(), this.actions(), rested, this.innHooks(keeper), () => this.innShortRest());
    if (this.run.day !== this.packDay) this.newDay();
    await this.settleLevels();
    this.readLeader();
    this.changed();
    if (hold) this.busy = false;
  }

  /** Online: rooms at `keeper`'s counter are called for and joined, never simply booked. */
  private innHooks(keeper: Keeper): InnHooks | undefined {
    const session = this.session;
    if (!session) return undefined;
    return {
      call: () => {
        const inn = session.council.inn;
        if (!inn) return null;
        return {
          by: inn.by === session.localSeat ? 'You' : session.nameOf(inn.by),
          here: inn.shop === keeper.shop,
          joined: inn.answers[session.localSeat] === 'join',
          waitingFor: inn.answers.flatMap((answer, seat) => (answer === 'join' ? [] : [session.nameOf(seat)])),
        };
      },
      propose: () => session.say({ op: 'inn', shop: keeper.shop }),
      answer: (join) => session.say({ op: 'inn-answer', answer: join ? 'join' : 'refuse' }),
    };
  }

  /** The first day at the Lodge: a weapon each, off the pedestals, once the whole party has come in. */
  private async openArmory(keeper: Keeper): Promise<void> {
    const hud = this.hud;
    if (!hud) return;
    const hold = !this.session;
    if (hold) this.busy = true;
    this.walker?.stop();
    hud.setPrompt(null);
    if (this.session) {
      void this.actions().apply({ op: 'lodge' });
    } else {
      for (const entity of this.run.party.entities) enterLodge(this.run, entity.mageClass);
    }
    await hud.openArmory({
      keeperName: keeper.name,
      reducedMotion: isReducedMotion(),
      state: () => this.armoryState(),
      take: async (weapon) => {
        if (this.session) return this.actions().apply({ op: 'arm', weapon });
        const result = takeStarterWeapon(this.run, this.armoryPicker(), weapon);
        if (result.ok) this.changed();
        return result;
      },
    });
    this.readLeader();
    this.changed();
    if (hold) this.busy = false;
  }

  /** Who picks a weapon on this screen next: this player's traveller online, else the first one unarmed. */
  private armoryPicker(): MageClass | null {
    const picks = starterPicks(this.run);
    if (this.session) return this.member && !picks[this.member] ? this.member : null;
    return this.run.party.entities.find((entity) => !picks[entity.mageClass])?.mageClass ?? null;
  }

  private armoryState(): ArmoryState {
    const run = this.run;
    const picks = starterPicks(run);
    const nameOf = (member: MageClass): string => memberIn(run, member)?.name ?? 'someone';
    const picker = armsPending(run) ? this.armoryPicker() : null;
    return {
      pedestals: STARTER_WEAPONS.map(({ id }) => ({
        id,
        takenBy: run.party.entities.filter((entity) => picks[entity.mageClass] === id).map((entity) => nameOf(entity.mageClass)),
      })),
      shared: weaponsShared(run),
      picker: picker ? nameOf(picker) : null,
      waitingFor: lodgeWaiting(run).map(nameOf),
      done: !armsPending(run),
    };
  }

  private async openPack(): Promise<void> {
    if (!this.hud) return;
    const hold = !this.session;
    if (hold) this.busy = true;
    this.walker?.stop();
    await this.hud.openPack(this.run, () => this.changed(), this.actions());
    this.readLeader();
    this.changed();
    if (hold) this.busy = false;
  }

  private async openMenu(): Promise<void> {
    if (!this.hud) return;
    const session = this.session;
    if (session && !session.isHost) return this.openGuestMenu(session);
    this.busy = true;
    this.walker?.stop();
    // The host's pause holds the whole party.
    session?.send({ k: 'x-pause', on: true });
    const onFoot = !!this.run.area && !!this.place.world;
    const spent = this.run.area ? areaHours(this.run.area) : 0;
    const choice = await this.hud.choose('PAUSED', onFoot ? 'On foot' : this.place.def.name, [
      { id: 'resume', label: 'Resume', detail: onFoot ? 'Back to the country.' : 'Back to the streets.' },
      { id: 'pack', label: 'Pack', detail: 'Gear, words and stats.' },
      { id: 'rest', label: 'Short Rest', detail: this.restDetail() },
      ...(onFoot ? [{
        id: 'map',
        label: 'Back to the Travel Map',
        detail: spent > 0 ? `The party has spent ${spanLabel(spent)} on foot. It stands where it set out.` : 'No time spent. The party stands where it set out.',
      }] : []),
      session
        ? { id: 'quit', label: 'Save and Quit', detail: 'Everyone returns to the main menu. Continue Co-op from the lobby later.' }
        : { id: 'quit', label: 'Save and Quit', detail: 'Return to the main menu. The run waits here.' },
    ], 'resume');
    this.busy = false;
    if (choice !== 'quit') session?.send({ k: 'x-pause', on: false });
    if (choice === 'pack') void this.openPack();
    if (choice === 'rest') void this.shortRest();
    if (choice === 'map') this.leaveOnFoot();
    if (choice === 'quit') {
      this.leaving = true;
      saveRun(this.run);
      if (session) {
        session.end('The host saved the run and closed the session.');
        return;
      }
      this.scene.stop('LocaleHud');
      this.scene.start('Menu');
    }
  }

  /** A guest's menu: the host decides where the party goes; on foot, everyone rests when they like. */
  private async openGuestMenu(session: AdventureSession): Promise<void> {
    const hud = this.hud;
    if (!hud) return;
    this.walker?.stop();
    const choice = await hud.choose('MENU', `${session.nameOf(HOST_SEAT)} leads the party.`, [
      { id: 'resume', label: 'Resume', detail: 'Back to the party.' },
      { id: 'pack', label: 'Pack', detail: 'Gear, words and stats.' },
      ...(this.place.world ? [{ id: 'rest', label: 'Short Rest', detail: this.restDetail() }] : []),
      { id: 'leave', label: 'Leave the session', detail: 'Everyone returns to the main menu. The host keeps the run.' },
    ], 'resume');
    if (choice === 'pack') void this.openPack();
    if (choice === 'rest') void this.shortRest();
    if (choice === 'leave') {
      this.leaving = true;
      session.end('You left the session.');
    }
  }

  /** Back on the travel map, on the tile the party set out from. The time spent on foot has already passed. */
  private leaveOnFoot(): void {
    if (this.leaving || this.guest || !this.run.area) return;
    this.leaving = true;
    this.walker?.stop();
    // After a site the party plans the rest of its way from the map.
    const replan = this.run.area.site?.dest;
    const hours = leaveArea(this.run);
    this.run.locale = null;
    saveRun(this.run);
    playSound('ui.back');
    this.cameras.main.fadeOut(240, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.stop('LocaleHud');
      this.scene.start('Exploration', {
        run: this.run,
        notice: hours > 0 ? `Back on the map. ${spanLabel(hours)} passed on foot.` : 'Back on the map.',
        replan,
      } satisfies ExplorationEntry);
    });
  }

  /** Search a secret: a cache, a glint, a patch. On foot it takes the searcher half an hour. */
  private async search(secret: Secret, member: MageClass | null = this.leader?.mageClass ?? null): Promise<void> {
    if (!this.hud || !this.place.search) return;
    if (this.guest) {
      this.session?.send({ k: 'x-act', what: 'secret', id: secret.id });
      this.hud.toast(`Searching: ${secret.label}...`, 1600);
      return;
    }
    this.busy = true;
    this.walker?.stop();
    const result = this.place.search(this.run, secret);
    if (member && this.spendTime([member], AREA_HOURS.pickup)) this.newDay();
    if (result.fight) {
      this.notify(result.message, 2400);
      if (result.trap) await this.springTrap(secret, result.fight);
      this.busy = false;
      this.startFight(result.fight);
      return;
    }
    if (!this.run.flags.includes(`secret:${secret.id}`)) this.run.flags.push(`secret:${secret.id}`);
    this.takeAway(secret.id);
    playSound('ui.confirm');
    this.notify(result.message, 4200);
    if (result.revealAll) this.revealAll();
    if (result.wake) this.makeNoise(secret, result.wake);
    await this.settleLevels();
    this.changed();
    this.refreshSite();
    this.busy = false;
  }

  /** Hold E on a find: fill the ring, then take it. Anything else lets go. */
  private updateHold(secret: Secret | null, delta: number): void {
    if (!secret?.hold) {
      if (this.holdId) this.endHold();
      return;
    }
    if (this.holdId !== secret.id) {
      this.endHold();
      this.holdId = secret.id;
    }
    this.holdMs += delta;
    this.walker?.stop();
    const t = Math.min(1, this.holdMs / secret.hold);
    this.drawHoldRing(t);
    this.hud?.setHoldProgress(t);
    // Leaves and dust come off it as it is worked at.
    this.dustMs += delta;
    const image = this.secretSprites.get(secret.id);
    if (image && this.dustMs > 180) {
      this.dustMs = 0;
      this.particles?.burst({ x: image.x, y: image.y - image.displayHeight * 0.4 }, {
        color: siteDebris(secret.look ?? 'trinket', secret.herb), count: 2, speed: 50, lifespan: 420, size: 5,
        gravityY: 120, angle: { min: 220, max: 320 }, depth: image.depth + 1,
      });
      image.setX((secret.x + 0.5) * TILE_PX + (Math.random() < 0.5 ? -1 : 1) * 1.5);
    }
    if (this.holdMs >= secret.hold) {
      this.endHold();
      void this.search(secret);
    }
  }

  private endHold(): void {
    const secret = this.place.secrets.find((s) => s.id === this.holdId);
    const image = secret ? this.secretSprites.get(secret.id) : undefined;
    if (secret && image) image.setX((secret.x + 0.5) * TILE_PX);
    this.holdId = '';
    this.holdMs = 0;
    this.holdRing?.clear();
    this.hud?.setHoldProgress(null);
  }

  private drawHoldRing(t: number): void {
    const walker = this.walker;
    if (!walker) return;
    const ring = this.holdRing ?? (this.holdRing = this.add.graphics().setDepth(100002));
    const x = Math.round(walker.x);
    const y = Math.round(walker.y - TILE_PX * 1.7);
    ring.clear();
    ring.fillStyle(0x120d09, 1).fillCircle(x, y, 13);
    ring.lineStyle(4, 0x3a281b, 1).strokeCircle(x, y, 9);
    ring.lineStyle(4, t >= 1 ? 0xf4e7b5 : 0xd2bd7f, 1).beginPath()
      .arc(x, y, 9, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2, false).strokePath();
    ring.fillStyle(0xd2bd7f, 1).fillRect(x - 1, y - 1, 3, 3);
  }

  /** A find is taken: it lifts, bursts into leaves or splinters, and is gone. */
  private takeAway(id: string, image = this.secretSprites.get(id)): void {
    this.secretSprites.delete(id);
    if (!image) return;
    if (this.holdId === id) this.endHold();
    const secret = this.place.secrets.find((s) => s.id === id);
    this.tweens.killTweensOf(image);
    const at = { x: image.x, y: image.y - image.displayHeight * 0.5 };
    if (image.alpha > 0.1) {
      this.particles?.burst(at, {
        color: secret?.look ? siteDebris(secret.look, secret.herb) : 0xfff1b0, count: 12, speed: 110, lifespan: 560,
        size: 6, gravityY: 180, angle: { min: 200, max: 340 }, depth: 100001,
      });
      this.particles?.burst(at, { shape: 'spark', color: 0xffe9a8, count: 6, speed: 70, lifespan: 380, size: 5, depth: 100001 });
    }
    this.tweens.add({
      targets: image, y: image.y - 16, scaleX: image.scaleX * 1.15, scaleY: image.scaleY * 1.15, alpha: 0,
      duration: 320, ease: 'Cubic.Out', onComplete: () => image.destroy(),
    });
  }

  /** The find was bait: it jolts, bursts open and the ambushers leap out of it. */
  private async springTrap(secret: Secret, pack: WildPack): Promise<void> {
    const image = this.secretSprites.get(secret.id);
    const x = (secret.x + 0.5) * TILE_PX;
    const y = (secret.y + 0.9) * TILE_PX;
    const pause = (ms: number): Promise<void> => new Promise((resolve) => this.time.delayedCall(ms, () => resolve()));
    playSound('travel.ambush');
    if (image && !isReducedMotion()) this.tweens.add({ targets: image, x: x + 3, duration: 45, yoyo: true, repeat: 4 });
    await pause(isReducedMotion() ? 80 : 300);
    if (!this.scene.isActive()) return;
    if (!isReducedMotion()) this.cameras.main.shake(240, 0.006);
    this.cameras.main.flash(140, 110, 24, 16);
    this.particles?.burst({ x, y: y - 14 }, { shape: 'smoke', color: 0x5a524a, count: 9, speed: 80, lifespan: 700, size: 22, alpha: 0.6, drag: 0.6, depth: 100001 });
    this.particles?.burst({ x, y: y - 14 }, { color: 0x8d5c30, count: 10, speed: 150, lifespan: 520, size: 6, gravityY: 240, depth: 100001 });
    if (image) this.takeAway(secret.id, image);
    // The first of them springs out: only a figure, the fight is next.
    const leap = this.addPack({ ...pack, x: secret.x, y: secret.y, hunting: true, asleep: false });
    this.packs = this.packs.filter((state) => state !== leap);
    const scaleX = leap.sprite.scaleX;
    const scaleY = leap.sprite.scaleY;
    leap.sprite.setScale(scaleX * 0.2, scaleY * 0.2);
    this.tweens.add({ targets: leap.sprite, scaleX, scaleY, duration: 260, ease: 'Back.Out' });
    this.tweens.add({ targets: leap.sprite, y: leap.y - 18, duration: 150, yoyo: true, ease: 'Quad.Out' });
    leap.marker.setScale(0).setVisible(true);
    this.tweens.add({ targets: leap.marker, scale: 1, duration: 300, delay: 120, ease: 'Back.Out' });
    await pause(isReducedMotion() ? 200 : 560);
  }

  /** Whether the party has done what it came to this site for: said once, then shown as the way back. */
  private refreshSite(): void {
    const site = this.place.world ? this.run.area?.site : undefined;
    const done = !!site && siteDone(this.run, site);
    if (done && !this.siteFinished && this.ready) {
      this.hud?.toast(SITE_DONE, 4200);
      playSound('ui.confirm');
    }
    this.siteFinished = done;
  }

  /** On foot, `members` spend `hours`. Returns the midnights that passed. Elsewhere nothing is counted. */
  private spendTime(members: readonly MageClass[], hours: number): number {
    if (!this.place.world || !this.run.area) return 0;
    const days = spendAreaTime(this.run, members, hours);
    this.afterAreaTime();
    return days;
  }

  private async useExit(exit: ExitDef): Promise<void> {
    if (this.leaving) return;
    const refusal = gateRefusal(this.run, this.place.def.id, START_PLACE, this.gateTries);
    if (refusal) {
      this.gateTries += 1;
      playSound('ui.deny');
      this.hud?.toast(refusal, 5200);
      return;
    }
    const walker = this.walker;
    if (this.session && walker) {
      this.wantToLeave({ x: walker.cell.x, y: walker.cell.y });
      return;
    }
    await this.goThrough(exit);
  }

  /** Through `exit`: the whole party goes, wherever it leads. */
  private async goThrough(exit: ExitDef): Promise<void> {
    if (this.leaving) return;
    const travel = exit.to && exit.to !== 'world' && this.place.travel
      ? this.place.travel(this.run, exit)
      : { t: 'world' as const, notice: `You leave ${this.place.def.name}.` };
    if (travel.t === 'fight') {
      this.startFight(travel.pack, travel.then, travel.fleeTo);
      return;
    }
    if (travel.t === 'dungeon') {
      await this.enterDungeon(travel.place);
      return;
    }
    if (travel.t === 'stay') {
      playSound('ui.deny');
      this.hud?.toast(travel.notice, 2600);
      return;
    }
    this.leaving = true;
    this.hud?.setPrompt(null);
    playSound('ui.back');
    this.cameras.main.fadeOut(220, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      if (travel.t === 'world') {
        this.run.locale = null;
        saveRun(this.run);
        this.scene.stop('LocaleHud');
        this.scene.start('Exploration', { run: this.run, notice: travel.notice } satisfies ExplorationEntry);
      } else {
        this.run.locale = null;
        saveRun(this.run);
        this.scene.stop('LocaleHud');
        this.scene.start('Locale', { run: this.run, locale: travel.locale, at: travel.at, notice: travel.notice } satisfies LocaleEntry);
      }
    });
  }

  private onPointer(pointer: Phaser.Input.Pointer): void {
    if (!this.ready || this.busy || this.leaving || this.hud?.modalOpen || !this.walker || this.sitting()) return;
    const rect = this.areaRect;
    const x = Math.floor(pointer.worldX / TILE_PX);
    const y = Math.floor(pointer.worldY / TILE_PX);
    // A click past the edge of the area walks to the edge.
    const cell = rect
      ? { x: Phaser.Math.Clamp(x, rect.x0 / TILE_PX, rect.x1 / TILE_PX - 1), y: Phaser.Math.Clamp(y, rect.y0 / TILE_PX, rect.y1 / TILE_PX - 1) }
      : { x, y };
    const keeper = this.model.keepers.find((k) => k.x === cell.x && k.y === cell.y)
      ?? this.keeperOfBuildingAt(cell);
    if (keeper) {
      const spot = this.approach(keeper);
      if (spot && this.walker.walkTo(spot, () => void this.openShop(keeper))) return;
    }
    const exit = this.model.exitAt(cell.x, cell.y);
    if (exit && this.walker.walkTo(cell, () => void this.useExit(exit))) return;
    if (!this.model.blocked(cell.x, cell.y)) this.walker.walkTo(cell);
  }

  private keeperOfBuildingAt(cell: Cell): Keeper | undefined {
    const building = this.place.def.buildings.find((b) =>
      b.shop && cell.x >= b.x && cell.y >= b.y && cell.x < b.x + b.spec.w && cell.y < b.y + b.spec.h);
    return building ? this.model.keepers.find((k) => k.shop === building.shop) : undefined;
  }

  /** The free cell next to a keeper that is closest to the player. */
  private approach(keeper: Keeper): Cell | null {
    const around: Cell[] = [[0, 1], [-1, 0], [1, 0], [-1, 1], [1, 1], [0, -1]]
      .map(([dx, dy]) => ({ x: keeper.x + dx, y: keeper.y + dy }))
      .filter((cell) => !this.model.blocked(cell.x, cell.y));
    around.sort((a, b) => this.distanceTo(a.x, a.y) - this.distanceTo(b.x, b.y));
    return around[0] ?? null;
  }

  // ---------------------------------------------------------------------------
  //  PACKS AND SECRETS
  // ---------------------------------------------------------------------------

  private spawnPacks(): void {
    for (const pack of this.place.packs) {
      const fell = this.run.groupsBeaten[pack.id];
      if (fell != null && fell >= this.run.day) continue;
      this.addPack(pack);
    }
  }

  private addPack(pack: WildPack): PackState {
    const x = (pack.x + 0.5) * TILE_PX;
    const y = (pack.y + 0.8) * TILE_PX;
    const size = pack.elite ? 1.35 : 1.05;
    // The figure is the first member: in its own art where it has some, else the tinted mage, as in a fight.
    const lead = pack.spawns?.[0];
    const kind = lead?.family === 'swamp' ? lead.kind : null;
    const creature = creatureSpriteFor(kind);
    const idleAnim = creature ? `enemy-${creature}-idle` : MAGE_IDLE;
    const sprite = this.add.sprite(x, y, creature ? creatureTexture(creature) : MAGE_FIRST_FRAME)
      .setOrigin(0.5, creature ? 0.9 : 0.95).setDepth(y);
    sprite.play({ key: idleAnim, startFrame: pack.x % 4 });
    const build = creature && kind ? ENEMY_DEFS[kind].scale ?? 1 : 1;
    const mageHeight = this.textures.getFrame(MAGE_FIRST_FRAME).height * TILE_SCALE * size;
    sprite.setScale(creature ? (mageHeight * CREATURE_FRAME_RATIO * build) / (sprite.height || 1) : TILE_SCALE * size);
    const restTint = !creature || kind === 'acidZombie' ? pack.tint : null;
    if (restTint != null) sprite.setTint(restTint);
    const lift = TILE_PX * 1.25 * Math.max(1, build);
    const marker = this.add.text(x, y - lift, pack.elite ? '!!' : '!', {
      fontFamily: 'Georgia, serif',
      fontSize: '22px',
      fontStyle: 'bold',
      color: pack.elite ? '#ff8a5a' : '#ffd070',
      stroke: '#1a0e08',
      strokeThickness: 4,
    }).setOrigin(0.5, 1).setDepth(100000).setVisible(false);
    const state: PackState = {
      pack, sprite, marker, idleAnim, runAnim: creature ? `enemy-${creature}-walk` : MAGE_RUN,
      facesRight: !creature || creatureFacesRight(creature), restTint, lift,
      x, y, homeX: x, homeY: y, wanderX: x, wanderY: y,
      chasing: !!pack.hunting, sees: false, slowUntil: 0, bound: false,
      pace: this.place.world ? pack.pace ?? PACK_SPEED : PACK_SPEED,
      hunting: !!pack.hunting,
      lostMs: 0,
      asleep: false,
      zzzAt: 0,
    };
    this.packs.push(state);
    this.addShadow(sprite, creature ? 0.8 * Math.max(1, build) : 0.7);
    if (pack.asleep) this.fallAsleep(state);
    return state;
  }

  /** Asleep where it lies: slow breath, no sight, a "z" now and then. */
  private fallAsleep(state: PackState): void {
    state.asleep = true;
    state.chasing = false;
    state.sprite.anims.timeScale = 0.3;
    state.breath = this.tweens.add({
      targets: state.sprite,
      scaleY: state.sprite.scaleX * 0.95,
      duration: 1500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });
    state.zzzAt = this.time.now + Math.random() * 900;
  }

  /** It wakes: the breath stops, the mark pops up over it. */
  private rouse(state: PackState): void {
    if (!state.asleep) return;
    state.asleep = false;
    state.breath?.remove();
    state.breath = undefined;
    state.sprite.setScale(state.sprite.scaleX);
    state.sprite.anims.timeScale = 1;
    state.pack = { ...state.pack, asleep: false, label: state.pack.label.replace(/, asleep.*$/, '') };
    state.marker.setScale(0).setVisible(true);
    this.tweens.add({ targets: state.marker, scale: 1, duration: 340, ease: 'Back.Out' });
    this.ring(state.x, state.y, 1.6, 0xffd070);
    this.particles?.burst({ x: state.x, y: state.y - state.lift * 0.6 }, {
      shape: 'spark', color: 0xffd070, count: 8, speed: 110, lifespan: 420, glow: true, alignToTravel: true, drag: 0.8, size: 10, depth: 100001,
    });
    playSound('travel.notice');
  }

  /** Host: a sleeper wakes, and rouses any others asleep close by. From then on nothing at the site sleeps. */
  private wakePack(state: PackState, why: 'near' | 'noise'): void {
    if (!state.asleep) return;
    const light = (state.pack.wakeTiles ?? 2) >= 3.5;
    this.rouse(state);
    state.hunting = true;
    state.chasing = true;
    const site = this.run.area?.site;
    if (site && !this.run.flags.includes(siteWokeFlag(site))) {
      this.run.flags.push(siteWokeFlag(site));
      this.changed();
    }
    const who = state.pack.spawns?.length ? describeSpawns(state.pack.spawns) : state.pack.label;
    this.notify(why === 'noise' ? `The noise wakes them: ${who}!` : light ? `Light sleepers! ${who} wake as you creep closer.` : `${who} wake up!`, 2400);
    for (const other of this.packs) {
      if (other !== state && other.asleep && Math.hypot(other.x - state.x, other.y - state.y) <= TILE_PX * 6) this.wakePack(other, why);
    }
  }

  /** Host: taking something made noise; each sleeper close enough may wake. The roll is fixed per find. */
  private makeNoise(secret: Secret, wake: { tiles: number; chance: number }): void {
    const x = (secret.x + 0.5) * TILE_PX;
    const y = (secret.y + 0.8) * TILE_PX;
    for (const state of [...this.packs]) {
      if (!state.asleep || Math.hypot(state.x - x, state.y - y) > wake.tiles * TILE_PX) continue;
      const dice = new Dice((hashString(`${secret.id}:wake:${state.pack.id}`) ^ this.run.seed) >>> 0);
      if (dice.float() < wake.chance) this.wakePack(state, 'noise');
    }
  }

  /** Sleepers breathe out a "z" now and then, while anyone could see it. */
  private updateSleepers(): void {
    const now = this.time.now;
    const view = this.cameras.main.worldView;
    for (const state of this.packs) {
      if (!state.asleep || now < state.zzzAt) continue;
      state.zzzAt = now + 900 + Math.random() * 500;
      if (!view.contains(state.x, state.y)) continue;
      const big = Math.random() < 0.4;
      const z = this.add.text(state.x + 6, state.y - state.lift * 0.75, big ? 'Z' : 'z', {
        fontFamily: 'Georgia, serif',
        fontSize: big ? '19px' : '14px',
        fontStyle: 'bold',
        color: '#e6dcff',
        stroke: '#120d09',
        strokeThickness: 4,
      }).setOrigin(0.5).setDepth(100000).setAlpha(0).setScale(0.6);
      this.tweens.add({
        targets: z,
        x: z.x + 10 + Math.random() * 10,
        y: z.y - 30,
        alpha: { from: 1, to: 0 },
        scale: 1.2,
        duration: 1300,
        ease: 'Sine.Out',
        onComplete: () => z.destroy(),
      });
    }
  }

  private removePack(state: PackState): void {
    this.packs = this.packs.filter((other) => other !== state);
    this.mindView?.labels.get(state)?.destroy();
    this.mindView?.labels.delete(state);
    state.breath?.remove();
    const { sprite, marker } = state;
    marker.destroy();
    this.tweens.add({ targets: sprite, alpha: 0, duration: 420, onComplete: () => sprite.destroy() });
    if (this.session?.isHost) this.session.send({ k: 'x-pack-', id: state.pack.id });
  }

  /** Bind's tint on a pack, on or off. */
  private setBound(state: PackState, bound: boolean): void {
    if (bound === state.bound) return;
    state.bound = bound;
    if (bound) state.sprite.setTint(WORDS.bind.color);
    else if (state.restTint == null) state.sprite.clearTint();
    else state.sprite.setTint(state.restTint);
  }

  private updatePacks(delta: number): void {
    if (!this.walker || this.busy) return;
    const travellers = this.standingTravellers();
    const dt = Math.min(0.05, delta / 1000);
    const now = this.time.now;
    const world = !!this.place.world;
    const weather = world && this.inStorm() ? STORM_SIGHT : 1;
    this.graceMs = Math.max(0, this.graceMs - delta);
    for (const state of [...this.packs]) {
      // Each pack minds the traveller nearest to it.
      let near: Traveller | null = null;
      let distance = Infinity;
      for (const traveller of travellers) {
        const away = Math.hypot(traveller.x - state.x, traveller.y - state.y) / TILE_PX;
        if (away < distance) {
          distance = away;
          near = traveller;
        }
      }
      state.active = !!near && (distance <= PACK_ACTIVE_TILES || state.hunting);
      if (!near || !state.active) continue;
      const calm = this.graceMs > 0;
      if (state.asleep) {
        // Asleep it sees nothing; only someone close enough (half that sneaking) wakes it.
        const reach = (state.pack.wakeTiles ?? 2) * (near.sneaking ? 0.5 : 1) * (near.veiled ? 0.6 : 1);
        if (calm || distance > Math.max(reach, 0.9)) {
          state.sees = false;
          state.marker.setVisible(false);
          continue;
        }
        this.wakePack(state, 'near');
      }
      if (distance < 0.85 && !calm) {
        this.startFight(state.pack);
        return;
      }
      const leash = Math.hypot(state.x - state.homeX, state.y - state.homeY) / TILE_PX;
      const sight = state.pack.sight * (near.veiled ? VEIL_SIGHT : 1) * (near.sneaking ? SNEAK_SIGHT : 1) * weather;
      // A pack notices only what it can see; once on the scent it keeps it a while.
      const sees = distance <= sight && (distance < 1.2 || this.clearLine(state.x, state.y - 1, near.x, near.y - 1));
      state.sees = sees;
      if (state.hunting) {
        // An ambush runs the party down; only a veil or a long lead shakes it.
        state.lostMs = near.veiled && !sees ? state.lostMs + delta : 0;
        if (state.lostMs > HUNT_LOST_MS || distance > HUNT_LOST_TILES) {
          this.notify('You shook them off.', 2000);
          this.removePack(state);
          continue;
        }
        state.chasing = !calm;
      } else {
        const scent = state.chasing && distance <= (world ? sight * 2 : sight * 1.3 + 1);
        const reach = world ? state.pack.sight * 4 : state.pack.sight + 4;
        state.chasing = !calm && leash < reach && (sees || scent);
      }
      this.setBound(state, now < state.slowUntil);
      let tx = state.wanderX;
      let ty = state.wanderY;
      if (state.chasing) {
        tx = near.x;
        ty = near.y;
      } else if (Math.hypot(tx - state.x, ty - state.y) < 4) {
        const wander = this.wanderPoint(state, world);
        state.wanderX = wander.x;
        state.wanderY = wander.y;
      }
      const mx = tx - state.x;
      const my = ty - state.y;
      const len = Math.hypot(mx, my);
      if (len > 2) {
        const speed = (state.chasing ? state.pace : state.pace * 0.35) * (state.bound ? BIND_SPEED : 1) * TILE_PX * dt;
        const nx = state.x + (mx / len) * speed;
        const ny = state.y + (my / len) * speed;
        const blocked = (x: number, y: number): boolean => this.model.blocked(x, y);
        if (feetFit(nx, state.y, this.model.w, this.model.h, blocked) && this.insideArea(nx, state.y)) state.x = nx;
        if (feetFit(state.x, ny, this.model.w, this.model.h, blocked) && this.insideArea(state.x, ny)) state.y = ny;
        state.sprite.setFlipX(state.facesRight ? mx < 0 : mx > 0);
      }
      const anim = len > 2 ? state.runAnim : state.idleAnim;
      if (state.sprite.anims.currentAnim?.key !== anim) state.sprite.play(anim);
      state.sprite.setPosition(Math.round(state.x), Math.round(state.y)).setDepth(state.y);
      state.marker.setPosition(Math.round(state.x), Math.round(state.y - state.lift)).setVisible(state.chasing);
    }
  }

  /** Where an idle pack strolls next: near home, out in the world along its road if it keeps one, never past the area's edge. */
  private wanderPoint(state: PackState, world: boolean): { x: number; y: number } {
    const rect = this.areaRect;
    const keep = (at: { x: number; y: number }): { x: number; y: number } => !rect ? at : {
      x: Phaser.Math.Clamp(at.x, rect.x0 + TILE_PX, rect.x1 - TILE_PX),
      y: Phaser.Math.Clamp(at.y, rect.y0 + TILE_PX, rect.y1 - TILE_PX / 2),
    };
    const home = { x: Math.floor(state.homeX / TILE_PX), y: Math.floor(state.homeY / TILE_PX) };
    if (world && this.model.def.terrain[home.y]?.[home.x] === '=') {
      for (let tries = 0; tries < 8; tries++) {
        const x = home.x + Math.round((Math.random() - 0.5) * 12);
        const y = home.y + Math.round((Math.random() - 0.5) * 12);
        if (this.model.def.terrain[y]?.[x] === '=') return keep({ x: (x + 0.5) * TILE_PX, y: (y + 0.8) * TILE_PX });
      }
    }
    const angle = Math.random() * Math.PI * 2;
    const radius = TILE_PX * (world ? 4 : 1.5);
    return keep({ x: state.homeX + Math.cos(angle) * radius, y: state.homeY + Math.sin(angle) * radius });
  }

  private placeSecrets(): void {
    const key = 'fx-secret';
    if (!this.textures.exists(key)) {
      const px = new PixelBuffer(9, 9);
      for (let i = 0; i < 9; i++) {
        px.set(4, i, 0xfff1b0);
        px.set(i, 4, 0xfff1b0);
      }
      px.set(4, 4, 0xffffff);
      for (const [x, y] of [[3, 3], [5, 5], [3, 5], [5, 3]]) px.set(x, y, 0xe7c24a);
      bufferTexture(this, key, px);
    }
    for (const secret of this.place.secrets) {
      if (this.run.flags.includes(`secret:${secret.id}`)) continue;
      const art = secret.look ? siteTexture(this, secret.look, secret.herb) : null;
      if (art) {
        // What a site holds stands on the ground in its own art.
        const x = (secret.x + 0.5) * TILE_PX;
        const y = (secret.y + 0.9) * TILE_PX;
        const image = this.add.image(x, y, art).setOrigin(0.5, 1).setScale(TILE_SCALE).setDepth(y - 1).setAlpha(0);
        if (secret.look === 'herb' && !isReducedMotion()) {
          this.tweens.add({
            targets: image, angle: { from: -3, to: 3 }, duration: 1200 + (secret.x % 5) * 110,
            yoyo: true, repeat: -1, ease: 'Sine.InOut',
          });
        }
        this.secretSprites.set(secret.id, image);
        continue;
      }
      const image = this.add.image((secret.x + 0.5) * TILE_PX, (secret.y + 0.4) * TILE_PX, key)
        .setScale(TILE_SCALE).setDepth(100000 - 1).setAlpha(0);
      this.tweens.add({ targets: image, scale: TILE_SCALE * 0.7, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.InOut' });
      this.secretSprites.set(secret.id, image);
    }
  }

  private updateSecrets(): void {
    if (this.secretSprites.size === 0) return;
    for (const secret of this.place.secrets) {
      const image = this.secretSprites.get(secret.id);
      if (!image) continue;
      const seen = this.distanceTo(secret.x, secret.y) <= secret.reveal + this.lightBonus;
      image.setAlpha(Phaser.Math.Linear(image.alpha, seen ? 1 : 0, 0.12));
    }
    // Now and then a glint on what the party came for.
    if (this.time.now < this.glintAt || isReducedMotion()) return;
    this.glintAt = this.time.now + 700 + Math.random() * 900;
    const shown = [...this.secretSprites.values()].filter((image) => image.originY === 1 && image.alpha > 0.8);
    const image = shown[Math.floor(Math.random() * shown.length)];
    if (!image) return;
    this.particles?.burst(
      { x: image.x + (Math.random() - 0.5) * image.displayWidth * 0.6, y: image.y - image.displayHeight * (0.4 + Math.random() * 0.5) },
      { shape: 'spark', color: 0xfff1b0, count: 1, speed: 6, lifespan: 520, size: 7, depth: image.depth + 1 },
    );
  }

  // ---------------------------------------------------------------------------
  //  FOG
  // ---------------------------------------------------------------------------

  private setupFog(): void {
    this.fog = undefined;
    this.fogCell = '';
    this.fogSeen = new Set();
    this.exploredMask = undefined;
    const chunk = this.place.fogChunk;
    if (!chunk || !this.walker) return;
    if (this.place.world) {
      const mask = unpackExplored(this.run.explored);
      this.exploredMask = mask;
      for (let y = 0; y < this.world.h; y++) for (let x = 0; x < this.world.w; x++) {
        if (isExplored(mask, x, y)) this.fogSeen.add(`${x},${y}`);
      }
    } else {
      const prefix = `${this.place.def.id}:`;
      for (const key of this.run.wildsSeen) if (key.startsWith(prefix)) this.fogSeen.add(key.slice(prefix.length));
    }
    this.fog = this.add.graphics().setDepth(100010);
    this.revealAround(this.walker.cell);
    this.drawFog();
  }

  private fogSize(): { chunk: number; cols: number; rows: number } {
    const chunk = this.place.fogChunk ?? 1;
    return { chunk, cols: Math.ceil(this.model.w / chunk), rows: Math.ceil(this.model.h / chunk) };
  }

  /** Mark the chunks around a cell as seen. Returns the newly seen chunk keys. */
  private revealAround(cell: Cell): string[] {
    const { chunk, cols, rows } = this.fogSize();
    const cx = Math.floor(cell.x / chunk);
    const cy = Math.floor(cell.y / chunk);
    // Blowing sand hides everything but the ground underfoot.
    const reach = this.place.world && this.inStorm() ? 0 : 1;
    const fresh: string[] = [];
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      const key = `${x},${y}`;
      if (this.fogSeen.has(key)) continue;
      this.fogSeen.add(key);
      if (this.exploredMask) this.exploredMask[y * this.world.w + x] = 1;
      else this.run.wildsSeen.push(`${this.place.def.id}:${key}`);
      fresh.push(key);
    }
    if (fresh.length && this.exploredMask) this.run.explored = packExplored(this.exploredMask);
    return fresh;
  }

  private revealAll(): void {
    if (!this.fog || this.place.world) return;
    const { cols, rows } = this.fogSize();
    const fresh: string[] = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const key = `${x},${y}`;
      if (this.fogSeen.has(key)) continue;
      this.fogSeen.add(key);
      this.run.wildsSeen.push(`${this.place.def.id}:${key}`);
      fresh.push(key);
    }
    this.drawFog();
    this.discoverLandmarks(fresh);
  }

  /** Name landmarks whose chunk just came out of the fog. */
  private discoverLandmarks(fresh: string[]): void {
    const chunk = this.place.fogChunk ?? 1;
    const flag = (id: string): string => `landmark:${this.place.def.id}:${id}`;
    const found = (this.place.landmarks ?? []).filter((mark) =>
      fresh.includes(`${Math.floor(mark.x / chunk)},${Math.floor(mark.y / chunk)}`) && !this.run.flags.includes(flag(mark.id)));
    if (!found.length) return;
    for (const mark of found) this.run.flags.push(flag(mark.id));
    playSound('ui.confirm');
    const names = found.length > 2 ? `${found.length} places` : found.map((mark) => mark.name).join(' and ');
    this.hud?.toast(`Discovered ${names}.`, 3600);
  }

  private drawFog(): void {
    const fog = this.fog;
    if (!fog) return;
    const { chunk, cols, rows } = this.fogSize();
    const size = chunk * TILE_PX;
    const band = TILE_PX;
    fog.clear();
    if (this.place.world) {
      // Too many chunks for soft edges: one run of darkness per row instead.
      fog.fillStyle(0x07080a, 0.96);
      for (let y = 0; y < rows; y++) {
        let start = -1;
        for (let x = 0; x <= cols; x++) {
          const dark = x < cols && !this.fogSeen.has(`${x},${y}`);
          if (dark && start < 0) start = x;
          if (!dark && start >= 0) {
            fog.fillRect(start * size, y * size, (x - start) * size, size);
            start = -1;
          }
        }
      }
      return;
    }
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const px = x * size;
      const py = y * size;
      if (!this.fogSeen.has(`${x},${y}`)) {
        fog.fillStyle(0x07080a, 0.96).fillRect(px, py, size, size);
        continue;
      }
      // Soft edge on the seen side of each border with the unknown.
      fog.fillStyle(0x07080a, 0.42);
      if (y > 0 && !this.fogSeen.has(`${x},${y - 1}`)) fog.fillRect(px, py, size, band);
      if (y < rows - 1 && !this.fogSeen.has(`${x},${y + 1}`)) fog.fillRect(px, py + size - band, size, band);
      if (x > 0 && !this.fogSeen.has(`${x - 1},${y}`)) fog.fillRect(px, py, band, size);
      if (x < cols - 1 && !this.fogSeen.has(`${x + 1},${y}`)) fog.fillRect(px + size - band, py, band, size);
    }
  }

  private updateFog(): void {
    if (!this.fog || !this.walker) return;
    const cell = this.walker.cell;
    const key = `${cell.x},${cell.y}`;
    if (key === this.fogCell) return;
    this.fogCell = key;
    const fresh = this.revealAround(cell);
    if (!fresh.length) return;
    this.drawFog();
    this.discoverLandmarks(fresh);
    this.changed();
  }

  /** Share of the map walked, for places under fog. */
  private mappedPercent(): number {
    const { cols, rows } = this.fogSize();
    return Math.round((this.fogSeen.size / Math.max(1, cols * rows)) * 100);
  }

  // ---------------------------------------------------------------------------
  //  WORDS AND AMBUSHES
  // ---------------------------------------------------------------------------

  /** Read what this player's member carries: words, charges, mana, weapon reach. */
  private readLeader(): void {
    const leader = memberIn(this.run, this.member);
    this.leader = leader;
    this.lightBonus = leader?.lightRadius() ? 2 : 0;
    this.words = leader ? leader.loadout.filter((word) => !isModifierWord(word)).slice(0, WORD_KEYS.length) : [];
    this.picked = this.picked.filter((word) => this.words.includes(word));
    const weapon = leader?.activeWeapon();
    this.strikeRanged = !!weapon && isRangedWeapon(weapon);
    this.strikeTiles = weapon && this.strikeRanged ? reachTiles(weapon.rangePx) : MELEE_AMBUSH_TILES;
    this.strikeBlocked = !leader ? 'Nobody can strike.'
      : !leader.alive ? 'The fallen cannot strike.'
      : leader.outOfAmmo() ? 'Out of arrows.'
      : leader.cannotAttack ? 'You cannot attack right now.'
      : null;
    if (leader) void this.readAttacks(leader);
    const party = partyOf(this.run);
    this.fallen = new Set(party.filter((mage) => !mage.alive).map((mage) => mage.mageClass));
    this.paintCompanions();
    this.refreshWordBar();
  }

  /** Try each of the leader's spells once to learn which are straight attacks. */
  private async readAttacks(leader: Mage): Promise<void> {
    for (const words of fieldCombos(this.words)) {
      const key = comboKey(words);
      if (this.attacks.has(key)) continue;
      const spell = getSpell(words, leader.spellClass);
      this.attacks.set(key, !!spell && (await isStraightAttack(spell, leader.spellClass)));
    }
    this.refreshWordBar();
  }

  private refreshWordBar(): void {
    if (!this.hud) return;
    const now = this.time.now;
    this.barAt = now;
    const charges = this.leader?.charges ?? {};
    const words = this.words.map((word, index) => {
      const text = `${index + 1} ${WORDS[word].label} ${charges[word] ?? 0}`;
      return this.picked.includes(word) ? `[${text}]` : text;
    });
    const seconds = (until: number): number => Math.ceil((until - now) / 1000);
    const text = [
      this.sneaking ? 'SNEAKING' : '',
      now < this.veilUntil ? `VEILED ${seconds(this.veilUntil)}s` : '',
      now < this.mindUntil ? `READING ${seconds(this.mindUntil)}s` : '',
      words.length ? `WORDS   ${words.join('    ')}` : '',
      this.picked.length ? `${this.spellLine()}   R: cast   Esc: clear` : '',
    ].filter(Boolean).join('     |     ');
    this.hud.setWordBar(text || null);
  }

  /** What the picked words do out here, and what they cost. */
  private spellLine(): string {
    const words = this.picked;
    const name = spellDisplayName(words);
    const leader = this.leader;
    if (!leader) return name;
    const mana = fieldSpellMana(leader, words);
    const cost = mana > 0 ? `, ${mana} mana` : '';
    const rule = words.length === 1 ? FIELD_RULES[words[0]] : undefined;
    if (rule) return `${name}: ${RULE_TEXT[rule.effect]}${cost}`;
    const spell = getSpell(words, leader.spellClass);
    if (!spell) return `${name}: no such spell`;
    const attack = this.attacks.get(comboKey(words));
    if (attack !== true) return attack === false ? `${name}: no effect outside a fight` : name;
    return `${name}: attack, reach ${Math.round(reachTiles(casterReach(spell)))}${cost}`;
  }

  /** Fade the leader while veiled or sneaking, and keep the veil's countdown fresh. */
  private updateStealth(): void {
    const walker = this.walker;
    if (!walker) return;
    const veiled = this.time.now < this.veilUntil;
    const alpha = this.leader?.alive === false ? 0.35 : veiled ? 0.45 : this.sneaking ? 0.7 : 1;
    if (walker.sprite.alpha !== alpha) walker.sprite.setAlpha(alpha);
    if (this.veilUntil <= 0) return;
    if (!veiled) {
      this.veilUntil = 0;
      this.hud?.toast('Veil ended.', 1600);
      this.refreshWordBar();
    } else if (this.time.now - this.barAt > 500) {
      this.refreshWordBar();
    }
  }

  /** C: sneak (much harder to see, half the pace) or walk upright again. */
  private toggleSneak(): void {
    this.sneaking = !this.sneaking;
    this.applyPace();
    playSound('ui.click');
    this.hud?.toast(this.sneaking ? 'Sneaking: packs notice you only up close. Half pace.' : 'Sneaking ended.', 2000);
    this.refreshWordBar();
  }

  /** Sneaking halves the pace; out in the world the ground underfoot sets it too. */
  private applyPace(): void {
    const walker = this.walker;
    if (!walker) return;
    const ground = this.place.world ? openWorldPace(walker.cell.x, walker.cell.y) : 1;
    walker.speedMul = (this.sneaking ? SNEAK_SPEED : 1) * ground;
  }

  /** How much of their usual sight packs have on the party right now. */
  private sightMultiplier(): number {
    const veiled = this.time.now < this.veilUntil;
    return (veiled ? VEIL_SIGHT : 1) * (this.sneaking ? SNEAK_SIGHT : 1) * (this.place.world && this.inStorm() ? STORM_SIGHT : 1);
  }

  /** F: spring on the nearest pack within weapon reach. Up close, only on one that has not seen you. */
  private strike(): void {
    if (!this.packs.length) return;
    const refuse = (message: string): void => {
      playSound('ui.deny');
      this.hud?.toast(message, 2200);
    };
    if (this.strikeBlocked) return refuse(this.strikeBlocked);
    const melee = !this.strikeRanged;
    const prey = this.preyWithin(this.strikeTiles, melee);
    if (prey) return this.ambush(prey, { kind: 'weapon' });
    const seen = melee && this.packsWithin(this.strikeTiles).some((state) => state.chasing);
    refuse(seen
      ? 'Melee ambush: they have seen you. Sneak (C) up on foes that have not.'
      : 'Ambush: no pack in weapon reach with a clear line.');
  }

  /** 1-6: pick a word for the next spell, or put it back. */
  private pick(index: number): void {
    const word = this.words[index];
    if (!word) return;
    const at = this.picked.indexOf(word);
    if (at >= 0) {
      this.picked.splice(at, 1);
    } else if (this.picked.length >= MAX_FIELD_WORDS) {
      playSound('ui.deny');
      this.hud?.toast(`At most ${MAX_FIELD_WORDS} words outside a fight.`, 1800);
      return;
    } else {
      this.picked.push(word);
    }
    playSound('ui.click');
    this.refreshWordBar();
  }

  /** The pack the picked words would open a fight on, when they make an attack and one is in reach. */
  private spellTarget(): PackState | null {
    const leader = this.leader;
    if (!leader || !this.picked.length || this.attacks.get(comboKey(this.picked)) !== true) return null;
    const spell = getSpell(this.picked, leader.spellClass);
    return spell ? this.preyWithin(reachTiles(casterReach(spell)), false) : null;
  }

  /** R: speak the picked words. An attack opens a fight with a free strike, seen or not. */
  private async cast(): Promise<void> {
    const hud = this.hud;
    const leader = this.leader;
    if (!hud || !leader) return;
    const words = [...this.picked];
    const refuse = (message: string): void => {
      playSound('ui.deny');
      hud.toast(message, 2200);
    };
    if (!leader.alive) return refuse('The fallen cannot speak words. Rest at an inn.');
    if (!words.length) return refuse(`Pick a word first (1-${this.words.length}), then R.`);
    const name = spellDisplayName(words);
    const spent = words.find((word) => (leader.charges[word] ?? 0) <= 0);
    if (spent) return refuse(`${WORDS[spent].label}: no charges left. Rest to restore them.`);
    const mana = fieldSpellMana(leader, words);
    if (!leader.hasMana(mana)) return refuse(`${name}: needs ${mana} mana.`);
    const rule = words.length === 1 ? FIELD_RULES[words[0]] : undefined;
    if (rule) return this.useRule(rule, words[0], mana);
    const spell = getSpell(words, leader.spellClass);
    if (!spell) return refuse(`${name}: no such spell.`);
    if (!(await isStraightAttack(spell, leader.spellClass))) {
      return refuse(`${name}: no effect outside a fight. Only straight attacks work here.`);
    }
    const prey = this.preyWithin(reachTiles(casterReach(spell)), false);
    if (!prey) return refuse(`${name}: no pack in reach with a clear line.`);
    // A guest's spell is paid by the host, which opens the fight.
    if (!this.guest) this.pay(words, mana);
    this.ambush(prey, { kind: 'spell', words });
  }

  /** Veil, Bind, Mind or Heal spoken alone. A guest shows it here and has the host settle it. */
  private useRule(rule: FieldRule, word: WordId, mana: number): void {
    const walker = this.walker;
    const hud = this.hud;
    if (!walker || !hud) return;
    const refuse = (message: string): void => {
      playSound('ui.deny');
      hud.toast(message, 2200);
    };
    const remote = this.guest;
    const settle = (): void => {
      if (!remote) return this.pay([word], mana);
      this.session?.send({ k: 'x-act', what: 'rule', word });
      playSound('ui.confirm');
      this.picked = [];
      this.refreshWordBar();
    };
    const { color } = WORDS[word];
    const now = this.time.now;
    const seconds = rule.ms / 1000;
    switch (rule.effect) {
      case 'veil':
        settle();
        this.veilUntil = now + rule.ms;
        this.ring(walker.x, walker.y, 1.4, color);
        hud.toast(`Veil: hidden for ${seconds}s. Packs notice you only up close.`, 2400);
        return;
      case 'bind': {
        const caught = this.packsWithin(rule.range);
        if (!caught.length) return refuse(`Bind: no pack within ${rule.range} tiles.`);
        settle();
        if (!remote) for (const state of caught) state.slowUntil = now + rule.ms;
        this.ring(walker.x, walker.y, rule.range, color);
        const who = caught.length === 1 ? caught[0].pack.label : `${caught.length} packs`;
        hud.toast(`Bind: ${who} slowed for ${seconds}s.`, 2400);
        return;
      }
      case 'mind':
        if (!this.packsWithin(rule.range).length) return refuse(`Mind: no pack within ${rule.range} tiles.`);
        settle();
        this.mindUntil = now + rule.ms;
        this.ring(walker.x, walker.y, rule.range, color);
        hud.toast(`Mind: for ${seconds}s you see how far each pack sees and where it is headed.`, 2600);
        return;
      case 'heal': {
        if (remote) {
          if (!partyOf(this.run).some((mage) => mage.alive && mage.hp < mage.maxHp)) return refuse('Heal: the party is at full HP.');
          settle();
          this.ring(walker.x, walker.y, 1, color);
          return;
        }
        const healed = this.healParty(this.member, word, mana);
        if (!healed) return refuse('Heal: the party is at full HP.');
        playSound('ui.confirm');
        this.ring(walker.x, walker.y, 1, color);
        this.notify(`Heal: ${healed.name} +${healed.amount} HP.`, 2200);
        this.spoke();
        return;
      }
    }
  }

  /** Heal the most hurt standing member, paid by `member`'s charges and mana. Null when nobody is hurt. */
  private healParty(member: MageClass | null, word: WordId, mana: number): { name: string; amount: number } | null {
    return withMember(this.run, member, (caster, party) => {
      const hurt = party.filter((m) => m.alive && m.hp < m.maxHp).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      if (!hurt) return null;
      const roll = 1 + Math.floor(Math.random() * 6);
      const amount = Math.min(hurt.maxHp - hurt.hp, fieldHealAmount(roll, caster.effectiveInt()));
      hurt.hp += amount;
      caster.spendCharges([word]);
      caster.spendMana(mana);
      return { name: hurt.name, amount };
    });
  }

  /** Pay a spell's charges and mana, as a fight would. */
  private pay(words: WordId[], mana: number): void {
    withMember(this.run, this.member, (caster) => {
      caster.spendCharges(words);
      caster.spendMana(mana);
    });
    playSound('ui.confirm');
    this.spoke();
  }

  /** After a spell: the words are put down and the leader read afresh. */
  private spoke(): void {
    this.picked = [];
    this.readLeader();
    this.changed();
  }

  private ambush(state: PackState, opening: ExplorationOpening): void {
    this.veilUntil = 0;
    if (this.guest) {
      // The host starts every fight; this one opens with this player's strike.
      this.session?.send({ k: 'x-act', what: 'ambush', pack: state.pack.id, opening });
      this.hud?.toast(`Ambush: ${state.pack.label}.`, 1800);
      return;
    }
    this.notify(`Ambush: ${state.pack.label}.`, 1800);
    this.startFight(state.pack, undefined, undefined, { ...opening, by: this.leader?.mageClass });
  }

  /** Packs within `tiles` of a point (this player's feet unless told otherwise), nearest first. */
  private packsWithin(tiles: number, from: { x: number; y: number } | undefined = this.walker): PackState[] {
    if (!from) return [];
    return this.packs
      .map((state) => ({ state, distance: Math.hypot(state.x - from.x, state.y - from.y) / TILE_PX }))
      .filter((entry) => entry.distance <= tiles)
      .sort((a, b) => a.distance - b.distance)
      .map((entry) => entry.state);
  }

  /** The nearest pack within `tiles` the leader has a clear line to; with `unseenOnly`, one that has not seen the leader. */
  private preyWithin(tiles: number, unseenOnly: boolean): PackState | null {
    const walker = this.walker;
    if (!walker || !this.packs.length) return null;
    return this.packsWithin(tiles)
      .find((state) => (!unseenOnly || !state.chasing) && this.clearLine(walker.x, walker.y - 1, state.x, state.y - 1)) ?? null;
  }

  /** Whether nothing solid stands between two points (their own cells aside). */
  private clearLine(ax: number, ay: number, bx: number, by: number): boolean {
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / (TILE_PX / 4));
    const cell = (x: number, y: number): string => `${Math.floor(x / TILE_PX)},${Math.floor(y / TILE_PX)}`;
    const ends = [cell(ax, ay), cell(bx, by)];
    for (let i = 1; i < steps; i++) {
      const x = ax + ((bx - ax) * i) / steps;
      const y = ay + ((by - ay) * i) / steps;
      if (ends.includes(cell(x, y))) continue;
      if (this.model.blocked(Math.floor(x / TILE_PX), Math.floor(y / TILE_PX))) return false;
    }
    return true;
  }

  /** While Mind holds: how far each pack near you sees, whether it sees you, and where it is headed. */
  private updateMindView(): void {
    const walker = this.walker;
    const now = this.time.now;
    if (!walker || now >= this.mindUntil) {
      if (this.mindUntil > 0) {
        this.mindUntil = 0;
        this.clearMindView();
        this.hud?.toast('Mind ended.', 1600);
        this.refreshWordBar();
      }
      return;
    }
    const view = (this.mindView ??= { gfx: this.add.graphics().setDepth(100015), labels: new Map() });
    const g = view.gfx;
    g.clear();
    const range = (FIELD_RULES.mind?.range ?? 0) * TILE_PX;
    const sightMul = this.sightMultiplier();
    const lift = TILE_PX * 0.4;
    for (const state of this.packs) {
      const label = view.labels.get(state);
      if (Math.hypot(state.x - walker.x, state.y - walker.y) > range) {
        label?.setVisible(false);
        continue;
      }
      const colour = state.chasing || state.sees ? 0xff5a4a : 0xffd070;
      const radius = state.pack.sight * sightMul * TILE_PX;
      g.fillStyle(colour, 0.08).fillCircle(state.x, state.y - lift, radius);
      g.lineStyle(2, colour, 0.75).strokeCircle(state.x, state.y - lift, radius);
      const tx = state.chasing ? walker.x : state.wanderX;
      const ty = state.chasing ? walker.y : state.wanderY;
      g.lineStyle(2, colour, 0.9).lineBetween(state.x, state.y - lift, tx, ty - lift);
      g.fillStyle(colour, 1).fillCircle(tx, ty - lift, 3);
      const text = `${state.pack.label}\n${state.chasing ? 'Hunting you' : state.sees ? 'Sees you' : 'Has not seen you'}`;
      const tag = label ?? this.add.text(0, 0, '', {
        fontFamily: 'Georgia, serif',
        fontSize: '13px',
        color: '#ffe6a0',
        stroke: '#1a0e08',
        strokeThickness: 3,
        align: 'center',
      }).setOrigin(0.5, 1).setDepth(100016);
      if (!label) view.labels.set(state, tag);
      if (tag.text !== text) tag.setText(text);
      tag.setPosition(Math.round(state.x), Math.round(state.y - state.lift - TILE_PX * 0.35)).setVisible(true);
    }
    if (now - this.barAt > 500) this.refreshWordBar();
  }

  private clearMindView(): void {
    if (!this.mindView) return;
    this.mindView.gfx.destroy();
    for (const label of this.mindView.labels.values()) label.destroy();
    this.mindView = undefined;
  }

  private ring(x: number, y: number, tiles: number, color: number): void {
    const g = this.add.graphics().setDepth(100005).setPosition(x, y - TILE_PX * 0.4);
    g.lineStyle(3, color, 0.9).strokeCircle(0, 0, Math.max(TILE_PX * 0.5, tiles * TILE_PX));
    g.setScale(0.25);
    this.tweens.add({ targets: g, scale: 1, alpha: 0, duration: 560, ease: 'Cubic.Out', onComplete: () => g.destroy() });
  }

  // ---------------------------------------------------------------------------
  //  THE WORLD ON FOOT
  // ---------------------------------------------------------------------------

  /** Keep the run's world tile under the party's feet; every new tile may draw an ambush. */
  private syncWorldTile(): void {
    if (!this.walker) return;
    const cell = this.walker.cell;
    const tile = cellWorldTile(cell);
    const key = `${tile.x},${tile.y}`;
    if (key === this.worldTile) return;
    const stepped = this.worldTile !== '';
    this.worldTile = key;
    this.run.pos = tile;
    if (!stepped || this.leader?.alive === false) return;
    this.rollAmbushAt(tile, cell, { sneaking: this.sneaking, veiled: this.time.now < this.veilUntil });
  }

  /** A traveller stepped onto a new world tile: something may lie in wait (one roll per tile and hour, party-wide). */
  private rollAmbushAt(tile: Cell, near: Cell, cover: { sneaking: boolean; veiled: boolean }): void {
    if (this.guest || this.leaving || this.busy || this.graceMs > 0) return;
    if (this.ambushCooldown > 0) {
      this.ambushCooldown -= 1;
      return;
    }
    const pack = rollAmbush(this.run, tile, cover, WALK_SPEED);
    if (!pack || this.rolledAmbushes.has(pack.id)) return;
    this.rolledAmbushes.add(pack.id);
    this.spawnAmbush(pack, near);
  }

  /** Set an ambush down at the edge of sight, somewhere it can run the party down from. */
  private spawnAmbush(pack: WildPack, from: Cell): void {
    const placed = this.packNear(pack, from);
    if (!placed) return;
    this.ambushCooldown = AMBUSH_COOLDOWN;
    playSound('ui.deny');
    this.notify(`Ambush: ${pack.label}.`, 2600);
  }

  /** Put `pack` down some way off `from`, on open ground inside the area, and tell the guests. Null when no spot fits. */
  private packNear(pack: WildPack, from: Cell, near = AMBUSH_NEAR, far = AMBUSH_FAR): WildPack | null {
    const land = openWorldMainland();
    for (let tries = 0; tries < 32; tries++) {
      const angle = Math.random() * Math.PI * 2;
      const range = near + Math.random() * (far - near);
      const x = Math.round(from.x + Math.cos(angle) * range);
      const y = Math.round(from.y + Math.sin(angle) * range);
      if (x < 0 || y < 0 || x >= this.model.w || y >= this.model.h) continue;
      if (!land[y * this.model.w + x] || this.model.exitAt(x, y)) continue;
      if (!this.insideArea((x + 0.5) * TILE_PX, (y + 0.8) * TILE_PX)) continue;
      const placed = { ...pack, x, y };
      this.addPack(placed);
      if (this.session?.isHost) this.session.send({ k: 'x-pack+', pack: placed });
      return placed;
    }
    return null;
  }

  private inStorm(): boolean {
    return isSandstorm(this.run) && inDesert(this.world, this.run.pos.x, this.run.pos.y);
  }

  /** Night shade and the sandstorm's wall of sand, pinned to the camera. */
  private setupWorldOverlays(): void {
    this.nightShade = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x0a1438, 0.4)
      .setOrigin(0).setScrollFactor(0).setDepth(100020).setVisible(false);
    const key = 'fx-storm-vignette';
    if (!this.textures.exists(key)) {
      const size = 512;
      const tex = this.textures.createCanvas(key, size, size);
      const ctx = tex?.getContext();
      if (tex && ctx) {
        const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        gradient.addColorStop(0, 'rgba(207,166,108,0)');
        gradient.addColorStop(0.1, 'rgba(207,166,108,0.05)');
        gradient.addColorStop(0.3, 'rgba(207,166,108,0.93)');
        gradient.addColorStop(1, 'rgba(196,152,96,0.97)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);
        tex.refresh();
      }
    }
    const streakKey = 'fx-storm-streaks';
    if (!this.textures.exists(streakKey)) {
      const px = new PixelBuffer(64, 32);
      for (let i = 0; i < 26; i++) {
        const x = (i * 23) % 64;
        const y = (i * 11) % 32;
        const len = 4 + (i % 7) * 2;
        for (let d = 0; d < len; d++) px.set((x + d) % 64, y, i % 3 === 0 ? 0xfff1d0 : 0xe8cd98);
      }
      bufferTexture(this, streakKey, px);
    }
    const vignette = this.add.image(0, 0, key).setScale(3.2).setDepth(100025).setVisible(false);
    const haze = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0xcfa66c, 0.18)
      .setOrigin(0).setScrollFactor(0).setDepth(100024).setVisible(false);
    const streaks = this.add.tileSprite(0, 0, GAME_WIDTH, GAME_HEIGHT, streakKey)
      .setOrigin(0).setScrollFactor(0).setDepth(100026).setTileScale(TILE_SCALE, TILE_SCALE).setAlpha(0.55).setVisible(false);
    this.storm = { vignette, haze, streaks };
  }

  /** The weather on foot: night falls and the desert storms come as the clock turns. Walking itself takes no time. */
  private updateWorld(delta: number): void {
    const walker = this.walker;
    if (!walker) return;
    if (!this.guest) this.syncWorldTile();
    this.applyPace();
    this.nightShade?.setVisible(isNight(this.run.hour));
    const storm = this.storm;
    if (storm) {
      const raging = this.inStorm();
      if (storm.vignette.visible !== raging) {
        storm.vignette.setVisible(raging);
        storm.haze.setVisible(raging);
        storm.streaks.setVisible(raging);
        for (const pack of this.packs) pack.marker.setAlpha(raging ? 0 : 1);
      }
      if (raging) {
        storm.vignette.setPosition(walker.x, walker.y - TILE_PX * 0.5);
        storm.streaks.tilePositionX -= delta * 0.35;
        storm.streaks.tilePositionY += delta * 0.04;
      }
    }
    if (this.time.now - this.hudAt > 500) {
      this.hudAt = this.time.now;
      this.refreshHud();
    }
  }

  /** Midnight on the road: yesterday's packs move on and today's take their places. */
  private newDay(): void {
    this.packDay = this.run.day;
    // The HUD announces the day itself as soon as it sees the clock turn.
    this.refreshHud();
    const fresh = resolveLocale(this.run, this.place.def.id);
    if (!fresh) return;
    this.clearMindView();
    for (const state of this.packs) {
      state.sprite.destroy();
      state.marker.destroy();
    }
    this.packs = [];
    this.place = { ...this.place, packs: fresh.packs };
    this.spawnPacks();
  }

  // ---------------------------------------------------------------------------
  //  THE AREA ON FOOT
  // ---------------------------------------------------------------------------

  /** On foot: whether feet at x, y (px) stay inside the area. Everywhere else, anywhere. */
  private insideArea(x: number, y: number): boolean {
    const rect = this.areaRect;
    return !rect || (x - 14 >= rect.x0 && x + 14 <= rect.x1 && y - 11 >= rect.y0 && y <= rect.y1);
  }

  /** On foot: whether the cell at x, y lies inside the area. */
  private cellInArea(x: number, y: number): boolean {
    const rect = this.areaRect;
    return !rect || (x * TILE_PX >= rect.x0 && (x + 1) * TILE_PX <= rect.x1 && y * TILE_PX >= rect.y0 && (y + 1) * TILE_PX <= rect.y1);
  }

  /** Standing by the edge of the area, where the way back to the map is. */
  private atAreaEdge(): boolean {
    const rect = this.areaRect;
    const walker = this.walker;
    if (!rect || !walker) return false;
    const reach = EDGE_TILES * TILE_PX;
    return walker.x - rect.x0 < reach || rect.x1 - walker.x < reach || walker.y - rect.y0 < reach || rect.y1 - walker.y < reach;
  }

  /** The country past the edge of the area lies under a veil, ringed in brass. */
  private drawAreaVeil(): void {
    const rect = this.areaRect;
    if (!rect) return;
    const g = this.add.graphics().setDepth(100012);
    const pad = AREA_MARGIN * 3;
    const w = rect.x1 - rect.x0;
    const h = rect.y1 - rect.y0;
    g.fillStyle(0x05060a, 0.64);
    g.fillRect(rect.x0 - pad, rect.y0 - pad, w + pad * 2, pad);
    g.fillRect(rect.x0 - pad, rect.y1, w + pad * 2, pad);
    g.fillRect(rect.x0 - pad, rect.y0, pad, h);
    g.fillRect(rect.x1, rect.y0, pad, h);
    g.lineStyle(6, 0x120d09, 0.75).strokeRect(rect.x0 - 3, rect.y0 - 3, w + 6, h + 6);
    g.lineStyle(2, 0xa98b50, 0.95).strokeRect(rect.x0, rect.y0, w, h);
    // Brass corner brackets, and a post at every world tile along the edge.
    const arm = TILE_PX * 2;
    g.lineStyle(4, 0xd2bd7f, 1);
    for (const [cx, cy, sx, sy] of [[rect.x0, rect.y0, 1, 1], [rect.x1, rect.y0, -1, 1], [rect.x0, rect.y1, 1, -1], [rect.x1, rect.y1, -1, -1]]) {
      g.lineBetween(cx, cy, cx + sx * arm, cy);
      g.lineBetween(cx, cy, cx, cy + sy * arm);
    }
    const span = WORLD_SCALE * TILE_PX;
    g.fillStyle(0xd2bd7f, 0.85);
    for (let x = rect.x0 + span; x < rect.x1; x += span) {
      g.fillRect(x - 2, rect.y0 - 5, 4, 10);
      g.fillRect(x - 2, rect.y1 - 5, 4, 10);
    }
    for (let y = rect.y0 + span; y < rect.y1; y += span) {
      g.fillRect(rect.x0 - 5, y - 2, 10, 4);
      g.fillRect(rect.x1 - 5, y - 2, 10, 4);
    }
    this.areaVeil = g;
  }

  /** "9 tiles north-east". */
  private bearing(from: Cell, to: Cell): string {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const tiles = Math.max(1, Math.round(Math.hypot(dx, dy)));
    const compass = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
    return `${tiles} tiles ${compass[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8]}`;
  }

  /** Tell one player something: on this screen, or on the guest's in `seat`. */
  private noteFor(seat: number | null, text: string): void {
    const session = this.session;
    if (seat == null || !session || seat === session.localSeat) this.hud?.toast(text, 4200);
    else session.send({ k: 'x-note', to: seat, text });
  }

  // ---------------------------------------------------------------------------
  //  SEARCHING
  // ---------------------------------------------------------------------------

  /** G on foot: search for something in particular round where you stand. */
  private async openSearch(): Promise<void> {
    const hud = this.hud;
    const walker = this.walker;
    const me = this.leader;
    if (!hud || !walker || !me || this.busy || this.leaving || !this.place.world) return;
    if (!me.alive) {
      playSound('ui.deny');
      hud.toast('The fallen cannot search. Only a night at an inn gets them up.', 2400);
      return;
    }
    walker.stop();
    const cell = walker.cell;
    const tile = cellWorldTile(cell);
    const site = searchSite(this.run, tile);
    const made: { resolution: SearchResolution | null } = { resolution: null };
    const done = await hud.search({
      place: describeTile(this.world, tile.x, tile.y),
      searcher: me.name,
      hours: SEARCH_HOURS,
      pickedOver: pickedOver(this.run, tile),
      depth: site.depth,
      night: isNight(this.run.hour),
      shelves: searchShelves(this.run, tile, me),
    }, (choice) => {
      if (this.guest) return this.requestSearch(choice.target.category, choice.target.id);
      const resolution = this.searchFor(tile, choice.target, me.mageClass, choice.bonus);
      made.resolution = resolution;
      return Promise.resolve({ roll: resolution.roll, message: resolution.message });
    });
    const resolution = made.resolution;
    if (!done || !resolution || this.guest || this.leaving) return;
    this.afterSearch(resolution, tile, cell, null);
  }

  /** Host: search `tile` for `member`: roll, hand out what was found, and spend the searcher's hour. */
  private searchFor(tile: Cell, target: SearchTarget, member: MageClass, bonus: number): SearchResolution {
    this.run.steps += 1;
    const resolution = resolveSearch(this.run, tile, target, member, bonus, stepDice(this.run, this.run.steps * 7 + 3));
    if (this.spendTime([member], SEARCH_HOURS)) this.newDay();
    this.readLeader();
    this.changed();
    return resolution;
  }

  /** Host: what a search set going: a tracked pack not far off, or something happening nearby. */
  private afterSearch(resolution: SearchResolution, tile: Cell, cell: Cell, seat: number | null): void {
    const pack = resolution.pack;
    if (pack) {
      this.run.steps += 1;
      const placed = this.packNear({
        id: `once:track:${this.run.steps}`,
        x: 0,
        y: 0,
        sight: 6,
        depth: pack.depth,
        spawns: pack.spawns,
        label: `${pack.label}, tracked down`,
        tint: spawnTint(pack.spawns),
        zone: pack.zone,
        pace: packPace(pack.spawns),
      }, cell, 8, 11);
      this.noteFor(seat, placed
        ? `The trail ends ${this.bearing(cell, placed)}: ${pack.label}. They have not noticed you yet.`
        : 'The trail runs out of the area.');
    }
    if (resolution.event) void this.runSearchEvent(tile, cell, seat);
    else if (resolution.levels && seat == null) void this.settleLevels();
  }

  /** Guest: the host makes the search; this waits for how it went. */
  private requestSearch(category: string, id: string): Promise<SearchRollResult | null> {
    const session = this.session;
    if (!session) return Promise.resolve(null);
    const request = ++this.askSeq;
    return new Promise((resolve) => {
      let off = (): void => undefined;
      const timer = setTimeout(() => {
        off();
        resolve(null);
      }, REPLY_MS);
      off = session.on('x-search', (message) => {
        if (message.to !== session.localSeat || message.id !== request) return;
        clearTimeout(timer);
        off();
        resolve(readSearchReply(message));
      });
      session.send({ k: 'x-act', what: 'search', id: request, category, target: id });
    });
  }

  /** Something going on round a searcher: an event, put to whoever searched. */
  private async runSearchEvent(tile: Cell, cell: Cell, seat: number | null): Promise<void> {
    const hud = this.hud;
    if (!hud) return;
    const { zone, depth } = searchSite(this.run, tile);
    const dice = stepDice(this.run, this.run.steps * 7 + 6);
    const event = pickEvent(zone, dice, isNight(this.run.hour));
    const ctx = { run: this.run, zone, depth, dice };
    const options = event.choices.map((choice, index) => ({
      id: String(index),
      label: choice.label,
      detail: choice.detail,
      enabled: !choice.available || choice.available(ctx),
    }));
    const remote = seat != null && !!this.session && seat !== this.session.localSeat;
    const index = remote ? await this.askSeat(seat, event.title, event.text, options) : Number(await hud.choose(event.title, event.text, options));
    if (this.leaving || index < 0) return;
    const chosen = event.choices[index];
    const picked = chosen && (!chosen.available || chosen.available(ctx)) ? chosen : event.choices[event.choices.length - 1];
    const result = picked.resolve(ctx);
    this.noteFor(seat, result.message);
    this.readLeader();
    this.changed();
    if (result.fight) {
      const fight = result.fight;
      const spawns = fight.spawns ?? rollEncounter(zone, fight.encounter, fight.depth, dice);
      this.startFight({
        id: `once:event:${this.run.steps}`, x: cell.x, y: cell.y, sight: 0, depth: fight.depth,
        spawns, label: fight.label ?? 'A fight.', tint: 0xffffff, zone,
      });
      return;
    }
    if (!remote) await this.settleLevels();
  }

  /** Host: put a choice to the player in `seat` and wait for it; no answer in a minute takes the last option. */
  private askSeat(seat: number, title: string, text: string, options: { id: string; label: string; detail: string; enabled?: boolean }[]): Promise<number> {
    const session = this.session;
    if (!session) return Promise.resolve(options.length - 1);
    const id = ++this.askSeq;
    return new Promise((resolve) => {
      const settle = (choice: number): void => {
        clearTimeout(timer);
        this.asks.delete(id);
        resolve(choice);
      };
      const timer = setTimeout(() => settle(options.length - 1), 60_000);
      this.asks.set(id, { seat, settle });
      session.send({ k: 'x-ask', to: seat, id, title, text, options });
    });
  }

  /** Guest: choices the host put to this player, one at a time, once nothing else is on screen. */
  private async answerAsks(): Promise<void> {
    if (this.answering) return;
    this.answering = true;
    while (this.askQueue.length && !this.leaving) {
      const hud = this.hud;
      if (!hud || hud.modalOpen) {
        await new Promise<void>((resolve) => this.time.delayedCall(250, () => resolve()));
        continue;
      }
      const ask = this.askQueue.shift()!;
      const raw = Array.isArray(ask.options) ? ask.options.slice(0, 8) : [];
      const options = raw.map((entry, index) => {
        const option = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
        return {
          id: String(index),
          label: typeof option.label === 'string' ? option.label.slice(0, 80) : 'Walk on',
          detail: typeof option.detail === 'string' ? option.detail.slice(0, 200) : '',
          enabled: option.enabled !== false,
        };
      });
      if (!options.length) continue;
      const title = typeof ask.title === 'string' ? ask.title.slice(0, 80) : 'Something happens';
      const text = typeof ask.text === 'string' ? ask.text.slice(0, 400) : '';
      const choice = await hud.choose(title, text, options);
      this.session?.send({ k: 'x-act', what: 'answer', id: ask.id, choice: Number(choice) });
    }
    this.answering = false;
  }

  // ---------------------------------------------------------------------------
  //  RESTING
  // ---------------------------------------------------------------------------

  /** Where a rest here is made: behind walls it is safe, anywhere else it is out in the country. */
  private restSite(cell: Cell): RestSite {
    if (this.place.world) return { safe: false, tile: cellWorldTile(cell) };
    return this.place.kind === 'town' ? { safe: true } : { safe: false, tile: this.run.pos };
  }

  /** The pause menu's line for a short rest here. */
  private restDetail(): string {
    const risk = shortRestRisk(this.run, this.restSite(this.walker?.cell ?? this.place.def.spawn));
    const who = this.place.world ? 'You rest' : 'The party rests';
    return `${who} ${SHORT_REST_HOURS.min}-${SHORT_REST_HOURS.max} h: a quarter of HP, mana, sanity and charges back. ${risk > 0 ? `${Math.round(risk * 100)}% chance of an ambush here.` : 'Safe here.'}`;
  }

  /** Z: a short rest. Alone it happens at once; online this traveller sits down and the others are asked to join. */
  private async shortRest(): Promise<void> {
    const hud = this.hud;
    const walker = this.walker;
    if (!hud || !walker || this.busy || this.leaving) return;
    const onFoot = !!this.place.world;
    const me = this.leader;
    const session = this.session;
    const mine = session?.council.camp?.by === session?.localSeat;
    if (onFoot && me?.alive === false && !mine) {
      playSound('ui.deny');
      hud.toast('The fallen cannot rest. Only a night at an inn gets them up.', 2400);
      return;
    }
    walker.stop();
    if (session) {
      this.callCamp(session, walker.cell);
      return;
    }
    this.restAt(onFoot && me ? [me.mageClass] : null, null, walker.cell);
  }

  /**
   * The inn's free short rest, from its counter. Alone it happens at once and the
   * counter hears how it went; online the counter closes and this traveller sits
   * down for the others to join, as with any rest.
   */
  private innShortRest(): string | null {
    const walker = this.walker;
    if (!walker || this.leaving) return null;
    const session = this.session;
    if (session) {
      this.hud?.closeWindow();
      this.callCamp(session, walker.cell);
      return null;
    }
    let said: string | null = null;
    this.restAt(null, null, walker.cell, undefined, (text) => { said = text; });
    return said;
  }

  /** Online Z: sit down and call the others, get back up, or hear that someone else already sat down. */
  private callCamp(session: AdventureSession, cell: Cell): void {
    const camp = session.council.camp;
    const me = session.localSeat;
    if (!camp) {
      playSound('travel.rest');
      session.say({ op: 'camp', place: this.place.def.id, at: { x: cell.x, y: cell.y } });
      return;
    }
    if (camp.by === me && !camp.resting) {
      playSound('ui.back');
      session.say({ op: 'camp-cancel' });
      return;
    }
    playSound('ui.deny');
    this.hud?.toast(camp.resting
      ? 'A rest is already under way.'
      : `${session.nameOf(camp.by)} is already resting: walk over and press E to join.`, 2600);
  }

  /** Online: this traveller is sitting down, waiting for the others or resting. */
  private sitting(): boolean {
    const session = this.session;
    const camp = session?.council.camp;
    if (!session || !camp || camp.place !== this.place.def.id) return false;
    const me = session.localSeat;
    if (camp.resting) return camp.resting.includes(me);
    return camp.by === me || camp.answers[me] === 'join';
  }

  private sitPrompt(): string {
    const session = this.session;
    const camp = session?.council.camp;
    if (!session || !camp) return '';
    if (camp.resting) {
      const area = this.run.area;
      const others = this.othersThan(session, camp.resting);
      const ahead = area && others.length ? Math.max(0, camp.until - Math.max(...others.map((member) => memberHours(area, member)))) : 0;
      return ahead > 0 ? `Resting. You get up once the others have spent another ${gapLabel(ahead)}.` : 'Getting up...';
    }
    const waiting = camp.answers.flatMap((answer, seat) => (answer ? [] : [session.nameOf(seat)]));
    const wait = waiting.length ? `Waiting for ${waiting.join(', ')}...` : 'Settling in...';
    return camp.by === session.localSeat ? `Resting here. ${wait}   [Z] Get back up` : `Resting with ${session.nameOf(camp.by)}. ${wait}   [X] Get up`;
  }

  /** The party members not sitting in `seats`. */
  private othersThan(session: AdventureSession, seats: readonly number[]): MageClass[] {
    return session.roster.flatMap((member, seat) => (member && !seats.includes(seat) ? [member] : []));
  }

  /** The name of whoever sat down within reach, when this traveller has not joined them yet. */
  private campToJoin(): string | null {
    const session = this.session;
    const camp = session?.council.camp;
    if (!session || !camp || camp.resting || camp.place !== this.place.def.id) return null;
    const me = session.localSeat;
    if (camp.by === me || camp.answers[me] === 'join' || this.leader?.alive === false) return null;
    return this.distanceTo(camp.at.x, camp.at.y) <= CAMP_REACH_TILES ? session.nameOf(camp.by) : null;
  }

  /** X: keep going instead of resting (or get up again). True when it was said. */
  private refuseCamp(): boolean {
    const session = this.session;
    const camp = session?.council.camp;
    if (!session || !camp || camp.resting || camp.by === session.localSeat || camp.answers[session.localSeat] === 'refuse') return false;
    playSound('ui.back');
    session.say({ op: 'camp-answer', answer: 'refuse' });
    return true;
  }

  /**
   * Host: everyone has answered. The ones who sat down rest; on foot they stay
   * sitting until someone who kept going has spent as long as the rest took.
   */
  private campRest(session: AdventureSession, camp: CampCall, seats: number[]): void {
    const members = seats.flatMap((seat) => session.roster[seat] ?? []);
    const rested = this.restAt(members, null, camp.at, seats.map((seat) => session.nameOf(seat)));
    if (!rested || session.council.camp !== camp) {
      if (session.council.camp === camp) {
        session.council.camp = null;
        session.publishCouncil();
      }
      return;
    }
    camp.resting = seats;
    camp.until = rested.until;
    session.publishCouncil();
    this.checkRestOver(session);
  }

  /** Host: the rest is over once one of those who kept going has caught up with it; the resters get up. */
  private checkRestOver(session: AdventureSession): void {
    const camp = session.council.camp;
    if (!camp?.resting) return;
    const area = this.place.world ? this.run.area : null;
    if (area && !restOver(area, this.othersThan(session, camp.resting), camp.until)) return;
    session.council.camp = null;
    session.publishCouncil();
    if (camp.resting.length < session.size) this.notify(`${camp.resting.map((seat) => session.nameOf(seat)).join(' and ')} get back up.`, 2600);
  }

  /** Host: someone's time on foot moved on; a rest may be over, and the party may now be able to move on. */
  private afterAreaTime(): void {
    const session = this.session;
    if (!session?.isHost) return;
    this.time.delayedCall(0, () => {
      if (this.leaving || this.session !== session) return;
      this.checkRestOver(session);
      this.settleCouncil(session);
    });
  }

  /** T: stand about. Behind the others, catch up with them; in front, let half an hour go by. */
  private waitAbout(): void {
    const walker = this.walker;
    const member = this.leader?.mageClass;
    if (!walker || !member || !this.place.world || !this.run.area) return;
    walker.stop();
    playSound('ui.click');
    if (this.guest) {
      this.session?.send({ k: 'x-act', what: 'wait' });
      return;
    }
    this.waitFor(member, null);
  }

  /** Host: `member` waits; `seat` is the guest who did, if one did. */
  private waitFor(member: MageClass, seat: number | null): void {
    const waited = waitInArea(this.run, member);
    if (waited.hours <= 0) return;
    if (waited.days) this.newDay();
    this.changed();
    this.afterAreaTime();
    this.noteFor(seat, `You wait ${gapLabel(waited.hours)}.`);
  }

  /** Host: `members` (null: everyone standing) rest at `cell`; `seat` is the guest who asked, if one did; `names` rested together; `say` takes the closing line instead of a toast. Returns the hours rested and, on foot, the area time the resters get up at; null when the rest was cut short. */
  private restAt(members: MageClass[] | null, seat: number | null, cell: Cell, names?: string[], say?: (text: string) => void): { hours: number; until: number } | null {
    this.run.steps += 1;
    const outcome: ShortRestOutcome = takeShortRest(this.run, members, this.restSite(cell), stepDice(this.run, this.run.steps * 7 + 2));
    // On foot each traveller keeps their own hours; anywhere else the day moves on for everyone.
    const onFoot = !!members && !!this.place.world && !!this.run.area;
    const together = onFoot && names ? restTogether(this.run, members!, outcome.hours) : null;
    const days = together ? together.days : onFoot ? this.spendTime(members!, outcome.hours) : advanceHours(this.run, outcome.hours);
    if (days) this.newDay();
    if (seat == null) {
      playSound('travel.rest');
      this.ring((cell.x + 0.5) * TILE_PX, (cell.y + 0.8) * TILE_PX, 1.1, 0xffa04a);
    }
    const ambush = outcome.ambush;
    if (ambush) {
      const who = seat != null ? `${this.session?.nameOf(seat) ?? 'A traveller'}'s camp` : 'The camp';
      this.notify(`${who}: ${outcome.message}`, 2600);
      this.startFight({
        id: `once:rest:${this.run.steps}`, x: cell.x, y: cell.y, sight: 0, depth: ambush.depth,
        spawns: ambush.spawns, label: outcome.message, tint: spawnTint(ambush.spawns), zone: ambush.zone,
      }, undefined, undefined, undefined, ambush.kind);
      return null;
    }
    this.readLeader();
    this.changed();
    // Woken by the bloodmoon: it rises on the next free frame.
    if (outcome.bloodmoon) {
      if (say) say(outcome.message);
      else if (names) this.notify(outcome.message, 3200);
      else this.noteFor(seat, outcome.message);
      return null;
    }
    if (seat == null) playSound('spell.heal');
    if (say) say(`${spanLabel(outcome.hours)} of rest. ${outcome.message}`);
    else if (names) this.notify(`${names.join(' and ')} rest${names.length === 1 ? 's' : ''} ${spanLabel(outcome.hours)}. ${outcome.message}`, 4200);
    else this.noteFor(seat, `${spanLabel(outcome.hours)} of rest. ${outcome.message}`);
    return { hours: outcome.hours, until: together?.until ?? 0 };
  }

  // ---------------------------------------------------------------------------
  //  ONLINE: DECIDING TOGETHER
  // ---------------------------------------------------------------------------

  /** [E] at a way out, online: how many are ready to move on. */
  private leavePrompt(label: string): string {
    const session = this.session;
    if (!session) return `[E] ${label}`;
    const call = session.council.leave;
    const wants = call?.place === this.place.def.id ? call.wants : null;
    const ready = wants ? wants.filter((wish) => !!wish).length : 0;
    if (wants?.[session.localSeat]) return `[E] Stay after all   (${ready}/${session.size} want to move on)`;
    return `[E] ${label}   (${ready}/${session.size}: everyone has to want to go)`;
  }

  /** Online: say this traveller wants to move on by `exit` (null: back to the map), or take it back. */
  private wantToLeave(exit: { x: number; y: number } | null): void {
    const session = this.session;
    if (!session) return;
    const call = session.council.leave;
    if (call?.place === this.place.def.id && call.wants[session.localSeat]) {
      playSound('ui.back');
      session.say({ op: 'stay' });
      return;
    }
    playSound('ui.confirm');
    session.say({ op: 'leave', place: this.place.def.id, exit });
  }

  private wantToLeaveOnFoot(): void {
    if (this.session) this.wantToLeave(null);
    else this.leaveOnFoot();
  }

  /** The council changed: show it, sit down or get up, and (host) act on whatever is settled. */
  private onCouncil(): void {
    const session = this.session;
    if (!session || !this.walker) return;
    const me = session.localSeat;
    const camp = session.council.camp?.place === this.place.def.id ? session.council.camp : null;
    // The fallen cannot rest; they keep going.
    if (camp && !camp.resting && camp.by !== me && !camp.answers[me] && this.leader?.alive === false) {
      session.say({ op: 'camp-answer', answer: 'refuse' });
    }
    if (camp?.resting) {
      const key = `${camp.by}:${camp.at.x},${camp.at.y}:${camp.resting.join(',')}`;
      // Everyone rested: skip ahead in a blink.
      if (this.campSeen !== key && camp.resting.length === session.size) this.cameras.main.flash(900, 0, 0, 0);
      this.campSeen = key;
    }
    this.drawCamp(session, camp);
    this.hud?.setCouncil(this.councilLines(session));
    this.hud?.refreshWindow();
    if (session.isHost) this.settleCouncil(session);
  }

  /** A small fire where someone sat down, with whose rest it is. */
  private drawCamp(session: AdventureSession, camp: CampCall | null): void {
    const key = camp ? `${camp.by}:${camp.at.x},${camp.at.y}` : '';
    if ((this.campMark?.key ?? '') === key) return;
    if (this.campMark) {
      this.tweens.killTweensOf(this.campMark.fire);
      this.campMark.fire.destroy();
      this.campMark.label.destroy();
      this.campMark = undefined;
    }
    if (!camp) return;
    const x = (camp.at.x + 0.5) * TILE_PX;
    const y = (camp.at.y + 0.8) * TILE_PX;
    const fire = this.add.image(x, y - 4, GLOW.soft).setTint(0xff9a3c).setBlendMode(Phaser.BlendModes.ADD).setScale(1.5).setAlpha(0.75).setDepth(y + 1);
    if (!isReducedMotion()) this.tweens.add({ targets: fire, alpha: 0.45, scale: 1.3, duration: 220, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    const label = this.add.text(x, y - TILE_PX * 1.9, `${session.nameOf(camp.by)}'s rest`, {
      fontFamily: 'Georgia, serif',
      fontSize: '13px',
      color: '#ffcf8a',
      stroke: '#1a0e08',
      strokeThickness: 3,
    }).setOrigin(0.5, 1).setDepth(100000);
    this.campMark = { key, fire, label };
  }

  /** The HUD's note of what the party is deciding here. */
  private councilLines(session: AdventureSession): string[] {
    const council = session.council;
    const me = session.localSeat;
    const place = this.place.def.id;
    const lines: string[] = [];
    const names = (seats: number[]): string => seats.map((seat) => (seat === me ? 'you' : session.nameOf(seat))).join(', ');
    const seatsWhere = <T>(list: readonly T[], test: (entry: T) => boolean): number[] => list.flatMap((entry, seat) => (test(entry) ? [seat] : []));
    const camp = council.camp?.place === place ? council.camp : null;
    if (camp?.resting) {
      const area = this.run.area;
      const others = this.othersThan(session, camp.resting);
      const left = area && others.length ? camp.until - Math.max(...others.map((member) => memberHours(area, member))) : 0;
      lines.push(`RESTING  ${names(camp.resting)}${left > 0 ? `, up in ${gapLabel(left)} of the others' time` : ''}`);
    } else if (camp) {
      const waiting = seatsWhere(camp.answers, (answer) => !answer);
      lines.push(`SHORT REST  ${camp.by === me ? 'You sat' : `${session.nameOf(camp.by)} sat`} down.`);
      if (camp.by !== me && !camp.answers[me]) lines.push('Walk over and press E to join, or X to keep going.');
      if (waiting.length) lines.push(`Waiting for ${names(waiting)}.`);
    }
    const leave = council.leave?.place === place ? council.leave : null;
    if (leave) {
      const ready = seatsWhere(leave.wants, (wish) => !!wish);
      const waiting = seatsWhere(leave.wants, (wish) => !wish);
      lines.push(`MOVING ON  ${names(ready)} (${ready.length}/${session.size})`);
      lines.push(leave.wants[me]
        ? `Waiting for ${names(waiting)}.`
        : this.place.world ? 'Walk to the edge and press E to go too.' : 'Walk to a way out and press E to go too.');
      const behind = this.laggards(session);
      if (behind.length) {
        lines.push(`First everyone must catch up: ${behind.map(({ seat, hours }) => `${seat === me ? 'you are' : `${session.nameOf(seat)} is`} ${gapLabel(hours)} behind`).join(', ')}. [T] waits.`);
      }
    }
    const inn = council.inn;
    if (inn) {
      const waiting = seatsWhere(inn.answers, (answer) => answer !== 'join');
      lines.push(`A NIGHT AT ${(shopById(inn.shop)?.name ?? 'the inn').toUpperCase()}  (${session.nameOf(inn.by)} asked)`);
      lines.push(inn.answers[me] === 'join' ? `Waiting for ${names(waiting)}.` : 'Talk to the keeper there to join for free, or turn it down.');
    }
    return lines;
  }

  /** Host: act on whatever the party has settled here. */
  private settleCouncil(session: AdventureSession): void {
    if (!this.ready || this.leaving || !this.walker) return;
    const council = session.council;
    const camp = council.camp?.place === this.place.def.id ? council.camp : null;
    const resting = camp ? campOutcome(council) : null;
    if (camp && resting) {
      this.campRest(session, camp, resting);
      return;
    }
    const inn = innOutcome(council);
    if (inn) {
      void this.innNight(session, inn);
      return;
    }
    const leave = leaveOutcome(council);
    if (!leave || leave.place !== this.place.def.id) return;
    // Nobody moves on while someone is still behind on their own time.
    if (this.laggards(session).length) return;
    council.leave = null;
    session.publishCouncil();
    if (!leave.exit) {
      this.leaveOnFoot();
      return;
    }
    const exit = this.model.exitAt(leave.exit.x, leave.exit.y);
    if (exit) void this.goThrough(exit);
  }

  /** Host: everyone joined the night. The one who asked pays for the rooms, and the whole party sleeps. */
  private async innNight(session: AdventureSession, shopId: string): Promise<void> {
    const inn = session.council.inn;
    if (!inn) return;
    const payer = session.nameOf(inn.by);
    session.council.inn = null;
    session.publishCouncil();
    const price = roomPrice(this.run, shopById(shopId)) ?? 0;
    const from = { day: this.run.day, hour: this.run.hour };
    const result = rest(this.run, shopId);
    if (!result.ok) {
      this.notify(result.message, 3200);
      return;
    }
    session.news(`${payer} paid ${moneyLabel(price)} for the rooms. Purse: ${moneyLabel(this.run.gold)}.`);
    const nap: RestNap = { from, to: { day: this.run.day, hour: this.run.hour }, bloodmoon: bloodmoonDue(this.run), message: result.message };
    session.send({ k: 'x-sleep', nap });
    this.hud?.closeWindow();
    this.walker?.stop();
    await this.hud?.sleep(nap, { black: () => this.changed() });
    if (this.run.day !== this.packDay) this.newDay();
    this.readLeader();
    this.changed();
  }

  /** The bloodmoon has risen: whatever the party was doing, its boss is upon it here. */
  private riseBloodmoon(): void {
    const fight = bloodmoonFight(this.run);
    const walker = this.walker;
    if (!fight || !walker || this.leaving || this.guest) return;
    this.leaving = true;
    walker.stop();
    if (this.holdId) this.endHold();
    this.hud?.setPrompt(null);
    const back = { id: this.place.def.id, x: walker.cell.x, y: walker.cell.y };
    this.run.locale = back;
    if (this.place.world) this.syncWorldTile();
    saveRun(this.run);
    void (async () => {
      await this.hud?.bloodmoonRise();
      startAdventureFight(this, {
        mode: 'exploration',
        loadouts: [[], []],
        exploration: bloodmoonCombat(this.run, fight, this.place.zone ?? 'capitol', back),
      } satisfies MatchConfig);
    })();
  }

  private startFight(
    pack: WildPack,
    then?: { locale: string; at?: Cell },
    fleeTo?: { locale: string; at?: Cell },
    opening?: ExplorationOpening,
    encounter: EncounterKind = 'monsters',
  ): void {
    // Online only the host starts fights; its guests follow.
    if (this.leaving || this.guest) return;
    this.leaving = true;
    const walker = this.walker!;
    const at = then?.at ?? walker.cell;
    const locale = then?.locale ?? this.place.def.id;
    const fleeAt = fleeTo?.at ?? walker.cell;
    const zone = pack.zone ?? this.place.zone;
    // Elites stay what they are; anything else may be a scene under way.
    const staged = zone && pack.spawns && !pack.elite
      ? stageScene(zone, encounter, pack.depth, pack.spawns, stepDice(this.run, sceneSalt(pack.id) + this.run.day * 24 + Math.floor(this.run.hour)), false)
      : null;
    this.run.locale = { id: locale, x: at.x, y: at.y };
    if (this.place.world) this.syncWorldTile();
    saveRun(this.run);
    playSound('ui.deny');
    this.cameras.main.shake(180, 0.004);
    this.cameras.main.fadeOut(320, 20, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      startAdventureFight(this, {
        mode: 'exploration',
        loadouts: [[], []],
        exploration: {
          run: this.run,
          encounter,
          depth: pack.depth,
          cameFrom: null,
          zone,
          spawns: staged ? undefined : pack.spawns,
          returnTo: { id: locale, x: at.x, y: at.y },
          fleeTo: fleeTo ? { id: fleeTo.locale, x: fleeAt.x, y: fleeAt.y } : undefined,
          tag: pack.id.startsWith('once:') ? undefined : pack.id,
          label: staged?.label ?? pack.label,
          opening,
          scene: staged?.fight,
        },
      } satisfies MatchConfig);
    });
  }

  /** A dungeon gate: say what lies inside, and go in only if the party means it. */
  private async enterDungeon(placeId: string): Promise<void> {
    const place = placeById(placeId);
    const hud = this.hud;
    if (!place?.dungeon || !hud || this.busy || this.leaving) return;
    const def = DUNGEONS[place.dungeon];
    this.busy = true;
    const choice = await hud.choose(def.name.toUpperCase(), def.warning, [
      { id: 'enter', label: 'Go in', detail: place.dungeon === 'mines' ? 'Into the tunnels.' : 'Depth 1.' },
      { id: 'stay', label: 'Not yet', detail: 'Stay outside.' },
    ], 'stay');
    this.busy = false;
    if (choice === 'enter') this.startDungeon(place);
  }

  /** Into the dungeon; the party comes back out just below its gate. */
  private startDungeon(place: Place): void {
    const dungeon = place.dungeon;
    if (this.leaving || !dungeon) return;
    this.leaving = true;
    const out = this.place.world ? openWorldCell(place) : this.walker?.cell ?? this.place.def.spawn;
    const back = { id: this.place.def.id, x: out.x, y: out.y };
    this.run.locale = back;
    this.run.pos = { x: place.x, y: place.y };
    if (!this.run.visited.includes(place.id)) this.run.visited.push(place.id);
    saveRun(this.run);
    playSound('ui.confirm');
    this.cameras.main.fadeOut(320, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      startAdventureFight(this, {
        mode: 'exploration',
        loadouts: [[], []],
        exploration: dungeonCombat(this.run, dungeon, back),
      } satisfies MatchConfig);
    });
  }

  // ---------------------------------------------------------------------------
  //  ONLINE: THE WHOLE PARTY ON FOOT
  // ---------------------------------------------------------------------------

  /** A guest of an online party: the host runs the world, this client shows it. */
  private get guest(): boolean {
    return !!this.session && !this.session.isHost;
  }

  /** Say something to the whole party: here, and online on every guest's screen. */
  private notify(text: string, ms: number): void {
    this.hud?.toast(text, ms);
    if (this.session?.isHost) this.session.send({ k: 'x-toast', text });
  }

  /** A soft shadow under a figure's feet, `size` tiles across, kept under it every frame. */
  private addShadow(sprite: Phaser.GameObjects.Sprite, size: number): void {
    const shadow = this.add.image(sprite.x, sprite.y, GLOW.soft).setTint(0x000000).setAlpha(0);
    shadow.setDisplaySize(TILE_PX * size, TILE_PX * size * 0.34);
    this.shadows.push({ sprite, shadow });
  }

  private updateShadows(): void {
    if (!this.shadows.length) return;
    this.shadows = this.shadows.filter(({ sprite, shadow }) => {
      if (!sprite.active) {
        shadow.destroy();
        return false;
      }
      shadow.setPosition(sprite.x, sprite.y - 2).setDepth(sprite.depth - 0.5).setVisible(sprite.visible).setAlpha(sprite.alpha * 0.42);
      return true;
    });
  }

  /** A puff of dust at this traveller's heels while running. */
  private kickDust(delta: number): void {
    const walker = this.walker;
    if (!walker?.isMoving || !this.particles) {
      this.dustMs = 0;
      return;
    }
    this.dustMs -= delta;
    if (this.dustMs > 0) return;
    this.dustMs = this.sneaking ? 520 : 260;
    this.particles.burst({ x: walker.x, y: walker.y - 2 }, {
      shape: 'smoke', color: 0xcfc3a2, count: 2, speed: 18, lifespan: 460, size: 9, alpha: 0.32,
      angle: { min: 200, max: 340 }, gravityY: -10, drag: 0.6, spread: 4, depth: walker.y - 1,
    });
  }

  /** A figure for every other traveller, at the door until they say where they stand. */
  private makeCompanions(session: AdventureSession, at: Cell): void {
    const x = (at.x + 0.5) * TILE_PX;
    const y = (at.y + 0.8) * TILE_PX;
    for (let seat = 0; seat < session.size; seat++) {
      if (seat === session.localSeat) continue;
      const sprite = this.add.sprite(x, y, MAGE_FIRST_FRAME).setOrigin(0.5, 0.95).setScale(TILE_SCALE).setDepth(y);
      sprite.play(MAGE_IDLE);
      this.addShadow(sprite, 0.7);
      const label = this.add.text(x, y - TILE_PX * 1.3, session.nameOf(seat), {
        fontFamily: 'Georgia, serif',
        fontSize: '13px',
        color: '#f4e6c4',
        stroke: '#1a0e08',
        strokeThickness: 3,
      }).setOrigin(0.5, 1).setDepth(100000);
      this.companions.set(seat, { seat, sprite, label, tx: x, ty: y, moving: false, sneaking: false, seen: 0, tile: '', cell: '' });
    }
  }

  /** Each companion in their class's colour, faded while sneaking and more so while fallen; on foot, how far ahead or behind they are. */
  private paintCompanions(): void {
    const session = this.session;
    if (!session) return;
    const area = this.place.world ? this.run.area : null;
    const mine = area && this.leader ? memberHours(area, this.leader.mageClass) : 0;
    for (const companion of this.companions.values()) {
      const member = session.roster[companion.seat];
      const down = !!member && this.fallen.has(member);
      companion.sprite.setAlpha(down ? 0.35 : companion.sneaking ? 0.7 : 1);
      if (member) companion.sprite.setTint(CLASS_TINT[member]);
      else companion.sprite.clearTint();
      const gap = area && member ? memberHours(area, member) - mine : 0;
      const time = Math.abs(gap) > 1e-6 ? `\n${gapLabel(gap)} ${gap > 0 ? 'ahead' : 'behind'}` : '';
      const name = `${session.nameOf(companion.seat)}${down ? ' (fallen)' : ''}${time}`;
      if (companion.label.text !== name) companion.label.setText(name);
    }
  }

  /** Everyone the packs can go after: this walker and the other standing travellers where they last were. */
  private standingTravellers(): Traveller[] {
    const walker = this.walker!;
    const now = this.time.now;
    const out: Traveller[] = [];
    if (this.leader?.alive !== false) out.push({ x: walker.x, y: walker.y, sneaking: this.sneaking, veiled: now < this.veilUntil });
    const session = this.session;
    if (!session) return out;
    for (const companion of this.companions.values()) {
      const member = session.roster[companion.seat];
      if (!member || this.fallen.has(member)) continue;
      out.push({ x: companion.tx, y: companion.ty, sneaking: companion.sneaking, veiled: now < (this.seatVeils.get(companion.seat) ?? 0) });
    }
    return out;
  }

  /** Online, every frame: the others move, and this client's news goes out ten times a second. */
  private updateLink(delta: number): void {
    const session = this.session;
    const walker = this.walker;
    if (!session || !walker) return;
    this.moveCompanions(delta);
    if (!session.isHost) this.movePacksToHost(delta);
    const now = this.time.now;
    if (this.leaving || now - this.linkAt < LINK_MS) return;
    this.linkAt = now;
    if (session.isHost) this.sendLive(session, walker);
    else this.sendPosition(session, walker);
  }

  /** The other travellers ease toward where they last said they stood. */
  private moveCompanions(delta: number): void {
    const ease = 1 - Math.exp(-delta / 80);
    for (const companion of this.companions.values()) {
      const { sprite } = companion;
      const dx = companion.tx - sprite.x;
      const dy = companion.ty - sprite.y;
      const jump = Math.hypot(dx, dy) > TILE_PX * 6;
      const x = jump ? companion.tx : sprite.x + dx * ease;
      const y = jump ? companion.ty : sprite.y + dy * ease;
      sprite.setPosition(x, y).setDepth(y);
      const anim = companion.moving ? MAGE_RUN : MAGE_IDLE;
      if (sprite.anims.currentAnim?.key !== anim) sprite.play(anim);
      companion.label.setPosition(Math.round(x), Math.round(y - TILE_PX * 1.3));
    }
  }

  /** Guest: each pack eases toward where the host last saw it. */
  private movePacksToHost(delta: number): void {
    const ease = 1 - Math.exp(-delta / 80);
    for (const state of this.packs) {
      if (state.tx == null || state.ty == null) continue;
      const dx = state.tx - state.x;
      const dy = state.ty - state.y;
      const far = Math.hypot(dx, dy);
      if (far > TILE_PX * 8) {
        state.x = state.tx;
        state.y = state.ty;
      } else {
        state.x += dx * ease;
        state.y += dy * ease;
      }
      if (Math.abs(dx) > 0.5) state.sprite.setFlipX(state.facesRight ? dx < 0 : dx > 0);
      const anim = far > 1.5 ? state.runAnim : state.idleAnim;
      if (state.sprite.anims.currentAnim?.key !== anim) state.sprite.play(anim);
      state.sprite.setPosition(Math.round(state.x), Math.round(state.y)).setDepth(state.y);
      state.marker.setPosition(Math.round(state.x), Math.round(state.y - state.lift)).setVisible(state.chasing);
    }
  }

  /** Host: the clock, where everyone stands, and the packs near anyone. */
  private sendLive(session: AdventureSession, walker: Walker): void {
    const round = Math.round;
    const avatars: number[][] = [
      [session.localSeat, round(walker.x), round(walker.y), walker.sprite.flipX ? 1 : 0, walker.isMoving ? 1 : 0, this.sneaking ? 1 : 0],
    ];
    for (const companion of this.companions.values()) {
      avatars.push([companion.seat, round(companion.tx), round(companion.ty), companion.sprite.flipX ? 1 : 0, companion.moving ? 1 : 0, companion.sneaking ? 1 : 0]);
    }
    const packs = this.packs
      .filter((state) => state.active)
      .map((state) => [state.pack.id, round(state.x), round(state.y), state.chasing ? 1 : 0, state.bound ? 1 : 0, state.asleep ? 1 : 0]);
    session.send({ k: 'x-live', hour: Math.round(this.run.hour * 1000) / 1000, day: this.run.day, avatars, packs });
  }

  /** Guest: where this traveller stands, whenever that changes (and every second regardless). */
  private sendPosition(session: AdventureSession, walker: Walker): void {
    const report = { x: Math.round(walker.x), y: Math.round(walker.y), flip: walker.sprite.flipX, moving: walker.isMoving, sneaking: this.sneaking };
    const key = `${report.x},${report.y},${report.flip},${report.moving},${report.sneaking}`;
    const now = this.time.now;
    if (key === this.sentPos && now - this.sentPosAt < 1000) return;
    this.sentPos = key;
    this.sentPosAt = now;
    session.send({ k: 'x-pos', ...report });
  }

  /** Guest: the host's view of the world. */
  private onLive(message: Record<string, unknown>): void {
    const now = this.time.now;
    if (finite(message.hour)) this.run.hour = Phaser.Math.Clamp(message.hour, 0, 24);
    const day = message.day;
    if (finite(day) && Number.isInteger(day) && day > this.run.day && day < this.run.day + 400) this.run.day = day;
    if (this.run.day !== this.packDay) this.newDay();
    let repaint = false;
    for (const entry of Array.isArray(message.avatars) ? message.avatars.slice(0, MAX_PARTY) : []) {
      if (!Array.isArray(entry)) continue;
      const [seat, x, y, flip, moving, sneaking] = entry as unknown[];
      const companion = finite(seat) ? this.companions.get(seat) : undefined;
      if (!companion || !finite(x) || !finite(y)) continue;
      companion.tx = x;
      companion.ty = y;
      companion.moving = moving === 1;
      companion.sprite.setFlipX(flip === 1);
      companion.seen = now;
      if ((sneaking === 1) !== companion.sneaking) {
        companion.sneaking = sneaking === 1;
        repaint = true;
      }
    }
    if (repaint) this.paintCompanions();
    const packs = Array.isArray(message.packs) ? message.packs.slice(0, 256) : [];
    if (!packs.length) return;
    const byId = new Map(this.packs.map((state) => [state.pack.id, state]));
    for (const entry of packs) {
      if (!Array.isArray(entry)) continue;
      const [id, x, y, chasing, bound, asleep] = entry as unknown[];
      const state = typeof id === 'string' ? byId.get(id) : undefined;
      if (!state || !finite(x) || !finite(y)) continue;
      state.tx = x;
      state.ty = y;
      state.chasing = chasing === 1;
      this.setBound(state, bound === 1);
      if (state.asleep && asleep !== 1) this.rouse(state);
    }
  }

  /** Guest: the host set an ambush down. */
  private onPackAdded(message: Record<string, unknown>): void {
    const pack = parseWildPack(message.pack);
    if (!pack || this.packs.some((state) => state.pack.id === pack.id)) return;
    this.addPack(pack);
  }

  /** Guest: a pack gave up the chase. */
  private onPackGone(message: Record<string, unknown>): void {
    const state = this.packs.find((entry) => entry.pack.id === message.id);
    if (state) this.removePack(state);
  }

  /** Guest: the fog lifts wherever anyone in the party has been. */
  private adoptSeen(): void {
    if (!this.fog) return;
    let fresh = false;
    if (this.place.world) {
      if (this.run.explored === this.exploredSeen) return;
      this.exploredSeen = this.run.explored;
      const mask = unpackExplored(this.run.explored);
      // What this guest saw since the host's last word stays seen.
      if (this.exploredMask && this.exploredMask.length === mask.length) {
        for (let i = 0; i < mask.length; i++) if (this.exploredMask[i]) mask[i] = 1;
      }
      this.exploredMask = mask;
      for (let y = 0; y < this.world.h; y++) for (let x = 0; x < this.world.w; x++) {
        const key = `${x},${y}`;
        if (!isExplored(mask, x, y) || this.fogSeen.has(key)) continue;
        this.fogSeen.add(key);
        fresh = true;
      }
    } else {
      const prefix = `${this.place.def.id}:`;
      for (const entry of this.run.wildsSeen) {
        const key = entry.startsWith(prefix) ? entry.slice(prefix.length) : null;
        if (!key || this.fogSeen.has(key)) continue;
        this.fogSeen.add(key);
        fresh = true;
      }
    }
    if (fresh) this.drawFog();
  }

  /** Host: a guest says where they stand. */
  private onCompanionMoved(message: Record<string, unknown>): void {
    const companion = finite(message.from) ? this.companions.get(message.from) : undefined;
    const { x, y } = message;
    if (!companion || !finite(x) || !finite(y)) return;
    companion.tx = Phaser.Math.Clamp(x, 0, this.model.w * TILE_PX);
    companion.ty = Phaser.Math.Clamp(y, 0, this.model.h * TILE_PX);
    companion.moving = message.moving === true;
    companion.sprite.setFlipX(message.flip === true);
    companion.seen = this.time.now;
    const sneaking = message.sneaking === true;
    if (sneaking !== companion.sneaking) {
      companion.sneaking = sneaking;
      this.paintCompanions();
    }
    if (this.ready && !this.leaving) this.companionGround(companion);
  }

  /** Host: what a guest's feet uncover. The fog lifts for the party, and a new world tile may hide an ambush. */
  private companionGround(companion: Companion): void {
    const cell = { x: Math.floor(companion.tx / TILE_PX), y: Math.floor((companion.ty - 1) / TILE_PX) };
    const cellKey = `${cell.x},${cell.y}`;
    if (cellKey === companion.cell) return;
    companion.cell = cellKey;
    if (this.fog) {
      const fresh = this.revealAround(cell);
      if (fresh.length) {
        this.drawFog();
        this.discoverLandmarks(fresh);
        this.changed();
      }
    }
    if (!this.place.world) return;
    const tile = cellWorldTile(cell);
    const key = `${tile.x},${tile.y}`;
    if (key === companion.tile) return;
    const stepped = companion.tile !== '';
    companion.tile = key;
    const member = this.session?.roster[companion.seat];
    if (!stepped || !member || this.fallen.has(member)) return;
    this.rollAmbushAt(tile, cell, { sneaking: companion.sneaking, veiled: this.time.now < (this.seatVeils.get(companion.seat) ?? 0) });
  }

  /** Host: a guest struck, spoke a word, searched or rested; it is settled here for the whole party. */
  private onCompanionAct(message: Record<string, unknown>): void {
    const session = this.session;
    const seat = finite(message.from) ? message.from : -1;
    if (message.what === 'answer') {
      // The answer to a choice put to that guest; it may come while anything else is going on.
      const ask = finite(message.id) ? this.asks.get(message.id) : undefined;
      if (ask && ask.seat === seat && finite(message.choice)) ask.settle(Math.max(0, Math.floor(message.choice)));
      return;
    }
    const member = session?.roster[seat];
    const companion = this.companions.get(seat);
    if (!session || !member || !companion) return;
    const mage = memberIn(this.run, member);
    const able = this.ready && !this.leaving && !this.busy && !!mage?.alive;
    if (message.what === 'search') {
      // Always answered, so the guest's window never waits for nothing.
      const reply = (payload: Record<string, unknown>): void => session.send({ k: 'x-search', to: seat, id: message.id, ...payload });
      const cell = { x: Math.floor(companion.tx / TILE_PX), y: Math.floor((companion.ty - 1) / TILE_PX) };
      const tile = cellWorldTile(cell);
      const target = able && mage && this.place.world && typeof message.category === 'string' && typeof message.target === 'string'
        ? findSearchTarget(this.run, tile, message.category, message.target)
        : null;
      if (!mage || !target) {
        reply({ ok: false });
        return;
      }
      const resolution = this.searchFor(tile, target, member, searchBonus(mage, target.category));
      reply({ ok: true, roll: resolution.roll, message: resolution.message });
      this.afterSearch(resolution, tile, cell, seat);
      return;
    }
    // Waiting is open to the fallen too, so nobody is ever stuck behind.
    if (message.what === 'wait') {
      if (this.ready && !this.leaving && this.place.world && this.run.area) this.waitFor(member, seat);
      return;
    }
    if (!able || !mage) return;
    const name = session.nameOf(seat);
    const near = (x: number, y: number, tiles: number): boolean => Math.hypot(x - companion.tx, y - companion.ty) / TILE_PX <= tiles;
    switch (message.what) {
      case 'rest': {
        if (!this.place.world) return;
        this.restAt([member], seat, { x: Math.floor(companion.tx / TILE_PX), y: Math.floor((companion.ty - 1) / TILE_PX) });
        return;
      }
      case 'ambush': {
        const state = this.packs.find((entry) => entry.pack.id === message.pack);
        if (!state || !near(state.x, state.y, GUEST_REACH_TILES)) return;
        const opening = this.companionOpening(message.opening, member, mage);
        if (!opening) return;
        this.notify(`${name} springs an ambush: ${state.pack.label}.`, 1800);
        this.startFight(state.pack, undefined, undefined, opening);
        return;
      }
      case 'rule': {
        const word = typeof message.word === 'string' && Object.prototype.hasOwnProperty.call(FIELD_RULES, message.word)
          ? message.word as WordId
          : null;
        const rule = word ? FIELD_RULES[word] : undefined;
        if (!word || !rule || !mage.loadout.includes(word) || (mage.charges[word] ?? 0) <= 0) return;
        const mana = fieldSpellMana(mage, [word]);
        if (!mage.hasMana(mana)) return;
        const now = this.time.now;
        if (rule.effect === 'heal') {
          const healed = this.healParty(member, word, mana);
          if (healed) this.notify(`${name} heals ${healed.name}: +${healed.amount} HP.`, 2200);
        } else {
          if (rule.effect === 'veil') this.seatVeils.set(seat, now + rule.ms);
          if (rule.effect === 'bind') {
            for (const state of this.packsWithin(rule.range, { x: companion.tx, y: companion.ty })) state.slowUntil = now + rule.ms;
          }
          withMember(this.run, member, (caster) => {
            caster.spendCharges([word]);
            caster.spendMana(mana);
          });
        }
        this.readLeader();
        this.changed();
        return;
      }
      case 'secret': {
        const secret = this.place.secrets.find((entry) => entry.id === message.id && !this.run.flags.includes(`secret:${entry.id}`));
        if (!secret || !near((secret.x + 0.5) * TILE_PX, (secret.y + 0.8) * TILE_PX, 3)) return;
        void this.search(secret, member);
        return;
      }
    }
  }

  /** Host: the opening strike a guest asked for, a spell paid for out of their own charges and mana. Null when it cannot be. */
  private companionOpening(raw: unknown, member: MageClass, mage: Mage): ExplorationOpening | null {
    const opening = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
    if (opening?.kind === 'weapon') return mage.outOfAmmo() || mage.cannotAttack ? null : { kind: 'weapon', by: member };
    if (opening?.kind !== 'spell' || !Array.isArray(opening.words)) return null;
    const words: unknown[] = opening.words.slice(0, MAX_FIELD_WORDS);
    const known = (word: unknown): word is WordId =>
      typeof word === 'string' && Object.prototype.hasOwnProperty.call(WORDS, word)
      && mage.loadout.includes(word as WordId) && (mage.charges[word as WordId] ?? 0) > 0;
    if (!words.length || new Set(words).size !== words.length || !words.every(known)) return null;
    const mana = fieldSpellMana(mage, words);
    if (!mage.hasMana(mana)) return null;
    withMember(this.run, member, (caster) => {
      caster.spendCharges(words);
      caster.spendMana(mana);
    });
    return { kind: 'spell', words, by: member };
  }
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Guest: the host's word on a search, checked before it is shown. Null when the host would not or could not search. */
function readSearchReply(message: Record<string, unknown>): SearchRollResult | null {
  if (message.ok !== true || !message.roll || typeof message.roll !== 'object') return null;
  const roll = message.roll as Record<string, unknown>;
  const whole = (value: unknown, min: number, max: number): number | null =>
    finite(value) && value >= min && value <= max ? Math.round(value) : null;
  const die = whole(roll.die, 1, 20);
  const bonus = whole(roll.bonus, 0, 20);
  const dc = whole(roll.dc, 0, 99);
  const outcome = roll.outcome === 'found' || roll.outcome === 'near' || roll.outcome === 'nothing' ? roll.outcome : null;
  if (die == null || bonus == null || dc == null || !outcome) return null;
  return {
    roll: { die, bonus, total: die + bonus, dc, outcome },
    message: typeof message.message === 'string' ? message.message.slice(0, 240) : '',
  };
}
