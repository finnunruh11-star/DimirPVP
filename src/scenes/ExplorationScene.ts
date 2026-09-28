import Phaser from 'phaser';
import { playMusic, playSound } from '../audio';
import { COLORS, GAME_HEIGHT, GAME_WIDTH } from '../config/constants';
import type { ExplorationOpening, MatchConfig } from '../config/MatchConfig';
import { MAGE_CLASSES } from '../core/Classes';
import type { ItemId } from '../core/Items';
import { Mage } from '../core/Mage';
import { recordKills } from '../pve/exploration/bounties';
import { AREA_HOURS, enterArea, leaveArea, spendAreaTime } from '../pve/exploration/area';
import { advanceHours, clockTime, durationLabel, isNight, spanLabel } from '../pve/exploration/clock';
import { MAX_PARTY } from '../pve/exploration/coop';
import { absoluteHour, isSandstorm, stormHoursLeft } from '../pve/exploration/desert';
import { dungeonCombat, DUNGEONS } from '../pve/exploration/dungeons';
import { grantToMage, money, moneyLabel, partyOf } from '../pve/exploration/economy';
import { describeSpawns, rollEncounter, type EncounterKind, type EncounterSpawn, type EncounterZone } from '../pve/exploration/encounters';
import { bloodmoonCombat, bloodmoonDue, bloodmoonFight, BOSSES, type BossFight } from '../pve/exploration/bloodmoon';
import { pickEvent, ROAD_EVENTS, type RoadEvent } from '../pve/exploration/events';
import { isExplored, unpackExplored } from '../pve/exploration/explored';
import { rollFind } from '../pve/exploration/finds';
import { localActions, type ExplorationActions } from '../pve/exploration/intents';
import {
  emptyRoad,
  LEG_TILES,
  rollBeat,
  stopsAlong,
  walkStep,
  type Beat,
  type Sighting,
  type SightingKind,
} from '../pve/exploration/journey';
import { resolveLocale } from '../pve/exploration/locales';
import { OPEN_WORLD_ID, openWorldCell, siteArrival } from '../pve/exploration/openWorld';
import { capturePartySnapshot } from '../pve/exploration/party';
import { questFightWon } from '../pve/exploration/quest';
import { createRun, stepDice, type ExplorationRun, type LocaleState } from '../pve/exploration/run';
import { clearRun, loadRun, saveRun } from '../pve/exploration/save';
import {
  bestSearcher,
  pickedOver,
  resolveSearch,
  SEARCH_HOURS,
  searchShelves,
  searchSite,
  type SearchResolution,
} from '../pve/exploration/search';
import { shortRestRisk, SHORT_REST_HOURS, takeShortRest } from '../pve/exploration/shortRest';
import { createSite, SITE_RADIUS, siteIntro, type EncounterSite } from '../pve/exploration/site';
import {
  dangerWord,
  exploreAlong,
  findRoute,
  findsWord,
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
  REGIONS,
  regionAt,
  START_PLACE,
  terrainAt,
  type DungeonId,
  type RegionId,
  type WorldMap,
} from '../pve/exploration/world';
import { CabinetButton, MenuFocusGroup } from '../ui/cabinet/controls';
import { AdventureSession, HOST_SEAT } from '../net/AdventureSession';
import { startAdventureFight } from '../net/adventureFight';
import { claimTravellers } from '../net/partySetup';
import { SceneInput } from '../engine/SceneInput';
import { MENU_FONT, MENU_HEX } from '../ui/cabinet/theme';
import { darkness } from '../visuals/daylight';
import { TravelFx } from '../visuals/TravelFx';
import type { BreakSetting } from '../visuals/TravelBreak';
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
}

const ROBBERY_TOLL = 0.25;
const DRAG_SLOP = 8;
/** Real milliseconds a tile takes per hour it costs, and the bounds either side. */
const STEP_MS_PER_HOUR = 1250;
const STEP_MS = { min: 270, max: 700 };
const FAST_STEP_MS = { perHour: 420, min: 90, max: 200 };
/** How quickly the light over the map catches up with the clock. */
const LIGHT_FOLLOW_MS = 170;

/** A share of the purse, rounded down to the silver. */
const silverDown = (value: number): number => Math.floor(value * 10 + 1e-6) / 10;

/** A trip under way: where it is bound, how it is walked and what is still ahead. */
interface Trip {
  dest: Cell;
  mode: TravelMode;
  left: number;
  tiles: number;
}

