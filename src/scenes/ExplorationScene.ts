import Phaser from 'phaser';
import { playMusic, playSound } from '../audio';
import { COLORS, GAME_HEIGHT, GAME_WIDTH } from '../config/constants';
import type { ExplorationOpening, MatchConfig } from '../config/MatchConfig';
import { MAGE_CLASSES, type MageClass } from '../core/Classes';
import { setHexLore } from '../core/hexcraft/lore';
import { getItem, type ItemId } from '../core/Items';
import { Mage } from '../core/Mage';
import { recordKills } from '../pve/exploration/bounties';
import { AREA_HOURS, enterArea, leaveArea, spendAreaTime } from '../pve/exploration/area';
import { advanceHours, clockTime, isNight, spanLabel } from '../pve/exploration/clock';
import { MAX_PARTY, livingMembers } from '../pve/exploration/coop';
import { campOutcome, clearTravel, openPoll, pollOutcome, travelOutcome, type Spot, type TravelVote } from '../pve/exploration/council';
import { absoluteHour, inDesert, isSandstorm, stormHoursLeft } from '../pve/exploration/desert';
import { dungeonCombat, DUNGEONS } from '../pve/exploration/dungeons';
import { exchangeItems, grantToMage, grantToParty, money, moneyLabel, partyOf, shikigamiRides } from '../pve/exploration/economy';
import { describeSpawns, rollEncounter, type EncounterKind, type EncounterSpawn, type EncounterZone } from '../pve/exploration/encounters';
import { bloodmoonCombat, bloodmoonDue, bloodmoonFight, BOSSES, hoursToBloodmoon, type BossFight } from '../pve/exploration/bloodmoon';
import { isExplored, unpackExplored } from '../pve/exploration/explored';
import { rollExploreFindLoot, type ExploreFindLoot } from '../pve/exploration/finds';
import { localActions, type ExplorationActions } from '../pve/exploration/intents';
import {
  emptyRoad,
  rollBeat,
  rollFastSighting,
  stopsAlong,
  walkStep,
  type Beat,
  type Sighting,
  type SightingKind,
} from '../pve/exploration/journey';
import { resolveLocale } from '../pve/exploration/locales';
import { OPEN_WORLD_ID, openWorldCell, siteArrival } from '../pve/exploration/openWorld';
import { capturePartySnapshot } from '../pve/exploration/party';
import { createRun, stepDice, type ExplorationRun, type LocaleState } from '../pve/exploration/run';
import { clearRun, loadRun, saveRun, saveSlot } from '../pve/exploration/save';
import { downloadRun } from '../ui/runFile';
import type { SceneFight } from '../pve/exploration/sceneFight';
import { SCENE_SALT, stageScene } from '../pve/exploration/scenes';
import {
  bestSearcher,
  pickedOver,
  resolveSearch,
  SEARCH_HOURS,
  searchShelves,
  searchSite,
  type SearchResolution,
} from '../pve/exploration/search';
import { takeShortRest } from '../pve/exploration/shortRest';
import { WAYSIDE_KINDS, waysideShopId, type WaysideKind } from '../pve/exploration/shops';
import { createSite, SITE_RADIUS, siteIntro, type EncounterSite } from '../pve/exploration/site';
import { restThought } from '../pve/exploration/thoughts';
import {
  dangerWord,
  exploreAlong,
  findRoute,
  planTrip,
  rollTrip,
  TRAVEL_MODES,
  TRAVEL_ORDER,
  type TravelMode,
  type TripPlan,
  type TripStep,
  type TripStop,
} from '../pve/exploration/travel';
import {
  createWorld,
  describeTile,
  isPassable,
  placeAt,
  placeById,
  placeNear,
  REGIONS,
  regionAt,
  START_PLACE,
  terrainAt,
  type DungeonId,
  type Place,
  type RegionId,
  type WorldMap,
} from '../pve/exploration/world';
import { CabinetButton, MenuFocusGroup } from '../ui/cabinet/controls';
import { AdventureSession, HOST_SEAT } from '../net/AdventureSession';
import { startAdventureFight } from '../net/adventureFight';
import { claimTravellers } from '../net/partySetup';
import { parseSpawn } from '../net/fightWire';
import { SceneInput } from '../engine/SceneInput';
import { MENU_FONT, MENU_HEX } from '../ui/cabinet/theme';
import { darkness } from '../visuals/daylight';
import { PlanMarks } from '../visuals/PlanMarks';
import type { VoteBoardModel, VoteRow, VoteSeat } from '../ui/pve/VoteBoard';
import { TravelFx } from '../visuals/TravelFx';
import { createCreatureAnims, preloadCreatureSprites } from '../world/creatureSprite';
import { preloadLocaleAssets } from '../world/localeRender';
import { createMageAnims, MAGE_FIRST_FRAME, MAGE_IDLE, MAGE_RUN, preloadMageFrames } from '../world/mageSprite';
import { OverworldView, OW_CELL, OW_SCALE } from '../world/overworldRender';
import type { Cell } from '../world/pathfind';
import type { HudOwner, LocaleHudScene, WorldPanel } from './LocaleHudScene';
import type { LocaleEntry } from './LocaleScene';

/** What the scene was handed when it started. */
export interface ExplorationEntry {
  config?: MatchConfig;
  /** Pick the autosave back up instead of building a fresh run. */
  resume?: boolean;
  /** Handed back by GameScene once a fight is done. */
  result?: ExplorationCombatResult;
  /** Handed back by a walkable place the party just left. */
  run?: ExplorationRun;
  notice?: string;
  /** Online guest: show the host's travel map, or wait for the host's next scene. */
  follow?: 'map' | 'wait';
  /** Back from a site off the road: plan the interrupted trip to here again. */
  replan?: Cell;
}

export interface ExplorationCombatResult {
  run: ExplorationRun;
  outcome: 'won' | 'lost' | 'fled';
  /** Border the party broke off by, when they fled. */
  edge?: 'north' | 'south' | 'east' | 'west';
  cameFrom: string | null;
  /** Creature kinds felled, for bounty progress. */
  kills?: string[];
  returnTo?: LocaleState;
  /** Where a party that broke off goes, when that differs from `returnTo`. */
  fleeTo?: LocaleState;
  tag?: string;
  robbery?: boolean;
  /** The dungeon the party dived into, when the fight was a dive. */
  dungeon?: DungeonId;
  crushed?: boolean;
  /** The bloodmoon boss this fight was against. */
  boss?: BossFight;
  /** A merchant saved in a won scene fight opens these wares. */
  wares?: WaysideKind;
}

const ROBBERY_TOLL = 0.25;
const DRAG_SLOP = 8;
/** Room the camera may scroll past the map's edges, so a corner can be pulled out from under the HUD. */
const MAP_MARGIN = { x: 440, y: 380 };
/** Clicking this many tiles from a town, mine or swamp aims at it. */
const PLACE_REACH = 1;
/** Where the party is headed stands out in the travel menu. */
const DEST_HEX = '#ffd070';
/** Real milliseconds a tile takes per hour it costs, and the bounds either side. */
const STEP_MS_PER_HOUR = 1250;
const STEP_MS = { min: 270, max: 700 };
const FAST_STEP_MS = { perHour: 420, min: 90, max: 200 };
/** How long the party stands still on a quiet stop. */
const QUIET_STOP_MS = 1400;
/** How quickly the light over the map catches up with the clock. */
const LIGHT_FOLLOW_MS = 170;

/** How long the party's choice stays on screen once made; longer for a tie, while the lots are drawn. */
const POLL_SHOW_MS = 1500;
const POLL_TIE_MS = 4200;

/** A share of the purse, rounded down to the silver. */
const silverDown = (value: number): number => Math.floor(value * 10 + 1e-6) / 10;

/** A trip under way: where it is bound, how it is walked and what is still ahead. */
interface Trip {
  dest: Cell;
  mode: TravelMode;
  left: number;
  tiles: number;
}

/** An effect over the party on the map, played on every screen of an online party. */
type FxCall =
  | { what: 'think'; text: string }
  | { what: 'sparkle' }
  | { what: 'rest' }
  | { what: 'follow' }
  | { what: 'cue'; symbol: string; color: string }
  | { what: 'alarm'; foe?: EncounterSpawn }
  | { what: 'mark'; id: number; kind: SightingKind; cell: Cell; foe?: EncounterSpawn }
  | { what: 'unmark'; id: number }
  | { what: 'frame'; cell: Cell };

const SIGHTING_GO: Record<SightingKind, string> = {
  herbs: 'Pick it',
  pack: 'Sneak up',
  cache: 'Search it',
};

/**
 * The overworld. Owns the run, draws the world map, plans and walks trips, and
 * hands off to GameScene for every fight and to LocaleScene for every town,
 * forest and wild.
 */
export class ExplorationScene extends Phaser.Scene implements HudOwner {
  private world: WorldMap = createWorld();
  private currentRun!: ExplorationRun;
  /** The run the party plays; its rune lore decides how this client names every Hexzettel. */
  private get run(): ExplorationRun {
    return this.currentRun;
  }
  private set run(run: ExplorationRun) {
    this.currentRun = run;
    setHexLore(run.hexLore.runes);
  }
  private layer?: Phaser.GameObjects.Container;
  private focus = new MenuFocusGroup();
  private keys?: SceneInput;
  private notice = '';
  private pendingConfig?: MatchConfig;
  private view?: OverworldView;
  private token?: Phaser.GameObjects.Sprite;
  private fx?: TravelFx;
  private hud?: LocaleHudScene;
  private busy = false;
  private route: Cell[] | null = null;
  private trip: Trip | null = null;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private overview = false;
  /** The hour the map is lit for, trailing the clock so the light eases along. */
  private lightHour = -1;
  /** A guest's own level-up prompts are on screen. */
  private settling = false;
  /** The bloodmoon's fight is on its way; nothing else starts. */
  private rising = false;
  /** A merchant saved on the road opens their wares once the map is up. */
  private pendingWares: WaysideKind | null = null;
  /** Online: everyone's planned routes. */
  private plans?: PlanMarks;
  /** Guest: the party is on the road until then, as far as the host's steps say. */
  private hostWalkingUntil = 0;
  /** Guest: the host's trip under way, as the host last drew it. */
  private guestTrip: Trip | null = null;
  /** Host: a party vote waiting to be settled. */
  private pollWaiter: { id: number; resolve: (choice: number) => void } | null = null;
  /** Beacons over things spotted, by id, so a guest's go when the host's do. */
  private beacons = new Map<number, { destroy(): void }>();
  private beaconSeq = 0;
  /** Guest: the token stops running once the host's steps stop coming. */
  private guestIdle: Phaser.Time.TimerEvent | null = null;
  /** Routes to each planned destination from where the party stands, found once. */
  private routeCache = new Map<string, Cell[] | null>();

  constructor() {
    super('Exploration');
  }

  preload(): void {
    preloadLocaleAssets(this);
    preloadMageFrames(this);
    preloadCreatureSprites(this);
  }

