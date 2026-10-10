// The Mines as the party walks them: timbered tunnels seen from above, black
// but for the light the party carries. A torch throws a warm, flickering pool
// around the walkers and a cone ahead of them, a lantern a steadier one; without
// either the party gropes along in a faint grey ring. The party walks in single
// file behind the light and the view follows them instead of reframing the map.
// Chalk keeps what has been mapped readable in the dark, and a small map in the
// corner keeps the whole. Traps spring as they were rolled (darts, spikes, a
// blade, rockfall, a cave-in), solid rock turns the party back, and a room is
// entered by closing in on its doorway. Online, every player votes and tokens
// show who wants which way.

import Phaser from 'phaser';
import { playSound, type SoundName } from '../../audio';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config/constants';
import { SceneInput } from '../../engine/SceneInput';
import { mineNodePoint } from '../../pve/mineLayout';
import {
  MINE_DIRECTIONS,
  MINE_DIRECTION_LABEL,
  MINE_DIRECTION_VECTOR,
  MINE_ORE_DEFS,
  MINE_TRAP_NAME,
  type MineDirection,
  type MineMazeNode,
  type MineMazeState,
  type MineOreKind,
  type MineTrapDamage,
} from '../../pve/mineMaze';
import { MINE_ROOM_VISUAL_LABEL, mineRoomIconTextureKey, mineRoomTextureKey, mineTrapIconTextureKey } from '../../scenes/mineVisualTextures';
import { ensureGlowTextures, GLOW } from '../../visuals/glowTextures';
import {
  ensureMineLightTextures,
  MINE_BEAM_ORIGIN,
  MINE_BEAM_REACH,
  MINE_LIGHT,
  MINE_ROUND_RADIUS,
} from '../../visuals/mineLight';
import { CabinetChip, MenuFocusGroup } from '../cabinet/controls';
import { isReducedMotion } from '../cabinet/motion';
import { addCabinetBackdrop, addSectionRule, MENU_COLOR, MENU_FONT, MENU_HEX } from '../cabinet/theme';
import { MineVoteStrip, type MineVoteDisplay, type MineVoteState } from './MineVoteStrip';

type Point = { x: number; y: number };

/** The light a walker carries. */
export type MineLight = 'torch' | 'lantern' | null;

/** One member of the party as the mine shows them. */
export interface MineWalker {
  /** Their player colour: the ring at their feet, matching their vote token. */
  color: number;
  light: MineLight;
  name: string;
  hp: number;
  maxHp: number;
}

export interface MineMapModel {
  title: string;
  status: string;
  maze: MineMazeState;
  /** Where the party stands. */
  current: number;
  /** Junctions the party's map shows; null shows every one. */
  known: ReadonlySet<number> | null;
  /** Mark the entrance and the side exits (the Exploration Mines). */
  markExits: boolean;
  /** The way out from here, if there is one: its button label. */
  leave: string | null;
  /** The routes answer this player's clicks. */
  interactive: boolean;
  hint: string;
  /** A junction just reached: greet it with a pulse. */
  reveal?: number;
  /** The party standing at `current`, the light bearer first. */
  party: MineWalker[];
  /** A fresh window opened from inside a room: pull back out of it. */
  intro?: 'room';
}

export interface MineMapHooks {
  choose(choice: string): void;
  inventory(): void;
  decide(): void;
}

/** A sprung trap as it was rolled, for the walk to play out. */
export interface MineTrapShow {
  kind: MineTrapDamage;
  /** The walker it catches (or misses). */
  target: number;
  /** Their name, for the telling. */
  who: string;
  /** The light gave it away before it sprang. */
  spotted: boolean;
  dodged: boolean;
  damage: number;
  /** The hit is the target's last. */
  fatal: boolean;
  /** It would have been, but full health left them at 1 HP. */
  clung: boolean;
}

export interface MineWalk {
  from: MineMazeNode;
  direction: MineDirection;
  /** Where the tunnel led; absent when it ended in solid rock. */
  to?: MineMazeNode;
  /** A trap springs halfway along. */
  trap?: MineTrapShow;
  /** The party walking, the light bearer first. */
  party: MineWalker[];
}

interface Walker {
  look: MineWalker;
  holder: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Sprite | Phaser.GameObjects.Container;
  ring: Phaser.GameObjects.Ellipse;
  torch?: Phaser.GameObjects.Rectangle;
  /** Their health over their head, drawn over the dark. */
  health: Phaser.GameObjects.Graphics;
  /** Where the feet are, in mine pixels. */
  at: Point;
  /** The way the walker last moved. */
  dir: Point;
  facing: number;
  stride: number;
  steps: number;
  moving: boolean;
  fallen: boolean;
}

/** The party walking in file: each walker down their own path, each a step behind the one before. */
interface FileWalk {
  walkers: Walker[];
  paths: Point[][];
  lengths: number[];
  delays: number[];
  pace: number;
  clock: number;
  speed: number;
  /** While above 0 everyone stands still: a trap is being shown. */
  holds: number;
  watch?: (file: FileWalk) => void;
  finish: () => void;
}

interface LightLook {
  /** The pool of light around the bearer, in pixels. */
  radius: number;
  /** The reach of the cone thrown ahead while walking (0: none). */
  beam: number;
  /** How much of the dark it lifts. */
  lift: number;
  tint: number;
  glow: number;
  /** How hard it flickers. */
  flicker: number;
}

const FRAME = { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 + 8, w: 1000, h: 390 };
/** The window onto the mine, inside the frame's border. */
const VIEW = { x: FRAME.x - FRAME.w / 2 + 1, y: FRAME.y - FRAME.h / 2 + 1, w: FRAME.w - 2, h: FRAME.h - 2 };
/** Pixels to a standard tunnel. */
const UNIT = 144;
/** A tunnel's floor, wall to wall. */
const TUNNEL = 22;
/** The floor of a junction's cavern. */
const CAVERN = 17;
const ROOM_W = 44;
const ROOM_H = 34;
/** How far down an unexplored passage its floor shows, as a share of the tunnel. */
const STUB = 0.42;
/** Junctions drawn around the party, in standard tunnels. */
const DRAW_RADIUS = 5.5;
/** Walking pace, in pixels per millisecond: a standard tunnel in a little over a second. */
const PACE = UNIT / 1150;
/** Room between walkers in the file. */
const SPACING = 19;
/** Where each walker stands at a junction, the light bearer in the middle. */
const HUDDLE: readonly Point[] = [{ x: 0, y: 0 }, { x: -14, y: 7 }, { x: 13, y: 9 }, { x: -1, y: 15 }];

const huddle = (index: number): Point =>
  HUDDLE[index] ?? { x: Math.cos(index * 2.4) * 17, y: 6 + Math.sin(index * 2.4) * 9 };
const ROOM_ZOOM = 2.6;
/** How close the view comes in on a trap as it springs. */
const TRAP_ZOOM = 2.1;
const TRAP_RED = 0xe66d6d;
/** The dark everywhere the light does not reach. */
const DARKNESS = 0.95;

const ROCK = {
  base: 0x0d0a08,
  specks: [0x1b1511, 0x231b15, 0x15100d, 0x2b221a],
  halo: 0x060504,
  wall: 0x3a2d22,
  floor: 0x54412f,
  path: 0x624c38,
  timber: 0x5a3d24,
  post: 0x2e2014,
  rail: 0x85827a,
  sleeper: 0x3a2a1c,
  pebble: 0x7a6a58,
};
const ORE_TINT: Record<MineOreKind, number> = { coal: 0x26262a, copper: 0xc07a48, iron: 0xb9b2aa, gold: 0xe8c45a };
const ORE_SHINE: Record<MineOreKind, number> = { coal: 0xc8d8ff, copper: 0xffb070, iron: 0xe8e0d8, gold: 0xffe080 };

const LIGHTS: Record<'torch' | 'lantern' | 'none', LightLook> = {
  torch: { radius: 186, beam: 330, lift: 1, tint: 0xff8a3a, glow: 0.24, flicker: 1 },
  lantern: { radius: 204, beam: 300, lift: 1, tint: 0xffdca0, glow: 0.17, flicker: 0.25 },
  none: { radius: 80, beam: 0, lift: 0.6, tint: 0x8fa2b8, glow: 0.07, flicker: 0.15 },
};

const hasExit = (node: MineMazeNode, direction: MineDirection): boolean =>
  Object.prototype.hasOwnProperty.call(node.exits, direction);

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

const unit = (a: Point, b: Point): Point => {
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
};

const pathLength = (path: readonly Point[]): number =>
  path.reduce((sum, point, i) => (i ? sum + Math.hypot(point.x - path[i - 1].x, point.y - path[i - 1].y) : 0), 0);

/** Where a walker `d` pixels down a path stands, and which way the path runs there. */
function along(path: readonly Point[], d: number): { at: Point; dir: Point | null } {
  let left = Math.max(0, d);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= length || i === path.length - 1) {
      return {
        at: length > 0 ? lerp(a, b, Math.min(1, left / length)) : { ...b },
        dir: length > 0.01 ? unit(a, b) : null,
      };
    }
    left -= length;
  }
  return { at: { ...path[0] }, dir: null };
}