const SIGHTING_GO: Record<SightingKind, string> = {
  herbs: 'Go and pick it',
  pack: 'Sneak up on them',
  cache: 'Search it',
  event: 'Go and see',
};

/**
 * The overworld. Owns the run, draws the world map, plans and walks trips, and
 * hands off to GameScene for every fight and to LocaleScene for every town,
 * forest and wild.
 */
export class ExplorationScene extends Phaser.Scene implements HudOwner {
  private world: WorldMap = createWorld();
  private run!: ExplorationRun;
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
    if (entry.replan) this.pickTile(entry.replan);
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
        notice: 'On foot. Walking takes no time here; fights, finds, searches and rests do.',
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
          ? `The saved online run has ${saved.party.entities.length} travellers, but ${session.size} players joined.`
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
      notice: `Day 1 in ${town.name}. ${moneyLabel(this.run.gold)} between you, a torch and three potions each. The keeper of the Lodge has work.`,
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
    void this.stepToken({ x, y }, ms);
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
      detail: 'Back to the main menu',
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
      notice: `Day 1 in ${town.name}. ${moneyLabel(this.run.gold)} to your name, a torch and three potions. The keeper of the Lodge has work.`,
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
      this.add.text(GAME_WIDTH / 2, 220, 'A RUN IS ALREADY ON THE ROAD', {
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
      ['Continue', `Pick up at ${where}`, () => {
        root.destroy();
        this.focus.clear();
        this.resumeRun(saved, 'Where you left off.');
      }],
      ['Start Over', 'Abandon that run and set out fresh', () => {
        root.destroy();
        this.focus.clear();
        this.beginFreshRun();
      }],
      ['Back', 'Return to the main menu', () => this.scene.start('Menu')],
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

  /** Fresh travellers with a torch and a few potions each; classes and words are chosen in Kerusai. */
  private buildParty(config?: MatchConfig): ReturnType<typeof capturePartySnapshot> {
    const seats = (config?.seats ?? []).slice(0, MAX_PARTY);
    const count = Math.max(1, seats.length);
    const party = Array.from({ length: count }, (_, index) => {
      const mage = new Mage({
        name: count > 1 ? seats[index]?.name ?? `Player ${index + 1}` : 'Traveller',
        isAI: false,
        team: 1,
        position: { x: 200, y: 240 },
        loadout: [],
        mageClass: MAGE_CLASSES[index],
      });
      mage.assignFlatStats(3);
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
    root.add(this.add.text(GAME_WIDTH / 2, 220, crushed ? 'CRUSHED IN THE MINES' : 'THE PARTY HAS FALLEN', {
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
      detail: 'Set out again from the menu',
      index: '1',
      onActivate: () => {
        if (session) session.end('The party has fallen. The run is over.');
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
    const felled = result.outcome === 'won' && result.boss ? `${BOSSES[result.boss.id].name} is defeated. The bloodmoon sets.` : null;
    const quest = result.outcome === 'won' ? questFightWon(run, result.tag) : null;
    const questNote = quest ? ` ${quest}` : '';

    const back = result.outcome === 'fled' ? result.fleeTo ?? result.returnTo : result.returnTo;
    // On foot a fight costs everyone in the party an hour.
    const onFoot = !!run.area && back?.id === OPEN_WORLD_ID;
    if (onFoot) spendAreaTime(run, run.party.entities.map((entity) => entity.mageClass), AREA_HOURS.fight);
    const took = onFoot ? ` (${spanLabel(AREA_HOURS.fight)})` : '';
    const dungeon = result.dungeon ? DUNGEONS[result.dungeon].name : null;
    const won = dungeon ? `Out of ${dungeon}.${bountyNote}` : `${felled ?? 'The way is clear.'}${took}${bountyNote}${questNote}`;
    const fled = dungeon ? `You fled ${dungeon}.${note}` : `You broke away.${took}${note}`;
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
      : result.outcome === 'fled' ? `You broke away and caught your breath.${note}` : `${felled ?? 'The road is clear again.'}${bountyNote}${questNote}`;
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
    this.fx?.clearRoute();
    saveRun(this.run);
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
    const choice = await hud.choose(def.name.toUpperCase(), def.warning, [
      { id: 'enter', label: 'Go in', detail: dungeon === 'mines' ? 'Into the tunnels.' : 'Depth 1.' },
      { id: 'stay', label: 'Not yet', detail: 'Stay outside.' },
    ], 'stay');
    if (choice !== 'enter') {
      this.busy = false;
      this.refresh();
      return;
    }
    if (!this.run.visited.includes(place.id)) this.run.visited.push(place.id);
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
    cam.setBounds(0, 0, view.width, view.height);
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
      ? 'The host leads the way     Drag: look around     Wheel: zoom     M: map     C: centre     I: pack     Esc: menu'
      : 'Click the map: plan a trip     Drag: look around     Wheel: zoom     M: map     C: centre     I: pack     Esc: menu');
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
      this.refresh();
    })();
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
      if (!drag || drag.moved || this.busy || this.hud?.modalOpen || this.spectating) return;
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
      cam.setBounds(0, 0, view.width, view.height);
      cam.startFollow(this.token, true, 0.15, 0.15);
    }
  }

  private followParty(): void {
    if (!this.token || this.overview) return;
    this.cameras.main.startFollow(this.token, true, 0.15, 0.15);
  }

  private pickTile(cell: Cell): void {
    if (cell.x < 0 || cell.y < 0 || cell.x >= this.world.w || cell.y >= this.world.h) return;
    if (cell.x === this.run.pos.x && cell.y === this.run.pos.y) {
      this.clearRoute();
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
    this.route = route;
    this.drawRoute();
    this.refresh();
  }

  private clearRoute(): void {
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
  }

  private hereTitle(): string {
    return describeTile(this.world, this.run.pos.x, this.run.pos.y);
  }

  private refresh(): void {
    this.refreshClock();
    this.hud?.setWorldPanel(this.worldPanel());
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
    if (this.spectating) {
      return {
        title: this.hereTitle(),
        lines: ['The host leads the way and makes the party\'s choices.'],
        actions: [{ id: 'pack', label: 'Pack', enabled: true }],
        onAction: (id) => this.onPanelAction(id),
      };
    }
    const trip = this.trip;
    if (trip) return this.tripPanel(trip);
    const place = placeAt(run.pos.x, run.pos.y);
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
    if (route) {
      const end = route[route.length - 1];
      const plans = TRAVEL_ORDER.map((mode) => planTrip(world, run, route, mode));
      const stops = stopsAlong(run, route.length).length;
      lines.push(`To ${describeTile(world, end.x, end.y)}`);
      lines.push(`${route.length} tiles, ${stops} stop${stops === 1 ? '' : 's'} on the way, ${Math.round(plans[0].known * 100)}% explored`);
      lines.push(`Leaving now at a sprint: in by ${this.arrivalLabel(plans[0].hours)}.`);
      if (plans[0].storm) lines.push('A sandstorm hides the desert: the way counts as unknown.');
      plans.forEach((plan) => actions.push({ id: `mode:${plan.mode}`, label: this.modeLabel(plan), enabled: !this.busy && plan.allowed }));
      actions.push({ id: 'clear', label: 'Clear route', enabled: !this.busy });
    } else {
      lines.push('Click anywhere on the map to plan a trip,');
      lines.push('or stay and see to the country round you.');
      actions.push({ id: 'foot', label: 'Explore on Foot  walk the country round you', enabled: !this.busy, tone: place ? 'normal' : 'primary' });
      const picked = pickedOver(run, run.pos);
      actions.push({
        id: 'search',
        label: `Search the Area  ${SEARCH_HOURS} h${picked ? `  /  searched today, +${picked} DC` : ''}`,
        enabled: !this.busy,
      });
      const risk = shortRestRisk(run, { safe: false, tile: run.pos });
      actions.push({
        id: 'rest',
        label: `Short Rest  ${SHORT_REST_HOURS.min}-${SHORT_REST_HOURS.max} h  /  ${risk > 0 ? `${Math.round(risk * 100)}% ambush` : 'safe here'}`,
        enabled: !this.busy,
      });
    }
    actions.push({ id: 'pack', label: 'Pack', enabled: !this.busy });
    return {
      title: this.hereTitle(),
      lines,
      actions,
      onAction: (id) => this.onPanelAction(id),
    };
  }

  private modeLabel(plan: TripPlan): string {
    const rule = TRAVEL_MODES[plan.mode];
    if (!plan.allowed) return `${rule.label}  (${plan.reason ?? 'not possible'})`;
    if (plan.mode === 'fast') return `${rule.label}  ${durationLabel(plan.hours)}  /  one roll, danger ${dangerWord(plan.fights)}`;
    return `${rule.label}  ${durationLabel(plan.hours)}  /  danger ${dangerWord(plan.fights)}  /  finds ${findsWord(plan.finds)}`;
  }

  /** The panel on the road: where to, when the next stop falls and when the party gets in. */
  private tripPanel(trip: Trip): WorldPanel {
    const { run, world } = this;
    const lines = [`To ${describeTile(world, trip.dest.x, trip.dest.y)}  ·  ${TRAVEL_MODES[trip.mode].label}`];
    if (trip.mode === 'fast') {
      lines.push('A road you know: no stops on the way.');
    } else {
      const next = Math.max(1, LEG_TILES - run.road.tiles);
      lines.push(next >= trip.tiles
        ? 'No more stops before you arrive.'
        : `Next stop in ${next} tile${next === 1 ? '' : 's'}, then one every ${LEG_TILES}.`);
    }
    lines.push(`About ${spanLabel(trip.left)} to go, in by ${this.arrivalLabel(trip.left)}.`);
    return { title: 'ON THE ROAD', lines, actions: [], onAction: () => undefined };
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

  private stepToken(cell: Cell, ms: number): Promise<void> {
    const token = this.token;
    if (!token) return Promise.resolve();
    const session = AdventureSession.current;
    if (session?.isHost) session.send({ k: 'x-step', x: cell.x, y: cell.y, ms });
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
    this.fx?.clearRoute();
    this.refresh();
    this.pickTile(dest);
    this.notify(`The way on to ${describeTile(this.world, dest.x, dest.y)} is planned again. Choose how to travel, or pick somewhere else.`, 4200);
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
        if ((await this.handleStop(stop)) === 'away') return 'away';
        this.walking(true);
      } else if (due && !home) {
        this.walking(false);
        const beat = rollBeat(this.world, this.run, step, trip.mode, plan.steps.slice(index + 1).map((next) => next.cell));
        saveRun(this.run);
        const result = await this.playBeat(beat);
        if (result !== 'done') return result;
        this.refresh();
        this.walking(true);
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
    await this.stepToken(step.cell, this.stepMs(step, mode === 'fast'));
    this.run.pos = { x: step.cell.x, y: step.cell.y };
    const days = advanceHours(this.run, step.hours);
    const reveal = TRAVEL_MODES[mode].reveal;
    if (reveal > 0 && exploreAlong(this.run, [step.cell], step.storm ? 0 : reveal)) {
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

  /** What a break has to work with where the party stands. */
  private breakSetting(): BreakSetting {
    const { x, y } = this.run.pos;
    let water = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const terrain = terrainAt(this.world, x + dx, y + dy);
      if (terrain === 'water' || terrain === 'ford') water = true;
    }
    return { water, night: isNight(this.run.hour) };
  }

  /** A stop on the way. 'replan' when the party went off to something and the trip is to be planned again. */
  private async playBeat(beat: Beat): Promise<'away' | 'replan' | 'done'> {
    const fx = this.fx;
    if (!this.hud || !fx) return 'done';
    switch (beat.kind) {
      case 'rest':
        await fx.takeBreak(this.breakSetting());
        return 'done';
      case 'loot':
        await this.find(rollFind(this.run, beat.zone, beat.depth, stepDice(this.run, this.run.steps * 7 + 5)));
        return 'done';
      case 'event':
        await fx.cue('?', '#cdb2f2');
        return (await this.runEvent(beat.zone, beat.depth, stepDice(this.run, this.run.steps * 7 + 6))) === 'away' ? 'away' : 'done';
      case 'fight':
        await this.ambush(beat.encounter, beat.zone, beat.depth);
        return 'away';
      case 'sighting':
        return this.sightingBeat(beat.sighting);
    }
  }

  /** A find: sparks round the party and what it was. */
  private async find(message: string): Promise<void> {
    const hud = this.hud;
    if (!hud) return;
    this.fx?.sparkle();
    playSound('ui.confirm');
    this.notify(message, 3000);
    saveRun(this.run);
    this.refresh();
    if (this.run.pendingLevels > 0 && (await hud.levelUps(this.run, this.actions()))) saveRun(this.run);
    await this.pause(650);
  }

  /** Trouble on the road: the foe steps into view, then the fight begins. */
  private async ambush(encounter: EncounterKind, zone: EncounterZone, depth: number): Promise<void> {
    const foes = rollEncounter(zone, encounter, depth, stepDice(this.run, this.run.steps * 7 + 4));
    this.notify(encounter === 'robbery' ? 'Ambushed on the road!' : `${describeSpawns(foes)} on the road!`, 1800);
    saveRun(this.run);
    await this.fx?.alarm(foes[0]);
    this.startCombat(encounter, zone, depth, foes);
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
      await fx?.takeBreak(this.breakSetting());
      return 'done';
    }
    // A pack is crept up on from the next tile over, not stood upon.
    const path = sighting.kind === 'pack' && there.length > 1 ? there.slice(0, -1) : there;
    const toSpot = planTrip(this.world, this.run, path, trip.mode);
    const from = there.length > 1 ? there[there.length - 2] : { ...this.run.pos };
    const beacon = fx.mark(sighting.kind, this.tileCenter(sighting.cell), sighting.spawns?.[0]);
    playSound('travel.notice');
    await this.frameBoth(this.tileCenter(sighting.cell));
    this.notify(`Spotted: ${sighting.title}. The host decides whether to go.`, 3000);
    const go = await hud.sighting({
      kind: sighting.kind,
      title: sighting.title,
      bearing: sighting.bearing,
      text: sighting.text,
      go: SIGHTING_GO[sighting.kind],
      pass: 'Keep going',
    });
    this.followParty();
    if (!go) {
      beacon.destroy();
      return 'done';
    }
    this.walking(true);
    for (let i = 0; i < toSpot.steps.length; i++) {
      this.drawCells(path.slice(i), []);
      const step = toSpot.steps[i];
      await this.advance(step, trip.mode);
      walkStep(this.run, step);
    }
    this.fx?.clearRoute();
    this.walking(false);
    return this.visit(sighting, beacon, from);
  }

  /** At what was spotted: walk in on foot to see to it, or play out the scene. The trip is planned again after. */
  private async visit(sighting: Sighting, beacon: { destroy(): void }, from: Cell): Promise<'away' | 'replan'> {
    const trip = this.trip;
    const site = createSite(this.run, sighting, from, trip ? { dest: trip.dest, mode: trip.mode } : undefined);
    beacon.destroy();
    if (site) {
      this.enterSite(site, sighting.cell);
      return 'away';
    }
    const event = ROAD_EVENTS.find((candidate) => candidate.id === sighting.eventId);
    const dice = stepDice(this.run, this.run.steps * 7 + 3);
    return (await this.runEvent(sighting.zone, sighting.depth, dice, event)) === 'away' ? 'away' : 'replan';
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
    this.fx?.clearRoute();
    if (place) this.notify(`You reach ${place.name}.`, 2000);
    this.refresh();
  }

  /** Something on the way on a known road, or turned up by a search. 'away' when the scene has moved on. */
  private async handleStop(stop: TripStop): Promise<'away' | 'done'> {
    const hud = this.hud;
    if (!hud) return 'done';
    if (stop.kind === 'robbery' || stop.kind === 'monsters') {
      await this.ambush(stop.kind, stop.zone, stop.depth);
      return 'away';
    }
    if (stop.kind === 'loot') {
      await this.find(rollFind(this.run, stop.zone, stop.depth, stepDice(this.run, this.run.steps * 7 + 5 + stop.index)));
      return 'done';
    }
    return this.runEvent(stop.zone, stop.depth, stepDice(this.run, this.run.steps * 7 + 6 + stop.index));
  }

  /** A roadside happening with a choice; the trip's own dice decide it. */
  private async runEvent(zone: EncounterZone, depth: number, dice: ReturnType<typeof stepDice>, chosen?: RoadEvent): Promise<'away' | 'done'> {
    const hud = this.hud;
    if (!hud) return 'done';
    const event = chosen ?? pickEvent(zone, dice);
    const ctx = { run: this.run, zone, depth, dice };
    this.notify(`${event.title}: the host is choosing.`, 3000);
    const choice = await hud.choose(event.title, event.text, event.choices.map((c, i) => ({
      id: String(i),
      label: c.label,
      detail: c.detail,
      enabled: !c.available || c.available(ctx),
    })));
    const picked = event.choices[Number(choice)] ?? event.choices[event.choices.length - 1];
    const result = picked.resolve(ctx);
    saveRun(this.run);
    this.notify(result.message, 4200);
    this.refresh();
    if (result.fight) {
      const fight = result.fight;
      this.time.delayedCall(900, () => this.startCombat(fight.encounter, zone, fight.depth, fight.spawns, fight.label));
      return 'away';
    }
    if (await hud.levelUps(this.run, this.actions())) saveRun(this.run);
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
    this.notify('The party searches the area. The host is choosing what for.', 2600);
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
      await this.fx?.cue('!', '#ffd070');
      this.startCombat('monsters', pack.zone, pack.depth, pack.spawns, `${pack.label}. You fall on them first.`, { kind: 'weapon' });
      return;
    }
    if (resolution.event) {
      await this.fx?.cue('?', '#cdb2f2');
      if ((await this.runEvent(site.zone, site.depth, stepDice(this.run, this.run.steps * 7 + 6))) === 'away') return;
    } else if (resolution.roll.outcome !== 'nothing') {
      this.fx?.sparkle();
    }
    await hud.dayShown();
    if (this.run.pendingLevels > 0 && (await hud.levelUps(this.run, this.actions()))) saveRun(this.run);
    saveRun(this.run);
    this.busy = false;
    this.refresh();
  }

  /** An hour or two off your feet where you stand: a quarter of everything back, unless something finds you first. */
  private async shortRest(): Promise<void> {
    const hud = this.hud;
    if (!hud || this.busy) return;
    this.busy = true;
    this.refresh();
    this.run.steps += 1;
    const outcome = takeShortRest(this.run, null, { safe: false, tile: this.run.pos }, stepDice(this.run, this.run.steps * 7 + 2));
    this.notify('The party makes camp for a short rest.', 1800);
    await this.fx?.rest();
    advanceHours(this.run, outcome.hours);
    saveRun(this.run);
    this.refresh();
    const ambush = outcome.ambush;
    if (ambush) {
      this.notify(`${spanLabel(outcome.hours)} in: ${outcome.message}`, 2600);
      await this.fx?.alarm(ambush.spawns[0]);
      this.startCombat(ambush.kind, ambush.zone, ambush.depth, ambush.spawns, outcome.message);
      return;
    }
    playSound('spell.heal');
    this.fx?.sparkle();
    this.notify(`${spanLabel(outcome.hours)} of rest. ${outcome.message}`, 4200);
    await hud.dayShown();
    this.busy = false;
    this.refresh();
  }

  private enterHere(): void {
    if (this.busy || this.hud?.modalOpen) return;
    const place = placeAt(this.run.pos.x, this.run.pos.y);
    if (!place) return;
    if (place.dungeon) {
      void this.enterDungeon(place.id);
      return;
    }
    if (!place.locale || !resolveLocale(this.run, place.locale)) {
      this.hud?.toast(place.note ?? `${place.name} cannot be entered yet.`, 2400);
      return;
    }
    this.busy = true;
    if (!this.run.visited.includes(place.id)) this.run.visited.push(place.id);
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
      const choice = await this.hud.choose('MENU', 'The host leads the way and keeps the save.', [
        { id: 'resume', label: 'Resume', detail: 'Back to the map.' },
        { id: 'pack', label: 'Pack', detail: 'Gear, words and stats.' },
        { id: 'leave', label: 'Leave the Session', detail: 'Everyone returns to the menu. The host keeps the run.' },
      ], 'resume');
      if (choice === 'pack') void this.openPack();
      if (choice === 'leave') session.end('You left the session.');
      return;
    }
    const choice = await this.hud.choose('PAUSED', 'The run is saved after every step.', [
      { id: 'resume', label: 'Resume', detail: 'Back to the map.' },
      { id: 'pack', label: 'Pack', detail: 'Gear, words and stats.' },
      { id: 'quit', label: 'Save and Quit', detail: session ? 'Everyone returns to the menu; the run waits in your save.' : 'Return to the main menu.' },
    ], 'resume');
    if (choice === 'pack') void this.openPack();
    if (choice === 'quit') {
      saveRun(this.run);
      playSound('ui.back');
      if (session) {
        session.end('The host saved and left. Continue Co-op picks the run back up.');
        return;
      }
      this.scene.stop('LocaleHud');
      this.scene.start('Menu');
    }
  }
}
