// A walkable place: a town, a forest glade, the open wilds, or on an open-world
// run the whole world. The player walks the map, talks to keepers at their
// doors, searches secrets, sneaks, and meets roaming packs, which hand off to
// GameScene exactly like a road fight.

import Phaser from 'phaser';
import { playMusic, playSound } from '../audio';
import { GAME_HEIGHT, GAME_WIDTH } from '../config/constants';
import type { ExplorationOpening, MatchConfig } from '../config/MatchConfig';
import { isRangedWeapon } from '../core/Items';
import { WORDS, type WordId } from '../core/Words';
import { advanceHours, isNight } from '../pve/exploration/clock';
import {
  absoluteHour, applyHeat, heatFor, inDesert, isSandstorm, partyHeatProof, STORM_SIGHT, stormHoursLeft,
} from '../pve/exploration/desert';
import { partyOf, withParty } from '../pve/exploration/economy';
import { rollEncounter } from '../pve/exploration/encounters';
import { pickEvent } from '../pve/exploration/events';
import { isExplored, packExplored, unpackExplored } from '../pve/exploration/explored';
import {
  BIND_SPEED, FIELD_RULES, fieldHealAmount, fieldWordsFor, MELEE_AMBUSH_TILES, reachTiles, SNEAK_SIGHT, SNEAK_SPEED,
  VEIL_SIGHT, type FieldWord,
} from '../pve/exploration/fieldWords';
import { rollFind } from '../pve/exploration/finds';
import { resolveLocale, type ResolvedLocale, type Secret, type WildPack } from '../pve/exploration/locales';
import { cellWorldTile, WORLD_SCALE } from '../pve/exploration/openWorld';
import { stepDice, type ExplorationRun } from '../pve/exploration/run';
import { saveRun } from '../pve/exploration/save';
import { canSearch, HOURS_PER_TILE, rollSearch, SEARCH_HOURS } from '../pve/exploration/travel';
import { createWorld, describeTile, regionAt } from '../pve/exploration/world';
import { addXp } from '../pve/progression';
import { getSpell } from '../spells/registry';
import { TILE_PX, TILE_SCALE } from '../world/kenney';
import { buildLocaleModel, type ExitDef, type Keeper, type LocaleModel } from '../world/locale';
import { bufferTexture, LocaleView, preloadLocaleAssets } from '../world/localeRender';
import { createMageAnims, MAGE_FIRST_FRAME, MAGE_IDLE, MAGE_RUN, preloadMageFrames } from '../world/mageSprite';
import { floodReach, type Cell } from '../world/pathfind';
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
}

interface PackState {
  pack: WildPack;
  sprite: Phaser.GameObjects.Sprite;
  marker: Phaser.GameObjects.Text;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  wanderX: number;
  wanderY: number;
  chasing: boolean;
  /** Scene time until which Bind holds it to a crawl. */
  slowUntil: number;
  /** Scene time until which Mind keeps it from noticing you. */
  calmUntil: number;
  bound: boolean;
}