/** A fixed pseudo-random fraction for (a, b, c): the same rock every time it is drawn. */
function noise(a: number, b: number, c = 0): number {
  let h = Math.imul(a ^ 0x5bd1e995, 0x85ebca6b) ^ Math.imul(b ^ 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c ^ 0x27d4eb2f, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 0x100000000;
}

/** Blend colour `a` towards `b`. */
function blend(a: number, b: number, t: number): number {
  const channel = (shift: number): number =>
    Math.round(((a >> shift) & 0xff) * (1 - t) + ((b >> shift) & 0xff) * t) << shift;
  return channel(16) | channel(8) | channel(0);
}

export class MineMapView extends Phaser.GameObjects.Container implements MineVoteDisplay {
  private readonly sceneInput: SceneInput;
  private readonly focus = new MenuFocusGroup();
  private readonly reduced = isReducedMotion();
  private readonly heading: Phaser.GameObjects.Text;
  private readonly statusText: Phaser.GameObjects.Text;
  private readonly hintText: Phaser.GameObjects.Text;
  private readonly leaveChip: CabinetChip;
  private readonly voteStrip: MineVoteStrip;
  /** The mine under the dark: rock, tunnels and rooms, the party, what falls on them. */
  private readonly world: Phaser.GameObjects.Container;
  private readonly ground: Phaser.GameObjects.Graphics;
  /** A passage drawn for one walk only: one that ends in rock. */
  private readonly scratch: Phaser.GameObjects.Graphics;
  private readonly floorFx: Phaser.GameObjects.Container;
  private readonly actors: Phaser.GameObjects.Container;
  private readonly airFx: Phaser.GameObjects.Container;
  /** The dark, with the light lifted out of it every frame. */
  private readonly dark: Phaser.GameObjects.RenderTexture;
  /** Over the dark and moving with the mine: chalk, glows, the ways on, words. */
  private readonly above: Phaser.GameObjects.Container;
  private readonly chalk: Phaser.GameObjects.Graphics;
  private readonly hints: Phaser.GameObjects.Container;
  private readonly glow: Phaser.GameObjects.Image;
  private readonly beamGlow: Phaser.GameObjects.Image;
  private readonly flame: Phaser.GameObjects.Image;
  private readonly routes: Phaser.GameObjects.Container;
  private readonly fx: Phaser.GameObjects.Container;
  private readonly bars: Phaser.GameObjects.Container;
  /** Fixed over the window: the small map, the compass, the room card. */
  private readonly chrome: Phaser.GameObjects.Container;
  private readonly miniDot: Phaser.GameObjects.Arc;
  /** Fixed over the window: what a trap is and what it did, and its red flash. */
  private readonly stage: Phaser.GameObjects.Container;
  private readonly flash: Phaser.GameObjects.Rectangle;
  private readonly fade: Phaser.GameObjects.Rectangle;
  private readonly voteLayer: Phaser.GameObjects.Container;
  private readonly maskShape: Phaser.GameObjects.Graphics;
  private model: MineMapModel;
  private walkers: Walker[] = [];
  private partyKey = '';
  private file: FileWalk | null = null;
  /** What the window looks at, in mine pixels, and how close. */
  private readonly cam = { x: 0, y: 0, zoom: 1 };
  /** Where the camera drifts to; while `camLocked` a zoom owns it outright. */
  private follow: Point | null = null;
  private camLocked = false;
  private shake = 0;
  private readonly light = {
    at: { x: 0, y: 0 } as Point,
    radius: 0,
    angle: 0,
    beam: 0,
    level: 1,
    flicker: 1,
    target: 1,
    next: 0,
    jitter: { x: 0, y: 0 } as Point,
  };
  /** Light that is not the party's: daylight down a shaft, a shopkeeper's lamp. */
  private lamps: { at: Point; radius: number; lift: number }[] = [];
  private readonly cells = new Map<string, Point>();
  private mini = { scale: 1, x: 0, y: 0, box: { x: 0, y: 0, w: 0, h: 0 } };
  /** Screen points of the routes on offer, where vote tokens gather. */
  private readonly routePoints = new Map<string, Point>();
  private votes: MineVoteState | null = null;
  private introDone: Promise<void> = Promise.resolve();
  private readonly sleepers: Phaser.Time.TimerEvent[] = [];
  private loops: Phaser.Time.TimerEvent[] = [];
  private readonly running = new Set<Phaser.Tweens.Tween>();
  private readonly hintTweens = new Set<Phaser.Tweens.Tween>();
  private readonly waiting = new Set<() => void>();
  private disposed = false;

  constructor(scene: Phaser.Scene, model: MineMapModel, private readonly hooks: MineMapHooks) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(99);
    ensureGlowTextures(scene);
    ensureMineLightTextures(scene);
    this.model = model;
    addCabinetBackdrop(scene, this);
    this.heading = scene.add.text(58, 42, '', {
      fontFamily: MENU_FONT.display,
      fontSize: '28px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    });
    this.statusText = scene.add.text(60, 82, '', {
      fontFamily: MENU_FONT.body,
      fontSize: '14px',
      color: MENU_HEX.boneDim,
      fixedWidth: 1100,
    });
    this.add([this.heading, this.statusText]);
    addSectionRule(scene, this, 58, 112, 1164);
    const frame = scene.add
      .rectangle(FRAME.x, FRAME.y, FRAME.w, FRAME.h, ROCK.base, 1)
      .setStrokeStyle(1, MENU_COLOR.brassDark, 1);
    this.ground = scene.add.graphics();
    this.scratch = scene.add.graphics();
    this.floorFx = scene.add.container(0, 0);
    this.actors = scene.add.container(0, 0);
    this.airFx = scene.add.container(0, 0);
    this.world = scene.add.container(0, 0, [this.ground, this.scratch, this.floorFx, this.actors, this.airFx]);
    this.dark = scene.add.renderTexture(VIEW.x, VIEW.y, VIEW.w, VIEW.h).setOrigin(0, 0);
    this.chalk = scene.add.graphics();
    this.hints = scene.add.container(0, 0);
    this.beamGlow = scene.add.image(0, 0, MINE_LIGHT.beam)
      .setOrigin(MINE_BEAM_ORIGIN.x, MINE_BEAM_ORIGIN.y)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0);
    this.glow = scene.add.image(0, 0, GLOW.soft).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
    this.flame = scene.add.image(0, 0, GLOW.soft).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.routes = scene.add.container(0, 0);
    this.fx = scene.add.container(0, 0);
    this.bars = scene.add.container(0, 0);
    this.above = scene.add.container(0, 0, [
      this.chalk, this.hints, this.beamGlow, this.glow, this.flame, this.routes, this.bars, this.fx,
    ]);
    this.maskShape = scene.make.graphics({}, false).fillRect(VIEW.x, VIEW.y, VIEW.w, VIEW.h);
    const mask = this.maskShape.createGeometryMask();
    this.world.setMask(mask);
    this.above.setMask(mask);
    this.chrome = scene.add.container(0, 0);
    this.miniDot = scene.add.circle(0, 0, 3, MENU_COLOR.brassLight, 1).setStrokeStyle(1, MENU_COLOR.pitch, 1);
    this.flash = scene.add.rectangle(VIEW.x, VIEW.y, VIEW.w, VIEW.h, 0xff2a14, 1).setOrigin(0, 0).setAlpha(0);
    this.stage = scene.add.container(0, 0);
    this.fade = scene.add.rectangle(VIEW.x, VIEW.y, VIEW.w, VIEW.h, 0x000000, 1).setOrigin(0, 0).setAlpha(0);
    this.voteLayer = scene.add.container(0, 0);
    this.add([
      frame, this.world, this.dark, this.above, this.chrome, this.miniDot, this.flash, this.stage, this.fade, this.voteLayer,
    ]);
    this.hintText = scene.add.text(FRAME.x, FRAME.y + 234, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '15px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    }).setOrigin(0.5);
    this.add(this.hintText);
    const inventory = new CabinetChip(scene, FRAME.x + 350, FRAME.y + 214, {
      width: 160,
      height: 40,
      label: 'Inventory',
      onActivate: () => this.hooks.inventory(),
    });
    this.leaveChip = new CabinetChip(scene, FRAME.x - 510, FRAME.y + 214, {
      width: 200,
      height: 40,
      label: 'Leave',
      onActivate: () => this.hooks.choose('leave'),
    });
    this.add([inventory, this.leaveChip]);
    this.focus.add(inventory);
    this.focus.add(this.leaveChip);
    this.voteStrip = new MineVoteStrip(
      scene,
      this,
      { x: FRAME.x, y: FRAME.y + 272, width: 640, chip: { x: FRAME.x + 345, y: FRAME.y + 255 } },
      this.focus,
      () => this.hooks.decide(),
    );
    this.sceneInput = new SceneInput(scene);
    this.sceneInput.bindKeys([
      { key: 'LEFT', capture: true, run: () => this.focus.move(-1) },
      { key: 'RIGHT', capture: true, run: () => this.focus.move(1) },
      { key: 'TAB', capture: true, run: (event) => this.focus.move(event.shiftKey ? -1 : 1) },
      { key: 'SPACE', capture: true, run: () => this.focus.activate() },
      { key: 'ENTER', capture: true, run: () => this.focus.activate() },
    ]);

    const here = this.nodePx(this.currentNode());
    this.cam.x = here.x;
    this.cam.y = here.y;
    this.follow = here;
    this.setParty(model.party, true);
    this.render();
    this.intro(model.intro);
    if (!this.reduced) {
      this.track(scene.tweens.add({ targets: this.miniDot, scale: 1.7, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.InOut' }));
    }
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.tick, this);
    this.tick(scene.time.now, 0);
  }

  /** Show the mine as it now stands: after an arrival, or with new routes on offer. */
  update(model: MineMapModel): void {
    if (this.disposed) return;
    if (model.maze !== this.model.maze) this.cells.clear();
    this.model = model;
    this.votes = null;
    this.voteStrip.set({ line: '', marks: [], canDecide: false });
    this.setParty(model.party);
    if (!this.camLocked) this.follow = this.nodePx(this.currentNode());
    this.render();
  }

  setVotes(state: MineVoteState): void {
    if (this.disposed) return;
    this.votes = state;
    this.voteStrip.set(state);
    this.drawVotes();
  }

  /**
   * Walk the party down a tunnel in single file behind the light, the view
   * following them. A trap springs halfway as it was rolled; solid rock sends
   * the party back the way it came.
   */
  async walk(plan: MineWalk): Promise<void> {
    if (this.disposed) return;
    await this.introDone;
    if (this.disposed) return;
    const { from, direction, to, trap } = plan;
    this.quiet(`Taking the ${MINE_DIRECTION_LABEL[direction].toLowerCase()} tunnel.`);
    this.setParty(plan.party);
    this.floorFx.removeAll(true);
    this.airFx.removeAll(true);
    if (to) this.drawWorld(to);
    const a = this.nodePx(from);
    const vector = MINE_DIRECTION_VECTOR[direction];
    const far = to ? this.nodePx(to) : this.cellPx(from.mapX + vector.x, from.mapY + vector.y);
    const u = unit(a, far);
    const walkers = this.walkers.filter((walker) => !walker.fallen);
    if (!to) {
      await this.walkBlocked(walkers, a, lerp(a, far, 0.46), u);
      return;
    }
    const facing = u.x < -0.2 ? -1 : 1;
    const paths = walkers.map((walker, index) => [
      { ...walker.at },
      a,
      { x: far.x + huddle(index).x * facing, y: far.y + huddle(index).y },
    ]);
    const trapPoint = lerp(a, far, 0.5);
    const victim = trap ? Math.min(Math.max(0, trap.target), walkers.length - 1) : -1;
    // How far down its own path each walker is when it stands on the trap.
    const onTrap = (index: number): number =>
      Math.hypot(paths[index][0].x - a.x, paths[index][0].y - a.y) +
      Math.hypot(paths[index][2].x - a.x, paths[index][2].y - a.y) * 0.5;
    let warned = !trap?.spotted;
    let sprung = !trap;
    await this.walkFile(walkers, paths, {
      watch: (file) => {
        if (!trap) return;
        if (!warned && this.walked(file, 0) >= onTrap(0) - 46) {
          warned = true;
          file.holds += 1;
          void this.revealTrap(trap.kind, trapPoint, u).then(() => {
            file.holds -= 1;
            file.speed = 0.6;
          });
        }
        if (!sprung && this.walked(file, victim) >= onTrap(victim)) {
          sprung = true;
          file.holds += 1;
          void this.trapMoment(trap, walkers[victim], trapPoint, u).then(() => {
            file.holds -= 1;
            file.speed = 1;
          });
        }
      },
    });
    if (this.disposed) return;
    if (walkers.some((walker) => !walker.fallen)) {
      this.follow = far;
      // The walkers settle in; the redraw that follows greets the junction (`reveal`).
      await this.sleep(this.reduced ? 60 : 200);
      return;
    }
    // The trap was the end of them: let it sink in before the run is called.
    await this.sleep(this.reduced ? 400 : 1100);
  }

  /** Close in on the room the party stands at, until its doorway fills the dark. */
  async enterRoom(): Promise<void> {
    if (this.disposed) return;
    await this.introDone;
    if (this.disposed) return;
    this.quiet('Entering the room.');
    const room = this.nodePx(this.currentNode());
    if (this.reduced) {
      await this.tweenTo(this.fade, { alpha: 1 }, 140, 'Linear');
      return;
    }
    const walkers = this.walkers.filter((walker) => !walker.fallen);
    this.camLocked = true;
    await Promise.all([
      this.walkFile(walkers, walkers.map((walker, index) => [
        { ...walker.at },
        { x: room.x + huddle(index).x * 0.5, y: room.y - 5 + huddle(index).y * 0.4 },
      ])),
      this.tweenTo(this.cam, { x: room.x, y: room.y - 6, zoom: ROOM_ZOOM }, 760, 'Cubic.In'),
      this.tweenTo(this.fade, { alpha: 1 }, 380, 'Sine.In', 400),
    ]);
  }

  override destroy(fromScene?: boolean): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene?.events.off(Phaser.Scenes.Events.UPDATE, this.tick, this);
    this.file = null;
    this.stopHints();
    for (const timer of this.sleepers) timer.remove(false);
    this.stopTweens();
    for (const finish of [...this.waiting]) finish();
    this.sceneInput.destroy();
    this.maskShape.destroy();
    super.destroy(fromScene);
  }

  // ---- Drawing ----------------------------------------------------------------

  private currentNode(): MineMazeNode {
    return this.model.maze.nodes[this.model.current] ?? this.model.maze.nodes[0];
  }

  /** Where grid cell (mapX, mapY) lies, in mine pixels: the tunnels' own lengths apart. */
  private cellPx(mapX: number, mapY: number): Point {
    const key = `${mapX},${mapY}`;
    let point = this.cells.get(key);
    if (!point) {
      const at = mineNodePoint(this.model.maze, mapX, mapY);
      point = { x: at.x * UNIT, y: at.y * UNIT };
      this.cells.set(key, point);
    }
    return point;
  }

  private nodePx(node: MineMazeNode): Point {
    return this.cellPx(node.mapX, node.mapY);
  }

  /** Nothing to choose while the party moves: the routes, the votes and the way out stand down. */
  private quiet(hint: string): void {
    this.votes = null;
    this.voteStrip.set({ line: '', marks: [], canDecide: false });
    this.voteLayer.removeAll(true);
    this.routes.removeAll(true);
    this.routePoints.clear();
    this.leaveChip.setVisible(false).setEnabled(false);
    this.hintText.setText(hint).setColor(MENU_HEX.boneDim);
  }

  /** Draw the mine as the model stands, the party where it is and the ways on offered. */
  private render(): void {
    const { model } = this;
    this.heading.setText(model.title);
    this.statusText.setText(model.status);
    this.hintText.setText(model.hint).setColor(model.interactive ? MENU_HEX.bone : MENU_HEX.boneDim);
    this.leaveChip.setVisible(model.leave != null).setEnabled(model.interactive && model.leave != null);
    if (model.leave) this.leaveChip.setLabel(model.leave);
    this.floorFx.removeAll(true);
    this.airFx.removeAll(true);
    this.fx.removeAll(true);
    this.stage.removeAll(true);
    this.flash.setAlpha(0);
    this.scratch.clear();
    this.drawWorld();
    this.drawChrome();
    this.drawRoutes();
    this.drawVotes();
    const revealed = model.reveal != null ? model.maze.nodes[model.reveal] : undefined;
    if (revealed) this.pulse(this.nodePx(revealed));
  }

  /**
   * The workings around the party: bare rock, the tunnels hewn through it with
   * their timbers, rails and rubble, the caverns and rooms, and (over the dark)
   * whatever gives itself away: daylight, a lamp, eyes, a glint, the chalk map.
   * `extra` is a junction the party is about to reach and has not mapped yet.
   */
  private drawWorld(extra?: MineMazeNode): void {
    const { model } = this;
    const maze = model.maze;
    const here = this.currentNode();
    const shown = (id: number): boolean => !model.known || model.known.has(id) || id === here.id || id === extra?.id;
    const centre = this.nodePx(here);
    const nodes = Object.values(maze.nodes).filter((node) => {
      if (!shown(node.id)) return false;
      if (node.id === extra?.id) return true;
      const point = this.nodePx(node);
      return Math.hypot(point.x - centre.x, point.y - centre.y) <= DRAW_RADIUS * UNIT;
    });
    const passages: { a: Point; b: Point; key: number; stub: boolean }[] = [];
    const seen = new Set<string>();
    for (const node of nodes) {
      const a = this.nodePx(node);
      MINE_DIRECTIONS.forEach((direction, index) => {
        if (!hasExit(node, direction)) return;
        const id = node.exits[direction];
        const target = id != null && shown(id) ? maze.nodes[id] : undefined;
        if (target) {
          const key = `${Math.min(node.id, target.id)}:${Math.max(node.id, target.id)}`;
          if (seen.has(key)) return;
          seen.add(key);
          passages.push({ a, b: this.nodePx(target), key: Math.min(node.id, target.id) * 1031 + Math.max(node.id, target.id), stub: false });
          return;
        }
        // Not followed yet (or forgotten): its mouth, fading into the rock.
        const vector = MINE_DIRECTION_VECTOR[direction];
        passages.push({
          a,
          b: lerp(a, this.cellPx(node.mapX + vector.x, node.mapY + vector.y), STUB),
          key: node.id * 31 + index + 7,
          stub: true,
        });
      });
    }

    const g = this.ground;
    g.clear();
    for (const node of nodes) {
      const point = this.nodePx(node);
      for (let k = 0; k < 16; k++) {
        const angle = noise(node.id, k, 1) * Math.PI * 2;
        const reach = 24 + noise(node.id, k, 2) * UNIT * 0.8;
        const size = 2 + Math.floor(noise(node.id, k, 3) * 5);
        g.fillStyle(ROCK.specks[k % ROCK.specks.length], 1)
          .fillRect(Math.round(point.x + Math.cos(angle) * reach), Math.round(point.y + Math.sin(angle) * reach), size, size);
      }
    }
    // Hewn in three coats, so floors run on unbroken where passages meet: the
    // shadow at the rock's edge, the walls, the floor.
    const coat = (pad: number, color: number): void => {
      for (const passage of passages) {
        const { a, b } = passage;
        if (!passage.stub) {
          g.lineStyle(TUNNEL + pad * 2, color, 1).lineBetween(a.x, a.y, b.x, b.y);
          continue;
        }
        for (let step = 0; step < 5; step++) {
          const from = lerp(a, b, step / 5);
          const to = lerp(a, b, (step + 1) / 5);
          g.lineStyle(TUNNEL + pad * 2, blend(color, ROCK.halo, Math.max(0, (step / 5 - 0.35) / 0.65)), 1)
            .lineBetween(from.x, from.y, to.x, to.y);
        }
      }
      g.fillStyle(color, 1);
      for (const node of nodes) {
        const point = this.nodePx(node);
        if (node.kind === 'room') {
          g.fillRoundedRect(point.x - ROOM_W / 2 - pad, point.y - ROOM_H / 2 - pad, ROOM_W + pad * 2, ROOM_H + pad * 2, 7 + pad / 2);
        } else {
          g.fillCircle(point.x, point.y, CAVERN + pad);
        }
      }
    };
    coat(9, ROCK.halo);
    coat(4, ROCK.wall);
    coat(0, ROCK.floor);

    for (const passage of passages) {
      const { a, b, key } = passage;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const u = unit(a, b);
      const at = (d: number, side = 0): Point => ({ x: a.x + u.x * d - u.y * side, y: a.y + u.y * d + u.x * side });
      const start = CAVERN + 3;
      const end = passage.stub ? length * 0.6 : length - CAVERN - 3;
      if (end <= start) continue;
      const p0 = at(start);
      const p1 = at(end);
      g.lineStyle(7, ROCK.path, 0.7).lineBetween(p0.x, p0.y, p1.x, p1.y);
      if (!passage.stub && noise(key, 1) < 0.3) {
        g.lineStyle(2, ROCK.sleeper, 1);
        for (let d = start + 3; d < end; d += 9) {
          const l = at(d, -6);
          const r = at(d, 6);
          g.lineBetween(l.x, l.y, r.x, r.y);
        }
        g.lineStyle(1.5, ROCK.rail, 0.9);
        for (const side of [-4, 4]) {
          const l = at(start, side);
          const r = at(end, side);
          g.lineBetween(l.x, l.y, r.x, r.y);
        }
      }
      if (noise(key, 2) < 0.8) {
        for (let d = start + 10 + noise(key, 3) * 20; d < end - 8; d += 46) {
          const l = at(d, -(TUNNEL / 2 + 2));
          const r = at(d, TUNNEL / 2 + 2);
          g.lineStyle(3, ROCK.timber, 1).lineBetween(l.x, l.y, r.x, r.y);
          g.fillStyle(ROCK.post, 1).fillRect(l.x - 2.5, l.y - 2.5, 5, 5).fillRect(r.x - 2.5, r.y - 2.5, 5, 5);
        }
      }
      for (let k = 0; k < 3; k++) {
        const pebble = at(start + noise(key, 10 + k) * (end - start), (noise(key, 20 + k) - 0.5) * (TUNNEL - 6));
        g.fillStyle(ROCK.pebble, 0.9).fillRect(Math.round(pebble.x), Math.round(pebble.y), 2 + (k % 2), 2);
      }
    }
    for (const node of nodes) if (node.kind === 'room' && node.room) this.furnish(g, node);

    this.stopHints();
    this.hints.removeAll(true);
    this.lamps = [];
    for (const node of nodes) {
      const point = this.nodePx(node);
      if (node.id === 0 || node.escape) this.daylight(point, node.id === 0 ? 1 : 0.7);
      if (model.markExits && (node.id === 0 || node.escape)) {
        this.hints.add(this.scene.add.text(point.x, point.y - CAVERN - 18, 'EXIT', {
          fontFamily: MENU_FONT.control,
          fontSize: '11px',
          fontStyle: 'bold',
          color: MENU_HEX.verdigris,
          backgroundColor: '#17110d',
          padding: { x: 4, y: 1 },
        }).setOrigin(0.5));
      }
      const room = node.kind === 'room' ? node.room : undefined;
      if (!room) continue;
      if (room.kind === 'shop') this.lampLight(point);
      else if (room.kind === 'enemies' && !room.resolved) this.eyes(node, point);
      else if (room.kind === 'ore' && !room.resolved && room.oreKind && (room.oreAmount ?? 1) > 0) {
        const shine = ORE_SHINE[room.oreKind];
        this.glints([0, 1, 2].map((k) => ({
          x: point.x - ROOM_W / 2 + 7 + k * 9 + noise(node.id, k, 50) * 4,
          y: point.y - ROOM_H / 2 + 6 + noise(node.id, k, 51) * 4,
        })), shine);
      } else if (room.kind === 'treasure' && !room.resolved) {
        this.glints([{ x: point.x + 11, y: point.y - 3 }], 0xffe08a);
      }
    }
    this.drawChalk(nodes);
  }

  /** What a room holds, for the light to find. */
  private furnish(g: Phaser.GameObjects.Graphics, node: MineMazeNode): void {
    const room = node.room!;
    const p = this.nodePx(node);
    const r = (k: number): number => noise(node.id, k, 9);
    if (room.kind === 'enemies') {
      g.fillStyle(0xd8cfb4, 0.8);
      for (let k = 0; k < 5; k++) g.fillRect(Math.round(p.x - 17 + r(k) * 32), Math.round(p.y - 12 + r(k + 5) * 22), 4, 1);
      g.fillCircle(p.x + 12, p.y + 8, 2);
      if (room.resolved) g.fillStyle(0x3a1612, 0.55).fillEllipse(p.x - 3, p.y + 4, 20, 8);
      else g.fillStyle(0x1a1410, 1).fillEllipse(p.x - 8, p.y - 2, 12, 9).fillEllipse(p.x + 7, p.y + 1, 14, 10);
    } else if (room.kind === 'treasure') {
      const x = Math.round(p.x + 4);
      const y = Math.round(p.y - 6);
      if (room.resolved) {
        g.fillStyle(0x8a5a30, 1).fillRect(x, y - 5, 14, 4);
        g.fillStyle(0x24160c, 1).fillRect(x, y, 14, 9);
        g.fillStyle(0x6b4122, 1).fillRect(x, y + 4, 14, 5);
      } else {
        g.fillStyle(0x6b4122, 1).fillRect(x, y, 14, 9);
        g.fillStyle(0xc89a3c, 1).fillRect(x, y + 3, 14, 2);
        g.fillStyle(0xffe08a, 1).fillRect(x + 6, y + 3, 2, 3);
      }
    } else if (room.kind === 'ore') {
      const tint = room.oreKind && !room.resolved ? ORE_TINT[room.oreKind] : 0x4a4440;
      const left = p.x - ROOM_W / 2 + 4;
      const top = p.y - ROOM_H / 2;
      for (let k = 0; k < 4; k++) {
        const x = left + 4 + k * 9;
        g.fillStyle(tint, 1).fillTriangle(x, top + 2, x + 7, top + 2, x + 3.5, top + 9 + r(k) * 6);
      }
      g.lineStyle(2, 0x7a5530, 1).lineBetween(p.x + 10, p.y + 9, p.x + 16, p.y + 3);
      g.lineStyle(2, 0x9aa2a4, 1).lineBetween(p.x + 13, p.y + 2, p.x + 19, p.y + 5);
    } else if (room.kind === 'shop') {
      g.fillStyle(0x6b4a2a, 1).fillRect(p.x - 12, p.y - 6, 24, 6);
      g.fillStyle(0x8a6238, 1).fillRect(p.x - 12, p.y - 6, 24, 2);
      g.fillStyle(0x7a5530, 1).fillRect(p.x - 19, p.y + 4, 7, 7).fillRect(p.x + 12, p.y + 5, 6, 6);
      g.fillStyle(0xffd27a, 1).fillRect(p.x - 1, p.y - 9, 3, 3);
    } else {
      // An old cart on a stub of rail, and a crate.
      g.lineStyle(1, ROCK.rail, 0.8).lineBetween(p.x - 16, p.y + 7, p.x + 10, p.y + 7);
      g.fillStyle(0x4a4e50, 1).fillRect(p.x - 10, p.y - 2, 14, 8);
      g.fillStyle(0x1d1f20, 1).fillRect(p.x - 8, p.y - 1, 10, 4);
      g.fillStyle(0x2a2c2d, 1).fillRect(p.x - 9, p.y + 6, 3, 2).fillRect(p.x + 1, p.y + 6, 3, 2);
      g.fillStyle(0x7a5530, 1).fillRect(p.x + 9, p.y - 10, 8, 7);
    }
  }

  /** Daylight down a shaft: the way out. */
  private daylight(at: Point, strength: number): void {
    const { scene } = this;
    this.lamps.push({ at, radius: 96 * strength, lift: 0.85 });
    const pool = scene.add.image(at.x, at.y, GLOW.soft)
      .setTint(0xcfe4ff).setBlendMode(Phaser.BlendModes.ADD).setScale(1.5 * strength).setAlpha(0.26);
    const rays = scene.add.image(at.x, at.y, GLOW.rays)
      .setTint(0xe6f2ff).setBlendMode(Phaser.BlendModes.ADD).setScale(0.3 * strength).setAlpha(0.13);
    this.hints.add([pool, rays]);
    if (this.reduced) return;
    this.trackHint(scene.tweens.add({ targets: rays, angle: 360, duration: 90_000, repeat: -1 }));
    this.trackHint(scene.tweens.add({ targets: pool, alpha: 0.18, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.InOut' }));
  }

  /** A shopkeeper's lamp on the counter. */
  private lampLight(at: Point): void {
    const { scene } = this;
    const spot = { x: at.x, y: at.y - 7 };
    this.lamps.push({ at: spot, radius: 66, lift: 0.85 });
    const glow = scene.add.image(spot.x, spot.y, GLOW.soft)
      .setTint(0xffb060).setBlendMode(Phaser.BlendModes.ADD).setScale(0.9).setAlpha(0.3);
    this.hints.add(glow);
    if (this.reduced) return;
    this.loops.push(scene.time.addEvent({ delay: 130, loop: true, callback: () => glow.setAlpha(0.24 + Math.random() * 0.1) }));
  }

  /** Red eyes in a den: the first, and only, thing to be seen of it. */
  private eyes(node: MineMazeNode, at: Point): void {
    const { scene } = this;
    for (let k = 0; k < 2; k++) {
      const x = at.x - 12 + noise(node.id, k, 40) * 20;
      const y = at.y - 8 + noise(node.id, k, 41) * 12;
      const glow = scene.add.image(x + 2, y, GLOW.soft)
        .setTint(0xff2a14).setBlendMode(Phaser.BlendModes.ADD).setScale(0.14, 0.08).setAlpha(0.6);
      const left = scene.add.rectangle(x, y, 2, 2, 0xff4a2c);
      const right = scene.add.rectangle(x + 4, y, 2, 2, 0xff4a2c);
      this.hints.add([glow, left, right]);
      if (this.reduced) continue;
      this.loops.push(scene.time.addEvent({
        delay: 1700 + k * 650,
        loop: true,
        callback: () => {
          if (Math.random() < 0.35) return;
          this.trackHint(scene.tweens.add({ targets: [left, right], scaleY: 0.1, duration: 60, yoyo: true, hold: 80 }));
        },
      }));
    }
  }

  /** Something that catches the light: ore in a wall, the lock of a chest. */
  private glints(points: readonly Point[], color: number): void {
    const { scene } = this;
    points.forEach((point, k) => {
      const star = scene.add.image(point.x, point.y, GLOW.soft)
        .setTint(color).setBlendMode(Phaser.BlendModes.ADD).setScale(0.1).setAlpha(this.reduced ? 0.6 : 0);
      this.hints.add(star);
      if (this.reduced) return;
      this.trackHint(scene.tweens.add({
        targets: star,
        alpha: { from: 0, to: 0.95 },
        scale: { from: 0.06, to: 0.14 },
        duration: 420,
        yoyo: true,
        hold: 120,
        repeat: -1,
        repeatDelay: 1500 + k * 380,
        delay: 300 + k * 520,
        ease: 'Sine.InOut',
      }));
    });
  }

  /** The party's own map of what it has walked: chalk that shows in the dark. */
  private drawChalk(nodes: readonly MineMazeNode[]): void {
    const { model } = this;
    const chalk = this.chalk;
    chalk.clear();
    const here = this.currentNode();
    const mapped = (id: number): boolean => !model.known || model.known.has(id) || id === here.id;
    const drawn = new Set<string>();
    for (const node of nodes) {
      if (!mapped(node.id)) continue;
      const a = this.nodePx(node);
      for (const direction of MINE_DIRECTIONS) {
        if (!hasExit(node, direction)) continue;
        const id = node.exits[direction];
        const target = id != null && mapped(id) ? model.maze.nodes[id] : undefined;
        if (target) {
          const key = `${Math.min(node.id, target.id)}:${Math.max(node.id, target.id)}`;
          if (drawn.has(key)) continue;
          drawn.add(key);
          const b = this.nodePx(target);
          chalk.lineStyle(2, 0xe2cfa6, 0.15).lineBetween(a.x, a.y, b.x, b.y);
          continue;
        }
        const vector = MINE_DIRECTION_VECTOR[direction];
        const b = lerp(a, this.cellPx(node.mapX + vector.x, node.mapY + vector.y), STUB);
        chalk.lineStyle(2, 0xe2cfa6, 0.2);
        for (let dash = 0; dash < 3; dash++) {
          const p0 = lerp(a, b, 0.3 + dash * 0.24);
          const p1 = lerp(a, b, 0.42 + dash * 0.24);
          chalk.lineBetween(p0.x, p0.y, p1.x, p1.y);
        }
      }
    }
    for (const node of nodes) {
      if (!mapped(node.id)) continue;
      const p = this.nodePx(node);
      if (node.kind === 'room') {
        const x = p.x - ROOM_W / 2 + 3;
        const y = p.y - ROOM_H / 2 + 3;
        chalk.fillStyle(this.markColor(node), 0.5).fillRect(x, y, 6, 6);
        chalk.lineStyle(1, 0xe2cfa6, 0.3).strokeRect(x - 1, y - 1, 8, 8);
      } else {
        chalk.fillStyle(this.markColor(node), 0.35).fillCircle(p.x, p.y, 3);
      }
    }
  }

  /** A room's colour on the maps: what it held, and whether that is dealt with. */
  private markColor(node: MineMazeNode): number {
    const room = node.room;
    if (!room?.entered) return node.id === 0 ? MENU_COLOR.brassLight : MENU_COLOR.boneDim;
    if (room.kind === 'enemies') return room.resolved ? 0x79c89a : TRAP_RED;
    if (room.kind === 'treasure') return 0xe4c160;
    if (room.kind === 'ore') return 0xb9875b;
    if (room.kind === 'shop') return MENU_COLOR.verdigris;
    return MENU_COLOR.boneDim;
  }

  /** Fixed over the window: the small map of everything mapped, the compass, the room. */
  private drawChrome(): void {
    const { scene, model } = this;
    const maze = model.maze;
    this.chrome.removeAll(true);
    const here = this.currentNode();
    const nodes = Object.values(maze.nodes).filter((node) => !model.known || model.known.has(node.id) || node.id === here.id);
    const units = new Map(nodes.map((node) => [node.id, mineNodePoint(maze, node.mapX, node.mapY)]));
    const box = { x: VIEW.x + 10, y: VIEW.y + 10, w: 196, h: 110 };
    const inner = { x: box.x + 12, y: box.y + 22, w: box.w - 24, h: box.h - 32 };
    const xs = [...units.values()].map((point) => point.x);
    const ys = [...units.values()].map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const scale = Math.min(18, inner.w / Math.max(0.5, maxX - minX), inner.h / Math.max(0.5, maxY - minY));
    this.mini = {
      scale,
      x: inner.x + inner.w / 2 - ((minX + maxX) / 2) * scale,
      y: inner.y + inner.h / 2 - ((minY + maxY) / 2) * scale,
      box,
    };
    const toMini = (point: Point): Point => ({ x: this.mini.x + point.x * scale, y: this.mini.y + point.y * scale });
    const g = scene.add.graphics();
    g.fillStyle(0x0b0907, 0.86).fillRect(box.x, box.y, box.w, box.h);
    g.lineStyle(1, MENU_COLOR.brassDark, 1).strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
    const seen = new Set<string>();
    for (const node of nodes) {
      const a = toMini(units.get(node.id)!);
      for (const direction of MINE_DIRECTIONS) {
        if (!hasExit(node, direction)) continue;
        const id = node.exits[direction];
        if (id != null && units.has(id)) {
          const key = `${Math.min(node.id, id)}:${Math.max(node.id, id)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const b = toMini(units.get(id)!);
          g.lineStyle(1.5, MENU_COLOR.boneDim, 0.7).lineBetween(a.x, a.y, b.x, b.y);
          continue;
        }
        const vector = MINE_DIRECTION_VECTOR[direction];
        const reach = Math.min(5, scale * 0.3) / Math.hypot(vector.x, vector.y);
        g.lineStyle(1, MENU_COLOR.disabled, 0.6).lineBetween(a.x, a.y, a.x + vector.x * reach, a.y + vector.y * reach);
      }
    }
    for (const node of nodes) {
      const p = toMini(units.get(node.id)!);
      if (node.kind === 'room') g.fillStyle(this.markColor(node), 1).fillRect(p.x - 2, p.y - 2, 4, 4);
      else g.fillStyle(MENU_COLOR.boneDim, 0.8).fillCircle(p.x, p.y, 1.2);
      if (model.markExits && (node.id === 0 || node.escape)) g.lineStyle(1, MENU_COLOR.verdigris, 1).strokeCircle(p.x, p.y, 3.5);
    }
    const title = scene.add.text(box.x + 8, box.y + 5, 'MAP', {
      fontFamily: MENU_FONT.control,
      fontSize: '10px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
    });
    const cx = VIEW.x + VIEW.w - 24;
    const cy = VIEW.y + 26;
    const compass = scene.add.graphics();
    compass.fillStyle(0x0b0907, 0.82).fillCircle(cx, cy, 15);
    compass.lineStyle(1, MENU_COLOR.brassDark, 1).strokeCircle(cx, cy, 15);
    compass.fillStyle(MENU_COLOR.verdigris, 1).fillTriangle(cx - 4, cy - 1, cx + 4, cy - 1, cx, cy - 11);
    compass.fillStyle(MENU_COLOR.boneDim, 0.6).fillTriangle(cx - 3, cy + 1, cx + 3, cy + 1, cx, cy + 9);
    const north = scene.add.text(cx - 24, cy, 'N', {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      fontStyle: 'bold',
      color: MENU_HEX.verdigris,
    }).setOrigin(0.5);
    this.chrome.add([g, title, compass, north]);
    if (here.kind === 'room' && here.room?.entered) this.drawRoomCard(here.room);
  }

  /** The small map's dot follows whoever leads. */
  private placeMiniDot(): void {
    const leader = this.leader();
    const at = leader ? leader.at : this.nodePx(this.currentNode());
    const { box, scale } = this.mini;
    this.miniDot.setPosition(
      Phaser.Math.Clamp(this.mini.x + (at.x / UNIT) * scale, box.x + 4, box.x + box.w - 4),
      Phaser.Math.Clamp(this.mini.y + (at.y / UNIT) * scale, box.y + 4, box.y + box.h - 4),
    );
  }

  /** The ways on from where the party stands: a marker at the mouth of each tunnel. */
  private drawRoutes(): void {
    const { scene, model } = this;
    this.routes.removeAll(true);
    this.routePoints.clear();
    const here = this.currentNode();
    const a = this.nodePx(here);
    for (const direction of MINE_DIRECTIONS) {
      if (!hasExit(here, direction)) continue;
      const vector = MINE_DIRECTION_VECTOR[direction];
      const far = this.cellPx(here.mapX + vector.x, here.mapY + vector.y);
      const u = unit(a, far);
      const n = { x: -u.y, y: u.x };
      const reach = Math.min(Math.max(Math.hypot(far.x - a.x, far.y - a.y) * 0.55, 42), 74);
      const mark = { x: a.x + u.x * reach, y: a.y + u.y * reach };
      const guide = scene.add.graphics();
      guide.lineStyle(2, MENU_COLOR.brass, 0.6);
      for (let d = CAVERN + 4; d < reach - 16; d += 9) {
        const end = Math.min(d + 5, reach - 16);
        guide.lineBetween(a.x + u.x * d, a.y + u.y * d, a.x + u.x * end, a.y + u.y * end);
      }
      const tip = { x: mark.x + u.x * 21, y: mark.y + u.y * 21 };
      guide.fillStyle(MENU_COLOR.brassLight, 0.9).fillTriangle(
        tip.x, tip.y,
        tip.x - u.x * 6 + n.x * 4, tip.y - u.y * 6 + n.y * 4,
        tip.x - u.x * 6 - n.x * 4, tip.y - u.y * 6 - n.y * 4,
      );
      const ring = scene.add.circle(mark.x, mark.y, 13, 0x17110d, 0.9).setStrokeStyle(2, MENU_COLOR.brassLight, 1);
      const label = scene.add.text(mark.x, mark.y, direction, {
        fontFamily: MENU_FONT.control,
        fontSize: '11px',
        fontStyle: 'bold',
        color: MENU_HEX.brassLight,
      }).setOrigin(0.5);
      this.routes.add([guide, ring, label]);
      // Where the marker sits on screen once the view rests on the party.
      this.routePoints.set(direction, { x: FRAME.x + mark.x - a.x, y: FRAME.y + mark.y - a.y });
      if (!model.interactive) {
        guide.setAlpha(0.6);
        ring.setAlpha(0.6);
        label.setAlpha(0.6);
        continue;
      }
      const choose = (): void => this.hooks.choose(direction);
      ring.setInteractive({ useHandCursor: true });
      ring.on('pointerdown', choose);
      ring.on('pointerover', () => ring.setFillStyle(MENU_COLOR.brass, 0.5));
      ring.on('pointerout', () => ring.setFillStyle(0x17110d, 0.9));
      label.setInteractive({ useHandCursor: true }).on('pointerdown', choose);
    }
    this.routePoints.set('leave', { x: FRAME.x - 310, y: FRAME.y + 254 });
  }

  /** The room the party stands in, pictured in the corner. */
  private drawRoomCard(room: NonNullable<MineMazeNode['room']>): void {
    const { scene } = this;
    const kind = room.kind;
    const w = 196;
    const h = 166;
    const left = VIEW.x + VIEW.w - w - 10;
    const top = VIEW.y + 50;
    const cx = left + w / 2;
    const roomName = kind === 'ore' && room.oreKind ? `${MINE_ORE_DEFS[room.oreKind].name} deposit` : MINE_ROOM_VISUAL_LABEL[kind];
    const roomState = kind === 'shop'
      ? 'SHOP'
      : kind === 'ore'
        ? room.resolved ? 'EXHAUSTED' : 'VEIN AVAILABLE'
        : kind === 'enemies'
          ? room.resolved ? 'CLEARED' : 'HOSTILE'
          : kind === 'treasure'
            ? room.resolved ? 'OPENED' : 'UNCLAIMED'
            : 'SEARCHED';
    const card = scene.add.graphics();
    card.fillStyle(0x0b0907, 0.88).fillRect(left, top, w, h);
    card.lineStyle(1, MENU_COLOR.brassDark, 1).strokeRect(left + 0.5, top + 0.5, w - 1, h - 1);
    this.chrome.add([
      card,
      scene.add.text(cx, top + 13, 'CURRENT ROOM', {
        fontFamily: MENU_FONT.control,
        fontSize: '11px',
        color: MENU_HEX.brassLight,
        fontStyle: 'bold',
      }).setOrigin(0.5),
      scene.add.rectangle(cx, top + 72, 178, 102, MENU_COLOR.woodDeep, 1).setStrokeStyle(2, MENU_COLOR.brass, 1),
      scene.add.image(cx, top + 72, mineRoomTextureKey(kind)).setDisplaySize(168, 96),
      scene.add.image(left + 18, top + 140, mineRoomIconTextureKey(kind)).setDisplaySize(18, 18),
      scene.add.text(left + 34, top + 131, roomName.toUpperCase(), {
        fontFamily: MENU_FONT.control,
        fontSize: '12px',
        color: MENU_HEX.bone,
        fontStyle: 'bold',
        fixedWidth: w - 44,
      }),
      scene.add.text(left + 34, top + 148, roomState, {
        fontFamily: MENU_FONT.control,
        fontSize: '10px',
        color: MENU_HEX.boneDim,
        fontStyle: 'bold',
      }),
    ]);
  }

  /** A token per vote beside the route it backs. */
  private drawVotes(): void {
    this.voteLayer.removeAll(true);
    const state = this.votes;
    if (!state) return;
    const counts = new Map<string, number>();
    for (const mark of state.marks) {
      const point = this.routePoints.get(mark.choice);
      if (!point) continue;
      const n = counts.get(mark.choice) ?? 0;
      counts.set(mark.choice, n + 1);
      const x = point.x + 22 + n * 15;
      const y = point.y - 20;
      this.voteLayer.add([
        this.scene.add.circle(x, y, 7, mark.color, 1).setStrokeStyle(1.5, MENU_COLOR.pitch, 1),
        this.scene.add.text(x, y, mark.initial, {
          fontFamily: MENU_FONT.control,
          fontSize: '10px',
          fontStyle: 'bold',
          color: '#17110d',
        }).setOrigin(0.5),
      ]);
    }
  }

  /** A ring that widens and fades: the party has arrived. */
  private pulse(at: Point): void {
    const ring = this.scene.add.circle(at.x, at.y, 12).setStrokeStyle(2, MENU_COLOR.brassLight, 1);
    this.fx.add(ring);
    this.track(this.scene.tweens.add({
      targets: ring,
      scale: this.reduced ? 1 : 2.8,
      alpha: 0,
      duration: this.reduced ? 300 : 700,
      ease: 'Sine.Out',
      onComplete: () => ring.destroy(),
    }));
  }

  // ---- The camera and the light -------------------------------------------------

  /** Every frame: walk the party, move the camera, flicker the light and paint the dark. */
  private tick(time: number, delta: number): void {
    if (this.disposed) return;
    const dt = Math.min(50, Math.max(0, delta));
    if (this.file) this.stepFile(dt);
    if (this.follow && !this.camLocked) {
      const k = this.reduced ? 1 : 1 - Math.exp(-dt / 130);
      this.cam.x += (this.follow.x - this.cam.x) * k;
      this.cam.y += (this.follow.y - this.cam.y) * k;
    }
    let sx = 0;
    let sy = 0;
    if (this.shake > 0.3 && !this.reduced) {
      sx = (Math.random() - 0.5) * 2 * this.shake;
      sy = (Math.random() - 0.5) * 2 * this.shake;
      this.shake *= Math.exp(-dt / 120);
    } else {
      this.shake = 0;
    }
    const z = this.cam.zoom;
    const ox = FRAME.x - this.cam.x * z + sx;
    const oy = FRAME.y - this.cam.y * z + sy;
    this.world.setPosition(ox, oy).setScale(z);
    this.above.setPosition(ox, oy).setScale(z);
    this.updateLight(time, dt);
    this.paintDark(ox, oy, z);
    this.placeMiniDot();
  }

  /** Whoever holds the light, standing or fallen; without one, whoever leads. */
  private bearer(): Walker | undefined {
    return this.walkers.find((walker) => walker.look.light) ?? this.leader();
  }

  /** The first walker still on their feet; with everyone down, the first. */
  private leader(): Walker | undefined {
    return this.walkers.find((walker) => !walker.fallen) ?? this.walkers[0];
  }

  private lightLook(): LightLook {
    return LIGHTS[this.bearer()?.look.light ?? 'none'];
  }

  /** The light's flicker, where it is carried and which way it points, and its glow. */
  private updateLight(time: number, dt: number): void {
    const light = this.light;
    const bearer = this.bearer();
    const look = this.lightLook();
    const flicker = this.reduced ? 0 : look.flicker;
    if (time >= light.next) {
      light.target = 1 + (Math.random() - 0.5) * 0.12 * flicker;
      light.jitter = { x: (Math.random() - 0.5) * 3 * flicker, y: (Math.random() - 0.5) * 2 * flicker };
      light.next = time + 50 + Math.random() * 90;
    }
    light.flicker += (light.target - light.flicker) * Math.min(1, dt / 40);
    const wave = 1 + flicker * (0.03 * Math.sin(time * 0.0113) + 0.02 * Math.sin(time * 0.0271 + 1.7));
    const strength = wave * light.flicker * light.level;
    const casting = !!bearer?.moving && look.beam > 0;
    light.beam += ((casting ? 1 : 0) - light.beam) * Math.min(1, dt / 260);
    if (bearer) {
      let turn = Math.atan2(bearer.dir.y, bearer.dir.x) - light.angle;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      light.angle += turn * (this.reduced ? 1 : Math.min(1, dt / 120));
    }
    const base = !bearer
      ? this.nodePx(this.currentNode())
      : bearer.fallen
        ? { x: bearer.at.x + 8 * bearer.facing, y: bearer.at.y - 3 }
        : { x: bearer.at.x + 4 * bearer.facing, y: bearer.at.y - 8 };
    light.at = { x: base.x + light.jitter.x, y: base.y + light.jitter.y };
    light.radius = look.radius * strength;
    this.glow.setPosition(light.at.x, light.at.y).setTint(look.tint)
      .setScale((light.radius * 1.4) / 64).setAlpha(look.glow * light.level);
    this.beamGlow.setPosition(light.at.x, light.at.y).setRotation(light.angle).setTint(look.tint)
      .setScale((look.beam * strength) / MINE_BEAM_REACH).setAlpha(look.glow * 0.55 * light.beam * light.level);
    const carried = bearer?.look.light;
    if (!bearer || !carried) {
      this.flame.setVisible(false);
      return;
    }
    const hand = this.handOf(bearer);
    this.flame.setVisible(true).setPosition(hand.x, hand.y)
      .setTint(carried === 'torch' ? 0xffb85a : 0xfff0c8)
      .setScale((carried === 'torch' ? 0.17 : 0.12) * wave * light.flicker)
      .setAlpha(0.95 * Math.max(0.3, light.level));
  }

  /** Black over everything, lifted where the light falls. */
  private paintDark(ox: number, oy: number, z: number): void {
    const dark = this.dark;
    const light = this.light;
    const look = this.lightLook();
    dark.clear();
    dark.fill(0x020101, DARKNESS);
    const sx = ox + light.at.x * z - VIEW.x;
    const sy = oy + light.at.y * z - VIEW.y;
    if (light.radius > 1) {
      dark.stamp(MINE_LIGHT.round, undefined, sx, sy, {
        scale: (light.radius * z) / MINE_ROUND_RADIUS,
        alpha: look.lift,
        erase: true,
      });
    }
    if (light.beam > 0.02 && look.beam > 0) {
      dark.stamp(MINE_LIGHT.beam, undefined, sx, sy, {
        scale: (look.beam * z * (light.radius / look.radius)) / MINE_BEAM_REACH,
        rotation: light.angle,
        originX: MINE_BEAM_ORIGIN.x,
        originY: MINE_BEAM_ORIGIN.y,
        alpha: look.lift * light.beam * 0.85,
        erase: true,
      });
    }
    for (const lamp of this.lamps) {
      dark.stamp(MINE_LIGHT.round, undefined, ox + lamp.at.x * z - VIEW.x, oy + lamp.at.y * z - VIEW.y, {
        scale: (lamp.radius * z) / MINE_ROUND_RADIUS,
        alpha: lamp.lift * Math.max(0.2, light.level),
        erase: true,
      });
    }
  }

  /** Where the light is held: the head of the torch, or the lantern; dropped beside a fallen bearer. */
  private handOf(walker: Walker): Point {
    if (walker.fallen) return { x: walker.at.x + 10 * walker.facing, y: walker.at.y - 2 };
    const lift = walker.body.y - 1;
    return walker.look.light === 'torch'
      ? { x: walker.at.x + 7 * walker.facing, y: walker.at.y - 19 + lift }
      : { x: walker.at.x + 7 * walker.facing, y: walker.at.y - 12 + lift };
  }

  /** The window opens: out of a room the view pulls back; elsewhere the light flares up. */
  private intro(kind?: 'room'): void {
    if (this.reduced) return;
    if (kind === 'room') {
      const here = this.nodePx(this.currentNode());
      this.camLocked = true;
      this.cam.x = here.x;
      this.cam.y = here.y - 6;
      this.cam.zoom = ROOM_ZOOM;
      this.fade.setAlpha(1);
      this.introDone = Promise.all([
        this.tweenTo(this.cam, { zoom: 1, y: here.y }, 780, 'Cubic.Out'),
        this.tweenTo(this.fade, { alpha: 0 }, 460, 'Sine.Out'),
      ]).then(() => {
        this.camLocked = false;
      });
      return;
    }
    this.light.level = 0.15;
    this.track(this.scene.tweens.add({ targets: this.light, level: 1, duration: 520, ease: 'Sine.Out' }));
  }

  // ---- The walkers --------------------------------------------------------------

  /** Line the walkers up with the party: rebuilt when it changes or stands elsewhere, else left be. */
  private setParty(party: readonly MineWalker[], force = false): void {
    const looks: MineWalker[] = party.length
      ? [...party]
      : [{ color: MENU_COLOR.brassLight, light: null, name: '', hp: 0, maxHp: 0 }];
    const key = looks.map((look) => `${look.color}:${look.light ?? '-'}`).join('|');
    const here = this.nodePx(this.currentNode());
    const stray = this.walkers.some((walker) => !walker.fallen && Math.hypot(walker.at.x - here.x, walker.at.y - here.y) > 40);
    if (!force && key === this.partyKey && !stray) {
      this.walkers.forEach((walker, index) => {
        const look = looks[index];
        if (!look) return;
        walker.look = { ...walker.look, name: look.name, hp: look.hp, maxHp: look.maxHp };
        this.drawHealth(walker);
      });
      return;
    }
    this.partyKey = key;
    for (const walker of this.walkers) {
      walker.holder.destroy();
      walker.health.destroy();
    }
    const via = this.model.maze.arrivedVia;
    const facing = via && MINE_DIRECTION_VECTOR[via].x < 0 ? -1 : 1;
    this.walkers = looks.map((look, index) =>
      this.makeWalker(look, { x: here.x + huddle(index).x * facing, y: here.y + huddle(index).y }, facing));
    this.actors.sort('y');
  }

  /** A member of the party as the arena shows them, with their colour at their feet and their light in hand. */
  private makeWalker(look: MineWalker, at: Point, facing: number): Walker {
    const { scene } = this;
    const holder = scene.add.container(at.x, at.y);
    const shadow = scene.add.ellipse(0, 0, 16, 6, 0x000000, 0.5);
    const ring = scene.add.ellipse(0, 0, 15, 6).setStrokeStyle(1.5, look.color, 0.95);
    holder.add([shadow, ring]);
    let body: Walker['body'];
    if (scene.textures.exists('mage-idle-0')) {
      const sprite = scene.add.sprite(0, 1, 'mage-idle-0').setOrigin(0.5, 1).setScale(2);
      if (scene.anims.exists('mage-idle')) {
        sprite.play('mage-idle');
        sprite.anims.setProgress(Math.random());
      }
      body = sprite;
    } else {
      body = scene.add.container(0, 1, [
        scene.add.circle(0, -6, 4.5, look.color, 1).setStrokeStyle(1.5, MENU_COLOR.pitch, 1),
        scene.add.circle(0, -13, 2.6, 0xe8d6b8, 1).setStrokeStyle(1, MENU_COLOR.pitch, 1),
      ]);
    }
    holder.add(body);
    this.actors.add(holder);
    const health = scene.add.graphics();
    this.bars.add(health);
    const walker: Walker = {
      look, holder, body, ring, health,
      at: { ...at }, dir: { x: facing, y: 0 }, facing,
      stride: 0, steps: 0, moving: false, fallen: false,
    };
    this.giveLight(walker);
    this.face(walker, facing);
    this.drawHealth(walker);
    health.setPosition(at.x, at.y - 38);
    return walker;
  }

  /** Put the walker's light (if they have one) in their hand. */
  private giveLight(walker: Walker): void {
    walker.torch?.destroy();
    walker.torch = undefined;
    const light = walker.look.light;
    if (!light) return;
    walker.torch = light === 'torch'
      ? this.scene.add.rectangle(6, -13, 2, 9, 0x6b4526)
      : this.scene.add.rectangle(7, -12, 4, 5, 0xc8a050).setStrokeStyle(1, 0x3a2a14, 1);
    walker.holder.add(walker.torch);
    this.face(walker, walker.facing);
  }

  /** The health bar over a walker's head; `lost` shows, for a moment, what a blow took. */
  private drawHealth(walker: Walker, lost = 0): void {
    const bar = walker.health;
    const { hp, maxHp } = walker.look;
    if (!bar.active) return;
    bar.clear();
    if (maxHp <= 0) return;
    const share = Phaser.Math.Clamp(hp / maxHp, 0, 1);
    const gone = Phaser.Math.Clamp(lost / maxHp, 0, 1 - share);
    bar.fillStyle(0x0b0907, 0.85).fillRect(-12, -2, 24, 5);
    bar.fillStyle(share > 0.5 ? 0x7fd68a : share > 0.25 ? 0xf0c860 : 0xff6a5a, 1).fillRect(-11, -1, 22 * share, 3);
    if (gone > 0) bar.fillStyle(0xffffff, 1).fillRect(-11 + 22 * share, -1, 22 * gone, 3);
  }

  private face(walker: Walker, facing: number): void {
    walker.facing = facing;
    if (walker.body instanceof Phaser.GameObjects.Sprite) walker.body.setFlipX(facing < 0);
    if (walker.torch) {
      walker.torch.setX((walker.look.light === 'torch' ? 6 : 7) * facing).setAngle(walker.look.light === 'torch' ? 14 * facing : 0);
    }
  }

  private animate(walker: Walker, state: 'run' | 'idle'): void {
    const body = walker.body;
    if (walker.fallen || !(body instanceof Phaser.GameObjects.Sprite)) return;
    const key = state === 'run' ? 'mage-run' : 'mage-idle';
    if (!this.scene.anims.exists(key)) return;
    body.play(key, true);
    body.anims.timeScale = state === 'run' ? 0.8 : 1;
  }

  /** Raise the body, and what it carries, off its feet (the stride's bob). */
  private lift(walker: Walker, y: number): void {
    walker.body.y = 1 + y;
    walker.torch?.setY((walker.look.light === 'torch' ? -13 : -12) + y);
  }

  /** Put a walker down at `at`, facing the way it goes, running or standing. */
  private place(walker: Walker, at: Point, dir: Point | null, moving: boolean): void {
    const step = Math.hypot(at.x - walker.at.x, at.y - walker.at.y);
    walker.at = at;
    walker.holder.setPosition(at.x, at.y);
    walker.health.setPosition(at.x, at.y - 38);
    if (dir) {
      walker.dir = dir;
      if (Math.abs(dir.x) > 0.2) {
        const facing = dir.x < 0 ? -1 : 1;
        if (facing !== walker.facing) this.face(walker, facing);
      }
    }
    if (moving !== walker.moving) {
      walker.moving = moving;
      this.animate(walker, moving ? 'run' : 'idle');
      if (!moving) this.lift(walker, 0);
    }
    if (!moving || this.reduced) return;
    walker.stride += step;
    this.lift(walker, -Math.abs(Math.sin(walker.stride / 4.5)) * 1.4);
    if (walker.stride >= (walker.steps + 1) * 13) {
      walker.steps += 1;
      this.footprint(walker);
    }
  }

  /** Dust scuffed up underfoot, settling again in the dark. */
  private footprint(walker: Walker): void {
    const side = walker.steps % 2 ? 2.5 : -2.5;
    const print = this.scene.add.circle(walker.at.x - walker.dir.y * side, walker.at.y + walker.dir.x * side, 1.3, 0x8c7a62, 0.45);
    this.floorFx.add(print);
    this.track(this.scene.tweens.add({
      targets: print,
      alpha: 0,
      scale: 2,
      duration: 900,
      ease: 'Sine.Out',
      onComplete: () => print.destroy(),
    }));
  }

  /** How far down its path walker `index` of a file walk has come. */
  private walked(file: FileWalk, index: number): number {
    return Math.min(file.lengths[index], Math.max(0, (file.clock - file.delays[index]) * file.pace));
  }

  /** The party down their paths in file, each a step behind the one before; done when all have arrived. */
  private walkFile(
    walkers: Walker[],
    paths: Point[][],
    options: { reverse?: boolean; watch?: (file: FileWalk) => void } = {},
  ): Promise<void> {
    return new Promise((resolve) => {
      if (this.disposed || walkers.length === 0) return resolve();
      this.file?.finish();
      const finish = this.hold(resolve);
      const pace = this.reduced ? PACE * 4 : PACE;
      const last = walkers.length - 1;
      const file: FileWalk = {
        walkers,
        paths,
        lengths: paths.map(pathLength),
        delays: walkers.map((_, index) => (options.reverse ? last - index : index) * (SPACING / pace)),
        pace,
        clock: 0,
        speed: 1,
        holds: 0,
        watch: options.watch,
        finish: () => {
          if (this.file === file) this.file = null;
          finish();
        },
      };
      this.file = file;
    });
  }

  private stepFile(dt: number): void {
    const file = this.file!;
    const speed = file.holds > 0 ? 0 : file.speed;
    file.clock += dt * speed;
    let arrived = true;
    file.walkers.forEach((walker, index) => {
      if (walker.fallen) return;
      const total = file.lengths[index];
      const walked = this.walked(file, index);
      if (walked < total) arrived = false;
      const { at, dir } = along(file.paths[index], walked);
      this.place(walker, at, dir, speed > 0 && walked > 0 && walked < total);
    });
    const leader = file.walkers.find((walker) => !walker.fallen);
    if (leader?.moving && !this.camLocked) {
      this.follow = { x: leader.at.x + leader.dir.x * 34, y: leader.at.y + leader.dir.y * 34 };
    }
    this.actors.sort('y');
    file.watch?.(file);
    if (arrived && file.holds === 0 && this.file === file) file.finish();
  }

  /** Down the passage to where it ends in solid rock, and back again. */
  private async walkBlocked(walkers: Walker[], a: Point, end: Point, u: Point): Promise<void> {
    this.carve(a, end);
    const starts = walkers.map((walker) => ({ ...walker.at }));
    await this.walkFile(walkers, walkers.map((walker, index) => [
      { ...walker.at },
      a,
      { x: end.x - u.x * (12 + index * SPACING), y: end.y - u.y * (12 + index * SPACING) },
    ]));
    if (this.disposed) return;
    this.rockFace(end, u);
    await this.sleep(this.reduced ? 140 : 640);
    if (this.disposed) return;
    this.hintText.setText('Dead end.');
    await this.walkFile(walkers, walkers.map((walker, index) => [{ ...walker.at }, a, starts[index]]), { reverse: true });
    if (this.disposed) return;
    this.follow = a;
    await this.sleep(this.reduced ? 60 : 160);
  }

  /** A passage drawn for one walk: it ends in rock. */
  private carve(a: Point, end: Point): void {
    const g = this.scratch;
    g.clear();
    const u = unit(a, end);
    const n = { x: -u.y, y: u.x };
    for (const [pad, color] of [[9, ROCK.halo], [4, ROCK.wall], [0, ROCK.floor]]) {
      const from = pad ? CAVERN + 4 : CAVERN - 4;
      g.lineStyle(TUNNEL + pad * 2, color, 1)
        .lineBetween(a.x + u.x * from, a.y + u.y * from, end.x + u.x * pad, end.y + u.y * pad);
    }
    for (let k = -2; k <= 2; k++) {
      const stone = { x: end.x + n.x * k * 5 + u.x * (Math.abs(k) % 2) * 3, y: end.y + n.y * k * 5 + u.y * (Math.abs(k) % 2) * 3 };
      g.fillStyle(0x4f463c, 1).fillCircle(stone.x, stone.y, 5 - Math.abs(k) * 0.5);
      g.fillStyle(0x6d6458, 1).fillCircle(stone.x - 1, stone.y - 1, 2);
    }
  }

  /** Solid rock: chips fly back at the party, and the passage is struck from the map. */
  private rockFace(at: Point, u: Point): void {
    const { scene } = this;
    this.word('SOLID ROCK', { x: at.x, y: at.y - 24 }, MENU_HEX.bone);
    if (this.reduced) return;
    this.shake = Math.max(this.shake, 1.5);
    this.dust(at, 6, 12);
    for (let i = 0; i < 7; i++) {
      const chip = scene.add.rectangle(at.x, at.y - 6, 2, 2, 0xa89a88, 1);
      this.airFx.add(chip);
      const spread = (Math.random() - 0.5) * 1.6;
      this.track(scene.tweens.add({
        targets: chip,
        x: at.x - u.x * (10 + Math.random() * 12) - u.y * spread * 10,
        y: at.y - u.y * (10 + Math.random() * 12) + u.x * spread * 10,
        alpha: 0,
        duration: 420 + Math.random() * 200,
        ease: 'Quad.Out',
        onComplete: () => chip.destroy(),
      }));
    }
  }

  /** Dust thrown up around a point. */
  private dust(at: Point, count: number, spread: number): void {
    if (this.reduced) return;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.6;
      const puff = this.scene.add.circle(at.x, at.y, 1.8 + Math.random() * 2, 0x9c8a70, 0.5);
      this.airFx.add(puff);
      this.track(this.scene.tweens.add({
        targets: puff,
        x: at.x + Math.cos(angle) * spread * (0.6 + Math.random() * 0.6),
        y: at.y + Math.sin(angle) * spread * 0.5,
        scale: 2.4,
        alpha: 0,
        duration: 520 + Math.random() * 300,
        ease: 'Sine.Out',
        onComplete: () => puff.destroy(),
      }));
    }
  }

  /** A word that rises over the dark and fades. */
  private word(text: string, at: Point, color: string): void {
    const label = this.scene.add.text(at.x, at.y, text, {
      fontFamily: MENU_FONT.control,
      fontSize: '11px',
      fontStyle: 'bold',
      color,
      backgroundColor: '#17110d',
      padding: { x: 4, y: 1 },
    }).setOrigin(0.5);
    this.fx.add(label);
    this.track(this.scene.tweens.add({
      targets: label,
      y: at.y - 12,
      alpha: 0,
      delay: this.reduced ? 500 : 900,
      duration: 500,
      onComplete: () => label.destroy(),
    }));
  }

  // ---- Traps --------------------------------------------------------------------

  /** The light catches the trap before it springs, and the party stops short. */
  private async revealTrap(kind: MineTrapDamage, at: Point, u: Point): Promise<void> {
    const { scene } = this;
    const half = TUNNEL / 2;
    const spot = (ahead: number, side: number, up = 0): Point =>
      ({ x: at.x + u.x * ahead - u.y * side, y: at.y + u.y * ahead + u.x * side - up });
    const g = scene.add.graphics();
    g.lineStyle(1.5, 0xffe6a0, 0.95);
    if (kind === '1d3') {
      const a = spot(0, -half);
      const b = spot(0, half);
      g.lineBetween(a.x, a.y, b.x, b.y);
      for (const ahead of [-6, 0, 6]) {
        const hole = spot(ahead, half + 1, 10);
        g.strokeCircle(hole.x, hole.y, 1.5);
      }
    } else if (kind === '2d4') {
      g.strokePoints([spot(-8, -half + 2), spot(8, -half + 2), spot(8, half - 2), spot(-8, half - 2)], true);
    } else if (kind === '3d3') {
      const a = spot(-10, half + 3, 12);
      const b = spot(10, half + 3, 12);
      g.lineBetween(a.x, a.y, b.x, b.y);
    } else {
      g.strokePoints([spot(-14, -half, 8), spot(-6, -3, 8), spot(-1, 4, 8), spot(6, -2, 8), spot(14, half, 8)], false);
    }
    this.fx.add(g);
    this.word(kind === '2d6' || kind === '1d20' ? 'LOOSE ROOF' : 'TRAP SPOTTED', { x: at.x, y: at.y - 36 }, MENU_HEX.brassLight);
    if (!this.reduced) this.track(scene.tweens.add({ targets: g, alpha: 0.35, duration: 180, yoyo: true, repeat: 3 }));
    await this.sleep(this.reduced ? 160 : 600);
    if (this.disposed) return;
    this.track(scene.tweens.add({ targets: g, alpha: 0, delay: 900, duration: 400, onComplete: () => g.destroy() }));
  }

  /** A trap springs: the view closes in, names it, plays it out, and pulls back if anyone still stands. */
  private async trapMoment(trap: MineTrapShow, walker: Walker, at: Point, u: Point): Promise<void> {
    if (this.disposed) return;
    const tell = this.banner(trap, walker);
    playSound('ui.click');
    if (!this.reduced) {
      this.camLocked = true;
      await this.tweenTo(this.cam, { x: at.x, y: at.y - 12, zoom: TRAP_ZOOM }, 260, 'Cubic.Out');
      if (this.disposed) return;
    }
    await this.springTrap(trap, walker, at, u, tell);
    if (this.disposed) return;
    const standing = this.walkers.find((other) => !other.fallen);
    // Nobody left standing: the view stays on the fallen until the run is called.
    if (!standing) return;
    this.closeBanner();
    if (!this.reduced) {
      await this.tweenTo(this.cam, { x: standing.at.x, y: standing.at.y, zoom: 1 }, 420, 'Sine.InOut');
      if (this.disposed) return;
    }
    this.follow = { ...standing.at };
    this.camLocked = false;
  }

  /** A plate over the window naming the trap; returns how to say, once it has, what it did. */
  private banner(trap: MineTrapShow, walker: Walker): (line: string, color: string) => void {
    const { scene } = this;
    this.stage.removeAll(true);
    const who = trap.who || walker.look.name || 'Someone';
    const plate = scene.add.container(FRAME.x, VIEW.y + 46);
    const back = scene.add.graphics();
    back.fillStyle(0x0b0907, 0.92).fillRoundedRect(-180, -30, 360, 60, 6);
    back.lineStyle(2, TRAP_RED, 1).strokeRoundedRect(-180, -30, 360, 60, 6);
    const icon = scene.add.image(-150, 0, mineTrapIconTextureKey(trap.kind)).setScale(2);
    const title = scene.add.text(-124, -24, `${MINE_TRAP_NAME[trap.kind].toUpperCase()}!`, {
      fontFamily: MENU_FONT.display,
      fontSize: '22px',
      fontStyle: 'bold',
      color: '#ff8a7a',
    });
    const line = scene.add.text(-124, 6, trap.spotted ? `Spotted. ${who} braces.` : `${who} sets it off.`, {
      fontFamily: MENU_FONT.control,
      fontSize: '13px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    });
    plate.add([back, icon, title, line]);
    this.stage.add(plate);
    if (!this.reduced) {
      plate.setScale(0.85).setAlpha(0);
      this.track(scene.tweens.add({ targets: plate, scale: 1, alpha: 1, duration: 170, ease: 'Back.Out' }));
    }
    return (text, color) => {
      if (line.active) line.setText(text).setColor(color);
    };
  }

  private closeBanner(): void {
    for (const child of [...this.stage.list]) {
      this.track(this.scene.tweens.add({
        targets: child,
        alpha: 0,
        delay: this.reduced ? 400 : 700,
        duration: 320,
        onComplete: () => child.destroy(),
      }));
    }
  }

  /** Play a trap out as it was rolled: what fires, and whether it finds its mark. */
  private async springTrap(
    trap: MineTrapShow,
    walker: Walker,
    at: Point,
    u: Point,
    tell: (line: string, color: string) => void,
  ): Promise<void> {
    if (this.disposed) return;
    const n = { x: -u.y, y: u.x };
    const who = trap.who || walker.look.name || 'Someone';
    const strike = (): void => {
      if (trap.dodged || this.disposed) return;
      this.hurt(walker, trap.damage, trap.kind === '3d3' ? 'hit.slash' : trap.kind === '1d3' || trap.kind === '2d4' ? 'hit.pierce' : 'hit.physical');
      tell(
        trap.fatal ? `${who} takes ${trap.damage} damage and falls.`
          : trap.clung ? `${who} takes ${trap.damage} damage, clinging on at 1 HP!`
            : `${who} takes ${trap.damage} damage.`,
        trap.fatal ? '#ff8a7a' : trap.clung ? '#ffcf7a' : MENU_HEX.bone,
      );
    };
    if (trap.dodged) {
      this.dodge(walker, u);
      tell(`${who} dodges!`, '#9fe6a0');
    }
    if (this.reduced) {
      strike();
      if (!trap.dodged) this.word('TRAP', { x: at.x, y: at.y - 30 }, '#ff8a7a');
      await this.sleep(240);
    } else if (trap.kind === '1d3') {
      await this.darts(walker, at, u, n, strike, trap.dodged);
    } else if (trap.kind === '2d4') {
      await this.spikes(at, u, n, strike);
    } else if (trap.kind === '3d3') {
      await this.blade(at, n, strike);
    } else {
      await this.rockfall(at, u, n, strike, trap.kind === '1d20');
    }
    if (this.disposed) return;
    if (trap.fatal && !trap.dodged) {
      this.fall(walker);
      await this.sleep(this.reduced ? 120 : 560);
    } else {
      await this.sleep(this.reduced ? 60 : 260);
    }
  }

  /** Holes in the wall, and darts across the passage. */
  private async darts(walker: Walker, at: Point, u: Point, n: Point, strike: () => void, dodged: boolean): Promise<void> {
    const { scene } = this;
    const side = Math.random() < 0.5 ? 1 : -1;
    const wall = { x: at.x + n.x * side * (TUNNEL / 2 + 1), y: at.y + n.y * side * (TUNNEL / 2 + 1) };
    const across = { x: -n.x * side, y: -n.y * side };
    const angle = Math.atan2(across.y, across.x);
    this.dust({ x: wall.x, y: wall.y - 10 }, 3, 5);
    playSound('melee.swing');
    for (let k = 0; k < 3; k++) {
      const start = { x: wall.x + u.x * (k - 1) * 6, y: wall.y + u.y * (k - 1) * 6 - 10 };
      const hits = !dodged && k === 1;
      const stop = hits
        ? { x: walker.at.x, y: walker.at.y - 14 }
        : { x: start.x + across.x * (TUNNEL + 2), y: start.y + across.y * (TUNNEL + 2) };
      const dart = scene.add.rectangle(start.x, start.y, 12, 2, 0xddd5c2).setRotation(angle);
      this.airFx.add(dart);
      this.track(scene.tweens.add({
        targets: dart,
        x: stop.x,
        y: stop.y,
        duration: 150,
        delay: k * 90,
        onComplete: () => {
          if (hits) {
            strike();
            dart.destroy();
            return;
          }
          this.track(scene.tweens.add({ targets: dart, alpha: 0, delay: 1000, duration: 400, onComplete: () => dart.destroy() }));
        },
      }));
    }
    await this.sleep(90 * 2 + 150 + 360);
  }

  /** A plate gives underfoot, and spikes stab up out of the floor. */
  private async spikes(at: Point, u: Point, n: Point, strike: () => void): Promise<void> {
    const { scene } = this;
    const half = TUNNEL / 2 - 2;
    const corner = (ahead: number, side: number): Point =>
      ({ x: at.x + u.x * ahead + n.x * side, y: at.y + u.y * ahead + n.y * side });
    const plate = scene.add.graphics();
    plate.fillStyle(0x2a2826, 1).fillPoints([corner(-8, -half), corner(8, -half), corner(8, half), corner(-8, half)], true);
    this.floorFx.add(plate);
    const spikes = scene.add.graphics();
    this.airFx.add(spikes);
    const spots = Array.from({ length: 6 }, (_, k) => corner((k % 2) * 5 - 2.5, (k - 2.5) * 3.4));
    const draw = (height: number): void => {
      spikes.clear();
      if (height < 1) return;
      for (const spot of spots) {
        spikes.fillStyle(0x9aa2a4, 1).fillTriangle(spot.x - 2.2, spot.y, spot.x + 2.2, spot.y, spot.x, spot.y - height);
        spikes.lineStyle(1, 0xdfe5e6, 0.9).lineBetween(spot.x, spot.y - 1, spot.x, spot.y - height + 1);
      }
    };
    await this.counter(0, 16, 110, 'Back.Out', draw);
    if (this.disposed) return;
    strike();
    this.dust(at, 4, 8);
    await this.sleep(320);
    if (this.disposed) return;
    await this.counter(16, 0, 240, 'Sine.In', draw);
    spikes.destroy();
  }

  /** A blade on an iron arm swings out of the wall and across the passage. */
  private async blade(at: Point, n: Point, strike: () => void): Promise<void> {
    const { scene } = this;
    const side = Math.random() < 0.5 ? 1 : -1;
    const pivot = { x: at.x + n.x * side * (TUNNEL / 2 + 5), y: at.y + n.y * side * (TUNNEL / 2 + 5) - 12 };
    const arm = scene.add.graphics({ x: pivot.x, y: pivot.y });
    arm.lineStyle(2, 0x6a6d6e, 1).lineBetween(0, 0, 21, 0);
    arm.lineStyle(4, 0xc4ccce, 1);
    arm.beginPath();
    arm.arc(21, 0, 7, -1.3, 1.3);
    arm.strokePath();
    arm.fillStyle(0x4a4c4d, 1).fillCircle(0, 0, 2.5);
    const trail = scene.add.graphics({ x: pivot.x, y: pivot.y });
    this.airFx.add([trail, arm]);
    const across = Math.atan2(-n.y * side, -n.x * side);
    const sweep = 1.25;
    let struck = false;
    playSound('melee.swing');
    await this.counter(-sweep, sweep, 320, 'Sine.InOut', (t) => {
      arm.setRotation(across + t);
      trail.clear();
      trail.lineStyle(6, 0xc4ccce, 0.18);
      trail.beginPath();
      trail.arc(0, 0, 25, across - sweep, across + t);
      trail.strokePath();
      if (!struck && t >= 0) {
        struck = true;
        strike();
      }
    });
    if (this.disposed) return;
    trail.destroy();
    await this.counter(sweep, -0.4, 320, 'Sine.Out', (t) => arm.setRotation(across + t));
    if (this.disposed) return;
    this.track(scene.tweens.add({ targets: arm, alpha: 0, duration: 260, onComplete: () => arm.destroy() }));
  }

  /** Stone comes down from the roof: a few rocks, or (`heavy`) the roof itself. */
  private async rockfall(at: Point, u: Point, n: Point, strike: () => void, heavy: boolean): Promise<void> {
    const { scene } = this;
    const count = heavy ? 12 : 6;
    const stagger = heavy ? 40 : 65;
    const span = heavy ? 46 : 24;
    if (heavy) {
      playSound('spell.explode');
      this.shake = Math.max(this.shake, 2);
      this.track(scene.tweens.add({ targets: this.light, level: 0.55, duration: 160, yoyo: true, hold: 520, ease: 'Sine.InOut' }));
      this.later(380, () => this.dust(at, 14, 34));
    }
    let landed = 0;
    for (let k = 0; k < count; k++) {
      const spot = {
        x: at.x + u.x * (Math.random() - 0.5) * span + n.x * (Math.random() - 0.5) * (TUNNEL - 4),
        y: at.y + u.y * (Math.random() - 0.5) * span + n.y * (Math.random() - 0.5) * (TUNNEL - 4),
      };
      const size = (heavy ? 3 : 2) + Math.random() * (heavy ? 4 : 2.5);
      const shadow = scene.add.ellipse(spot.x, spot.y, size * 2.4, size * 1.1, 0x000000, 0.45).setScale(0.2);
      const rock = scene.add.circle(spot.x, spot.y - 60 - Math.random() * 40, size, k % 2 ? 0x6d6458 : 0x5b5246)
        .setStrokeStyle(1, 0x2a241d, 1);
      this.floorFx.add(shadow);
      this.airFx.add(rock);
      const delay = k * stagger + Math.random() * 40;
      this.track(scene.tweens.add({ targets: shadow, scale: 1, duration: 300, delay, ease: 'Quad.In' }));
      this.track(scene.tweens.add({
        targets: rock,
        y: spot.y,
        duration: 300,
        delay,
        ease: 'Quad.In',
        onComplete: () => {
          landed += 1;
          if (landed === Math.ceil(count / 2)) {
            strike();
            this.shake = Math.max(this.shake, heavy ? 6 : 3);
          }
          this.dust(spot, heavy ? 4 : 3, heavy ? 12 : 8);
          shadow.destroy();
          if (!heavy) this.track(scene.tweens.add({ targets: rock, alpha: 0, delay: 700, duration: 400, onComplete: () => rock.destroy() }));
        },
      }));
    }
    await this.sleep(count * stagger + 340 + (heavy ? 520 : 300));
  }

  /** A leap clear: off the feet and along the passage, and down again. */
  private dodge(walker: Walker, u: Point): void {
    this.word('EVADED', { x: walker.at.x, y: walker.at.y - 42 }, '#9fe6a0');
    if (this.reduced) return;
    const parts = walker.torch ? [walker.body, walker.torch] : [walker.body];
    this.track(this.scene.tweens.add({
      targets: parts,
      x: `+=${(u.x * 9).toFixed(1)}`,
      y: `+=${(u.y * 9 - 10).toFixed(1)}`,
      duration: 150,
      yoyo: true,
      ease: 'Quad.Out',
    }));
  }

  /** Struck: a flash, a flinch, blood on the floor, the damage over the head and the health bar dropping. */
  private hurt(walker: Walker, damage: number, sound: SoundName): void {
    const { scene } = this;
    const body = walker.body;
    playSound(sound);
    const lost = Math.min(damage, walker.look.hp);
    walker.look = { ...walker.look, hp: walker.look.hp - lost };
    this.drawHealth(walker, lost);
    this.later(450, () => this.drawHealth(walker));
    if (!this.reduced) {
      this.flash.setAlpha(0.32);
      this.track(scene.tweens.add({ targets: this.flash, alpha: 0, duration: 420, ease: 'Sine.Out' }));
    }
    if (body instanceof Phaser.GameObjects.Sprite) {
      body.setTintFill(0xffffff);
      this.later(70, () => body.active && body.setTint(0xff7a6a));
      this.later(300, () => body.active && !walker.fallen && body.clearTint());
      if (scene.anims.exists('mage-hit')) {
        body.play('mage-hit');
        body.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => this.animate(walker, walker.moving ? 'run' : 'idle'));
      }
    }
    for (let k = 0; k < 3; k++) {
      this.floorFx.add(scene.add.rectangle(
        walker.at.x + (Math.random() - 0.5) * 10,
        walker.at.y + (Math.random() - 0.5) * 4,
        2,
        2,
        0x8a1d14,
        0.9,
      ));
    }
    const number = scene.add.text(walker.at.x, walker.at.y - 46, `-${damage}`, {
      fontFamily: MENU_FONT.control,
      fontSize: '14px',
      fontStyle: 'bold',
      color: '#ff8a7a',
      stroke: '#17110d',
      strokeThickness: 3,
    }).setOrigin(0.5);
    this.fx.add(number);
    this.track(scene.tweens.add({
      targets: number,
      y: number.y - 18,
      alpha: 0,
      delay: 500,
      duration: 700,
      onComplete: () => number.destroy(),
    }));
    if (this.reduced) return;
    this.shake = Math.max(this.shake, 2.5);
    const parts = walker.torch ? [body, walker.torch] : [body];
    this.track(scene.tweens.add({ targets: parts, x: `-=${4 * walker.facing}`, duration: 60, yoyo: true, repeat: 1 }));
  }

  /** The trap's hit was the last: the walker goes down and stays where they fell; someone else takes up the light. */
  private fall(walker: Walker): void {
    walker.fallen = true;
    walker.moving = false;
    const body = walker.body;
    playSound('unit.death');
    if (body instanceof Phaser.GameObjects.Sprite) {
      body.anims.stop();
      body.setTint(0x8f8a84);
    }
    walker.ring.setVisible(false);
    this.word('FALLS', { x: walker.at.x, y: walker.at.y - 52 }, '#ff8a7a');
    this.track(this.scene.tweens.add({ targets: walker.health, alpha: 0, delay: 600, duration: 400 }));
    const heir = walker.look.light ? this.walkers.find((other) => !other.fallen) : undefined;
    if (heir) {
      heir.look = { ...heir.look, light: walker.look.light };
      walker.look = { ...walker.look, light: null };
      this.giveLight(walker);
      this.giveLight(heir);
    }
    const alone = !this.walkers.some((other) => !other.fallen);
    if (alone && !this.reduced) {
      this.flash.setAlpha(0.5);
      this.track(this.scene.tweens.add({ targets: this.flash, alpha: 0.16, duration: 900, ease: 'Sine.Out' }));
    }
    if (this.reduced) {
      body.setAngle(90 * walker.facing);
      walker.torch?.setAngle(90 * walker.facing).setPosition(10 * walker.facing, -1);
      return;
    }
    this.track(this.scene.tweens.add({ targets: body, angle: 90 * walker.facing, y: -3, duration: 340, ease: 'Quad.In' }));
    // A torch nobody can take up drops beside its bearer and burns on.
    if (walker.torch) {
      this.track(this.scene.tweens.add({
        targets: walker.torch,
        angle: 90 * walker.facing,
        x: 10 * walker.facing,
        y: -1,
        duration: 340,
        ease: 'Quad.In',
      }));
    }
  }

  // ---- Timing -------------------------------------------------------------------

  private counter(from: number, to: number, duration: number, ease: string, apply: (value: number) => void): Promise<void> {
    return new Promise((resolve) => {
      if (this.disposed) return resolve();
      const finish = this.hold(resolve);
      this.track(this.scene.tweens.addCounter({
        from,
        to,
        duration: Math.max(1, duration),
        ease,
        onUpdate: (tween) => apply(tween.getValue() ?? to),
        onComplete: () => {
          apply(to);
          finish();
        },
        onStop: finish,
      }));
    });
  }

  /** Tween a target's numbers, resolved when done (or when the view goes). */
  private tweenTo(target: object, props: Record<string, number>, duration: number, ease: string, delay = 0): Promise<void> {
    return new Promise((resolve) => {
      if (this.disposed) return resolve();
      const finish = this.hold(resolve);
      const tween = this.track(this.scene.tweens.add({ targets: target, ...props, duration, ease, delay, onComplete: finish }));
      tween.once(Phaser.Tweens.Events.TWEEN_STOP, finish);
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.disposed) return resolve();
      const finish = this.hold(resolve);
      this.sleepers.push(this.scene.time.delayedCall(ms, finish));
    });
  }

  /** Run `then` after `ms`, unless the view has gone by then. */
  private later(ms: number, then: () => void): void {
    this.sleepers.push(this.scene.time.delayedCall(ms, () => {
      if (!this.disposed) then();
    }));
  }

  /** A promise's resolve that also runs if the view is torn down first. */
  private hold(resolve: () => void): () => void {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      this.waiting.delete(finish);
      resolve();
    };
    this.waiting.add(finish);
    return finish;
  }

  private track(tween: Phaser.Tweens.Tween): Phaser.Tweens.Tween {
    this.running.add(tween);
    const forget = (): void => {
      this.running.delete(tween);
    };
    tween.once(Phaser.Tweens.Events.TWEEN_COMPLETE, forget);
    tween.once(Phaser.Tweens.Events.TWEEN_STOP, forget);
    return tween;
  }

  private stopTweens(): void {
    const tweens = [...this.running];
    this.running.clear();
    for (const tween of tweens) tween.stop();
  }

  /** Tweens of what glints and glows over the dark: stopped whenever the mine is redrawn. */
  private trackHint(tween: Phaser.Tweens.Tween): void {
    this.hintTweens.add(tween);
    const forget = (): void => {
      this.hintTweens.delete(tween);
    };
    tween.once(Phaser.Tweens.Events.TWEEN_COMPLETE, forget);
    tween.once(Phaser.Tweens.Events.TWEEN_STOP, forget);
  }

  private stopHints(): void {
    for (const timer of this.loops) timer.remove(false);
    this.loops = [];
    const tweens = [...this.hintTweens];
    this.hintTweens.clear();
    for (const tween of tweens) tween.stop();
  }
}
