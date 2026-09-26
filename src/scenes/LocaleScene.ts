// A walkable place: a town, the open wilds, or on an open-world
// run the whole world. The player walks the map, talks to keepers at their
// doors, searches secrets, sneaks, and meets roaming packs, which hand off to
// GameScene exactly like a road fight.

import Phaser from 'phaser';
import { playMusic, playSound } from '../audio';
import { GAME_HEIGHT, GAME_WIDTH } from '../config/constants';
import type { ExplorationOpening, MatchConfig } from '../config/MatchConfig';
import { getItem, isRangedWeapon, type ItemId } from '../core/Items';
import type { Mage } from '../core/Mage';
import { comboKey, isModifierWord, spellDisplayName, WORDS, type WordId } from '../core/Words';
import { rollAmbush } from '../pve/exploration/ambush';
import { advanceHours, isNight } from '../pve/exploration/clock';
import { inDesert, isSandstorm, STORM_SIGHT, stormHoursLeft } from '../pve/exploration/desert';
import { dungeonCombat, DUNGEONS } from '../pve/exploration/dungeons';
import { grantToMage, partyOf, withParty } from '../pve/exploration/economy';
import { rollEncounter } from '../pve/exploration/encounters';
import { pickEvent } from '../pve/exploration/events';
import { isExplored, packExplored, unpackExplored } from '../pve/exploration/explored';
import {
  BIND_SPEED, FIELD_RULES, fieldCombos, fieldHealAmount, fieldSpellMana, isStraightAttack, MAX_FIELD_WORDS, MELEE_AMBUSH_TILES,
  reachTiles, SNEAK_SIGHT, SNEAK_SPEED, VEIL_SIGHT, type FieldEffect, type FieldRule,
} from '../pve/exploration/fieldWords';
import { rollFind } from '../pve/exploration/finds';
import { resolveLocale, type ResolvedLocale, type Secret, type WildPack } from '../pve/exploration/locales';
import { cellWorldTile, openWorldCell, openWorldMainland, openWorldPace, WORLD_SCALE } from '../pve/exploration/openWorld';
import { MAP_PRICE, questCalm } from '../pve/exploration/quest';
import { stepDice, type ExplorationRun, type MapStyle } from '../pve/exploration/run';
import { saveRun } from '../pve/exploration/save';
import { canSearch, HOURS_PER_TILE, rollSearch, SEARCH_HOURS } from '../pve/exploration/travel';
import { createWorld, describeTile, placeById, regionAt, type Place } from '../pve/exploration/world';
import { ENEMY_DEFS } from '../pve/swamprun';
import { getSpell, setActiveSpellSets } from '../spells/registry';
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
  /** A fresh run: hand over the starter weapon first. */
  starter?: boolean;
}

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
}

const INTERACT_RANGE = 1.45;
const PACK_SPEED = 2.8;
const WORD_KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'];
/** Packs this many tiles away hold still; nobody is there to see them move. */
const PACK_ACTIVE_TILES = 30;
/** On foot across the world the clock runs at one world tile's worth of time per world tile walked. */
const WORLD_HOURS_PER_SECOND = (HOURS_PER_TILE * WALK_SPEED) / WORLD_SCALE;
/** World tiles walked after a fight or an ambush before the next ambush may roll. */
const AMBUSH_COOLDOWN = 3;
/** An ambush turns up this many tiles from the party. */
const AMBUSH_NEAR = 9;
const AMBUSH_FAR = 12;
/** A hunting pack gives up after this long without finding a veiled party, or beyond this many tiles. */
const HUNT_LOST_MS = 2000;
const HUNT_LOST_TILES = 24;

