import Phaser from 'phaser';
import { playMusic, playSound } from '../audio';
import { COLORS, GAME_HEIGHT, GAME_WIDTH } from '../config/constants';
import type { ExplorationOpening, MatchConfig } from '../config/MatchConfig';
import type { ItemId } from '../core/Items';
import { Mage } from '../core/Mage';
import { recordKills } from '../pve/exploration/bounties';
import { advanceHours, clockTime, durationLabel, spanLabel } from '../pve/exploration/clock';
import { absoluteHour, isSandstorm, stormHoursLeft } from '../pve/exploration/desert';
import { dungeonCombat, DUNGEONS } from '../pve/exploration/dungeons';
import { grantToMage, money, moneyLabel } from '../pve/exploration/economy';
import { describeSpawns, rollEncounter, type EncounterKind, type EncounterSpawn, type EncounterZone } from '../pve/exploration/encounters';
import { pickEvent, ROAD_EVENTS, type RoadEvent } from '../pve/exploration/events';
import { isExplored, unpackExplored } from '../pve/exploration/explored';
import { gatherHerbs, rollCache, rollFind } from '../pve/exploration/finds';
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
import { OPEN_WORLD_ID, openWorldCell } from '../pve/exploration/openWorld';
import { capturePartySnapshot } from '../pve/exploration/party';
import { questFightWon } from '../pve/exploration/quest';
import { createRun, stepDice, type ExplorationRun, type LocaleState } from '../pve/exploration/run';
import { loadRun, saveRun } from '../pve/exploration/save';
import {
  canSearch,
  dangerWord,
  exploreAlong,
  findRoute,
  findsWord,
  planTrip,
  rollSearch,
  rollTrip,
  SEARCH_HOURS,
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
import { SceneInput } from '../engine/SceneInput';
import { MENU_FONT, MENU_HEX } from '../ui/cabinet/theme';
import { darkness } from '../visuals/daylight';
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
}