  create(entry: ExplorationEntry): void {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    playMusic('menu');
    this.world = createWorld();
    this.pendingConfig = entry.config;
    this.busy = false;
    this.hud = undefined;
    this.view = undefined;
    this.token = undefined;
    this.fx = undefined;
    this.route = null;
    this.trip = null;
    this.drag = null;
    this.overview = false;
    this.lightHour = -1;
    this.settling = false;
    this.rising = false;
    this.pendingWares = null;
    this.plans = undefined;
    this.hostWalkingUntil = 0;
    this.guestTrip = null;
    this.pollWaiter = null;
    this.beacons = new Map();
    this.guestIdle = null;
    this.routeCache.clear();
    this.focus.clear();
    this.keys?.destroy();
    this.keys = new SceneInput(this);
    // While a HUD window is open the keys are its alone.
    const free = (run: () => void) => (): void => {
      if (!this.hud?.modalOpen) run();
    };
    this.keys.bindKeys([
      { key: 'UP', capture: true, run: free(() => this.focus.move(-1)) },
      { key: 'W', run: free(() => this.focus.move(-1)) },
      { key: 'DOWN', capture: true, run: free(() => this.focus.move(1)) },
      { key: 'S', run: free(() => this.focus.move(1)) },
      { key: 'ENTER', capture: true, run: free(() => this.focus.activate()) },
      { key: 'SPACE', capture: true, run: free(() => this.focus.activate()) },
      { key: 'I', run: free(() => void this.openPack()) },
      { key: 'M', run: free(() => this.toggleOverview()) },
      { key: 'C', run: free(() => this.followParty()) },
      { key: 'ESC', run: free(() => (this.route ? this.clearRoute() : void this.openMenu())) },
    ]);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.keys?.destroy();
      this.input.off(Phaser.Input.Events.POINTER_DOWN);
      this.input.off(Phaser.Input.Events.POINTER_MOVE);
      this.input.off(Phaser.Input.Events.POINTER_UP);
      this.input.off(Phaser.Input.Events.POINTER_WHEEL);
      this.fx?.destroy();
      this.fx = undefined;
      this.plans?.destroy();
      this.plans = undefined;
      this.view?.destroy();
      this.view = undefined;
      this.scene.stop('LocaleHud');
    });
    createMageAnims(this);
    createCreatureAnims(this);

    if (entry.config?.net) {
      this.startOnline(entry.config);
      return;
    }
    this.joinSession();
    if (entry.follow && entry.run) {
      this.run = entry.run;
      this.notice = entry.notice ?? '';
      if (entry.follow === 'wait') this.drawWaiting('THE FIGHT IS OVER', 'Waiting for the host...');
      else this.openOverworld();
      return;
    }
    if (entry.result) {
      this.run = entry.result.run;
      if (this.resolveCombatResult(entry.result)) return;
    } else if (entry.run) {
      this.run = entry.run;
      this.notice = entry.notice ?? '';
    } else {
      const saved = loadRun();
      // A run already on the road is never thrown away without being asked.
      if (saved) {
        this.run = saved;
        this.drawResumePrompt(saved);
        return;
      }
      this.beginFreshRun();
      return;
    }
    if (this.run.area) leaveArea(this.run);
    this.openOverworld();
    if (entry.replan) this.planAgain(entry.replan);
  }

  /** Set out on foot across the country round the tile the party stands on. */
  private exploreOnFoot(): void {
    if (this.busy || this.hud?.modalOpen) return;
    this.busy = true;
    enterArea(this.run);
    this.run.locale = null;
    saveRun(this.run);
    playSound('ui.confirm');
    this.cameras.main.fadeOut(240, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.stop('LocaleHud');
      this.scene.start('Locale', {
        run: this.run,
        locale: OPEN_WORLD_ID,
        at: openWorldCell(this.run.pos),
      } satisfies LocaleEntry);
    });
  }

  private freshSeed(): number {
    return Math.floor(Math.random() * 0xffffffff) >>> 0;
  }

  /**
   * An online Adventure begins. The host builds the party (or loads the online
   * save) and walks into Kerusai; every guest waits here for the host's first scene.
   */
  private startOnline(config: MatchConfig): void {
    const seats = config.seats ?? [];
    const localSeat = config.localSeat ?? HOST_SEAT;
    const session = AdventureSession.begin({
      net: config.net!,
      role: localSeat === HOST_SEAT ? 'host' : 'guest',
      localSeat,
      size: seats.length,
      names: seats.map((seat, index) => seat.name || `Player ${index + 1}`),
    });
    this.joinSession();
    if (!session.isHost) {
      this.drawWaiting('JOINED THE PARTY', 'Waiting for the host to set out...');
      return;
    }
    if (config.adventure?.resume) {
      const saved = loadRun('online');
      if (!saved || saved.party.entities.length !== session.size) {
        session.end(saved
          ? `The saved online run has ${saved.party.entities.length} players, but ${session.size} joined.`
          : 'There is no online run saved on this computer.');
        return;
      }
      this.run = saved;
      session.adopt(saved);
      this.resumeRun(saved, 'The party is back together.');
      return;
    }
    this.run = createRun(config.seed != null ? config.seed >>> 0 : this.freshSeed(), this.buildParty(config), { creating: true });
    session.adopt(this.run);
    saveRun(this.run);
    const town = placeById(START_PLACE)!;
    this.scene.stop('LocaleHud');
    this.scene.start('Locale', {
      run: this.run,
      locale: town.locale ?? town.id,
      notice: `Day 1 in ${town.name}. Get a weapon at the Guild.`,
    } satisfies LocaleEntry);
  }

  /** Online: this scene takes the session's messages until it closes. */
  private joinSession(): void {
    const session = AdventureSession.current;
    if (!session) return;
    const offs = [
      session.on('x-over', (message) => this.showGameOver(this.run, message.crushed === true)),
      session.on('x-step', (message) => this.followStep(message)),
      session.on('x-toast', (message) => {
        if (typeof message.text === 'string') this.hud?.toast(message.text.slice(0, 240), 3200);
      }),
      session.on('x-run', () => this.onRunChanged()),
      session.on('x-changed', () => this.onRunChanged()),
      session.on('x-council', () => this.onCouncil()),
      session.on('x-ahead', (message) => this.followAhead(message)),
      session.on('x-fx', (message) => {
        const call = this.readFx(message);
        if (call) session.showing(this.playFx(call));
      }),
      session.on('x-bloodmoon', () => {
        this.walking(false);
        void this.hud?.bloodmoonRise();
      }),
      session.on('x-news', (message) => {
        if (typeof message.text === 'string') this.hud?.toast(message.text, 3600);
      }),
      session.on('x-wares', (message) => {
        const kind = WAYSIDE_KINDS.find((entry) => entry === message.kind);
        if (!kind) return;
        this.pendingWares = kind;
        if (this.hud && !this.hud.modalOpen) void this.openWares();
      }),
    ];
    session.bind(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const off of offs) off();
      session.unbind(this);
    });
  }

  /** A guest watches the host lead: no trips, no searches, no doors. */
  private get spectating(): boolean {
    const session = AdventureSession.current;
    return !!session && !session.isHost;
  }

  /** Say something to the whole party: on this screen, and on every guest's. */
  private notify(text: string, ms: number): void {
    this.hud?.toast(text, ms);
    const session = AdventureSession.current;
    if (session?.isHost) session.send({ k: 'x-toast', text });
  }

  /** Guest: the host's token took a step. */
  private followStep(message: Record<string, unknown>): void {
    const x = typeof message.x === 'number' ? Math.floor(message.x) : -1;
    const y = typeof message.y === 'number' ? Math.floor(message.y) : -1;
    if (x < 0 || y < 0 || x >= this.world.w || y >= this.world.h || !this.view) return;
    const ms = typeof message.ms === 'number' ? Math.min(2000, Math.max(0, message.ms)) : 300;
    this.hostWalkingUntil = this.time.now + ms + 900;
    this.time.delayedCall(ms + 950, () => {
      if (this.view && !this.hostWalking()) this.refresh();
    });
    const token = this.token;
    if (token) this.fx?.step({ x: token.x, y: token.y }, this.tileCenter({ x, y }), terrainAt(this.world, x, y));
    this.walking(true);
    this.guestIdle?.remove();
    this.guestIdle = this.time.delayedCall(ms + 250, () => {
      this.guestIdle = null;
      this.walking(false);
    });
    const reveal = typeof message.reveal === 'number' ? Math.max(0, Math.min(8, Math.floor(message.reveal))) : 0;
    const day = typeof message.day === 'number' && Number.isInteger(message.day) ? message.day : null;
    const hour = typeof message.hour === 'number' && Number.isFinite(message.hour) ? Math.max(0, Math.min(24, message.hour)) : null;
    void this.stepToken({ x, y }, ms).then(() => {
      if (!this.view) return;
      // The host's run follows soon; meanwhile this screen maps the ground and turns the clock as the host did.
      this.run.pos = { x, y };
      if (reveal > 0 && exploreAlong(this.run, [{ x, y }], reveal)) this.view.setExplored(unpackExplored(this.run.explored));
      if (day != null && hour != null && (day > this.run.day || (day === this.run.day && hour >= this.run.hour)) && day < this.run.day + 30) {
        this.run.day = day;
        this.run.hour = hour;
      }
      this.refreshClock();
    });
  }

  /** Play `call` here and, as host, on every guest's map too. */
  private fxAll(call: FxCall): Promise<void> {
    const session = AdventureSession.current;
    if (session?.isHost) session.send({ k: 'x-fx', ...call });
    return this.playFx(call);
  }

  private async playFx(call: FxCall): Promise<void> {
    const fx = this.fx;
    if (!fx) return;
    switch (call.what) {
      case 'think':
        fx.think(call.text);
        return;
      case 'sparkle':
        fx.sparkle();
        return;
      case 'cue':
        return fx.cue(call.symbol, call.color);
      case 'alarm':
        return fx.alarm(call.foe);
      case 'rest':
        return fx.rest();
      case 'mark':
        this.beacons.get(call.id)?.destroy();
        this.beacons.set(call.id, fx.mark(call.kind, this.tileCenter(call.cell), call.foe));
        return;
      case 'unmark':
        this.beacons.get(call.id)?.destroy();
        this.beacons.delete(call.id);
        return;
      case 'frame':
        return this.frameBoth(this.tileCenter(call.cell));
      case 'follow':
        this.followParty();
        return;
    }
  }

  /** Guest: an effect the host played, off the wire. */
  private readFx(message: Record<string, unknown>): FxCall | null {
    const cell = (value: unknown): Cell | null => {
      const raw = value && typeof value === 'object' ? value as Record<string, unknown> : null;
      return raw && Number.isInteger(raw.x) && Number.isInteger(raw.y) ? { x: raw.x as number, y: raw.y as number } : null;
    };
    const foe = message.foe == null ? undefined : parseSpawn(message.foe) ?? undefined;
    const id = Number.isInteger(message.id) ? message.id as number : -1;
    switch (message.what) {
      case 'think':
        return typeof message.text === 'string' ? { what: 'think', text: message.text.slice(0, 120) } : null;
      case 'sparkle':
      case 'rest':
      case 'follow':
        return { what: message.what };
      case 'cue':
        return typeof message.symbol === 'string' && typeof message.color === 'string' && /^#[0-9a-f]{6}$/i.test(message.color)
          ? { what: 'cue', symbol: message.symbol.slice(0, 2), color: message.color }
          : null;
      case 'alarm':
        return { what: 'alarm', foe };
      case 'mark': {
        const at = cell(message.cell);
        const kind = (['herbs', 'pack', 'cache'] as const).find((entry) => entry === message.kind);
        return at && kind && id >= 0 ? { what: 'mark', id, kind, cell: at, foe } : null;
      }
      case 'unmark':
        return id >= 0 ? { what: 'unmark', id } : null;
      case 'frame': {
        const at = cell(message.cell);
        return at ? { what: 'frame', cell: at } : null;
      }
      default:
        return null;
    }
  }

  /** Another player changed the run, or the host sent it afresh. */
  private onRunChanged(): void {
    if (!this.view) return;
    this.view.setExplored(unpackExplored(this.run.explored));
    this.refresh();
    this.hud?.refreshWindow();
    if (this.spectating) void this.settleOwnLevels();
  }

  /** Guest: level-ups this player still owes, taken whenever nothing else is on screen. */
  private async settleOwnLevels(): Promise<void> {
    const hud = this.hud;
    if (!hud || hud.modalOpen || this.settling) return;
    this.settling = true;
    await hud.levelUps(this.run, this.actions());
    this.settling = false;
  }

  /** A plain card while a guest waits on the host. */
  private drawWaiting(title: string, detail: string): void {
    this.layer?.destroy();
    this.focus.clear();
    const root = this.add.container(0, 0);
    this.layer = root;
    root.add(this.add.text(GAME_WIDTH / 2, 300, title, {
      fontFamily: MENU_FONT.display,
      fontSize: '30px',
      color: MENU_HEX.brassLight,
    }).setOrigin(0.5));
    root.add(this.add.text(GAME_WIDTH / 2, 348, detail, {
      fontFamily: MENU_FONT.control,
      fontSize: '16px',
      color: MENU_HEX.bone,
    }).setOrigin(0.5));
    const leave = new CabinetButton(this, GAME_WIDTH / 2 - 170, 410, {
      width: 340,
      label: 'Leave',
      index: '1',
      onActivate: () => AdventureSession.current?.end('You left the session.'),
    });
    root.add(leave);
    this.focus.add(leave);
  }

  /** Pick a stored run up where it was left: inside a place, out on foot, or on the map. */
  private resumeRun(saved: ExplorationRun, notice: string): void {
    if (saved.locale && resolveLocale(saved, saved.locale.id)) {
      this.scene.start('Locale', { run: saved, locale: saved.locale.id, notice } satisfies LocaleEntry);
      return;
    }
    // Out on foot without a spot to stand on: back on the map where the walk began.
    if (saved.area) leaveArea(saved);
    this.notice = notice;
    this.openOverworld();
  }

  /** A fresh party wakes inside Kerusai with five silver each and work at the Lodge. */
  private beginFreshRun(): void {
    this.run = createRun(this.freshSeed(), this.buildParty(this.pendingConfig), { creating: true });
    saveRun(this.run);
    const town = placeById(START_PLACE)!;
    this.scene.stop('LocaleHud');
    this.scene.start('Locale', {
      run: this.run,
      locale: town.locale ?? town.id,
      notice: `Day 1 in ${town.name}. Get a weapon at the Guild.`,
    } satisfies LocaleEntry);
  }

  /** Standing offer when an old run is found: pick it up, or set it down. */
  private drawResumePrompt(saved: ExplorationRun): void {
    this.layer?.destroy();
    this.focus.clear();
    const root = this.add.container(0, 0);
    this.layer = root;
    const inside = saved.locale ? resolveLocale(saved, saved.locale.id)?.def.name : null;
    const where = inside ?? describeTile(this.world, saved.pos.x, saved.pos.y);
    root.add(
      this.add.text(GAME_WIDTH / 2, 220, 'SAVED RUN FOUND', {
        fontFamily: MENU_FONT.display,
        fontSize: '30px',
        color: MENU_HEX.brassLight,
      }).setOrigin(0.5)
    );
    root.add(
      this.add.text(
        GAME_WIDTH / 2,
        266,
        `${where}  /  ${moneyLabel(saved.gold)}  /  Level ${saved.level}  /  Day ${saved.day}`,
        { fontFamily: MENU_FONT.control, fontSize: '16px', color: MENU_HEX.bone }
      ).setOrigin(0.5)
    );
    const options: [string, string, () => void][] = [
      ['Continue', '', () => {
        root.destroy();
        this.focus.clear();
        this.resumeRun(saved, 'Run resumed.');
      }],
      ['Start Over', 'Deletes this run.', () => {
        root.destroy();
        this.focus.clear();
        this.beginFreshRun();
      }],
      ['Back', '', () => this.scene.start('Menu')],
    ];
    options.forEach(([label, detail, run], index) => {
      const button = new CabinetButton(this, GAME_WIDTH / 2 - 170, 330 + index * 74, {
        width: 340,
        label,
        detail,
        index: String(index + 1),
        onActivate: run,
      });
      root.add(button);
      this.focus.add(button);
    });
  }

  /** Fresh travellers with a torch and a few potions each, and no class: they name their words in Kerusai. */
  private buildParty(config?: MatchConfig): ReturnType<typeof capturePartySnapshot> {
    const seats = (config?.seats ?? []).slice(0, MAX_PARTY);
    const count = Math.max(1, seats.length);
    const party = Array.from({ length: count }, (_, index) => {
      const mage = new Mage({
        name: count > 1 ? seats[index]?.name ?? `Player ${index + 1}` : 'Player',
        isAI: false,
        team: 1,
        position: { x: 200, y: 240 },
        loadout: [],
        mageClass: MAGE_CLASSES[index],
      });
      mage.assignFlatStats(3);
      // The class is only an id that tells the travellers apart.
      mage.classless = true;
      for (const id of ['torch', 'healthPotion', 'healthPotion', 'manaPotion'] as ItemId[]) grantToMage(mage, id);
      return mage;
    });
    return capturePartySnapshot(party);
  }

  /** Everyone fell: the run is over and its save goes with it. */
  private showGameOver(run: ExplorationRun, crushed: boolean): void {
    const session = AdventureSession.current;
    clearRun();
    if (session?.isHost) session.send({ k: 'x-over', crushed });
    this.layer?.destroy();
    this.focus.clear();
    playSound('ui.deny');
    const root = this.add.container(0, 0);
    this.layer = root;
    root.add(this.add.text(GAME_WIDTH / 2, 220, crushed ? 'DIED IN THE MINES' : 'PARTY DEFEATED', {
      fontFamily: MENU_FONT.display,
      fontSize: '30px',
      color: MENU_HEX.brassLight,
    }).setOrigin(0.5));
    root.add(this.add.text(GAME_WIDTH / 2, 266,
      `The run is over.  Day ${run.day}  /  Level ${run.level}  /  ${run.visited.length} places reached`,
      { fontFamily: MENU_FONT.control, fontSize: '16px', color: MENU_HEX.bone },
    ).setOrigin(0.5));
    const button = new CabinetButton(this, GAME_WIDTH / 2 - 170, 330, {
      width: 340,
      label: 'Main Menu',
      index: '1',
      onActivate: () => {
        if (session) session.end('The party is dead. The run is over.');
        else this.scene.start('Menu');
      },
    });
    root.add(button);
    this.focus.add(button);
  }

  /** The windows' way of changing the run for this player. */
  private actions(): ExplorationActions {
    return AdventureSession.current?.actions() ?? localActions(this.run);
  }

  // ---------------------------------------------------------------------------
  //  COMBAT ROUND TRIP
  // ---------------------------------------------------------------------------

  /** Settle a finished fight. Returns true when the scene has already moved on. */
  private resolveCombatResult(result: ExplorationCombatResult): boolean {
    const run = this.run;
    const finished = recordKills(run, result.kills ?? []);
    const bountyNote = finished.length ? ` Bounty ready: ${finished.join(', ')}.` : '';

    if (result.outcome === 'lost') {
      this.showGameOver(run, !!result.crushed);
      return true;
    }

    let note = '';
    if (result.outcome === 'fled' && result.robbery) {
      const toll = silverDown(run.gold * ROBBERY_TOLL);
      run.gold = money(run.gold - toll);
      if (toll > 0) note = ` The bandits took ${moneyLabel(toll)} as you ran.`;
    }
    if (result.outcome === 'won' && result.tag) run.groupsBeaten[result.tag] = run.day;
    if (result.outcome === 'won' && result.boss) run.bloodmoons = Math.max(run.bloodmoons, result.boss.cycle);
    const felled = result.outcome === 'won' && result.boss ? `${BOSSES[result.boss.id].name} is defeated. The bloodmoon is over.` : null;
    if (result.outcome === 'won' && result.wares) this.pendingWares = result.wares;

    const back = result.outcome === 'fled' ? result.fleeTo ?? result.returnTo : result.returnTo;
    // On foot a fight costs everyone in the party an hour.
    const onFoot = !!run.area && back?.id === OPEN_WORLD_ID;
    if (onFoot) spendAreaTime(run, run.party.entities.map((entity) => entity.mageClass), AREA_HOURS.fight);
    const took = onFoot ? ` (${spanLabel(AREA_HOURS.fight)})` : '';
    const dungeon = result.dungeon ? DUNGEONS[result.dungeon].name : null;
    const won = dungeon ? `Out of ${dungeon}.${bountyNote}` : `${felled ?? 'Fight won.'}${took}${bountyNote}`;
    const fled = dungeon ? `You fled ${dungeon}.${note}` : `You fled.${took}${note}`;
    if (back) {
      saveRun(run);
      const line = result.outcome === 'won' ? won : fled;
      this.scene.start('Locale', {
        run,
        locale: back.id,
        at: { x: back.x, y: back.y },
        notice: line,
        grace: result.outcome === 'fled' ? 3000 : 0,
      } satisfies LocaleEntry);
      return true;
    }

    this.notice = dungeon
      ? result.outcome === 'fled' ? fled : won
      : result.outcome === 'fled' ? `You fled.${note}` : `${felled ?? 'Fight won.'}${bountyNote}`;
    saveRun(run);
    return false;
  }

  /** The bloodmoon has risen: wherever the party is on the map, its boss is upon it. */
  private async riseBloodmoon(): Promise<void> {
    const fight = bloodmoonFight(this.run);
    if (!fight || this.spectating || this.rising) return;
    this.rising = true;
    this.busy = true;
    this.walking(false);
    this.route = null;
    this.trip = null;
    this.clearTripLine();
    saveRun(this.run);
    AdventureSession.current?.send({ k: 'x-bloodmoon' });
    await this.hud?.bloodmoonRise();
    const zone: EncounterZone = regionAt(this.world, this.run.pos.x, this.run.pos.y);
    startAdventureFight(this, { mode: 'exploration', loadouts: [[], []], exploration: bloodmoonCombat(this.run, fight, zone) } satisfies MatchConfig);
  }

  private startCombat(
    encounter: EncounterKind,
    zone: EncounterZone,
    depth: number,
    spawns?: EncounterSpawn[],
    label?: string,
    opening?: ExplorationOpening,
    scene?: SceneFight,
  ): void {
    saveRun(this.run);
    startAdventureFight(this, {
      mode: 'exploration',
      loadouts: [[], []],
      exploration: {
        run: this.run,
        encounter,
        depth,
        cameFrom: null,
        zone,
        spawns,
        label,
        opening,
        scene,
      },
    } satisfies MatchConfig);
  }

  /** A dungeon on this tile: say what lies inside, then dive if the party means it. */
  private async enterDungeon(placeId: string): Promise<void> {
    const place = placeById(placeId);
    const hud = this.hud;
    if (!place?.dungeon || !hud || this.busy) return;
    const dungeon = place.dungeon;
    const def = DUNGEONS[dungeon];
    this.busy = true;
    const choice = (await this.askParty(def.name.toUpperCase(), def.warning, [
      { label: 'Go in', detail: '', enabled: true },
      { label: 'Not yet', detail: '', enabled: true },
    ])) === 0 ? 'enter' : 'stay';
    if (choice !== 'enter') {
      this.busy = false;
      this.refresh();
      return;
    }
    if (!this.run.visited.includes(place.id)) this.run.visited.push(place.id);
    this.run.pos = { x: place.x, y: place.y };
    saveRun(this.run);
    playSound('ui.confirm');
    this.cameras.main.fadeOut(240, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      startAdventureFight(this, { mode: 'exploration', loadouts: [[], []], exploration: dungeonCombat(this.run, dungeon) } satisfies MatchConfig);
    });
  }

  // ---------------------------------------------------------------------------
  //  THE MAP
  // ---------------------------------------------------------------------------

  private openOverworld(): void {
    this.layer?.destroy();
    this.layer = undefined;
    this.focus.clear();
    this.view?.destroy();
    const view = new OverworldView(this, this.world);
    this.view = view;
    view.setExplored(unpackExplored(this.run.explored));
    const at = this.tileCenter(this.run.pos);
    this.token = this.add.sprite(at.x, at.y, MAGE_FIRST_FRAME).setOrigin(0.5, 0.85).setScale(OW_SCALE + 0.5).setDepth(22);
    this.token.play(MAGE_IDLE);
    this.fx?.destroy();
    this.fx = new TravelFx(this, this.token);
    this.lightHour = -1;
    const cam = this.cameras.main;
    cam.setBounds(-MAP_MARGIN.x, -MAP_MARGIN.y, view.width + MAP_MARGIN.x * 2, view.height + MAP_MARGIN.y * 2);
    cam.setZoom(1);
    cam.setRoundPixels(true);
    cam.startFollow(this.token, true, 0.15, 0.15);
    this.bindMapInput();
    const session = AdventureSession.current;
    if (session?.isHost) {
      session.adopt(this.run);
      session.go('Exploration', { notice: this.notice });
    }
    this.scene.launch('LocaleHud', { owner: this });
  }

  onHudReady(hud: LocaleHudScene): void {
    this.hud = hud;
    hud.setMember(AdventureSession.current?.member ?? null);
    hud.setHint(this.spectating
      ? 'Click the map: plan a trip, or click a route to join it     Drag: look around     Wheel: zoom     M: map     C: centre     I: bag     Esc: menu'
      : 'Click the map: plan a trip     Drag: look around     Wheel: zoom     M: map     C: centre     I: bag     Esc: menu');
    this.refresh();
    if (this.notice) hud.toast(this.notice, 4200);
    void (async () => {
      // A resumed online party picks its travellers again before anyone moves.
      const session = AdventureSession.current;
      if (session && session.roster.some((member) => !member)) {
        this.busy = true;
        await claimTravellers(session, this.run, hud.choose.bind(hud), (text) => hud.setPrompt(text));
        this.busy = false;
        hud.setMember(session.member);
        this.refresh();
      }
      if (await hud.levelUps(this.run, this.actions())) saveRun(this.run);
      await this.openWares();
      this.refresh();
    })();
  }

  /** A merchant saved on the road opens their wares, a little under price. Everyone gets a look. */
  private async openWares(): Promise<void> {
    const kind = this.pendingWares;
    const hud = this.hud;
    if (!kind || !hud || hud.modalOpen) return;
    this.pendingWares = null;
    const session = AdventureSession.current;
    if (session?.isHost) session.send({ k: 'x-wares', kind });
    const wasBusy = this.busy;
    this.busy = true;
    await hud.openShop(this.run, waysideShopId(kind), 'road', () => {
      saveRun(this.run);
      this.refresh();
    }, this.actions());
    this.busy = wasBusy;
    this.refresh();
  }

  private tileCenter(cell: Cell): { x: number; y: number } {
    return { x: (cell.x + 0.5) * OW_CELL, y: (cell.y + 0.5) * OW_CELL };
  }

  /** Ease the light over the map after the clock, and keep the torch on the party. */
  update(time: number, delta: number): void {
    const view = this.view;
    if (!view || !this.run) return;
    const target = absoluteHour(this.run);
    if (this.lightHour < 0 || target < this.lightHour || target - this.lightHour > 48) this.lightHour = target;
    else this.lightHour += (target - this.lightHour) * (1 - Math.exp(-delta / LIGHT_FOLLOW_MS));
    const hour = this.lightHour % 24;
    view.setDaylight(hour);
    this.fx?.update(time, darkness(hour));
    // Nothing but an open window holds the bloodmoon back.
    if (!this.busy && this.hud && !this.hud.modalOpen && !this.spectating && bloodmoonDue(this.run)) void this.riseBloodmoon();
  }

  private bindMapInput(): void {
    this.input.off(Phaser.Input.Events.POINTER_DOWN);
    this.input.off(Phaser.Input.Events.POINTER_MOVE);
    this.input.off(Phaser.Input.Events.POINTER_UP);
    this.input.off(Phaser.Input.Events.POINTER_WHEEL);
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      this.drag = { x: pointer.x, y: pointer.y, moved: false };
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      const drag = this.drag;
      if (!drag || !pointer.isDown) return;
      if (!drag.moved && Math.hypot(pointer.x - drag.x, pointer.y - drag.y) < DRAG_SLOP) return;
      drag.moved = true;
      const cam = this.cameras.main;
      cam.stopFollow();
      cam.scrollX -= (pointer.x - pointer.prevPosition.x) / cam.zoom;
      cam.scrollY -= (pointer.y - pointer.prevPosition.y) / cam.zoom;
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => {
      const drag = this.drag;
      this.drag = null;
      if (!drag || drag.moved || this.busy || this.hud?.modalOpen || this.hostWalking()) return;
      this.pickTile({ x: Math.floor(pointer.worldX / OW_CELL), y: Math.floor(pointer.worldY / OW_CELL) });
    });
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (this.overview) return;
      this.cameras.main.setZoom(dy > 0 ? 0.5 : 1);
    });
  }

  private toggleOverview(): void {
    const view = this.view;
    if (!view || !this.token) return;
    const cam = this.cameras.main;
    this.overview = !this.overview;
    if (this.overview) {
      cam.stopFollow();
      cam.removeBounds();
      cam.setZoom(Math.min(GAME_WIDTH / view.width, GAME_HEIGHT / view.height));
      cam.centerOn(view.width / 2, view.height / 2);
    } else {
      cam.setZoom(1);
      cam.setBounds(-MAP_MARGIN.x, -MAP_MARGIN.y, view.width + MAP_MARGIN.x * 2, view.height + MAP_MARGIN.y * 2);
      cam.startFollow(this.token, true, 0.15, 0.15);
    }
  }

  private followParty(): void {
    if (!this.token || this.overview) return;
    this.cameras.main.startFollow(this.token, true, 0.15, 0.15);
  }

  private pickTile(clicked: Cell): void {
    if (clicked.x < 0 || clicked.y < 0 || clicked.x >= this.world.w || clicked.y >= this.world.h) return;
    const session = AdventureSession.current;
    const near = placeNear(clicked.x, clicked.y, PLACE_REACH);
    const snap = near && !(near.x === this.run.pos.x && near.y === this.run.pos.y) && isPassable(this.world, near.x, near.y);
    const cell = snap ? { x: near.x, y: near.y } : clicked;
    if (cell.x === this.run.pos.x && cell.y === this.run.pos.y) {
      this.clearRoute();
      return;
    }
    const joined = session ? this.routeUnder(session, cell) : null;
    if (session && joined) {
      playSound('ui.click');
      session.say({ op: 'route', dest: joined.dest });
      this.hud?.toast(`You go ${session.nameOf(joined.seat)}'s way.`, 1800);
      return;
    }
    if (!isPassable(this.world, cell.x, cell.y)) {
      this.hud?.toast('Nobody can walk there.', 1800);
      return;
    }
    const route = findRoute(this.world, this.run, cell);
    if (!route || route.length === 0) {
      this.hud?.toast('You cannot find a way there from here.', 2000);
      return;
    }
    playSound('ui.click');
    if (session) {
      session.say({ op: 'route', dest: { x: cell.x, y: cell.y } });
      return;
    }
    this.route = route;
    this.drawRoute();
    this.refresh();
  }

  private clearRoute(): void {
    const session = AdventureSession.current;
    if (session) {
      session.say({ op: 'route', dest: null });
      return;
    }
    this.route = null;
    this.fx?.clearRoute();
    this.refresh();
  }

  /** The planned route, with a diamond where each stop on the way will fall. */
  private drawRoute(): void {
    const route = this.route;
    if (!route) {
      this.fx?.clearRoute();
      return;
    }
    this.drawCells(route, stopsAlong(this.run, route.length));
  }

  private drawCells(cells: readonly Cell[], stops: readonly number[]): void {
    const mask = unpackExplored(this.run.explored);
    this.fx?.drawRoute(cells, stops, (cell) => this.tileCenter(cell), (cell) => isExplored(mask, cell.x, cell.y));
    const session = AdventureSession.current;
    const trip = this.trip;
    if (session?.isHost && trip) {
      session.send({
        k: 'x-ahead',
        cells: cells.map((cell) => [cell.x, cell.y]),
        stops,
        trip: { dest: trip.dest, mode: trip.mode, left: trip.left, tiles: trip.tiles },
      });
    }
  }

  /** The trip's line is gone: here, and on every guest's map. */
  private clearTripLine(): void {
    this.fx?.clearRoute();
    const session = AdventureSession.current;
    if (session?.isHost) session.send({ k: 'x-ahead', cells: [], stops: [] });
  }

  /** Guest: the host's trip, as far as it has still to go, with its stops. */
  private followAhead(message: Record<string, unknown>): void {
    const raw = Array.isArray(message.cells) ? message.cells.slice(0, 400) : [];
    const cells = raw.flatMap((entry) => (Array.isArray(entry) && Number.isInteger(entry[0]) && Number.isInteger(entry[1])
      ? [{ x: entry[0] as number, y: entry[1] as number }]
      : []));
    const stops = Array.isArray(message.stops) ? message.stops.filter((stop): stop is number => Number.isInteger(stop)).slice(0, 64) : [];
    const trip = message.trip && typeof message.trip === 'object' ? message.trip as Record<string, unknown> : null;
    const dest = trip?.dest && typeof trip.dest === 'object' ? trip.dest as Record<string, unknown> : null;
    const mode = TRAVEL_ORDER.find((entry) => entry === trip?.mode);
    if (!cells.length || !dest || !Number.isInteger(dest.x) || !Number.isInteger(dest.y) || !mode) {
      this.guestTrip = null;
      this.fx?.clearRoute();
      this.refresh();
      return;
    }
    const mask = unpackExplored(this.run.explored);
    this.fx?.drawRoute(cells, stops, (cell) => this.tileCenter(cell), (cell) => isExplored(mask, cell.x, cell.y));
    this.guestTrip = {
      dest: { x: dest.x as number, y: dest.y as number },
      mode,
      left: typeof trip?.left === 'number' ? Math.max(0, trip.left) : 0,
      tiles: typeof trip?.tiles === 'number' ? Math.max(0, trip.tiles) : cells.length,
    };
    this.refresh();
  }

  private hereTitle(): string {
    return describeTile(this.world, this.run.pos.x, this.run.pos.y);
  }

  /** The town, mine or swamp the party stands on or right beside. */
  private placeHere(): Place | undefined {
    const { x, y } = this.run.pos;
    return placeAt(x, y) ?? placeNear(x, y, PLACE_REACH);
  }

  private refresh(): void {
    this.refreshClock();
    const session = AdventureSession.current;
    const board = session ? this.councilBoard(session) : null;
    if (session && board) {
      this.hud?.setWorldBoard(board, {
        pick: (id) => this.onPanelAction(id),
        look: (id) => session.say({ op: 'hover', mode: id?.startsWith('mode:') ? id.slice(5) as TravelMode : null }),
      });
    } else {
      this.hud?.setWorldPanel(this.worldPanel());
    }
    if (!session) return;
    this.drawPlans(session);
    this.hud?.setCouncil(this.councilLines(session));
    this.showPoll(session);
    this.settlePoll(session);
    this.settleCouncil(session);
  }

  // ---------------------------------------------------------------------------
  //  ONLINE: DECIDING TOGETHER
  // ---------------------------------------------------------------------------

  /** Guest: the host's party is walking right now. */
  private hostWalking(): boolean {
    return this.spectating && (!!this.guestTrip || this.time.now < this.hostWalkingUntil);
  }

  /** The way from where the party stands to `dest`, found once per spot. */
  private routeTo(dest: Spot): Cell[] | null {
    const key = `${this.run.pos.x},${this.run.pos.y}>${dest.x},${dest.y}`;
    if (!this.routeCache.has(key)) {
      if (this.routeCache.size > 64) this.routeCache.clear();
      this.routeCache.set(key, findRoute(this.world, this.run, dest));
    }
    return this.routeCache.get(key) ?? null;
  }

  /** Another player's route running through `cell` (its end included), to be joined. */
  private routeUnder(session: AdventureSession, cell: Cell): { seat: number; dest: Spot } | null {
    const mine = session.council.travel[session.localSeat]?.dest;
    for (const [seat, vote] of session.council.travel.entries()) {
      const dest = vote.dest;
      if (seat === session.localSeat || !dest || (mine && mine.x === dest.x && mine.y === dest.y)) continue;
      if (this.routeTo(dest)?.some((step) => step.x === cell.x && step.y === cell.y)) return { seat, dest };
    }
    return null;
  }

  /** The council changed: follow this player's own plan, redraw everyone's, and act if it is settled. */
  private onCouncil(): void {
    const session = AdventureSession.current;
    if (!session || !this.view) return;
    // Plans made while the party walks are for a spot it has already left.
    if (session.isHost && this.trip && session.council.travel.some((vote) => vote.dest)) {
      clearTravel(session.council);
      session.publishCouncil();
      return;
    }
    if (!this.trip) {
      const dest = session.council.travel[session.localSeat]?.dest;
      this.route = dest ? this.routeTo(dest) : null;
    }
    this.refresh();
  }

  /** One line per destination, however many chose it, with a head for each of them at its end. */
  private drawPlans(session: AdventureSession): void {
    if (!this.view) return;
    this.plans ??= new PlanMarks(this, 21.2);
    const groups = new Map<string, { dest: Spot; seats: number[] }>();
    if (!this.trip && !this.hostWalking()) {
      session.council.travel.forEach((vote, seat) => {
        if (!vote.dest) return;
        const key = `${vote.dest.x},${vote.dest.y}`;
        const group = groups.get(key) ?? { dest: vote.dest, seats: [] };
        group.seats.push(seat);
        groups.set(key, group);
      });
    }
    const lines = [...groups.values()].flatMap(({ dest, seats }) => {
      const cells = this.routeTo(dest);
      if (!cells?.length) return [];
      return [{
        seat: seats[0],
        cells,
        stops: stopsAlong(this.run, cells.length),
        mine: seats.includes(session.localSeat),
        heads: seats.map((seat) => {
          const vote = session.council.travel[seat];
          return { seat, name: session.nameOf(seat), pace: vote.mode ? TRAVEL_MODES[vote.mode].label : vote.hover ? `${TRAVEL_MODES[vote.hover].label}?` : '...' };
        }),
      }];
    });
    this.plans.draw(lines, (cell) => this.tileCenter(cell));
  }

  /** The HUD's note of what is being decided, beside the board: whose plans are where. */
  private councilLines(session: AdventureSession): string[] {
    if (this.trip || this.hostWalking()) return [];
    const council = session.council;
    if (!council.travel.some((vote) => vote.dest)) return [];
    return ['PLANS', ...council.travel.map((vote, seat) => {
      const name = seat === session.localSeat ? 'You' : session.nameOf(seat);
      if (!vote.dest) return `${name}: no plan yet`;
      return `${name}: ${describeTile(this.world, vote.dest.x, vote.dest.y)}, ${vote.mode ? TRAVEL_MODES[vote.mode].label : 'no pace yet'}`;
    })];
  }

  /** What still keeps the party from setting out, for the board's last line. */
  private travelStatus(session: AdventureSession): string {
    const council = session.council;
    const me = session.localSeat;
    const mine = council.travel[me];
    const others = council.travel.flatMap((vote, seat) => (seat === me ? [] : [{ vote, name: session.nameOf(seat) }]));
    if (!mine?.dest) {
      const planned = others.filter(({ vote }) => vote.dest);
      return planned.length
        ? `${planned.map(({ name }) => name).join(' and ')} planned a trip.`
        : 'Nobody has planned a trip yet.';
    }
    const same = (vote: TravelVote): boolean => !!vote.dest && vote.dest.x === mine.dest!.x && vote.dest.y === mine.dest!.y;
    const notes = others.flatMap(({ vote, name }) => {
      if (!vote.dest) return [`${name} has no plan yet`];
      if (!same(vote)) return [`${name} wants to go elsewhere`];
      if (!vote.mode) return [`${name} is choosing a pace`];
      if (mine.mode && vote.mode !== mine.mode) return [`${name} chose ${TRAVEL_MODES[vote.mode].label}`];
      return [];
    });
    if (!mine.mode) return notes.length ? `Choose a pace. ${notes.join('; ')}.` : 'Choose a pace.';
    return notes.length ? `Waiting: ${notes.join('; ')}.` : 'Everyone agrees. Setting out...';
  }

  /** Host: act on whatever the party has settled. */
  private settleCouncil(session: AdventureSession): void {
    if (!session.isHost || this.busy || this.trip || this.rising || !this.view || this.hud?.modalOpen) return;
    const council = session.council;
    const trade = council.trade;
    if (trade?.place === 'map' && trade.with != null && trade.ready[trade.by] && trade.ready[trade.with]) {
      const first = session.roster[trade.by];
      const second = session.roster[trade.with];
      const result = first && second ? exchangeItems(this.run, first, second, trade.offers[trade.by], trade.offers[trade.with]) : { ok: false, message: 'A trader is missing.' };
      council.trade = null;
      session.publishCouncil();
      if (result.ok) session.changed();
      session.news(result.message);
    }
    const resting = council.camp?.place === 'map' ? campOutcome(council) : null;
    if (resting) {
      council.camp = null;
      session.publishCouncil();
      const members = resting.flatMap((seat) => session.roster[seat] ?? []);
      void this.shortRest(resting.length === session.size ? null : members, resting.map((seat) => session.nameOf(seat)));
      return;
    }
    const outcome = travelOutcome(council);
    if (outcome.t !== 'go') return;
    clearTravel(council);
    council.camp = null;
    session.publishCouncil();
    const route = findRoute(this.world, this.run, outcome.dest);
    if (!route?.length) {
      this.notify('There is no way there from here after all.', 2400);
      return;
    }
    const allowed = (mode: TravelMode): boolean => planTrip(this.world, this.run, route, mode).allowed;
    const mode = allowed(outcome.mode) ? outcome.mode : TRAVEL_ORDER.find(allowed) ?? 'sprint';
    this.notify(`Setting out: ${TRAVEL_MODES[mode].label} to ${describeTile(this.world, outcome.dest.x, outcome.dest.y)}.`, 3200);
    this.route = route;
    void this.travel(mode);
  }

  /** Put a choice to the party and wait for its answer; alone, just ask. Returns the index chosen. */
  private async askParty(title: string, text: string, options: { label: string; detail: string; enabled: boolean }[]): Promise<number> {
    const session = AdventureSession.current;
    const hud = this.hud;
    if (!session || !hud) {
      if (!hud) return options.length - 1;
      const choice = await hud.choose(title, text, options.map((option, index) => ({ id: String(index), ...option })));
      return Number(choice);
    }
    const id = session.nextPollId();
    openPoll(session.council, id, title, text, options);
    return new Promise((resolve) => {
      this.pollWaiter = { id, resolve };
      session.publishCouncil();
    });
  }

  /** The party's open choice on this screen, votes and all; gone once it is settled. */
  private showPoll(session: AdventureSession): void {
    const poll = session.council.poll;
    if (!poll) {
      this.hud?.showPoll(null);
      return;
    }
    const me = session.localSeat;
    const picks: Record<string, VoteSeat[]> = {};
    poll.votes.forEach((vote, seat) => {
      if (vote == null) return;
      (picks[String(vote)] ??= []).push({ seat, name: session.nameOf(seat) });
    });
    const waiting = poll.votes.flatMap((vote, seat) => (vote == null ? [seat === me ? 'you' : session.nameOf(seat)] : []));
    this.hud?.showPoll({
      title: poll.title,
      text: poll.text,
      rows: poll.options.map((option, index) => ({ id: String(index), label: option.label, detail: option.detail, enabled: option.enabled })),
      picks,
      looks: {},
      mine: poll.votes[me] != null ? String(poll.votes[me]) : null,
      mySeat: me,
      status: waiting.length ? `Waiting for ${waiting.join(', ')}. Most votes wins; ties are random.` : 'Everyone has voted.',
      buttons: [],
      reveal: poll.result ? { key: `${poll.id}`, among: poll.result.tied.map(String), final: String(poll.result.choice) } : null,
    }, { pick: (id) => session.say({ op: 'vote', poll: poll.id, choice: Number(id) }) });
  }

  /** Host: once everyone has voted, the choice is shown on every screen (a tie drawn by lot), then made. */
  private settlePoll(session: AdventureSession): void {
    const waiter = this.pollWaiter;
    const poll = session.council.poll;
    if (!session.isHost || !waiter || !poll || poll.id !== waiter.id || poll.result) return;
    const outcome = pollOutcome(session.council, (n) => Math.floor(Math.random() * n));
    if (!outcome) return;
    poll.result = outcome;
    session.publishCouncil();
    const tied = outcome.tied.length > 1;
    this.time.delayedCall(tied ? POLL_TIE_MS : POLL_SHOW_MS, () => {
      if (this.pollWaiter !== waiter) return;
      this.pollWaiter = null;
      if (session.council.poll === poll) {
        session.council.poll = null;
        session.publishCouncil();
      }
      waiter.resolve(outcome.choice);
    });
  }

  /** Plan the way to `dest` again: alone for this player, online for everyone at once. */
  private planAgain(dest: Cell): void {
    const session = AdventureSession.current;
    if (!session) {
      this.pickTile(dest);
      return;
    }
    if (!session.isHost) return;
    session.council.travel = session.council.travel.map(() => ({ dest: { x: dest.x, y: dest.y }, mode: null, hover: null }));
    session.publishCouncil();
  }

  /** Online: the board beside the map where everyone plans, joins, picks a pace, or answers a call to rest. */
  private councilBoard(session: AdventureSession): VoteBoardModel | null {
    if (this.trip || this.hostWalking()) return null;
    const { run, world } = this;
    const council = session.council;
    const me = session.localSeat;
    const free = !this.busy;
    const who = (seat: number): VoteSeat => ({ seat, name: session.nameOf(seat) });
    const pack = { id: 'pack', label: 'Bag', enabled: true };
    const camp = council.camp?.place === 'map' && !council.camp.resting ? council.camp : null;
    const trade = council.trade?.place === 'map' ? council.trade : null;
    if (trade) return {
      title: 'TRADE',
      text: trade.with == null ? `${session.nameOf(trade.by)} opened a trade.` : `${session.nameOf(trade.by)} and ${session.nameOf(trade.with)} are trading.`,
      rows: [], picks: {}, looks: {}, mine: null, mySeat: me,
      status: trade.with == null ? 'Waiting for another player.' : 'Reviewing offers.',
      buttons: trade.by === me || trade.with === me
        ? [{ id: 'trade-view', label: 'View trade', enabled: true }, { id: 'trade-cancel', label: 'Close trade', enabled: true }, pack]
        : trade.with == null ? [{ id: 'trade-join', label: 'Join trade', enabled: true }, pack] : [pack],
    };
    if (camp) {
      const picks: Record<string, VoteSeat[]> = {};
      camp.answers.forEach((answer, seat) => {
        if (answer) (picks[answer === 'join' ? 'camp-join' : 'camp-refuse'] ??= []).push(who(seat));
      });
      const waiting = camp.answers.flatMap((answer, seat) => (answer ? [] : [seat === me ? 'you' : session.nameOf(seat)]));
      return {
        title: 'SHORT REST',
        text: camp.by === me ? 'You start a short rest. The others can join or keep watch.' : `${session.nameOf(camp.by)} wants a short rest here.`,
        rows: [
          { id: 'camp-join', label: 'Rest too', detail: '', enabled: camp.by !== me },
          { id: 'camp-refuse', label: 'Keep watch', detail: '', enabled: camp.by !== me },
        ],
        picks,
        looks: {},
        mine: camp.answers[me] === 'join' ? 'camp-join' : camp.answers[me] === 'refuse' ? 'camp-refuse' : null,
        mySeat: me,
        status: waiting.length ? `Waiting for ${waiting.join(', ')}.` : 'Everyone has answered.',
        buttons: camp.by === me ? [{ id: 'camp-cancel', label: 'Get back up', enabled: true }, pack] : [pack],
      };
    }
    const vote = council.travel[me];
    const route = vote?.dest ? this.route : null;
    const place = this.placeHere();
    const buttons: VoteRow[] = [];
    let rows: VoteRow[] = [];
    let text = '';
    let title = this.hereTitle();
    const picks: Record<string, VoteSeat[]> = {};
    const looks: Record<string, VoteSeat[]> = {};
    if (vote?.dest && route?.length) {
      const plans = TRAVEL_ORDER.map((mode) => planTrip(world, run, route, mode));
      const stops = stopsAlong(run, route.length).length;
      title = `To ${describeTile(world, vote.dest.x, vote.dest.y)}`;
      text = `${route.length} tiles  \u00b7  ${stops} stop${stops === 1 ? '' : 's'}  \u00b7  ${Math.round(plans[0].known * 100)}% explored`;
      rows = plans.map((plan) => ({
        id: `mode:${plan.mode}`,
        label: TRAVEL_MODES[plan.mode].label,
        detail: !plan.allowed ? plan.reason ?? 'Not possible' : '',
        enabled: free && plan.allowed,
      }));
      council.travel.forEach((other, seat) => {
        if (!other.dest || other.dest.x !== vote.dest!.x || other.dest.y !== vote.dest!.y) return;
        if (other.mode) (picks[`mode:${other.mode}`] ??= []).push(who(seat));
        else if (other.hover && seat !== me) (looks[`mode:${other.hover}`] ??= []).push(who(seat));
      });
      buttons.push({ id: 'clear', label: 'Clear my route', enabled: true });
    } else {
      if (place && session.isHost) {
        buttons.push({
          id: 'enter',
          label: place.locale || place.dungeon ? `Enter ${place.name}` : `${place.name}: ${place.note ?? 'closed'}`,
          enabled: free && !!(place.locale || place.dungeon),
        });
      }
      if (session.isHost) {
        buttons.push({ id: 'foot', label: 'Explore on Foot', enabled: free });
        buttons.push({ id: 'search', label: 'Search the Area', enabled: free });
      }
      buttons.push({
        id: 'rest',
        label: 'Short Rest',
        enabled: free && !council.camp,
      });
    }
    buttons.push(pack);
    if (!council.trade && !council.camp && !this.route) buttons.push({ id: 'trade', label: 'Set Up Shop', enabled: free });
    return {
      title,
      titleColor: vote?.dest && route?.length ? DEST_HEX : undefined,
      text,
      rows,
      picks,
      looks,
      mine: vote?.mode ? `mode:${vote.mode}` : null,
      mySeat: me,
      status: this.travelStatus(session),
      buttons,
    };
  }

  /** Online board actions: the say every player has. True when `id` was one of them. */
  private councilAction(session: AdventureSession, id: string): boolean {
    if (id.startsWith('mode:')) {
      session.say({ op: 'mode', mode: id.slice(5) as TravelMode });
      return true;
    }
    switch (id) {
      case 'trade':
        session.say({ op: 'trade', place: 'map', at: { ...this.run.pos } });
        void this.hud?.openTrade(session, this.run, 'map');
        return true;
      case 'trade-join':
        session.say({ op: 'trade-join' });
        void this.hud?.openTrade(session, this.run, 'map');
        return true;
      case 'trade-view':
        void this.hud?.openTrade(session, this.run, 'map');
        return true;
      case 'trade-cancel':
        session.say({ op: 'trade-cancel' });
        return true;
      case 'clear':
        session.say({ op: 'route', dest: null });
        return true;
      case 'rest':
        session.say({ op: 'camp', place: 'map', at: { x: this.run.pos.x, y: this.run.pos.y } });
        return true;
      case 'camp-join':
      case 'camp-refuse':
        session.say({ op: 'camp-answer', answer: id === 'camp-join' ? 'join' : 'refuse' });
        return true;
      case 'camp-cancel':
        session.say({ op: 'camp-cancel' });
        return true;
      default:
        return false;
    }
  }

  /** The HUD and the weather only; cheap enough for every step of a trip. */
  private refreshClock(): void {
    const { run } = this;
    const region: RegionId = regionAt(this.world, run.pos.x, run.pos.y);
    const storm = isSandstorm(run);
    const weather = storm ? `Sandstorm over the desert (${Math.ceil(stormHoursLeft(run))} h)` : '';
    const subtitle = [placeAt(run.pos.x, run.pos.y) ? REGIONS[region].name : '', weather].filter(Boolean).join('  ·  ');
    this.hud?.refresh(run, this.hereTitle(), subtitle);
    this.view?.setStorm(storm);
  }

  private worldPanel(): WorldPanel {
    const { run, world } = this;
    const trip = this.trip ?? this.guestTrip;
    if (trip) return this.tripPanel(trip);
    const session = AdventureSession.current;
    if (session) {
      return {
        title: 'ON THE ROAD',
        lines: ['Travelling.'],
        actions: [{ id: 'pack', label: 'Bag', enabled: true }],
        onAction: (id) => this.onPanelAction(id),
      };
    }
    const place = this.placeHere();
    const lines: string[] = [];
    const actions: WorldPanel['actions'] = [];
    if (place) {
      actions.push({
        id: 'enter',
        label: place.locale || place.dungeon ? `Enter ${place.name}` : `${place.name}: ${place.note ?? 'closed'}`,
        enabled: !this.busy && !!(place.locale || place.dungeon),
        tone: 'primary',
      });
    }
    const route = this.route;
    let title = this.hereTitle();
    if (route) {
      const end = route[route.length - 1];
      const plans = TRAVEL_ORDER.map((mode) => planTrip(world, run, route, mode));
      const stops = stopsAlong(run, route.length).length;
      title = `To ${describeTile(world, end.x, end.y)}`;
      lines.push(`${route.length} tiles  \u00b7  ${stops} stop${stops === 1 ? '' : 's'}  \u00b7  ${Math.round(plans[0].known * 100)}% explored`);
      plans.forEach((plan) => actions.push({ id: `mode:${plan.mode}`, label: this.modeLabel(plan), enabled: !this.busy && plan.allowed }));
      actions.push({ id: 'clear', label: 'Clear route', enabled: !this.busy });
    } else {
      actions.push({ id: 'foot', label: 'Explore on Foot', enabled: !this.busy, tone: place ? 'normal' : 'primary' });
      actions.push({
        id: 'search',
        label: 'Search the Area',
        enabled: !this.busy,
      });
      actions.push({
        id: 'rest',
        label: 'Short Rest',
        enabled: !this.busy,
      });
    }
    actions.push({ id: 'pack', label: 'Bag', enabled: !this.busy });
    return {
      title,
      titleColor: route ? DEST_HEX : undefined,
      lines,
      actions,
      onAction: (id) => this.onPanelAction(id),
    };
  }

  private modeLabel(plan: TripPlan): string {
    const rule = TRAVEL_MODES[plan.mode];
    if (!plan.allowed) return `${rule.label}  (${plan.reason ?? 'not possible'})`;
    return rule.label;
  }

  /** The panel on the road: where to, how, and when the party gets in. */
  private tripPanel(trip: Trip): WorldPanel {
    const lines = [TRAVEL_MODES[trip.mode].label, `Arrive ${this.arrivalLabel(trip.left)} (${spanLabel(trip.left)})`];
    return { title: `To ${describeTile(this.world, trip.dest.x, trip.dest.y)}`, titleColor: DEST_HEX, lines, actions: [], onAction: () => undefined };
  }

  /** "18:45", or "day 4, 02:15" when the trip runs past midnight. */
  private arrivalLabel(hours: number): string {
    const arrival = this.run.hour + hours;
    const day = this.run.day + Math.floor(arrival / 24);
    return `${day > this.run.day ? `day ${day}, ` : ''}${clockTime(arrival % 24)}`;
  }

  private onPanelAction(id: string): void {
    if (this.hud?.modalOpen) return;
    if (id === 'pack') {
      void this.openPack();
      return;
    }
    const session = AdventureSession.current;
    if (session && this.councilAction(session, id)) return;
    if (this.busy || this.spectating) return;
    if (id === 'enter') this.enterHere();
    else if (id === 'clear') this.clearRoute();
    else if (id === 'foot') this.exploreOnFoot();
    else if (id === 'search') void this.search();
    else if (id === 'rest') void this.shortRest();
    else if (id.startsWith('mode:')) void this.travel(id.slice(5) as TravelMode);
  }

  // ---------------------------------------------------------------------------
  //  TRAVEL
  // ---------------------------------------------------------------------------

  private stepToken(cell: Cell, ms: number, news?: { reveal: number; day: number; hour: number }): Promise<void> {
    const token = this.token;
    if (!token) return Promise.resolve();
    const session = AdventureSession.current;
    if (session?.isHost) session.send({ k: 'x-step', x: cell.x, y: cell.y, ms, ...news });
    const at = this.tileCenter(cell);
    if (at.x !== token.x) token.setFlipX(at.x < token.x);
    return new Promise((resolve) => {
      this.tweens.add({ targets: token, x: at.x, y: at.y, duration: ms, ease: 'Linear', onComplete: () => resolve() });
    });
  }

  private async travel(mode: TravelMode): Promise<void> {
    const route = this.route;
    if (!route || this.busy || !this.hud) return;
    const plan = planTrip(this.world, this.run, route, mode);
    if (!plan.allowed) {
      this.hud.toast(plan.reason ?? 'You cannot go that way.', 2200);
      return;
    }
    this.busy = true;
    this.run.steps += 1;
    const stops = mode === 'fast' ? rollTrip(this.run, plan) : [];
    if (mode === 'fast' && stops.length === 0) {
      const seen = rollFastSighting(this.world, this.run, plan.steps);
      if (seen) stops.push({ ...seen, kind: 'sighting' });
    }
    saveRun(this.run);
    this.route = null;
    this.trip = { dest: route[route.length - 1], mode, left: plan.hours, tiles: plan.steps.length };
    this.followParty();
    const outcome = await this.walk(plan, stops);
    if (outcome === 'away') return;
    const dest = this.trip?.dest;
    this.trip = null;
    if (outcome === 'replan' && dest) {
      this.halt(dest);
      return;
    }
    this.arrive();
  }

  /** The trip was broken off: stand where the party is and plan the way on again, to be walked however the party likes. */
  private halt(dest: Cell): void {
    saveRun(this.run);
    this.busy = false;
    this.clearTripLine();
    this.refresh();
    this.planAgain(dest);
    this.notify(`Trip to ${describeTile(this.world, dest.x, dest.y)} paused. Pick a pace to continue.`, 4200);
  }

  /** Real time a tile takes: slow enough to watch the day go by, brisker on a road you know. */
  private stepMs(step: TripStep, fast: boolean): number {
    return fast
      ? Phaser.Math.Clamp(step.hours * FAST_STEP_MS.perHour, FAST_STEP_MS.min, FAST_STEP_MS.max)
      : Phaser.Math.Clamp(step.hours * STEP_MS_PER_HOUR, STEP_MS.min, STEP_MS.max);
  }

  private walking(on: boolean): void {
    const token = this.token;
    if (!token) return;
    token.play(on ? MAGE_RUN : MAGE_IDLE, true);
    token.anims.timeScale = on ? 0.72 : 1;
  }

  /** What is left of the trip, with the stops still to come. */
  private drawAhead(plan: TripPlan, from: number): void {
    const cells = plan.steps.slice(from).map((step) => step.cell);
    this.drawCells(cells, this.trip?.mode === 'fast' ? [] : stopsAlong(this.run, cells.length));
  }

  /** Walk a trip tile by tile with a stop at the end of every leg. 'away' once the scene has moved on, 'replan' when the trip was broken off. */
  private async walk(first: TripPlan, stops: readonly TripStop[]): Promise<'away' | 'replan' | 'done'> {
    const trip = this.trip;
    if (!trip) return 'done';
    const fast = trip.mode === 'fast';
    const plan = first;
    let index = 0;
    let nextStop = 0;
    this.drawAhead(plan, 0);
    this.refresh();
    this.walking(true);
    while (index < plan.steps.length) {
      const step = plan.steps[index];
      await this.advance(step, trip.mode);
      if (!this.spectating && bloodmoonDue(this.run)) {
        await this.riseBloodmoon();
        return 'away';
      }
      trip.left = plan.steps.slice(index + 1).reduce((sum, next) => sum + next.hours, 0);
      trip.tiles = plan.steps.length - index - 1;
      const due = !fast && walkStep(this.run, step);
      this.drawAhead(plan, index + 1);
      this.hud?.setWorldPanel(this.worldPanel());
      const stop = fast ? stops[nextStop] : undefined;
      // A stop falling on the arrival still happens, except inside a town's walls.
      const home = index === plan.steps.length - 1 && placeAt(step.cell.x, step.cell.y)?.kind === 'city';
      if (stop && stop.index === index) {
        nextStop += 1;
        this.walking(false);
        const result = await this.handleStop(stop);
        if (result !== 'done') return result;
        this.walking(true);
      } else if (due && !home) {
        const beat = rollBeat(this.world, this.run, step, trip.mode, plan.steps.slice(index + 1).map((next) => next.cell));
        saveRun(this.run);
        if (beat.kind === 'rest') {
          this.walking(false);
          this.think();
          await this.pause(QUIET_STOP_MS);
          this.walking(true);
        } else {
          this.walking(false);
          const result = await this.playBeat(beat);
          if (result !== 'done') return result;
          this.refresh();
          this.walking(true);
        }
      }
      index += 1;
    }
    this.walking(false);
    return 'done';
  }

  /** One tile of walking: the party moves on, the clock turns, the ground is mapped. */
  private async advance(step: TripStep, mode: TravelMode): Promise<void> {
    const token = this.token;
    if (token) this.fx?.step({ x: token.x, y: token.y }, this.tileCenter(step.cell), terrainAt(this.world, step.cell.x, step.cell.y));
    const reveal = step.storm ? 0 : TRAVEL_MODES[mode].reveal;
    const after = { day: this.run.day, hour: this.run.hour };
    advanceHours(after, step.hours);
    await this.stepToken(step.cell, this.stepMs(step, mode === 'fast'), { reveal, ...after });
    this.run.pos = { x: step.cell.x, y: step.cell.y };
    const days = advanceHours(this.run, step.hours);
    if (reveal > 0 && exploreAlong(this.run, [step.cell], reveal)) {
      this.view?.setExplored(unpackExplored(this.run.explored));
    }
    this.refreshClock();
    if (days) {
      this.walking(false);
      await this.hud?.dayShown();
      this.walking(true);
    }
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => this.time.delayedCall(ms, () => resolve()));
  }

  /** A joke over the party on a quiet stop, fitted to the ground, the hour and how the party is faring. */
  private think(): void {
    const { x, y } = this.run.pos;
    const standing = livingMembers(partyOf(this.run));
    void this.fxAll({ what: 'think', text: restThought({
      zone: regionAt(this.world, x, y),
      terrain: terrainAt(this.world, x, y),
      night: isNight(this.run.hour),
      storm: inDesert(this.world, x, y) && isSandstorm(this.run),
      health: Math.min(1, ...standing.map((mage) => mage.hp / Math.max(1, mage.maxHp))),
      bloodmoonIn: hoursToBloodmoon(this.run.day, this.run.hour),
      mode: this.trip?.mode ?? 'sprint',
    }, Math.random) });
  }

  /** A stop on the way. 'replan' when the party went off to something and the trip is to be planned again. */
  private async playBeat(beat: Exclude<Beat, { kind: 'rest' }>): Promise<'away' | 'replan' | 'done'> {
    const fx = this.fx;
    if (!this.hud || !fx) return 'done';
    switch (beat.kind) {
      case 'loot':
        if (beat.find) {
          const loot = rollExploreFindLoot(this.run, beat.zone, beat.find.roll, beat.find.rare, stepDice(this.run, this.run.steps * 7 + 5));
          if (loot) await this.find(loot);
        }
        return 'done';
      case 'fight':
        if (beat.find) {
          const loot = rollExploreFindLoot(this.run, beat.zone, beat.find.roll, beat.find.rare, stepDice(this.run, this.run.steps * 7 + 5));
          if (loot) await this.find(loot);
        }
        await this.ambush(beat.encounter, beat.zone, beat.depth);
        return 'away';
      case 'sighting':
        return this.sightingBeat(beat.sighting);
    }
  }

  /** A find: sparks round the party and what it was. */
  private async find(loot: ExploreFindLoot): Promise<void> {
    const hud = this.hud;
    if (!hud) return;
    void this.fxAll({ what: 'sparkle' });
    playSound('ui.confirm');
    this.notify(loot.left ? `Found ${getItem(loot.item).name}, but nobody can carry it yet.` : loot.message, 3000);
    saveRun(this.run);
    this.refresh();
    if (this.run.pendingLevels > 0 && (await hud.levelUps(this.run, this.actions()))) saveRun(this.run);
    await this.pause(650);
    while (loot.left > 0 && this.hud === hud && this.scene.isActive()) {
      const choice = await hud.choose('BAG FULL',
        `${getItem(loot.item).name}  /  ${getItem(loot.item).weight} kg. Drop something to take it.`, [
          { id: 'pack', label: 'Open bag', detail: '' },
          { id: 'leave', label: 'Leave it', detail: '' },
        ], 'leave');
      if (choice === 'leave') break;
      await hud.openPack(this.run, () => { saveRun(this.run); this.refresh(); }, this.actions(), loot.item);
      loot.left = grantToParty(this.run, loot.item, loot.left);
      if (loot.left === 0) {
        this.notify(`Picked up ${getItem(loot.item).name}.`, 2800);
        saveRun(this.run);
        this.refresh();
      }
    }
  }

  /** Trouble on the road: the foe steps into view, then the fight begins. Now and then it is a scene already under way. */
  private async ambush(encounter: EncounterKind, zone: EncounterZone, depth: number): Promise<void> {
    const foes = rollEncounter(zone, encounter, depth, stepDice(this.run, this.run.steps * 7 + 4));
    const staged = stageScene(zone, encounter, depth, foes, stepDice(this.run, this.run.steps * 7 + 4 + SCENE_SALT), true);
    if (staged) this.notify(staged.label, 2400);
    else this.notify(encounter === 'robbery' ? 'Ambushed on the road!' : `${describeSpawns(foes)} on the road!`, 1800);
    saveRun(this.run);
    await this.fxAll({ what: 'alarm', foe: staged?.figure ?? foes[0] });
    if (staged) this.startCombat(encounter, zone, depth, undefined, staged.label, undefined, staged.fight);
    else this.startCombat(encounter, zone, depth, foes);
  }

  /** Swing the camera so the party and what they spotted both sit above the card. */
  private frameBoth(spot: { x: number; y: number }): Promise<void> {
    const token = this.token;
    if (!token || this.overview) return Promise.resolve();
    const cam = this.cameras.main;
    cam.stopFollow();
    const x = (token.x + spot.x) / 2;
    const y = (token.y + spot.y) / 2 + 80 / cam.zoom;
    return new Promise((resolve) => {
      cam.pan(x, y, 520, 'Sine.easeInOut', true, (_cam: Phaser.Cameras.Scene2D.Camera, progress: number) => {
        if (progress >= 1) resolve();
      });
    });
  }

  /** Something spotted off the way: mark it, say what it is, and walk over if the party means to. */
  private async sightingBeat(sighting: Sighting): Promise<'away' | 'replan' | 'done'> {
    const hud = this.hud;
    const fx = this.fx;
    const trip = this.trip;
    const there = findRoute(this.world, this.run, sighting.cell);
    if (!hud || !fx || !trip || !there || there.length === 0) {
      this.think();
      return 'done';
    }
    // A pack is crept up on from the next tile over, not stood upon.
    const path = sighting.kind === 'pack' && there.length > 1 ? there.slice(0, -1) : there;
    const detourMode = trip.mode === 'fast' ? 'sprint' : trip.mode;
    const toSpot = planTrip(this.world, this.run, path, detourMode);
    const from = there.length > 1 ? there[there.length - 2] : { ...this.run.pos };
    const markId = ++this.beaconSeq;
    await this.fxAll({ what: 'mark', id: markId, kind: sighting.kind, cell: sighting.cell, foe: sighting.spawns?.[0] });
    const beacon = { destroy: (): void => void this.fxAll({ what: 'unmark', id: markId }) };
    playSound('travel.notice');
    await this.fxAll({ what: 'frame', cell: sighting.cell });
    const go = AdventureSession.current
      ? (await this.askParty(`SPOTTED: ${sighting.title.toUpperCase()}`, `${sighting.bearing}. ${sighting.text}`, [
        { label: SIGHTING_GO[sighting.kind], detail: '', enabled: true },
        { label: 'Keep going', detail: '', enabled: true },
      ])) === 0
      : await hud.sighting({
        kind: sighting.kind,
        title: sighting.title,
        bearing: sighting.bearing,
        text: sighting.text,
        go: SIGHTING_GO[sighting.kind],
        pass: 'Keep going',
      });
    void this.fxAll({ what: 'follow' });
    if (!go) {
      beacon.destroy();
      return 'done';
    }
    this.walking(true);
    for (let i = 0; i < toSpot.steps.length; i++) {
      this.drawCells(path.slice(i), []);
      const step = toSpot.steps[i];
      await this.advance(step, detourMode);
      walkStep(this.run, step);
    }
    this.clearTripLine();
    this.walking(false);
    return this.visit(sighting, beacon, from);
  }

  /** At what was spotted: walk in on foot to see to it. */
  private async visit(sighting: Sighting, beacon: { destroy(): void }, from: Cell): Promise<'away' | 'replan'> {
    const trip = this.trip;
    const site = createSite(this.run, sighting, from, trip ? { dest: trip.dest, mode: trip.mode } : undefined);
    beacon.destroy();
    if (site) {
      this.enterSite(site, sighting.cell);
      return 'away';
    }
    return 'replan';
  }

  /** Walk in on foot round the spot: a small area holding what was seen, and whatever else is about. */
  private enterSite(site: EncounterSite, tile: Cell): void {
    this.run.area = { tile: { x: tile.x, y: tile.y }, spent: {}, radius: SITE_RADIUS, site };
    this.run.locale = null;
    this.run.steps += 1;
    this.trip = null;
    saveRun(this.run);
    playSound('ui.confirm');
    this.cameras.main.fadeOut(420, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.stop('LocaleHud');
      this.scene.start('Locale', {
        run: this.run,
        locale: OPEN_WORLD_ID,
        at: siteArrival(tile, site),
        notice: siteIntro(site),
        grace: 2500,
      } satisfies LocaleEntry);
    });
  }

  /** Mark where the trip ended and give the controls back. */
  private arrive(): void {
    const place = placeAt(this.run.pos.x, this.run.pos.y);
    if (place && !this.run.visited.includes(place.id)) this.run.visited.push(place.id);
    // Inside the walls the road starts over.
    if (place?.kind === 'city') this.run.road = emptyRoad();
    saveRun(this.run);
    this.busy = false;
    this.clearTripLine();
    if (place) this.notify(`You reach ${place.name}.`, 2000);
    this.refresh();
  }

  /** Something on the way on a known road. 'away' when the scene has moved on. */
  private async handleStop(stop: TripStop): Promise<'away' | 'replan' | 'done'> {
    const hud = this.hud;
    if (!hud) return 'done';
    if (stop.kind === 'sighting') return this.sightingBeat(stop.sighting);
    if (stop.kind === 'robbery' || stop.kind === 'monsters') {
      await this.ambush(stop.kind, stop.zone, stop.depth);
      return 'away';
    }
    return 'done';
  }

  /** Stay put and search for something in particular. The party's best at it leads; one roll decides. */
  private async search(): Promise<void> {
    const hud = this.hud;
    if (!hud || this.busy) return;
    this.busy = true;
    this.refresh();
    const tile = { ...this.run.pos };
    const site = searchSite(this.run, tile);
    const party = partyOf(this.run);
    const made: { resolution: SearchResolution | null } = { resolution: null };
    if (AdventureSession.current) this.notify('The host is choosing what to search for.', 2600);
    const done = await hud.search({
      place: this.hereTitle(),
      searcher: party.length > 1 ? 'The party' : party[0]?.name ?? 'You',
      hours: SEARCH_HOURS,
      pickedOver: pickedOver(this.run, tile),
      depth: site.depth,
      night: isNight(this.run.hour),
      shelves: searchShelves(this.run, tile, null),
    }, async (choice) => {
      const lead = bestSearcher(this.run, choice.target.category);
      this.run.steps += 1;
      const resolution = resolveSearch(this.run, tile, choice.target, lead?.member ?? null, choice.bonus, stepDice(this.run, this.run.steps * 7 + 3));
      made.resolution = resolution;
      advanceHours(this.run, SEARCH_HOURS);
      saveRun(this.run);
      this.refresh();
      return {
        roll: resolution.roll,
        message: resolution.message,
        offer: resolution.pack ? { go: 'Attack them first', pass: 'Leave them be' } : undefined,
      };
    });
    const resolution = made.resolution;
    if (!done || !resolution) {
      this.busy = false;
      this.refresh();
      return;
    }
    this.notify(`Search for ${done.choice.target.label}: ${resolution.message}`, 3600);
    const pack = resolution.pack;
    if (pack && done.go) {
      await this.fxAll({ what: 'cue', symbol: '!', color: '#ffd070' });
      this.startCombat('monsters', pack.zone, pack.depth, pack.spawns, `${pack.label}. You attack first.`, { kind: 'weapon' });
      return;
    }
    if (resolution.roll.outcome !== 'nothing') {
      void this.fxAll({ what: 'sparkle' });
    }
    await hud.dayShown();
    if (this.run.pendingLevels > 0 && (await hud.levelUps(this.run, this.actions()))) saveRun(this.run);
    saveRun(this.run);
    this.busy = false;
    this.refresh();
  }

  /** An hour or two off your feet where you stand: a quarter of everything back, unless something finds you first. `members` null: everyone standing. */
  private async shortRest(members: MageClass[] | null = null, names?: string[]): Promise<void> {
    const hud = this.hud;
    if (!hud || this.busy) return;
    this.busy = true;
    this.refresh();
    this.run.steps += 1;
    const outcome = takeShortRest(this.run, members, { safe: false, tile: this.run.pos }, stepDice(this.run, this.run.steps * 7 + 2));
    this.notify(members && names ? `${names.join(' and ')} rest${names.length === 1 ? 's' : ''}; the others keep watch.` : 'Short rest.', 1800);
    await this.fxAll({ what: 'rest' });
    advanceHours(this.run, outcome.hours);
    saveRun(this.run);
    this.refresh();
    const ambush = outcome.ambush;
    if (ambush) {
      this.notify(`${spanLabel(outcome.hours)} in: ${outcome.message}`, 2600);
      await this.fxAll({ what: 'alarm', foe: ambush.spawns[0] });
      this.startCombat(ambush.kind, ambush.zone, ambush.depth, ambush.spawns, outcome.message);
      return;
    }
    // Woken by the bloodmoon: it rises on the next free frame.
    if (outcome.bloodmoon) {
      this.notify(outcome.message, 3200);
      this.busy = false;
      this.refresh();
      return;
    }
    playSound('spell.heal');
    void this.fxAll({ what: 'sparkle' });
    this.notify(`${spanLabel(outcome.hours)} of rest. ${outcome.message}`, 4200);
    await hud.dayShown();
    this.busy = false;
    this.refresh();
  }

  private enterHere(): void {
    if (this.busy || this.hud?.modalOpen) return;
    const place = this.placeHere();
    if (!place) return;
    if (place.dungeon) {
      void this.enterDungeon(place.id);
      return;
    }
    if (!place.locale || !resolveLocale(this.run, place.locale)) {
      this.hud?.toast(place.note ?? `${place.name} cannot be entered yet.`, 2400);
      return;
    }
    if (shikigamiRides(this.run)) {
      this.hud?.toast(`${place.name} does not let the Shikigami in.`, 2400);
      return;
    }
    this.busy = true;
    if (!this.run.visited.includes(place.id)) this.run.visited.push(place.id);
    this.run.pos = { x: place.x, y: place.y };
    playSound('ui.confirm');
    this.cameras.main.fadeOut(240, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      saveRun(this.run);
      this.scene.stop('LocaleHud');
      this.scene.start('Locale', { run: this.run, locale: place.locale! } satisfies LocaleEntry);
    });
  }

  private async openPack(): Promise<void> {
    if (!this.hud || this.busy || this.hud.modalOpen) return;
    await this.hud.openPack(this.run, () => {
      saveRun(this.run);
      this.refresh();
    }, this.actions());
    this.refresh();
  }

  private async openMenu(): Promise<void> {
    if (!this.hud || this.busy || this.hud.modalOpen) return;
    const session = AdventureSession.current;
    if (session && !session.isHost) {
      const choice = await this.hud.choose('MENU', 'The host keeps the save.', [
        { id: 'resume', label: 'Resume', detail: '' },
        { id: 'pack', label: 'Bag', detail: '' },
        { id: 'file', label: 'Save to File', detail: '' },
        { id: 'leave', label: 'Leave the Session', detail: 'Everyone returns to the menu. The host keeps the run.' },
      ], 'resume');
      if (choice === 'pack') void this.openPack();
      if (choice === 'file') this.saveToFile();
      if (choice === 'leave') session.end('You left the session.');
      return;
    }
    const choice = await this.hud.choose('PAUSED', '', [
      { id: 'resume', label: 'Resume', detail: '' },
      { id: 'pack', label: 'Bag', detail: '' },
      { id: 'save', label: 'Save Now', detail: '' },
      { id: 'file', label: 'Save to File', detail: '' },
      { id: 'quit', label: 'Save and Quit', detail: session ? 'Everyone returns to the menu.' : '' },
    ], 'resume');
    if (choice === 'pack') void this.openPack();
    if (choice === 'save') this.hud?.toast(saveRun(this.run) ? `Run saved. Day ${this.run.day}.` : 'Saving failed. Use Save to File.', 3200);
    if (choice === 'file') this.saveToFile();
    if (choice === 'quit') {
      saveRun(this.run);
      playSound('ui.back');
      if (session) {
        session.end('The host saved and left. Use Continue Co-op to resume.');
        return;
      }
      this.scene.stop('LocaleHud');
      this.scene.start('Menu');
    }
  }

  /** Download the run as it stands here; a guest's copy is the host's run. */
  private saveToFile(): void {
    downloadRun(this.run, saveSlot() === 'solo' ? 'solo' : 'online');
    this.hud?.toast(`Run saved to a file. Day ${this.run.day}.`, 3200);
  }
}