const INTERACT_RANGE = 1.45;
const PACK_SPEED = 2.8;
const WORD_KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'];
/** Packs this many tiles away hold still; nobody is there to see them move. */
const PACK_ACTIVE_TILES = 30;
/** On foot across the world the clock runs at one world tile's worth of time per world tile walked. */
const WORLD_HOURS_PER_SECOND = (HOURS_PER_TILE * WALK_SPEED) / WORLD_SCALE;

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
  private keys?: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd' | 'e' | 'space' | 'enter' | 'i' | 'esc' | 'f' | 'c' | 'g', Phaser.Input.Keyboard.Key>;
  private wordKeys: Phaser.Input.Keyboard.Key[] = [];
  /** The leader's words that work out here, and what is left of each. */
  private fieldWords: FieldWord[] = [];
  private charges: Record<string, number> = {};
  /** Weapon reach for an ambush, in tiles, and why it cannot be used (if it cannot). */
  private strikeTiles = MELEE_AMBUSH_TILES;
  private strikeBlocked: string | null = null;
  private veilUntil = 0;
  private barAt = 0;
  private sneaking = false;
  // ---- The whole world on foot ----
  private readonly world = createWorld();
  private worldTile = '';
  private hudAt = 0;
  private heat = 0;
  private heatLost = 0;
  private heatToastAt = 0;
  private heatProof = false;
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
    this.barAt = 0;
    this.sneaking = false;
    this.worldTile = '';
    this.hudAt = 0;
    this.heat = 0;
    this.heatLost = 0;
    this.heatToastAt = 0;
    this.nightShade = undefined;
    this.storm = undefined;
    this.run = entry.run;
    this.notice = entry.notice ?? '';
    this.graceMs = entry.grace ?? 0;
    const place = resolveLocale(this.run, entry.locale);
    if (!place) {
      this.scene.start('Exploration', { run: this.run, notice: 'That place cannot be entered yet.' } satisfies ExplorationEntry);
      return;
    }
    this.place = place;
    this.cameras.main.setBackgroundColor(0x0b0d0a);
    createMageAnims(this);
    this.model = place.model ?? buildLocaleModel(place.def);
    this.view = new LocaleView(this, this.model, { stream: !!place.world });

    const stored = this.run.locale?.id === place.def.id ? this.run.locale : null;
    const candidates = [entry.at, stored, place.def.spawn].filter((cell): cell is Cell => !!cell);
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
        e: 'E', space: 'SPACE', enter: 'ENTER', i: 'I', esc: 'ESC', f: 'F', c: 'C', g: 'G',
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
    const words = this.fieldWords.length ? '1-6: words     ' : '';
    const ambush = this.packs.length ? 'F: ambush     C: sneak     ' : '';
    const search = this.place.world ? 'G: search     ' : '';
    hud.setHint(`WASD / arrows or click: walk     E: act     ${words}${ambush}${search}I: pack     Esc: menu`);
    this.refreshWordBar();
    if (this.notice) hud.toast(this.notice);
    void this.settleLevels().then(() => {
      this.ready = true;
    });
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
      pressed.act = pressed.pack = pressed.menu = pressed.strike = pressed.sneak = pressed.search = false;
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

    const keeper = this.nearestKeeper();
    const secret = keeper ? null : this.nearestSecret(1.3);
    const exit = keeper || secret ? null : this.model.exitAt(walker.cell.x, walker.cell.y);
    const prey = keeper || secret || exit ? null : this.preyWithin(this.strikeTiles);
    this.hud?.setPrompt(
      keeper ? `[E] Talk: ${keeper.name}`
        : secret ? `[E] Search: ${secret.label}`
        : exit ? `[E] ${exit.label}`
        : prey ? `[F] Ambush: ${prey.pack.label}`
        : null,
    );
    if (pressed.act) {
      if (keeper) void this.openShop(keeper);
      else if (secret) void this.search(secret);
      else if (exit) void this.useExit(exit);
    } else if (pressed.strike) {
      this.strike(prey ?? this.preyWithin(this.strikeTiles));
    } else if (pressed.word >= 0) {
      this.speak(pressed.word);
    } else if (pressed.sneak) {
      this.toggleSneak();
    } else if (pressed.search && this.place.world) {
      void this.searchHere();
    } else if (pressed.pack) {
      void this.openPack();
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
    await this.hud.openShop(this.run, keeper.shop, this.place.def.id, () => this.changed());
    await this.settleLevels();
    this.readLeader();
    this.changed();
    this.busy = false;
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
        ? { id: 'travel', label: 'Map: travel map', detail: 'Plan trips on the world map instead of walking them.' }
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
  private setMapStyle(style: 'travel' | 'open'): void {
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
      const x = (pack.x + 0.5) * TILE_PX;
      const y = (pack.y + 0.8) * TILE_PX;
      const sprite = this.add.sprite(x, y, MAGE_FIRST_FRAME).setOrigin(0.5, 0.95)
        .setScale(TILE_SCALE * (pack.elite ? 1.35 : 1.05)).setTint(pack.tint).setDepth(y);
      sprite.play({ key: MAGE_IDLE, startFrame: pack.x % 4 });
      const marker = this.add.text(x, y - TILE_PX * 1.25, pack.elite ? '!!' : '!', {
        fontFamily: 'Georgia, serif',
        fontSize: '22px',
        fontStyle: 'bold',
        color: pack.elite ? '#ff8a5a' : '#ffd070',
        stroke: '#1a0e08',
        strokeThickness: 4,
      }).setOrigin(0.5, 1).setDepth(100000).setVisible(false);
      this.packs.push({
        pack, sprite, marker, x, y, homeX: x, homeY: y, wanderX: x, wanderY: y,
        chasing: false, slowUntil: 0, calmUntil: 0, bound: false,
      });
    }
  }

  private updatePacks(delta: number): void {
    const walker = this.walker;
    if (!walker || this.busy) return;
    const dt = Math.min(0.05, delta / 1000);
    const now = this.time.now;
    const sightMul = this.sightMultiplier();
    this.graceMs = Math.max(0, this.graceMs - delta);
    for (const state of this.packs) {
      const dx = walker.x - state.x;
      const dy = walker.y - state.y;
      const distance = Math.hypot(dx, dy) / TILE_PX;
      if (distance > PACK_ACTIVE_TILES) continue;
      const calm = this.graceMs > 0 || now < state.calmUntil;
      if (distance < 0.85 && !calm) {
        this.startFight(state.pack);
        return;
      }
      const leash = Math.hypot(state.x - state.homeX, state.y - state.homeY) / TILE_PX;
      const sight = state.pack.sight * sightMul;
      // A pack notices only what it can see; once on the scent it keeps it a little longer.
      const sees = distance <= sight && (distance < 1.2 || this.clearLine(state.x, state.y - 1, walker.x, walker.y - 1));
      const scent = state.chasing && distance <= sight * 1.3 + 1;
      state.chasing = !calm && leash < state.pack.sight + 4 && (sees || scent);
      const bound = now < state.slowUntil;
      if (bound !== state.bound) {
        state.bound = bound;
        if (bound) state.sprite.setTint(WORDS.bind.color);
        else state.sprite.setTint(state.pack.tint);
      }
      let tx = state.wanderX;
      let ty = state.wanderY;
      if (state.chasing) {
        tx = walker.x;
        ty = walker.y;
      } else if (Math.hypot(tx - state.x, ty - state.y) < 4) {
        const angle = Math.random() * Math.PI * 2;
        state.wanderX = state.homeX + Math.cos(angle) * TILE_PX * 1.5;
        state.wanderY = state.homeY + Math.sin(angle) * TILE_PX * 1.5;
      }
      const mx = tx - state.x;
      const my = ty - state.y;
      const len = Math.hypot(mx, my);
      if (len > 2) {
        const speed = (state.chasing ? PACK_SPEED : PACK_SPEED * 0.35) * (state.bound ? BIND_SPEED : 1) * TILE_PX * dt;
        const nx = state.x + (mx / len) * speed;
        const ny = state.y + (my / len) * speed;
        const blocked = (x: number, y: number): boolean => this.model.blocked(x, y);
        if (feetFit(nx, state.y, this.model.w, this.model.h, blocked)) state.x = nx;
        if (feetFit(state.x, ny, this.model.w, this.model.h, blocked)) state.y = ny;
        state.sprite.setFlipX(mx < 0);
      }
      const anim = len > 2 ? MAGE_RUN : MAGE_IDLE;
      if (state.sprite.anims.currentAnim?.key !== anim) state.sprite.play(anim);
      state.sprite.setPosition(Math.round(state.x), Math.round(state.y)).setDepth(state.y);
      state.marker.setPosition(Math.round(state.x), Math.round(state.y - TILE_PX * 1.25)).setVisible(state.chasing);
    }
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

  /** Name (and reward) landmarks whose chunk just came out of the fog. */
  private discoverLandmarks(fresh: string[]): void {
    const chunk = this.place.fogChunk ?? 1;
    const flag = (id: string): string => `landmark:${this.place.def.id}:${id}`;
    const found = (this.place.landmarks ?? []).filter((mark) =>
      fresh.includes(`${Math.floor(mark.x / chunk)},${Math.floor(mark.y / chunk)}`) && !this.run.flags.includes(flag(mark.id)));
    if (!found.length) return;
    for (const mark of found) this.run.flags.push(flag(mark.id));
    const xp = 2 * found.length;
    const levels = addXp(this.run, xp);
    playSound('ui.confirm');
    const names = found.length > 2 ? `${found.length} places` : found.map((mark) => mark.name).join(' and ');
    this.hud?.toast(`Discovered ${names}. +${xp} XP${levels ? '. Level up!' : ''}`, 3600);
    if (levels) void this.settleLevels().then(() => this.changed());
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

  /** Read what the leader carries: words that work out here, their charges, weapon reach. */
  private readLeader(): void {
    const party = partyOf(this.run);
    const leader = party[0];
    this.heatProof = partyHeatProof(party);
    this.lightBonus = leader?.lightRadius() ? 2 : 0;
    if (!leader) {
      this.fieldWords = [];
      this.charges = {};
      this.refreshWordBar();
      return;
    }
    this.fieldWords = fieldWordsFor(leader.loadout, (word) => {
      const spell = getSpell([word], leader.mageClass);
      if (!spell || spell.twoPointAim || spell.rotatableWall) return null;
      return spell.targeting === 'enemy' || spell.targeting === 'point' || spell.targeting === 'any' ? spell.range : null;
    });
    this.charges = { ...leader.charges };
    const weapon = leader.activeWeapon();
    this.strikeTiles = weapon && isRangedWeapon(weapon) ? reachTiles(weapon.rangePx) : MELEE_AMBUSH_TILES;
    this.strikeBlocked = leader.outOfAmmo() ? 'Out of arrows.' : leader.cannotAttack ? 'You cannot attack right now.' : null;
    this.refreshWordBar();
  }

  private refreshWordBar(): void {
    if (!this.hud) return;
    const now = this.time.now;
    this.barAt = now;
    const parts = this.fieldWords.slice(0, WORD_KEYS.length).map((entry, index) => {
      const left = this.charges[entry.word] ?? 0;
      const veil = entry.effect === 'veil' && now < this.veilUntil ? ` (${Math.ceil((this.veilUntil - now) / 1000)}s)` : '';
      return `${index + 1} ${WORDS[entry.word].label} ${left}${veil}`;
    });
    const words = parts.length ? `WORDS    ${parts.join('     ')}` : '';
    const text = [this.sneaking ? 'SNEAKING' : '', words].filter(Boolean).join('     |     ');
    this.hud.setWordBar(text || null);
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
    if (this.walker) this.walker.speedMul = this.sneaking ? SNEAK_SPEED : 1;
    playSound('ui.click');
    this.hud?.toast(this.sneaking ? 'Sneaking: packs notice you only up close. Half pace.' : 'Sneaking ended.', 2000);
    this.refreshWordBar();
  }

  /** How much of their usual sight packs have on the party right now. */
  private sightMultiplier(): number {
    const veiled = this.time.now < this.veilUntil;
    return (veiled ? VEIL_SIGHT : 1) * (this.sneaking ? SNEAK_SIGHT : 1) * (this.place.world && this.inStorm() ? STORM_SIGHT : 1);
  }

  /** A pack in reach that has already seen the party, if any. */
  private seenInReach(tiles: number): PackState | null {
    return this.packsWithin(tiles).find((state) => state.chasing) ?? null;
  }

  /** F: spring on the nearest pack within reach of your weapon. */
  private strike(prey: PackState | null): void {
    if (!this.packs.length) return;
    if (this.strikeBlocked) {
      playSound('ui.deny');
      this.hud?.toast(this.strikeBlocked, 1800);
      return;
    }
    if (!prey) {
      playSound('ui.deny');
      const seen = this.seenInReach(this.strikeTiles);
      this.hud?.toast(
        seen ? 'Ambush: they have seen you. Sneak, veil or hide first.' : 'Ambush: no pack in weapon range with a clear line.',
        2200,
      );
      return;
    }
    this.ambush(prey, { kind: 'weapon' });
  }

  /** 1-6: speak one of the leader's words outside a fight. */
  private speak(index: number): void {
    const entry = this.fieldWords[index];
    const walker = this.walker;
    const hud = this.hud;
    if (!entry || !walker || !hud) return;
    const { label, color } = WORDS[entry.word];
    const refuse = (message: string): void => {
      playSound('ui.deny');
      hud.toast(message, 2200);
    };
    if ((this.charges[entry.word] ?? 0) <= 0) return refuse(`${label}: no charges left. Rest to restore them.`);
    const now = this.time.now;
    const ms = FIELD_RULES[entry.word]?.ms ?? 0;
    switch (entry.effect) {
      case 'veil':
        this.veilUntil = now + ms;
        this.spend(entry.word);
        this.ring(walker.x, walker.y, 1.4, color);
        hud.toast(`Veil: hidden for ${ms / 1000}s. Packs notice you only up close.`, 2400);
        return;
      case 'bind': {
        const caught = this.packsWithin(entry.range);
        if (!caught.length) return refuse('Bind: no pack in range.');
        for (const state of caught) state.slowUntil = now + ms;
        this.spend(entry.word);
        this.ring(walker.x, walker.y, entry.range, color);
        const who = caught.length === 1 ? caught[0].pack.label : `${caught.length} packs`;
        hud.toast(`Bind: ${who} slowed for ${ms / 1000}s.`, 2400);
        return;
      }
      case 'mind': {
        const target = this.packsWithin(entry.range)[0];
        if (!target) return refuse('Mind: no pack in range.');
        target.calmUntil = now + ms;
        target.chasing = false;
        this.spend(entry.word);
        this.ring(target.x, target.y, 1.2, color);
        hud.toast(`Mind: ${target.pack.label} ignores you for ${ms / 1000}s.`, 2400);
        return;
      }
      case 'shadow': {
        const spot = this.shadowSpot(entry.range);
        if (!spot) return refuse('Shadow: no free spot in that direction.');
        this.spend(entry.word);
        this.ring(walker.x, walker.y, 0.8, color);
        walker.placeAt(spot.x, spot.y);
        this.ring(spot.x, spot.y, 0.8, color);
        this.updateFog();
        return;
      }
      case 'heal': {
        const healed = withParty(this.run, (leader, party) => {
          const hurt = party.filter((m) => m.hp < m.maxHp).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
          if (!hurt) return null;
          const roll = 1 + Math.floor(Math.random() * 6);
          const amount = Math.min(hurt.maxHp - hurt.hp, fieldHealAmount(roll, leader.effectiveInt()));
          hurt.hp += amount;
          leader.spendCharges(['heal']);
          return { name: hurt.name, amount };
        });
        if (!healed) return refuse('Heal: the party is at full HP.');
        this.charges.heal = Math.max(0, (this.charges.heal ?? 0) - 1);
        playSound('ui.confirm');
        this.ring(walker.x, walker.y, 1, color);
        hud.toast(`Heal: ${healed.name} +${healed.amount} HP.`, 2200);
        this.changed();
        this.refreshWordBar();
        return;
      }
      case 'ambush': {
        const prey = this.preyWithin(entry.range);
        if (!prey) {
          return refuse(this.seenInReach(entry.range)
            ? `${label}: they have seen you. Sneak, veil or hide first.`
            : `${label}: no pack in range with a clear line.`);
        }
        this.spend(entry.word);
        this.ambush(prey, { kind: 'spell', word: entry.word });
        return;
      }
    }
  }

  private spend(word: WordId): void {
    withParty(this.run, (leader) => leader.spendCharges([word]));
    this.charges[word] = Math.max(0, (this.charges[word] ?? 0) - 1);
    playSound('ui.confirm');
    this.changed();
    this.refreshWordBar();
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

  /** The nearest pack within `tiles` that the leader can see and that has not seen the leader. */
  private preyWithin(tiles: number): PackState | null {
    const walker = this.walker;
    if (!walker || !this.packs.length) return null;
    return this.packsWithin(tiles)
      .find((state) => !state.chasing && this.clearLine(walker.x, walker.y - 1, state.x, state.y - 1)) ?? null;
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

  /** The furthest open spot toward the pointer (or straight ahead), no further than `tiles`, still on your side of any wall. */
  private shadowSpot(tiles: number): { x: number; y: number } | null {
    const walker = this.walker!;
    const pointer = this.input.activePointer;
    const aim = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    let dx = aim.x - walker.x;
    let dy = aim.y - walker.y;
    let len = Math.hypot(dx, dy);
    let max = Math.min(tiles * TILE_PX, len);
    if (len < TILE_PX * 0.5) {
      dx = walker.sprite.flipX ? -1 : 1;
      dy = 0;
      len = 1;
      max = tiles * TILE_PX;
    }
    const { w, h } = this.model;
    const blocked = (x: number, y: number): boolean => this.model.blocked(x, y);
    const reach = floodReach(w, h, blocked, walker.cell);
    for (let d = max; d >= TILE_PX * 0.75; d -= TILE_PX / 4) {
      const x = walker.x + (dx / len) * d;
      const y = walker.y + (dy / len) * d;
      if (!feetFit(x, y, w, h, blocked)) continue;
      if (reach[Math.floor((y - 1) / TILE_PX) * w + Math.floor(x / TILE_PX)] !== 1) continue;
      return { x, y };
    }
    return null;
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

  /** Keep the run's world tile under the party's feet. */
  private syncWorldTile(): void {
    if (!this.walker) return;
    const tile = cellWorldTile(this.walker.cell);
    const key = `${tile.x},${tile.y}`;
    if (key === this.worldTile) return;
    this.worldTile = key;
    this.run.pos = tile;
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

  /** Time passes while the party walks; the sun and the storms of the desert follow. */
  private updateWorld(delta: number, moving: boolean): void {
    const walker = this.walker;
    if (!walker) return;
    this.syncWorldTile();
    if (moving) {
      const hours = (delta / 1000) * WORLD_HOURS_PER_SECOND;
      const { x, y } = this.run.pos;
      if (!this.heatProof) this.heat += heatFor(this.world, this.run, x, y, hours, absoluteHour(this.run));
      const days = advanceHours(this.run, hours);
      if (days) this.newDay();
      if (this.heat >= 1) {
        this.heatLost += applyHeat(this.run, this.heat);
        this.heat -= Math.floor(this.heat);
        this.refreshHud();
      }
      if (this.heatLost > 0 && this.time.now - this.heatToastAt > 8000) {
        this.heatToastAt = this.time.now;
        this.hud?.toast(`The desert sun takes ${this.heatLost} HP. Walk by night or wear a stillsuit.`, 2400);
        this.heatLost = 0;
      }
    }
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
    const { x, y } = this.run.pos;
    const burned = this.heatProof ? 0 : applyHeat(this.run, heatFor(this.world, this.run, x, y, SEARCH_HOURS, absoluteHour(this.run)));
    if (advanceHours(this.run, SEARCH_HOURS)) this.newDay();
    const { outcome, zone, depth } = rollSearch(this.world, this.run);
    const dice = stepDice(this.run, this.run.steps * 7 + 4);
    const sun = burned > 0 ? ` The sun takes ${burned} HP.` : '';
    saveRun(this.run);
    this.refreshHud();
    if (outcome === 'robbery' || outcome === 'monsters') {
      const spawns = rollEncounter(zone, outcome, depth, dice);
      hud.toast(`${outcome === 'robbery' ? 'Search: bandits attack.' : 'Search: something attacks.'}${sun}`, 2200);
      this.busy = false;
      this.startFight({ id: `once:search:${this.run.steps}`, x: this.walker.cell.x, y: this.walker.cell.y, sight: 0, depth, spawns, label: 'Attacked while searching.', tint: 0xffffff, zone });
      return;
    }
    if (outcome === 'loot') {
      playSound('ui.confirm');
      hud.toast(`${rollFind(this.run, zone, depth, dice)}${sun}`, 3200);
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
      hud.toast(`Search: nothing found.${sun}`, 2400);
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
}