const STARTER_WEAPONS: { id: ItemId; extra?: string }[] = [
  { id: 'travellersDagger' },
  { id: 'quarterstaff' },
  { id: 'huntingBow', extra: '15 arrows' },
  { id: 'apprenticeWand' },
];

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
  private keys?: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd' | 'e' | 'space' | 'enter' | 'i' | 'esc' | 'f' | 'c' | 'g' | 'r', Phaser.Input.Keyboard.Key>;
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
  private starter = false;
  // ---- The whole world on foot ----
  private readonly world = createWorld();
  private worldTile = '';
  /** World tiles still to walk before an ambush may roll. */
  private ambushCooldown = 0;
  private hudAt = 0;
  /** Extra tiles a carried light lets the party notice secrets from. */
  private lightBonus = 0;
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
    this.starter = !!entry.starter;
    // Exploration fights cast from the original catalogue; the field offers the same spells.
    setActiveSpellSets({ original: true });
    const place = resolveLocale(this.run, entry.locale);
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
      !cell ? null : !this.model.blocked(cell.x, cell.y) ? cell : place.world ? openWorldCell(cellWorldTile(cell)) : null;
    const candidates = [settle(entry.at), settle(stored), place.def.spawn].filter((cell): cell is Cell => !!cell);
    const start = candidates.find((cell) => !this.model.blocked(cell.x, cell.y)) ?? place.def.spawn;
    this.walker = new Walker(this, start, this.model.w, this.model.h, (x, y) => this.model.blocked(x, y));

    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.view.worldWidth, this.view.worldHeight);
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
    this.setupFog();
    this.readLeader();
    if (place.world) this.setupWorldOverlays();

    const kb = this.input.keyboard;
    if (kb) {
      this.keys = kb.addKeys({
        up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT',
        w: 'W', a: 'A', s: 'S', d: 'D',
        e: 'E', space: 'SPACE', enter: 'ENTER', i: 'I', esc: 'ESC', f: 'F', c: 'C', g: 'G', r: 'R',
      }) as LocaleScene['keys'];
      this.wordKeys = WORD_KEYS.map((key) => kb.addKey(key));
    }
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => this.onPointer(pointer));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off(Phaser.Input.Events.POINTER_DOWN);
      this.view?.destroy();
      this.view = undefined;
      this.scene.stop('LocaleHud');
    });
    playMusic('menu');
    this.scene.launch('LocaleHud', { owner: this });
  }

  onHudReady(hud: LocaleHudScene): void {
    this.hud = hud;
    this.refreshHud();
    const words = this.words.length ? `1-${this.words.length}: pick words  R: cast     ` : '';
    const ambush = this.packs.length ? 'F: ambush     C: sneak     ' : '';
    const search = this.place.world ? 'G: search     ' : '';
    hud.setHint(`WASD / arrows or click: walk     E: act     ${words}${ambush}${search}I: pack     Esc: menu`);
    this.refreshWordBar();
    void (async () => {
      if (this.starter) await this.chooseStarterWeapon();
      if (this.notice) hud.toast(this.notice, 5200);
      await this.settleLevels();
      this.ready = true;
    })();
  }

  /** A fresh run: every traveller leaves Kerusai armed. */
  private async chooseStarterWeapon(): Promise<void> {
    if (!this.hud) return;
    this.starter = false;
    const pick = await this.hud.choose<ItemId>('CHOOSE A WEAPON', 'Every traveller leaves Kerusai armed.',
      STARTER_WEAPONS.map(({ id, extra }) => {
        const def = getItem(id);
        return { id, label: def.name, detail: `${def.blurb}${extra ? ` Comes with ${extra}.` : ''}` };
      }));
    withParty(this.run, (leader) => {
      grantToMage(leader, pick);
      if (pick === 'huntingBow') leader.arrows += 15;
    });
    this.readLeader();
    this.changed();
  }

  private refreshHud(): void {
    if (this.place.world) {
      const { x, y } = this.run.pos;
      const storm = isSandstorm(this.run) && inDesert(this.world, x, y);
      const weather = storm ? `Sandstorm (${Math.ceil(stormHoursLeft(this.run))} h)` : '';
      this.hud?.refresh(this.run, describeTile(this.world, x, y), [weather, `Mapped ${this.mappedPercent()}%`].filter(Boolean).join('  ·  '));
      return;
    }
    const mapped = this.fog ? `Mapped ${this.mappedPercent()}%` : '';
    const subtitle = [this.place.subtitle, mapped].filter(Boolean).join('  ·  ');
    this.hud?.refresh(this.run, this.place.def.name, subtitle);
  }

  private changed(): void {
    saveRun(this.run);
    this.refreshHud();
  }

  private async settleLevels(): Promise<void> {
    if (!this.hud || this.run.pendingLevels <= 0) return;
    if (await this.hud.levelUps(this.run)) this.changed();
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
      word: this.wordKeys.findIndex((key) => Phaser.Input.Keyboard.JustDown(key)),
    };
    this.view?.stream(this.cameras.main.worldView);
    const walker = this.walker;
    const blocked = !walker || !this.ready || this.leaving || this.busy || !!this.hud?.modalOpen;
    // The press that closed a window still reads as just-down on the first free frame.
    const settling = this.blockedLastFrame;
    this.blockedLastFrame = blocked;
    if (!walker || blocked) {
      walker?.update(delta, { x: 0, y: 0 });
      return;
    }
    if (settling) {
      pressed.act = pressed.pack = pressed.menu = pressed.strike = pressed.sneak = pressed.search = pressed.cast = false;
      pressed.word = -1;
    }
    const steer = {
      x: (keys && (keys.right.isDown || keys.d.isDown) ? 1 : 0) - (keys && (keys.left.isDown || keys.a.isDown) ? 1 : 0),
      y: (keys && (keys.down.isDown || keys.s.isDown) ? 1 : 0) - (keys && (keys.up.isDown || keys.w.isDown) ? 1 : 0),
    };
    walker.update(delta, steer);
    if (this.place.world) this.updateWorld(delta, walker.isMoving);
    this.updateFog();
    this.updatePacks(delta);
    if (this.leaving || this.busy) return;
    this.updateSecrets();
    this.updateStealth();
    this.updateMindView();

    const keeper = this.nearestKeeper();
    const secret = keeper ? null : this.nearestSecret(1.3);
    const exit = keeper || secret ? null : this.model.exitAt(walker.cell.x, walker.cell.y);
    const target = keeper || secret || exit ? null : this.spellTarget();
    const prey = keeper || secret || exit || target ? null : this.preyWithin(this.strikeTiles, !this.strikeRanged);
    this.hud?.setPrompt(
      keeper ? `[E] Talk: ${keeper.name}`
        : secret ? `[E] Search: ${secret.label}`
        : exit ? `[E] ${exit.label}`
        : target ? `[R] ${spellDisplayName(this.picked)}: ${target.pack.label}`
        : prey ? `[F] Ambush: ${prey.pack.label}`
        : null,
    );
    if (pressed.act) {
      if (keeper) void this.openShop(keeper);
      else if (secret) void this.search(secret);
      else if (exit) void this.useExit(exit);
    } else if (pressed.strike) {
      this.strike();
    } else if (pressed.word >= 0) {
      this.pick(pressed.word);
    } else if (pressed.cast) {
      void this.cast();
    } else if (pressed.sneak) {
      this.toggleSneak();
    } else if (pressed.search && this.place.world) {
      void this.searchHere();
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

  private persistPosition(): void {
    const walker = this.walker;
    if (!walker || walker.isMoving) return;
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
    this.busy = true;
    this.walker?.stop();
    this.hud.setPrompt(null);
    const hadMap = this.run.hasMap;
    await this.hud.openShop(this.run, keeper.shop, this.place.def.id, () => this.changed());
    await this.settleLevels();
    this.readLeader();
    this.changed();
    this.busy = false;
    if (!hadMap && this.run.hasMap) await this.offerTravelMap();
  }

  /** A map was just bought: keep walking, or plan trips on it from now on. */
  private async offerTravelMap(): Promise<void> {
    if (!this.hud) return;
    this.busy = true;
    const style = await this.hud.choose<MapStyle>('A MAP OF THE REALM', 'You can switch at any time from the pause menu.', [
      { id: 'travel', label: 'Travel map', detail: 'Click a destination and choose how to travel: Sprint, Sneak, Explore or Fast travel.' },
      { id: 'open', label: 'Keep walking', detail: 'Walk the whole world on foot, as so far.' },
    ]);
    this.busy = false;
    this.setMapStyle(style);
  }

  private async openPack(): Promise<void> {
    if (!this.hud) return;
    this.busy = true;
    this.walker?.stop();
    await this.hud.openPack(this.run, () => this.changed());
    this.readLeader();
    this.changed();
    this.busy = false;
  }

  private async openMenu(): Promise<void> {
    if (!this.hud) return;
    this.busy = true;
    this.walker?.stop();
    const open = this.run.mapStyle === 'open';
    const choice = await this.hud.choose('PAUSED', this.place.world ? 'The world on foot' : this.place.def.name, [
      { id: 'resume', label: 'Resume', detail: this.place.world ? 'Back on the road.' : 'Back to the streets.' },
      { id: 'pack', label: 'Pack', detail: 'Gear, words and stats.' },
      open
        ? {
          id: 'travel',
          label: 'Map: travel map',
          detail: this.run.hasMap ? 'Plan trips on the world map instead of walking them.' : `Needs a map of the realm: ${MAP_PRICE}g at any guild.`,
          enabled: this.run.hasMap,
        }
        : { id: 'open', label: 'Map: open world', detail: 'Walk the whole world on foot instead of planning trips.' },
      { id: 'quit', label: 'Save and Quit', detail: 'Return to the main menu. The run waits here.' },
    ], 'resume');
    this.busy = false;
    if (choice === 'pack') void this.openPack();
    if (choice === 'travel' || choice === 'open') this.setMapStyle(choice);
    if (choice === 'quit') {
      this.leaving = true;
      saveRun(this.run);
      this.scene.stop('LocaleHud');
      this.scene.start('Menu');
    }
  }

  /** Switch how the world is crossed. From the open world itself, go straight to the map. */
  private setMapStyle(style: MapStyle): void {
    if (style === this.run.mapStyle || (style === 'travel' && !this.run.hasMap)) return;
    this.run.mapStyle = style;
    if (!this.place.world) {
      saveRun(this.run);
      this.hud?.toast(style === 'open' ? 'Map: open world once you leave.' : 'Map: travel map once you leave.', 2600);
      return;
    }
    this.leaving = true;
    this.syncWorldTile();
    this.run.locale = null;
    saveRun(this.run);
    this.cameras.main.fadeOut(220, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.stop('LocaleHud');
      this.scene.start('Exploration', { run: this.run, notice: 'Travel map.' } satisfies ExplorationEntry);
    });
  }

  private async search(secret: Secret): Promise<void> {
    if (!this.hud || !this.place.search) return;
    this.busy = true;
    this.walker?.stop();
    const result = this.place.search(this.run, secret);
    if (result.fight) {
      this.hud.toast(result.message, 2400);
      this.busy = false;
      this.startFight(result.fight);
      return;
    }
    if (!this.run.flags.includes(`secret:${secret.id}`)) this.run.flags.push(`secret:${secret.id}`);
    this.secretSprites.get(secret.id)?.destroy();
    this.secretSprites.delete(secret.id);
    playSound('ui.confirm');
    this.hud.toast(result.message, 4200);
    if (result.revealAll) this.revealAll();
    await this.settleLevels();
    this.changed();
    this.busy = false;
  }

  private async useExit(exit: ExitDef): Promise<void> {
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
    if (!this.ready || this.busy || this.leaving || this.hud?.modalOpen || !this.walker) return;
    const cell = { x: Math.floor(pointer.worldX / TILE_PX), y: Math.floor(pointer.worldY / TILE_PX) };
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
    };
    this.packs.push(state);
    return state;
  }

  private removePack(state: PackState): void {
    this.packs = this.packs.filter((other) => other !== state);
    this.mindView?.labels.get(state)?.destroy();
    this.mindView?.labels.delete(state);
    const { sprite, marker } = state;
    marker.destroy();
    this.tweens.add({ targets: sprite, alpha: 0, duration: 420, onComplete: () => sprite.destroy() });
  }

  private updatePacks(delta: number): void {
    const walker = this.walker;
    if (!walker || this.busy) return;
    const dt = Math.min(0.05, delta / 1000);
    const now = this.time.now;
    const sightMul = this.sightMultiplier();
    const veiled = now < this.veilUntil;
    const world = !!this.place.world;
    this.graceMs = Math.max(0, this.graceMs - delta);
    for (const state of [...this.packs]) {
      const dx = walker.x - state.x;
      const dy = walker.y - state.y;
      const distance = Math.hypot(dx, dy) / TILE_PX;
      if (distance > PACK_ACTIVE_TILES && !state.hunting) continue;
      const calm = this.graceMs > 0;
      if (distance < 0.85 && !calm) {
        this.startFight(state.pack);
        return;
      }
      const leash = Math.hypot(state.x - state.homeX, state.y - state.homeY) / TILE_PX;
      const sight = state.pack.sight * sightMul;
      // A pack notices only what it can see; once on the scent it keeps it a while.
      const sees = distance <= sight && (distance < 1.2 || this.clearLine(state.x, state.y - 1, walker.x, walker.y - 1));
      state.sees = sees;
      if (state.hunting) {
        // An ambush runs the party down; only a veil or a long lead shakes it.
        state.lostMs = veiled && !sees ? state.lostMs + delta : 0;
        if (state.lostMs > HUNT_LOST_MS || distance > HUNT_LOST_TILES) {
          this.hud?.toast('You shook them off.', 2000);
          this.removePack(state);
          continue;
        }
        state.chasing = !calm;
      } else {
        const scent = state.chasing && distance <= (world ? sight * 2 : sight * 1.3 + 1);
        const reach = world ? state.pack.sight * 4 : state.pack.sight + 4;
        state.chasing = !calm && leash < reach && (sees || scent);
      }
      const bound = now < state.slowUntil;
      if (bound !== state.bound) {
        state.bound = bound;
        if (bound) state.sprite.setTint(WORDS.bind.color);
        else if (state.restTint == null) state.sprite.clearTint();
        else state.sprite.setTint(state.restTint);
      }
      let tx = state.wanderX;
      let ty = state.wanderY;
      if (state.chasing) {
        tx = walker.x;
        ty = walker.y;
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
        if (feetFit(nx, state.y, this.model.w, this.model.h, blocked)) state.x = nx;
        if (feetFit(state.x, ny, this.model.w, this.model.h, blocked)) state.y = ny;
        state.sprite.setFlipX(state.facesRight ? mx < 0 : mx > 0);
      }
      const anim = len > 2 ? state.runAnim : state.idleAnim;
      if (state.sprite.anims.currentAnim?.key !== anim) state.sprite.play(anim);
      state.sprite.setPosition(Math.round(state.x), Math.round(state.y)).setDepth(state.y);
      state.marker.setPosition(Math.round(state.x), Math.round(state.y - state.lift)).setVisible(state.chasing);
    }
  }

  /** Where an idle pack strolls next: near home, and out in the world along its road if it keeps one. */
  private wanderPoint(state: PackState, world: boolean): { x: number; y: number } {
    const home = { x: Math.floor(state.homeX / TILE_PX), y: Math.floor(state.homeY / TILE_PX) };
    if (world && this.model.def.terrain[home.y]?.[home.x] === '=') {
      for (let tries = 0; tries < 8; tries++) {
        const x = home.x + Math.round((Math.random() - 0.5) * 12);
        const y = home.y + Math.round((Math.random() - 0.5) * 12);
        if (this.model.def.terrain[y]?.[x] === '=') return { x: (x + 0.5) * TILE_PX, y: (y + 0.8) * TILE_PX };
      }
    }
    const angle = Math.random() * Math.PI * 2;
    const radius = TILE_PX * (world ? 4 : 1.5);
    return { x: state.homeX + Math.cos(angle) * radius, y: state.homeY + Math.sin(angle) * radius };
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

  /** Read what the leader carries: words, charges, mana, weapon reach. */
  private readLeader(): void {
    const leader = partyOf(this.run)[0];
    this.leader = leader;
    this.lightBonus = leader?.lightRadius() ? 2 : 0;
    this.words = leader ? leader.loadout.filter((word) => !isModifierWord(word)).slice(0, WORD_KEYS.length) : [];
    this.picked = this.picked.filter((word) => this.words.includes(word));
    const weapon = leader?.activeWeapon();
    this.strikeRanged = !!weapon && isRangedWeapon(weapon);
    this.strikeTiles = weapon && this.strikeRanged ? reachTiles(weapon.rangePx) : MELEE_AMBUSH_TILES;
    this.strikeBlocked = !leader ? 'Nobody can strike.'
      : leader.outOfAmmo() ? 'Out of arrows.'
      : leader.cannotAttack ? 'You cannot attack right now.'
      : null;
    if (leader) void this.readAttacks(leader);
    this.refreshWordBar();
  }

  /** Try each of the leader's spells once to learn which are straight attacks. */
  private async readAttacks(leader: Mage): Promise<void> {
    for (const words of fieldCombos(this.words)) {
      const key = comboKey(words);
      if (this.attacks.has(key)) continue;
      const spell = getSpell(words, leader.mageClass);
      this.attacks.set(key, !!spell && (await isStraightAttack(spell, leader.mageClass)));
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
    const spell = getSpell(words, leader.mageClass);
    if (!spell) return `${name}: no such spell`;
    const attack = this.attacks.get(comboKey(words));
    if (attack !== true) return attack === false ? `${name}: no effect outside a fight` : name;
    return `${name}: attack, reach ${Math.round(reachTiles(spell.range))}${cost}`;
  }

  /** Fade the leader while veiled or sneaking, and keep the veil's countdown fresh. */
  private updateStealth(): void {
    const walker = this.walker;
    if (!walker) return;
    const veiled = this.time.now < this.veilUntil;
    const alpha = veiled ? 0.45 : this.sneaking ? 0.7 : 1;
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
    const spell = getSpell(this.picked, leader.mageClass);
    return spell ? this.preyWithin(reachTiles(spell.range), false) : null;
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
    if (!words.length) return refuse(`Pick a word first (1-${this.words.length}), then R.`);
    const name = spellDisplayName(words);
    const spent = words.find((word) => (leader.charges[word] ?? 0) <= 0);
    if (spent) return refuse(`${WORDS[spent].label}: no charges left. Rest to restore them.`);
    const mana = fieldSpellMana(leader, words);
    if (!leader.hasMana(mana)) return refuse(`${name}: needs ${mana} mana.`);
    const rule = words.length === 1 ? FIELD_RULES[words[0]] : undefined;
    if (rule) return this.useRule(rule, words[0], mana);
    const spell = getSpell(words, leader.mageClass);
    if (!spell) return refuse(`${name}: no such spell.`);
    if (!(await isStraightAttack(spell, leader.mageClass))) {
      return refuse(`${name}: no effect outside a fight. Only straight attacks work here.`);
    }
    const prey = this.preyWithin(reachTiles(spell.range), false);
    if (!prey) return refuse(`${name}: no pack in reach with a clear line.`);
    this.pay(words, mana);
    this.ambush(prey, { kind: 'spell', words });
  }

  /** Veil, Bind, Mind or Heal spoken alone. */
  private useRule(rule: FieldRule, word: WordId, mana: number): void {
    const walker = this.walker;
    const hud = this.hud;
    if (!walker || !hud) return;
    const refuse = (message: string): void => {
      playSound('ui.deny');
      hud.toast(message, 2200);
    };
    const { color } = WORDS[word];
    const now = this.time.now;
    const seconds = rule.ms / 1000;
    switch (rule.effect) {
      case 'veil':
        this.pay([word], mana);
        this.veilUntil = now + rule.ms;
        this.ring(walker.x, walker.y, 1.4, color);
        hud.toast(`Veil: hidden for ${seconds}s. Packs notice you only up close.`, 2400);
        return;
      case 'bind': {
        const caught = this.packsWithin(rule.range);
        if (!caught.length) return refuse(`Bind: no pack within ${rule.range} tiles.`);
        this.pay([word], mana);
        for (const state of caught) state.slowUntil = now + rule.ms;
        this.ring(walker.x, walker.y, rule.range, color);
        const who = caught.length === 1 ? caught[0].pack.label : `${caught.length} packs`;
        hud.toast(`Bind: ${who} slowed for ${seconds}s.`, 2400);
        return;
      }
      case 'mind':
        if (!this.packsWithin(rule.range).length) return refuse(`Mind: no pack within ${rule.range} tiles.`);
        this.pay([word], mana);
        this.mindUntil = now + rule.ms;
        this.ring(walker.x, walker.y, rule.range, color);
        hud.toast(`Mind: for ${seconds}s you see how far each pack sees and where it is headed.`, 2600);
        return;
      case 'heal': {
        const healed = withParty(this.run, (leader, party) => {
          const hurt = party.filter((m) => m.hp < m.maxHp).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
          if (!hurt) return null;
          const roll = 1 + Math.floor(Math.random() * 6);
          const amount = Math.min(hurt.maxHp - hurt.hp, fieldHealAmount(roll, leader.effectiveInt()));
          hurt.hp += amount;
          leader.spendCharges([word]);
          leader.spendMana(mana);
          return { name: hurt.name, amount };
        });
        if (!healed) return refuse('Heal: the party is at full HP.');
        playSound('ui.confirm');
        this.ring(walker.x, walker.y, 1, color);
        hud.toast(`Heal: ${healed.name} +${healed.amount} HP.`, 2200);
        this.spoke();
        return;
      }
    }
  }

  /** Pay a spell's charges and mana, as a fight would. */
  private pay(words: WordId[], mana: number): void {
    withParty(this.run, (leader) => {
      leader.spendCharges(words);
      leader.spendMana(mana);
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
    this.hud?.toast(`Ambush: ${state.pack.label}.`, 1800);
    this.startFight(state.pack, undefined, undefined, opening);
  }

  /** Packs within `tiles` of the leader, nearest first. */
  private packsWithin(tiles: number): PackState[] {
    const walker = this.walker;
    if (!walker) return [];
    return this.packs
      .map((state) => ({ state, distance: Math.hypot(state.x - walker.x, state.y - walker.y) / TILE_PX }))
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
    const tile = cellWorldTile(this.walker.cell);
    const key = `${tile.x},${tile.y}`;
    if (key === this.worldTile) return;
    const stepped = this.worldTile !== '';
    this.worldTile = key;
    this.run.pos = tile;
    if (!stepped || this.leaving || this.busy || this.graceMs > 0) return;
    if (this.ambushCooldown > 0) {
      this.ambushCooldown -= 1;
      return;
    }
    const cover = { sneaking: this.sneaking, veiled: this.time.now < this.veilUntil };
    const pack = rollAmbush(this.run, tile, cover, WALK_SPEED);
    if (pack) this.spawnAmbush(pack);
  }

  /** Set an ambush down at the edge of sight, somewhere it can run the party down from. */
  private spawnAmbush(pack: WildPack): void {
    const walker = this.walker;
    if (!walker) return;
    const land = openWorldMainland();
    const from = walker.cell;
    for (let tries = 0; tries < 24; tries++) {
      const angle = Math.random() * Math.PI * 2;
      const range = AMBUSH_NEAR + Math.random() * (AMBUSH_FAR - AMBUSH_NEAR);
      const x = Math.round(from.x + Math.cos(angle) * range);
      const y = Math.round(from.y + Math.sin(angle) * range);
      if (x < 0 || y < 0 || x >= this.model.w || y >= this.model.h) continue;
      if (!land[y * this.model.w + x] || this.model.exitAt(x, y)) continue;
      this.addPack({ ...pack, x, y });
      this.ambushCooldown = AMBUSH_COOLDOWN;
      playSound('ui.deny');
      this.hud?.toast(`Ambush: ${pack.label}.`, 2600);
      return;
    }
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

  /** Time passes while the party walks; the storms of the desert follow. */
  private updateWorld(delta: number, moving: boolean): void {
    const walker = this.walker;
    if (!walker) return;
    this.syncWorldTile();
    this.applyPace();
    if (moving && advanceHours(this.run, (delta / 1000) * WORLD_HOURS_PER_SECOND)) this.newDay();
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
    this.hud?.toast(`Day ${this.run.day} dawns.`, 1800);
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

  /** G: stay put and comb the area for two hours, as on the travel map. */
  private async searchHere(): Promise<void> {
    const hud = this.hud;
    if (!hud || !this.walker) return;
    this.syncWorldTile();
    const allowed = canSearch(this.run);
    if (!allowed.allowed) {
      playSound('ui.deny');
      hud.toast(allowed.reason ?? 'Nothing more to find here today.', 2000);
      return;
    }
    this.busy = true;
    this.walker.stop();
    this.run.steps += 1;
    if (advanceHours(this.run, SEARCH_HOURS)) this.newDay();
    const rolled = rollSearch(this.world, this.run);
    const { zone, depth } = rolled;
    const fight = rolled.outcome === 'robbery' || rolled.outcome === 'monsters';
    const outcome = fight && questCalm(this.run, this.run.pos.x, this.run.pos.y) ? 'nothing' : rolled.outcome;
    const dice = stepDice(this.run, this.run.steps * 7 + 4);
    saveRun(this.run);
    this.refreshHud();
    if (outcome === 'robbery' || outcome === 'monsters') {
      const spawns = rollEncounter(zone, outcome, depth, dice);
      hud.toast(outcome === 'robbery' ? 'Search: bandits attack.' : 'Search: something attacks.', 2200);
      this.busy = false;
      this.startFight({ id: `once:search:${this.run.steps}`, x: this.walker.cell.x, y: this.walker.cell.y, sight: 0, depth, spawns, label: 'Attacked while searching.', tint: 0xffffff, zone });
      return;
    }
    if (outcome === 'loot') {
      playSound('ui.confirm');
      hud.toast(rollFind(this.run, zone, depth, dice), 3200);
    } else if (outcome === 'event') {
      const event = pickEvent(zone, dice);
      const ctx = { run: this.run, zone, depth, dice };
      const choice = await hud.choose(event.title, event.text, event.choices.map((c, i) => ({
        id: String(i),
        label: c.label,
        detail: c.detail,
        enabled: !c.available || c.available(ctx),
      })));
      const picked = event.choices[Number(choice)] ?? event.choices[event.choices.length - 1];
      const result = picked.resolve(ctx);
      hud.toast(result.message, 4200);
      if (result.fight) {
        const fight = result.fight;
        const spawns = fight.spawns ?? rollEncounter(zone, fight.encounter, fight.depth, dice);
        this.busy = false;
        this.startFight({
          id: `once:event:${this.run.steps}`, x: this.walker.cell.x, y: this.walker.cell.y, sight: 0, depth: fight.depth,
          spawns, label: fight.label ?? 'A fight.', tint: 0xffffff, zone,
        });
        return;
      }
    } else {
      hud.toast('Search: nothing found.', 2400);
    }
    await this.settleLevels();
    this.changed();
    this.busy = false;
  }

  private startFight(
    pack: WildPack,
    then?: { locale: string; at?: Cell },
    fleeTo?: { locale: string; at?: Cell },
    opening?: ExplorationOpening,
  ): void {
    if (this.leaving) return;
    this.leaving = true;
    const walker = this.walker!;
    const at = then?.at ?? walker.cell;
    const locale = then?.locale ?? this.place.def.id;
    const fleeAt = fleeTo?.at ?? walker.cell;
    this.run.locale = { id: locale, x: at.x, y: at.y };
    if (this.place.world) this.syncWorldTile();
    saveRun(this.run);
    playSound('ui.deny');
    this.cameras.main.shake(180, 0.004);
    this.cameras.main.fadeOut(320, 20, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.stop('LocaleHud');
      this.scene.start('Game', {
        mode: 'exploration',
        loadouts: [[], []],
        exploration: {
          run: this.run,
          encounter: 'monsters',
          depth: pack.depth,
          cameFrom: null,
          zone: pack.zone ?? this.place.zone,
          spawns: pack.spawns,
          returnTo: { id: locale, x: at.x, y: at.y },
          fleeTo: fleeTo ? { id: fleeTo.locale, x: fleeAt.x, y: fleeAt.y } : undefined,
          tag: pack.id.startsWith('once:') ? undefined : pack.id,
          label: pack.label,
          opening,
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
      this.scene.stop('LocaleHud');
      this.scene.start('Game', {
        mode: 'exploration',
        loadouts: [[], []],
        exploration: dungeonCombat(this.run, dungeon, back),
      } satisfies MatchConfig);
    });
  }
}