const DEFEAT_TOLL = 0.2;
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
  herbs: 'Gather it',
  pack: 'Attack first',
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
    // Without a map there is no travel map: the world is walked.
    if (this.run.mapStyle === 'open' || !this.run.hasMap) {
      this.enterOpenWorld(this.notice);
      return;
    }
    this.openOverworld();
  }

  /** Walk the world on foot from wherever the party stands on the map. */
  private enterOpenWorld(notice?: string): void {
    this.run.mapStyle = 'open';
    this.run.locale = null;
    saveRun(this.run);
    this.scene.stop('LocaleHud');
    this.scene.start('Locale', { run: this.run, locale: OPEN_WORLD_ID, at: openWorldCell(this.run.pos), notice } satisfies LocaleEntry);
  }

  private freshSeed(): number {
    return Math.floor(Math.random() * 0xffffffff) >>> 0;
  }

  /** A fresh traveller wakes inside Kerusai with five silver, no map, and work at the Lodge. */
  private beginFreshRun(): void {
    this.run = createRun(this.freshSeed(), this.buildParty(this.pendingConfig));
    saveRun(this.run);
    const town = placeById(START_PLACE)!;
    this.scene.stop('LocaleHud');
    this.scene.start('Locale', {
      run: this.run,
      locale: town.locale ?? town.id,
      starter: true,
      notice: `Day 1 in ${town.name}. ${moneyLabel(this.run.gold)} to your name, a torch, three potions and no map. The keeper of the Lodge has work.`,
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
        if (saved.locale && resolveLocale(saved, saved.locale.id)) {
          this.scene.start('Locale', { run: saved, locale: saved.locale.id, notice: 'Where you left off.' } satisfies LocaleEntry);
          return;
        }
        if (saved.mapStyle === 'open' || !saved.hasMap) {
          this.enterOpenWorld('Where you left off.');
          return;
        }
        this.notice = 'The road is where you left it.';
        this.openOverworld();
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

  /** A fresh traveller: the chosen build, with a torch and a few potions. */
  private buildParty(config?: MatchConfig): ReturnType<typeof capturePartySnapshot> {
    const seat = config?.seats?.[0];
    const mage = new Mage({
      name: seat?.name ?? 'Traveller',
      isAI: false,
      team: 1,
      position: { x: 200, y: 240 },
      loadout: seat?.loadout ?? [],
      mageClass: seat?.mageClass,
    });
    mage.assignFlatStats(3);
    for (const id of ['torch', 'healthPotion', 'healthPotion', 'manaPotion'] as ItemId[]) grantToMage(mage, id);
    return capturePartySnapshot([mage]);
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
      const toll = silverDown(run.gold * DEFEAT_TOLL);
      run.gold = money(run.gold - toll);
      const town = placeById(run.lastTown) ?? placeById(START_PLACE)!;
      run.pos = { x: town.x, y: town.y };
      run.locale = null;
      this.notice = `You were carried back to ${town.name}.${toll > 0 ? ` ${moneyLabel(toll)} went missing on the way.` : ''}`;
      saveRun(run);
      this.scene.start('Locale', { run, locale: town.locale ?? town.id, notice: this.notice } satisfies LocaleEntry);
      return true;
    }

    let note = '';
    if (result.outcome === 'fled' && result.robbery) {
      const toll = silverDown(run.gold * ROBBERY_TOLL);
      run.gold = money(run.gold - toll);
      if (toll > 0) note = ` The bandits took ${moneyLabel(toll)} as you ran.`;
    }
    if (result.outcome === 'won' && result.tag) run.groupsBeaten[result.tag] = run.day;
    const quest = result.outcome === 'won' ? questFightWon(run, result.tag) : null;
    const questNote = quest ? ` ${quest}` : '';

    const back = result.outcome === 'fled' ? result.fleeTo ?? result.returnTo : result.returnTo;
    const dungeon = result.dungeon ? DUNGEONS[result.dungeon].name : null;
    const won = dungeon ? `Out of ${dungeon}.${bountyNote}` : `The way is clear.${bountyNote}${questNote}`;
    const fled = dungeon ? `You fled ${dungeon}.${note}` : `You broke away.${note}`;
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
      : result.outcome === 'fled' ? `You broke away and caught your breath.${note}` : `The road is clear again.${bountyNote}${questNote}`;
    saveRun(run);
    return false;
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
    this.scene.stop('LocaleHud');
    this.scene.start('Game', {
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
      this.scene.stop('LocaleHud');
      this.scene.start('Game', { mode: 'exploration', loadouts: [[], []], exploration: dungeonCombat(this.run, dungeon) } satisfies MatchConfig);
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
    this.scene.launch('LocaleHud', { owner: this });
  }

  onHudReady(hud: LocaleHudScene): void {
    this.hud = hud;
    hud.setHint('Click the map: plan a trip     Drag: look around     Wheel: zoom     M: map     C: centre     I: pack     Esc: menu');
    this.refresh();
    if (this.notice) hud.toast(this.notice, 4200);
    void (async () => {
      if (await hud.levelUps(this.run)) saveRun(this.run);
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
      if (!drag || drag.moved || this.busy || this.hud?.modalOpen) return;
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
      lines.push('Click anywhere on the map to plan a trip.');
    }
    const search = canSearch(run);
    actions.push({
      id: 'search',
      label: search.allowed ? `Search the Area  ${SEARCH_HOURS} h, stay put` : 'Search the Area (done here today)',
      enabled: !this.busy && search.allowed,
    });
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
    if (this.busy || this.hud?.modalOpen) return;
    if (id === 'enter') this.enterHere();
    else if (id === 'clear') this.clearRoute();
    else if (id === 'search') void this.search();
    else if (id === 'pack') void this.openPack();
    else if (id.startsWith('mode:')) void this.travel(id.slice(5) as TravelMode);
  }

  // ---------------------------------------------------------------------------
  //  TRAVEL
  // ---------------------------------------------------------------------------

  private stepToken(cell: Cell, ms: number): Promise<void> {
    const token = this.token;
    if (!token) return Promise.resolve();
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
    if ((await this.walk(plan, stops)) === 'fight') return;
    this.trip = null;
    this.arrive();
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

  /** Walk a trip tile by tile with a stop at the end of every leg. 'fight' once the scene has moved on. */
  private async walk(first: TripPlan, stops: readonly TripStop[]): Promise<'fight' | 'done'> {
    const trip = this.trip;
    if (!trip) return 'done';
    const fast = trip.mode === 'fast';
    let plan = first;
    let index = 0;
    let nextStop = 0;
    this.drawAhead(plan, 0);
    this.refresh();
    this.walking(true);
    while (index < plan.steps.length) {
      const step = plan.steps[index];
      await this.advance(step, trip.mode);
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
        if ((await this.handleStop(stop)) === 'fight') return 'fight';
        this.walking(true);
      } else if (due && !home) {
        this.walking(false);
        const beat = rollBeat(this.world, this.run, step, trip.mode, plan.steps.slice(index + 1).map((next) => next.cell));
        saveRun(this.run);
        const result = await this.playBeat(beat, plan, index);
        if (result === 'fight') return 'fight';
        if (result === 'moved') {
          const onward = findRoute(this.world, this.run, trip.dest);
          if (!onward || onward.length === 0) break;
          plan = planTrip(this.world, this.run, onward, trip.mode);
          trip.left = plan.hours;
          trip.tiles = plan.steps.length;
          index = 0;
          this.drawAhead(plan, 0);
          this.refresh();
          this.walking(true);
          continue;
        }
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

  /** A stop on the way. 'moved' when the party walked off to something and the way on must be found again. */
  private async playBeat(beat: Beat, plan: TripPlan, index: number): Promise<'fight' | 'moved' | 'done'> {
    const fx = this.fx;
    if (!this.hud || !fx) return 'done';
    switch (beat.kind) {
      case 'rest':
        await fx.rest();
        return 'done';
      case 'loot':
        await this.find(rollFind(this.run, beat.zone, beat.depth, stepDice(this.run, this.run.steps * 7 + 5)));
        return 'done';
      case 'event':
        await fx.cue('?', '#cdb2f2');
        return (await this.runEvent(beat.zone, beat.depth, stepDice(this.run, this.run.steps * 7 + 6))) === 'fight' ? 'fight' : 'done';
      case 'fight':
        await this.ambush(beat.encounter, beat.zone, beat.depth);
        return 'fight';
      case 'sighting':
        return this.sightingBeat(beat.sighting, plan, index);
    }
  }

  /** A find: sparks round the party and what it was. */
  private async find(message: string): Promise<void> {
    const hud = this.hud;
    if (!hud) return;
    this.fx?.sparkle();
    playSound('ui.confirm');
    hud.toast(message, 3000);
    saveRun(this.run);
    this.refresh();
    if (this.run.pendingLevels > 0 && (await hud.levelUps(this.run))) saveRun(this.run);
    await this.pause(650);
  }

  /** Trouble on the road: the foe steps into view, then the fight begins. */
  private async ambush(encounter: EncounterKind, zone: EncounterZone, depth: number): Promise<void> {
    const foes = rollEncounter(zone, encounter, depth, stepDice(this.run, this.run.steps * 7 + 4));
    this.hud?.toast(encounter === 'robbery' ? 'Ambushed on the road!' : `${describeSpawns(foes)} on the road!`, 1800);
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
  private async sightingBeat(sighting: Sighting, plan: TripPlan, index: number): Promise<'fight' | 'moved' | 'done'> {
    const hud = this.hud;
    const fx = this.fx;
    const trip = this.trip;
    const there = findRoute(this.world, this.run, sighting.cell);
    if (!hud || !fx || !trip || !there || there.length === 0) {
      await fx?.rest();
      return 'done';
    }
    // A pack is met from the next tile over, not stood upon.
    const path = sighting.kind === 'pack' && there.length > 1 ? there.slice(0, -1) : there;
    const toSpot = planTrip(this.world, this.run, path, trip.mode);
    const onward = findRoute(this.world, this.run, trip.dest, sighting.cell);
    const after = onward ? planTrip(this.world, this.run, onward, trip.mode, sighting.cell).hours : 0;
    const ahead = plan.steps.slice(index + 1).reduce((sum, step) => sum + step.hours, 0);
    const extra = Math.max(0, toSpot.hours + after - ahead);
    const beacon = fx.mark(sighting.kind, this.tileCenter(sighting.cell), sighting.spawns?.[0]);
    playSound('travel.notice');
    await this.frameBoth(this.tileCenter(sighting.cell));
    const go = await hud.sighting({
      kind: sighting.kind,
      title: sighting.title,
      bearing: sighting.bearing,
      text: sighting.text,
      go: `${SIGHTING_GO[sighting.kind]}   +${spanLabel(extra)}`,
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
    return this.visit(sighting, beacon);
  }

  /** At what was spotted: gather it, search it, see to it, or fall on it. */
  private async visit(sighting: Sighting, beacon: { destroy(): void }): Promise<'fight' | 'moved'> {
    const dice = stepDice(this.run, this.run.steps * 7 + 3);
    if (sighting.kind === 'pack') {
      this.hud?.toast('You fall on them before they see you.', 1800);
      saveRun(this.run);
      await this.fx?.cue('!', '#ffd070');
      this.startCombat('monsters', sighting.zone, sighting.depth, sighting.spawns, 'You fall on them before they see you.', { kind: 'weapon' });
      return 'fight';
    }
    beacon.destroy();
    if (sighting.kind === 'event') {
      const event = ROAD_EVENTS.find((candidate) => candidate.id === sighting.eventId);
      return (await this.runEvent(sighting.zone, sighting.depth, dice, event)) === 'fight' ? 'fight' : 'moved';
    }
    const message = sighting.kind === 'cache'
      ? rollCache(this.run, sighting.zone, sighting.depth, dice, sighting.site ?? 'The ruin')
      : sighting.herb ? gatherHerbs(this.run, sighting.herb, dice) : 'Nothing grows there after all.';
    await this.find(message);
    return 'moved';
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
    if (place) this.hud?.toast(`You reach ${place.name}.`, 2000);
    this.refresh();
  }

  /** Something on the way on a known road, or turned up by a search. 'fight' when the scene has moved on. */
  private async handleStop(stop: TripStop): Promise<'fight' | 'done'> {
    const hud = this.hud;
    if (!hud) return 'done';
    if (stop.kind === 'robbery' || stop.kind === 'monsters') {
      await this.ambush(stop.kind, stop.zone, stop.depth);
      return 'fight';
    }
    if (stop.kind === 'loot') {
      await this.find(rollFind(this.run, stop.zone, stop.depth, stepDice(this.run, this.run.steps * 7 + 5 + stop.index)));
      return 'done';
    }
    return this.runEvent(stop.zone, stop.depth, stepDice(this.run, this.run.steps * 7 + 6 + stop.index));
  }

  /** A roadside happening with a choice; the trip's own dice decide it. */
  private async runEvent(zone: EncounterZone, depth: number, dice: ReturnType<typeof stepDice>, chosen?: RoadEvent): Promise<'fight' | 'done'> {
    const hud = this.hud;
    if (!hud) return 'done';
    const event = chosen ?? pickEvent(zone, dice);
    const ctx = { run: this.run, zone, depth, dice };
    const choice = await hud.choose(event.title, event.text, event.choices.map((c, i) => ({
      id: String(i),
      label: c.label,
      detail: c.detail,
      enabled: !c.available || c.available(ctx),
    })));
    const picked = event.choices[Number(choice)] ?? event.choices[event.choices.length - 1];
    const result = picked.resolve(ctx);
    saveRun(this.run);
    hud.toast(result.message, 4200);
    this.refresh();
    if (result.fight) {
      const fight = result.fight;
      this.time.delayedCall(900, () => this.startCombat(fight.encounter, zone, fight.depth, fight.spawns, fight.label));
      return 'fight';
    }
    if (await hud.levelUps(this.run)) saveRun(this.run);
    return 'done';
  }

  /** Stay put and comb the area: one roll, weighted toward finds. */
  private async search(): Promise<void> {
    const hud = this.hud;
    if (!hud || this.busy) return;
    const allowed = canSearch(this.run);
    if (!allowed.allowed) {
      hud.toast(allowed.reason ?? 'Nothing more to find here today.', 2000);
      return;
    }
    this.busy = true;
    this.run.steps += 1;
    advanceHours(this.run, SEARCH_HOURS);
    if (exploreAlong(this.run, [this.run.pos], 2)) this.view?.setExplored(unpackExplored(this.run.explored));
    const { outcome, zone, depth } = rollSearch(this.world, this.run);
    saveRun(this.run);
    this.refresh();
    await hud.dayShown();
    const dice = stepDice(this.run, this.run.steps * 7 + 4);
    if (outcome === 'robbery' || outcome === 'monsters') {
      if ((await this.handleStop({ index: 0, kind: outcome, zone, depth })) === 'fight') return;
    } else if (outcome === 'loot') {
      await this.find(rollFind(this.run, zone, depth, dice));
    } else if (outcome === 'event') {
      if ((await this.runEvent(zone, depth, dice)) === 'fight') return;
    } else {
      hud.toast('Two hours of searching turn up nothing.', 2400);
    }
    saveRun(this.run);
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
    });
    this.refresh();
  }

  private async openMenu(): Promise<void> {
    if (!this.hud || this.busy || this.hud.modalOpen) return;
    const choice = await this.hud.choose('PAUSED', 'The run is saved after every step.', [
      { id: 'resume', label: 'Resume', detail: 'Back to the map.' },
      { id: 'pack', label: 'Pack', detail: 'Gear, words and stats.' },
      { id: 'open', label: 'Map: open world', detail: 'Walk the whole world on foot instead of planning trips.' },
      { id: 'quit', label: 'Save and Quit', detail: 'Return to the main menu.' },
    ], 'resume');
    if (choice === 'pack') void this.openPack();
    if (choice === 'open') this.enterOpenWorld('Open world.');
    if (choice === 'quit') {
      saveRun(this.run);
      playSound('ui.back');
      this.scene.stop('LocaleHud');
      this.scene.start('Menu');
    }
  }
}
