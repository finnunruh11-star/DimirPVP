// Drawing a hex. A Hexcraft mage lays a sheet on a scribing table under a slowly
// turning magic circle: a row of 3x3 peg grids, each with a seal (an eye) above
// it. Dragging peg to peg draws lines, and each grid's lines read as a rune.
// Striking a seal turns its rune inside out; a chain from one grid into the next
// couples them, so the rest of the hex rides on the effect before the chain.
// Scribing spends 1 mana a stroke and turns the sheet into a Hexzettel.

import Phaser from 'phaser';
import { playSound } from '../../audio';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config/constants';
import {
  BRIDGE_BIT,
  BRIDGE_FROM,
  BRIDGE_TO,
  couplingLine,
  couplingMode,
  ECHO_LIMIT,
  edgeIndex,
  FACETS,
  HEX_EDGES,
  hexAction,
  hexManaCost,
  hexName,
  maskEdges,
  PAPERS,
  partLabel,
  partLines,
  readHex,
  RUNE_LINES,
  RUNE_ORDER,
  RUNES,
  SEAL_BIT,
  SEAL_PEG,
  SEAL_TARGET,
  strokeEdges,
  type CouplingMode,
  type Facet,
  type FacetDef,
  type GridReading,
  type HexAction,
  type HexPart,
  type HexReading,
  type HexRecipe,
  type PaperKind,
  type RuneId,
  type RuneKind,
} from '../../core/hexcraft/runes';
import type { Mage } from '../../core/Mage';
import type { Vec2 } from '../../core/utils';
import { SceneInput } from '../../engine/SceneInput';
import { memberIn } from '../../pve/exploration/economy';
import type { ExplorationActions } from '../../pve/exploration/intents';
import type { ExplorationRun } from '../../pve/exploration/run';
import { ensureGlowTextures, GLOW } from '../../visuals/glowTextures';
import { CabinetChip, MenuFocusGroup } from '../cabinet/controls';
import { isReducedMotion } from '../cabinet/motion';
import { MENU_FONT } from '../cabinet/theme';
import {
  alongLines,
  BURST_MOTES,
  BURST_TIME,
  CHAIN_FX,
  drawAura,
  drawBurst,
  drawLines,
  easeOut,
  ensureHexFxTextures,
  FX,
  mix,
  moteEmitterConfig,
  RAW_FX,
  SEAL_FX,
  strengthOf,
  textureKey,
  burstEmitterConfig,
  type BurstKind,
  type FxStyle,
  type MoteBurst,
  type Seg,
} from './hexFx';

export interface HexDrawHooks {
  actions: ExplorationActions;
  /** A hex was scribed: save the run and refresh what shows it. */
  changed(): void;
  close(): void;
}

interface Peg {
  grid: number;
  /** 0-8 on the grid, or SEAL_PEG for the seal above it. */
  peg: number;
}

type CodexSlot = RuneId | 'legend';
type TextStyle = Phaser.Types.GameObjects.Text.TextStyle;
type ParticleEmitter = Phaser.GameObjects.Particles.ParticleEmitter;

/** A grid's living look: its lines, the pegs they light, and the motes they shed. */
interface GridFx {
  key: string;
  facet: Facet | null;
  fx: FxStyle;
  segs: Seg[];
  pegs: Vec2[];
  centre: Vec2;
  seed: number;
  emitters: ParticleEmitter[];
  inverted: boolean;
  /** The wick from the top peg up to the eye. */
  seal: Seg;
}

/** A line being cut into the sheet, tip first. */
interface Carve {
  grid: number;
  key: string;
  a: Vec2;
  b: Vec2;
  start: number;
  dur: number;
}

interface Burst {
  kind: BurstKind;
  centre: Vec2;
  color: number;
  start: number;
  dur: number;
  seed: number;
}

const GRID = 132;
const PEG_GAP = 44;
const PEG_INSET = 22;
const PEG_HIT = 17;
const BRIDGE_GAP = 30;
const GRIDS_TOP = 176;
const SHEET = { x: 36, y: 112, w: 828, h: 282 };
const WEAVE = { x: 36, y: 406, w: 828, h: 196 };
const CODEX = { x: 884, y: 112, w: 360, h: 490 };
const CELL = { w: 172, h: 36 };
const TAU = Math.PI * 2;
const ADD = Phaser.BlendModes.ADD;
const CIRCLE_OUTER = 'hexdraw-circle-outer';
const CIRCLE_INNER = 'hexdraw-circle-inner';
const CARVE_MS = 170;
const COOL_MS = 450;

const GOLD = 0xe8c872;
const GOLD_DIM = 0x7d6a3e;
const EMBER = 0xff5a74;
const VIOLET = 0x8a6cff;
const PALE = 0xcfc6e6;
const PLATE = 0x0b0916;
const RULE = 0x3a2f5c;
const TXT = { gold: '#e8c872', bone: '#ece3cc', ash: '#9d94bb', ember: '#ff8a9c', dim: '#5f587a' } as const;

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
const KIND_LABEL: Record<RuneKind, string> = { effect: 'EFFECT', target: 'TARGET', modifier: 'MODIFIER' };
const ACTION_LABEL: Record<HexAction, string> = { main: 'MAIN ACTION', bonus: 'BONUS ACTION', full: 'MAIN + BONUS ACTION' };
const LINK_WORD: Record<CouplingMode, string> = { impact: 'ON IMPACT', tick: 'EACH TICK', ground: 'FROM THE GROUND' };
const BURST_SOUND: Record<BurstKind, Parameters<typeof playSound>[0]> = {
  tap: 'ui.hover',
  blast: 'spell.fire',
  gust: 'spell.blink',
  vortex: 'spell.pull',
  bloom: 'spell.heal',
  ripple: 'spell.cast',
  splash: 'spell.corrosive',
  arc: 'spell.lightning',
  smoke: 'spell.vanish',
  spin: 'spell.psychic',
  quake: 'spell.impact',
  crack: 'spell.shatter',
  lock: 'ui.confirm',
  radiance: 'spell.heal',
  ward: 'spell.summon',
  glimmer: 'ui.confirm',
};

const HINT = 'Drag from peg to peg, or click two pegs, to draw; each stroke costs 1 mana. '
  + 'The eye above a grid inverts its rune; a chain between grids couples them. Z undoes, Esc leaves.';
const PRIMER = 'Draw a rune on each grid: effects say what happens, one target rune says where, modifiers say how much. '
  + 'Strike the eye above a grid down to its top peg to turn its rune inside out. '
  + "Chain a grid's right-hand pegs to the next grid's left-hand pegs to couple them: the effect before the chain carries the rest of the hex.";
const LEGEND = "The eye above each grid is its seal. A stroke from the seal down to the top peg turns the grid's rune inside out: "
  + 'Wind becomes Cyclone, Healing becomes Blight, Over Time becomes Burst, Single Target becomes Self, Bigger becomes Smaller.\n'
  + "A chain from a grid's right-hand pegs into the next grid's left-hand pegs couples them. The effect rune before the chain carries the next part: "
  + `it fires where the carrier strikes (${ECHO_LIMIT} times at most), each time a lingering carrier ticks, or each time coupled ground bites. `
  + 'Each part takes its own target rune; without one it touches the unit struck. Seal and chain cost 1 mana each to draw.';

const css = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

/** A rune's lines as segments, its middle peg at (cx, cy), pegs `gap` apart, turned by `angle`. */
function glyphSegments(mask: number, cx: number, cy: number, gap: number, angle = 0): [Vec2, Vec2][] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const at = (peg: number): Vec2 => {
    const dx = ((peg % 3) - 1) * gap;
    const dy = (Math.floor(peg / 3) - 1) * gap;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  };
  return maskEdges(mask).map(([a, b]) => [at(a), at(b)]);
}

function dotted(g: Phaser.GameObjects.Graphics, a: Vec2, b: Vec2, color: number, alpha: number, step = 7): void {
  const count = Math.max(1, Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / step));
  g.fillStyle(color, alpha);
  for (let i = 1; i < count; i++) g.fillCircle(a.x + ((b.x - a.x) * i) / count, a.y + ((b.y - a.y) * i) / count, 1.3);
}

const partTone = (part: HexPart): number => FACETS[part.carrier ?? part.effects[0]].color;
const hexTone = (recipe: HexRecipe): number => partTone(recipe.parts[0]);
const shortName = (recipe: HexRecipe): string => hexName(recipe).replace(/^(Fine )?Hexzettel: /, '');

function costText(def: FacetDef): string {
  if (def.kind === 'modifier') return def.cost === 0 ? 'free' : `${def.cost > 0 ? '+' : ''}${def.cost} mana`;
  if (def.modCost != null) return `${def.cost} mana, ${def.modCost} as a modifier`;
  return def.cost ? `${def.cost} mana to loose` : 'free to loose';
}

export class HexDrawView extends Phaser.GameObjects.Container {
  private readonly sceneInput: SceneInput;
  private readonly reduced = isReducedMotion();
  private focus = new MenuFocusGroup();
  private grids: number[];
  private history: number[][] = [];
  /** The peg the pen rests on, ready to draw from. */
  private pen: Peg | null = null;
  private dragging = false;
  /** The press being held has drawn by dragging. */
  private dragDrew = false;
  private gestureSaved = false;
  private pointer: Vec2 = { x: -999, y: -999 };
  private message = '';
  private working = false;
  private disposed = false;
  /** A stroke landed since the last paint: greet new runes and chains. */
  private celebrate = false;
  private lastFacets: (string | null)[] = [];
  private lastBridges: boolean[] = [];
  /** The grimoire entry under the pointer: the weave panel reads it out. */
  private hover: CodexSlot | null = null;
  /** A rune picked in the grimoire, ghosted on the grid to trace. */
  private guide: RuneId | null = null;
  private summaryKey = '';
  private loops: Phaser.Tweens.Tween[] = [];
  /** Rulings, plate tints and the traced guide. */
  private base!: Phaser.GameObjects.Graphics;
  /** Pegs, seals and the pen. */
  private pegs!: Phaser.GameObjects.Graphics;
  /** Redrawn every frame: the living lines, carving and bursts. */
  private fxGlow!: Phaser.GameObjects.Graphics;
  private fxCore!: Phaser.GameObjects.Graphics;
  private fxTop!: Phaser.GameObjects.Graphics;
  private fxMotes!: Phaser.GameObjects.Container;
  /** Sparks thrown off by the carving tip. */
  private chisel!: ParticleEmitter;
  private gridFx: (GridFx | null)[] = [];
  private carves: Carve[] = [];
  private bursts: Burst[] = [];
  /** When each freshly carved line was finished, while it still glows white-hot. */
  private cooling = new Map<string, number>();
  private manaBar!: Phaser.GameObjects.Graphics;
  private manaText!: Phaser.GameObjects.Text;
  private penHalo!: Phaser.GameObjects.Image;
  private plateGlows: Phaser.GameObjects.Image[] = [];
  private gridTexts: { rune: Phaser.GameObjects.Text; role: Phaser.GameObjects.Text }[] = [];
  private weave!: Phaser.GameObjects.Container;
  private infoText!: Phaser.GameObjects.Text;
  private scribeChip!: CabinetChip;
  private readonly offPointerUp: () => void;

  constructor(
    scene: Phaser.Scene,
    private readonly run: ExplorationRun,
    private paper: PaperKind,
    private readonly hooks: HexDrawHooks,
  ) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(125);
    ensureGlowTextures(scene);
    ensureHexFxTextures(scene);
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.tick, this);
    this.grids = Array.from({ length: PAPERS[paper].grids }, () => 0);
    this.sceneInput = new SceneInput(scene);
    this.sceneInput.bindKeys([
      { key: 'LEFT', capture: true, run: () => this.focus.move(-1) },
      { key: 'UP', capture: true, run: () => this.focus.move(-1) },
      { key: 'RIGHT', capture: true, run: () => this.focus.move(1) },
      { key: 'DOWN', capture: true, run: () => this.focus.move(1) },
      { key: 'TAB', capture: true, run: (event) => this.focus.move(event.shiftKey ? -1 : 1) },
      { key: 'SPACE', capture: true, run: () => this.focus.activate() },
      { key: 'ENTER', capture: true, run: () => this.focus.activate() },
      { key: 'ESC', capture: true, run: () => { if (!this.working) this.hooks.close(); } },
      { key: 'Z', run: () => this.undo() },
      { key: 'BACKSPACE', capture: true, run: () => this.undo() },
    ]);
    this.sceneInput.bindPointerDown((pointer) => this.press(pointer));
    this.sceneInput.bindPointerMove((pointer) => this.drag(pointer));
    const release = (): void => {
      // A dragged stroke ends where it is let go; a click leaves the pen ready for the next click.
      if (this.dragDrew) this.pen = null;
      this.dragging = false;
      this.dragDrew = false;
      if (!this.disposed) this.paintSheet();
    };
    scene.input.on('pointerup', release);
    this.offPointerUp = () => scene.input.off('pointerup', release);
    this.render();
  }

  override destroy(fromScene?: boolean): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.tick, this);
    this.stopLoops();
    this.offPointerUp();
    this.sceneInput.destroy();
    super.destroy(fromScene);
  }

  /** The run changed under the table (another player): show what is carried now. */
  refresh(): void {
    if (!this.disposed && !this.working) this.render();
  }

  // ---------------------------------------------------------------------------
  //  THE SHEET
  // ---------------------------------------------------------------------------

  private scribe(): Mage | undefined {
    return memberIn(this.run, this.hooks.actions.member);
  }

  private sheets(kind: PaperKind): number {
    const item = PAPERS[kind].item;
    return this.scribe()?.utility.filter((id) => id === item).length ?? 0;
  }

  private reading(): HexReading {
    return readHex(this.paper, this.grids);
  }

  private gridOrigin(index: number): Vec2 {
    const total = this.grids.length * GRID + (this.grids.length - 1) * BRIDGE_GAP;
    return { x: SHEET.x + (SHEET.w - total) / 2 + index * (GRID + BRIDGE_GAP), y: GRIDS_TOP };
  }

  private plateCentre(index: number): Vec2 {
    const origin = this.gridOrigin(index);
    return { x: origin.x + GRID / 2, y: origin.y + GRID / 2 };
  }

  private pegAt(grid: number, peg: number): Vec2 {
    const origin = this.gridOrigin(grid);
    if (peg === SEAL_PEG) return { x: origin.x + PEG_INSET + PEG_GAP, y: origin.y + PEG_INSET - PEG_GAP };
    return { x: origin.x + PEG_INSET + (peg % 3) * PEG_GAP, y: origin.y + PEG_INSET + Math.floor(peg / 3) * PEG_GAP };
  }

  /** The peg (or seal) under a screen point, if any. */
  private hitPeg(x: number, y: number): Peg | null {
    for (let grid = 0; grid < this.grids.length; grid++) {
      for (let peg = 0; peg <= SEAL_PEG; peg++) {
        const at = this.pegAt(grid, peg);
        if (Math.hypot(at.x - x, at.y - y) <= PEG_HIT) return { grid, peg };
      }
    }
    return null;
  }

  /** The grid a screen point is over, seal included. */
  private plateAt(at: Vec2): number | null {
    for (let grid = 0; grid < this.grids.length; grid++) {
      const origin = this.gridOrigin(grid);
      if (at.x >= origin.x - 8 && at.x <= origin.x + GRID + 8 && at.y >= origin.y - 34 && at.y <= origin.y + GRID + 8) return grid;
    }
    return null;
  }

  private press(pointer: Phaser.Input.Pointer): void {
    if (this.disposed || this.working) return;
    this.pointer = { x: pointer.x, y: pointer.y };
    const hit = this.hitPeg(pointer.x, pointer.y);
    if (!hit) {
      // Clicks on the chips and the grimoire fall through to them; anywhere else on the sheet lifts the pen.
      const onSheet = pointer.x >= SHEET.x && pointer.x <= SHEET.x + SHEET.w && pointer.y >= SHEET.y && pointer.y <= SHEET.y + SHEET.h;
      if (this.pen && onSheet) {
        this.pen = null;
        this.paintSheet();
      }
      return;
    }
    this.gestureSaved = false;
    this.dragDrew = false;
    if (this.pen && (this.pen.grid !== hit.grid || this.pen.peg !== hit.peg)) this.stroke(this.pen, hit);
    this.pen = hit;
    this.dragging = true;
    this.paintSheet();
  }

  private drag(pointer: Phaser.Input.Pointer): void {
    if (this.disposed || this.working) return;
    this.pointer = { x: pointer.x, y: pointer.y };
    if (this.dragging && this.pen) {
      const hit = this.hitPeg(pointer.x, pointer.y);
      if (hit && (hit.grid !== this.pen.grid || hit.peg !== this.pen.peg) && this.stroke(this.pen, hit)) {
        this.pen = hit;
        this.dragDrew = true;
      }
    }
    this.paintSheet();
  }

  /**
   * Draw from one peg to another: a line or two within a grid, the seal stroke
   * from a grid's eye to its top peg, or a chain from a grid's right-hand pegs to
   * the next grid's left-hand pegs. Returns whether such a stroke can be made.
   */
  private stroke(from: Peg, to: Peg): boolean {
    const next = [...this.grids];
    const cuts: Omit<Carve, 'start' | 'dur'>[] = [];
    if (from.grid === to.grid) {
      const grid = from.grid;
      if (from.peg === SEAL_PEG || to.peg === SEAL_PEG) {
        if ((from.peg === SEAL_PEG ? to.peg : from.peg) !== SEAL_TARGET) return false;
        if (!(next[grid] & SEAL_BIT)) cuts.push({ grid, key: 'seal', a: this.pegAt(grid, from.peg), b: this.pegAt(grid, to.peg) });
        next[grid] |= SEAL_BIT;
      } else {
        const lines = strokeEdges(from.peg, to.peg);
        if (!lines) return false;
        let at = from.peg;
        for (const line of lines) {
          const [p, q] = HEX_EDGES[line];
          const onward = p === at ? q : p;
          if (!(next[grid] & (1 << line))) cuts.push({ grid, key: `e${line}`, a: this.pegAt(grid, at), b: this.pegAt(grid, onward) });
          next[grid] |= 1 << line;
          at = onward;
        }
      }
    } else {
      const [left, right] = from.grid < to.grid ? [from, to] : [to, from];
      if (right.grid !== left.grid + 1 || !BRIDGE_FROM.includes(left.peg) || !BRIDGE_TO.includes(right.peg)) return false;
      if (!(next[left.grid] & BRIDGE_BIT)) {
        const { a, b } = this.chainSeg(left.grid);
        cuts.push(from === left ? { grid: left.grid, key: 'chain', a, b } : { grid: left.grid, key: 'chain', a: b, b: a });
      }
      next[left.grid] |= BRIDGE_BIT;
    }
    if (next.every((mask, index) => mask === this.grids[index])) return true;
    if (!this.gestureSaved) {
      this.history.push([...this.grids]);
      this.gestureSaved = true;
    }
    this.grids = next;
    const now = this.scene.time.now;
    const dur = this.reduced ? 1 : CARVE_MS;
    cuts.forEach((cut, order) => this.carves.push({ ...cut, start: now + order * dur, dur }));
    this.message = '';
    this.celebrate = true;
    playSound('ui.hover');
    return true;
  }

  private undo(): void {
    if (this.working) return;
    const last = this.history.pop();
    if (!last) return;
    const before = this.grids;
    this.grids = last;
    this.unmake(before);
    this.pen = null;
    this.message = '';
    playSound('ui.click');
    this.paintSheet();
  }

  private clearGrid(index: number | null): void {
    if (this.working) return;
    const cleared = this.grids.map((mask, at) => (index == null || at === index ? 0 : mask));
    if (cleared.every((mask, at) => mask === this.grids[at])) return;
    const before = this.grids;
    this.history.push([...before]);
    this.grids = cleared;
    this.unmake(before);
    this.pen = null;
    this.message = '';
    this.paintSheet();
  }

  private pickPaper(kind: PaperKind): void {
    if (kind === this.paper || this.working) return;
    const count = PAPERS[kind].grids;
    this.paper = kind;
    this.grids = Array.from({ length: count }, (_, index) => this.grids[index] ?? 0);
    // The last grid has nothing to chain into.
    this.grids[count - 1] &= ~BRIDGE_BIT;
    this.history = [];
    this.pen = null;
    playSound('ui.click');
    this.render();
  }

  private problem(reading: HexReading): string | null {
    const mage = this.scribe();
    if (!mage || mage.spellClass !== 'hexcraft') return 'Only a Hexcraft mage can draw a hex.';
    if (!mage.alive) return `${mage.name} has fallen.`;
    if (this.sheets(this.paper) === 0) return `No ${PAPERS[this.paper].name} to draw on.`;
    if (!reading.recipe) return reading.problem;
    if (mage.mana < reading.recipe.lines) return `Drawing it takes ${reading.recipe.lines} mana; ${mage.name} has ${mage.mana}.`;
    return null;
  }

  private async scribeHex(): Promise<void> {
    const reading = this.reading();
    const recipe = reading.recipe;
    if (this.working || !recipe || this.problem(reading)) return;
    this.working = true;
    this.pen = null;
    this.dragging = false;
    this.message = '';
    this.paintSheet();
    this.charge(reading);
    const grids = [...this.grids];
    const result = await this.hooks.actions.apply({ op: 'hex', paper: PAPERS[this.paper].item, grids });
    if (this.disposed) return;
    if (!result.ok) {
      this.working = false;
      this.message = result.message;
      playSound('ui.deny');
      this.paintSheet();
      return;
    }
    this.hooks.changed();
    this.unveil(recipe, grids, () => {
      this.message = result.message;
      this.grids = this.grids.map(() => 0);
      this.history = [];
      this.guide = null;
      if (this.sheets(this.paper) === 0) {
        const other = (Object.keys(PAPERS) as PaperKind[]).find((kind) => this.sheets(kind) > 0);
        if (other) {
          this.paper = other;
          this.grids = Array.from({ length: PAPERS[other].grids }, () => 0);
        }
      }
      this.working = false;
      this.render();
    });
  }

  // ---------------------------------------------------------------------------
  //  BUILDING THE TABLE
  // ---------------------------------------------------------------------------

  private text(x: number, y: number, value: string, size: number, color: string, options: TextStyle = {}): Phaser.GameObjects.Text {
    const text = this.scene.add.text(x, y, value, { fontFamily: MENU_FONT.control, fontSize: `${size}px`, color, ...options });
    this.add(text);
    return text;
  }

  private chip(
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    onActivate: () => void,
    options: { tone?: 'normal' | 'primary' | 'danger'; enabled?: boolean } = {},
  ): CabinetChip {
    const chip = new CabinetChip(this.scene, x, y, { width, height, label, onActivate, ...options });
    this.add(chip);
    this.focus.add(chip);
    return chip;
  }

  private loop(config: Phaser.Types.Tweens.TweenBuilderConfig): Phaser.Tweens.Tween {
    const tween = this.scene.tweens.add(config);
    this.loops.push(tween);
    return tween;
  }

  private stopLoops(): void {
    for (const tween of this.loops) tween.stop();
    this.loops = [];
  }

  /** A dark panel edged in gold leaf. */
  private panel(g: Phaser.GameObjects.Graphics, rect: { x: number; y: number; w: number; h: number }, alpha: number): void {
    g.fillStyle(0x0d0a17, alpha).fillRect(rect.x, rect.y, rect.w, rect.h);
    g.lineStyle(1, GOLD_DIM, 0.95).strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
    g.lineStyle(1, GOLD_DIM, 0.35).strokeRect(rect.x + 4.5, rect.y + 4.5, rect.w - 9, rect.h - 9);
    const corners: [number, number][] = [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h]];
    for (const [x, y] of corners) {
      g.fillStyle(GOLD, 0.9).fillPoints([{ x, y: y - 6 }, { x: x + 6, y }, { x, y: y + 6 }, { x: x - 6, y }], true);
      g.fillStyle(PLATE, 1).fillCircle(x, y, 1.6);
    }
  }

  /** A magic circle drawn once in white, to be tinted and turned. */
  private circleTexture(key: string, radius: number, points: number, step: number, glyphs: boolean): string {
    const { scene } = this;
    if (scene.textures.exists(key)) return key;
    const size = Math.ceil(radius * 2 + 12);
    const c = size / 2;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    const white = 0xffffff;
    const ring = (r: number, width: number, alpha: number): void => {
      g.lineStyle(width, white, alpha).strokeCircle(c, c, r);
    };
    const inner = radius * 0.6;
    ring(radius, 2.5, 1);
    ring(radius - 16, 1, 0.8);
    ring(inner, 1.5, 0.9);
    ring(inner - 6, 1, 0.5);
    g.lineStyle(1, white, 0.75);
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * TAU;
      const from = radius - (i % 10 === 0 ? 16 : 7);
      g.lineBetween(c + Math.cos(a) * from, c + Math.sin(a) * from, c + Math.cos(a) * radius, c + Math.sin(a) * radius);
    }
    const star = Array.from({ length: points }, (_, i) => {
      const a = (i / points) * TAU - Math.PI / 2;
      return { x: c + Math.cos(a) * inner, y: c + Math.sin(a) * inner };
    });
    g.lineStyle(1.2, white, 0.8);
    star.forEach((p, i) => {
      const q = star[(i + step) % points];
      g.lineBetween(p.x, p.y, q.x, q.y);
    });
    for (const p of star) {
      g.fillStyle(white, 1).fillCircle(p.x, p.y, 3);
      g.lineStyle(1, white, 0.8).strokeCircle(p.x, p.y, 8);
    }
    if (glyphs) {
      // Every rune of the craft, written around the band.
      const band = (radius - 16 + inner) / 2;
      RUNE_ORDER.forEach((id, i) => {
        const a = (i / RUNE_ORDER.length) * TAU;
        g.lineStyle(1.4, white, 0.85);
        for (const [p, q] of glyphSegments(RUNES[id].masks[0], c + Math.cos(a) * band, c + Math.sin(a) * band, 8, a + Math.PI / 2)) {
          g.lineBetween(p.x, p.y, q.x, q.y);
        }
      });
    } else {
      ring(inner * 0.45, 1, 0.7);
    }
    g.generateTexture(key, size, size);
    g.destroy();
    scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
    return key;
  }

  private render(): void {
    this.stopLoops();
    this.removeAll(true);
    this.focus = new MenuFocusGroup();
    this.gridTexts = [];
    this.plateGlows = [];
    this.gridFx = [];
    this.carves = [];
    this.bursts = [];
    this.cooling.clear();
    this.summaryKey = '';
    this.add(this.scene.add.zone(0, 0, GAME_WIDTH, GAME_HEIGHT).setOrigin(0).setInteractive());
    this.renderSky();
    this.renderHeader();
    this.renderSheet();
    const weavePanel = this.scene.add.graphics();
    this.panel(weavePanel, WEAVE, 0.88);
    this.add(weavePanel);
    this.weave = this.scene.add.container(0, 0);
    this.add(this.weave);
    this.renderCodex();
    this.renderBar();
    const reading = this.reading();
    this.lastFacets = reading.grids.map((grid) => grid.facet);
    this.lastBridges = this.grids.map((mask) => !!(mask & BRIDGE_BIT));
    this.paintSheet();
  }

  /** Night, nebulae, a turning magic circle and drifting motes. */
  private renderSky(): void {
    const { scene } = this;
    this.add(scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x07060d, 1).setOrigin(0));
    const nebula = (x: number, y: number, scale: number, tint: number, alpha: number): void => {
      this.add(scene.add.image(x, y, GLOW.soft).setScale(scale).setTint(tint).setAlpha(alpha).setBlendMode(ADD));
    };
    nebula(450, 290, 9, 0x2a1858, 0.75);
    nebula(1064, 360, 6.5, 0x10284a, 0.6);
    nebula(220, 650, 5, 0x3a1030, 0.4);
    const centre = { x: SHEET.x + SHEET.w / 2, y: SHEET.y + SHEET.h / 2 + 34 };
    const outer = scene.add.image(centre.x, centre.y, this.circleTexture(CIRCLE_OUTER, 270, 8, 3, true))
      .setTint(VIOLET).setAlpha(0.2).setBlendMode(ADD);
    const inner = scene.add.image(centre.x, centre.y, this.circleTexture(CIRCLE_INNER, 150, 6, 2, false))
      .setTint(GOLD).setAlpha(0.12).setBlendMode(ADD);
    this.add([outer, inner]);
    if (!this.reduced) {
      this.loop({ targets: outer, angle: 360, duration: 160000, repeat: -1 });
      this.loop({ targets: inner, angle: -360, duration: 90000, repeat: -1 });
      this.loop({ targets: inner, alpha: 0.2, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
    this.add(scene.add.particles(0, 0, GLOW.soft, {
      x: { min: 0, max: GAME_WIDTH },
      y: { min: GAME_HEIGHT - 10, max: GAME_HEIGHT + 30 },
      lifespan: { min: 7000, max: 12000 },
      speedY: { min: -40, max: -12 },
      speedX: { min: -10, max: 10 },
      scale: { start: 0.08, end: 0.015 },
      alpha: { start: 0.7, end: 0 },
      tint: [GOLD, VIOLET, 0x7fd0ff],
      blendMode: ADD,
      frequency: this.reduced ? 900 : 150,
      advance: 9000,
    }));
    this.add(scene.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, GLOW.vignette).setDisplaySize(GAME_WIDTH * 1.25, GAME_HEIGHT * 1.45).setAlpha(0.9));
  }

  private renderHeader(): void {
    const mage = this.scribe();
    this.text(36, 20, 'DRAW HEX', 32, TXT.gold, { fontFamily: MENU_FONT.display, fontStyle: 'bold' })
      .setShadow(0, 0, css(VIOLET), 14, false, true);
    this.text(38, 62, mage
      ? `${mage.name}, Hexcraft  \u00b7  ${PAPERS[this.paper].name}: ${this.sheets(this.paper)} carried  \u00b7  ${PAPERS[this.paper].grids} grids`
      : 'Nobody here can draw.', 13, TXT.ash, { fontFamily: MENU_FONT.body });
    this.manaBar = this.scene.add.graphics();
    this.add(this.manaBar);
    this.manaText = this.text(290, 82, '', 12, TXT.bone);
    (Object.keys(PAPERS) as PaperKind[]).forEach((kind, index) => {
      this.chip(884 + index * 184, 30, 176, 34, `${PAPERS[kind].name} x${this.sheets(kind)}`, () => this.pickPaper(kind), {
        tone: kind === this.paper ? 'primary' : 'normal',
        enabled: this.sheets(kind) > 0 || kind === this.paper,
      });
    });
    this.text(886, 72, `${PAPERS.plain.name} holds ${PAPERS.plain.grids} grids, ${PAPERS.fine.name} ${PAPERS.fine.grids}: room for longer chains.`, 11, TXT.ash, {
      fontFamily: MENU_FONT.body,
    });
  }

  private renderSheet(): void {
    const { scene } = this;
    const sheet = scene.add.graphics();
    this.panel(sheet, SHEET, 0.84);
    this.add(sheet);
    this.text(SHEET.x + SHEET.w / 2, SHEET.y + 9, `${PAPERS[this.paper].name.toUpperCase()}  \u00b7  ${this.grids.length} GRIDS`, 11, TXT.gold, {
      fontStyle: 'bold',
    }).setOrigin(0.5, 0);
    const plates = scene.add.graphics();
    this.add(plates);
    this.grids.forEach((_, index) => {
      const o = this.gridOrigin(index);
      const c = this.plateCentre(index);
      plates.fillStyle(PLATE, 0.94).fillRect(o.x, o.y, GRID, GRID);
      plates.lineStyle(1, RULE, 1).strokeRect(o.x + 0.5, o.y + 0.5, GRID - 1, GRID - 1);
      plates.lineStyle(1, RULE, 0.5).strokeCircle(c.x, c.y, GRID / 2 - 8);
      plates.lineStyle(1.5, GOLD_DIM, 0.9);
      for (const [x, y, dx, dy] of [[o.x, o.y, 1, 1], [o.x + GRID, o.y, -1, 1], [o.x, o.y + GRID, 1, -1], [o.x + GRID, o.y + GRID, -1, -1]]) {
        plates.lineBetween(x, y, x + dx * 10, y);
        plates.lineBetween(x, y, x, y + dy * 10);
      }
      this.text(o.x, o.y - 17, ROMAN[index], 11, TXT.dim, { fontStyle: 'bold' });
      const rune = this.text(c.x, o.y + GRID + 6, '', 15, TXT.bone, { fontFamily: MENU_FONT.display, fontStyle: 'bold', align: 'center' }).setOrigin(0.5, 0);
      const role = this.text(c.x, o.y + GRID + 27, '', 10, TXT.ash, { align: 'center', wordWrap: { width: GRID + 24 }, maxLines: 2 }).setOrigin(0.5, 0);
      this.gridTexts.push({ rune, role });
      this.chip(c.x - 38, o.y + GRID + 54, 76, 22, 'Clear', () => this.clearGrid(index));
    });
    // A formed rune washes its plate in its own light.
    this.grids.forEach((_, index) => {
      const centre = this.plateCentre(index);
      const wash = scene.add.image(centre.x, centre.y, GLOW.soft).setBlendMode(ADD).setScale(1.3).setVisible(false);
      this.plateGlows.push(wash);
      this.add(wash);
    });
    this.base = scene.add.graphics();
    this.fxGlow = scene.add.graphics().setBlendMode(ADD);
    this.fxMotes = scene.add.container(0, 0);
    this.fxCore = scene.add.graphics();
    this.pegs = scene.add.graphics();
    this.chisel = scene.add.particles(0, 0, GLOW.soft, {
      lifespan: { min: 220, max: 460 },
      speed: { min: 40, max: 170 },
      angle: { min: 0, max: 360 },
      gravityY: 380,
      scale: { start: 0.05, end: 0 },
      alpha: { start: 1, end: 0 },
      blendMode: ADD,
      emitting: false,
    });
    this.fxTop = scene.add.graphics().setBlendMode(ADD);
    this.penHalo = scene.add.image(0, 0, GLOW.soft).setBlendMode(ADD).setTint(GOLD).setScale(0.32).setAlpha(0.75).setVisible(false);
    this.add([this.base, this.fxGlow, this.fxMotes, this.fxCore, this.pegs, this.chisel, this.fxTop, this.penHalo]);
    if (!this.reduced) this.loop({ targets: this.penHalo, scale: 0.46, alpha: 0.45, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
  }

  /** Every rune, its glyph and what it becomes sealed, grouped as effects, targets and modifiers. */
  private renderCodex(): void {
    const { scene } = this;
    const g = scene.add.graphics();
    this.panel(g, CODEX, 0.9);
    const glow = scene.add.graphics().setBlendMode(ADD);
    const glyphs = scene.add.graphics();
    this.add([g, glow, glyphs]);
    this.text(CODEX.x + CODEX.w / 2, CODEX.y + 9, 'GRIMOIRE', 17, TXT.gold, { fontFamily: MENU_FONT.display, fontStyle: 'bold' })
      .setOrigin(0.5, 0).setShadow(0, 0, css(VIOLET), 10, false, true);
    this.text(CODEX.x + CODEX.w / 2, CODEX.y + 31, 'hover to read  \u00b7  click to trace  \u00b7  below each: what it becomes sealed', 10, TXT.ash).setOrigin(0.5, 0);
    const of = (kind: RuneKind): RuneId[] => RUNE_ORDER.filter((id) => FACETS[id].kind === kind);
    const slots: CodexSlot[] = [...of('effect'), ...of('target'), 'legend', ...of('modifier')];
    slots.forEach((slot, index) => {
      const row = Math.floor(index / 2);
      const x = CODEX.x + 8 + (index % 2) * CELL.w;
      const y = CODEX.y + 48 + row * CELL.h;
      const def = slot === 'legend' ? null : FACETS[slot];
      const color = def?.color ?? GOLD;
      if (row >= 6) g.fillStyle(row >= 9 ? 0xc0a0f0 : 0x7ec8b4, 0.06).fillRect(x, y, CELL.w - 4, CELL.h - 2);
      g.fillStyle(0x07060d, 0.95).fillRect(x + 2, y + 1, 32, 32);
      g.lineStyle(1, color, 0.45).strokeRect(x + 2.5, y + 1.5, 31, 31);
      const cx = x + 18;
      const cy = y + 17;
      if (slot === 'legend') {
        glyphs.fillStyle(0x6a5a96, 0.9);
        for (let peg = 0; peg < 9; peg++) glyphs.fillCircle(cx + ((peg % 3) - 1) * 8, cy + 2 + (Math.floor(peg / 3) - 1) * 8, 1.2);
        glow.lineStyle(4, EMBER, 0.3).lineBetween(cx, cy - 13, cx, cy - 6);
        glyphs.lineStyle(1.5, EMBER, 1).lineBetween(cx, cy - 13, cx, cy - 6);
        glyphs.fillStyle(EMBER, 1).fillCircle(cx, cy - 13, 2);
        glow.lineStyle(4, GOLD, 0.3).lineBetween(cx + 8, cy + 2, cx + 15, cy + 2);
        glyphs.lineStyle(1.5, GOLD, 1).lineBetween(cx + 8, cy + 2, cx + 15, cy + 2);
      } else {
        for (const [a, b] of glyphSegments(RUNES[slot].masks[0], cx, cy, 10)) {
          glow.lineStyle(5, color, 0.22).lineBetween(a.x, a.y, b.x, b.y);
          glyphs.lineStyle(1.6, mix(color, 0xffffff, 0.3), 1).lineBetween(a.x, a.y, b.x, b.y);
        }
        glyphs.fillStyle(0x6a5a96, 0.9);
        for (let peg = 0; peg < 9; peg++) glyphs.fillCircle(cx + ((peg % 3) - 1) * 10, cy + (Math.floor(peg / 3) - 1) * 10, 1.2);
      }
      const label = def ? def.label : 'Seal & Chain';
      const inverse = slot === 'legend' ? 'invert  \u00b7  couple' : `\u21ba ${FACETS[RUNES[slot].inverse].label}`;
      this.text(x + 40, y + 2, label, 12, css(color), { fontStyle: 'bold' });
      this.text(x + 40, y + 18, inverse, 10, slot === 'legend' ? TXT.ash : TXT.ember);
      const zone = scene.add.zone(x, y, CELL.w - 4, CELL.h - 2).setOrigin(0).setInteractive({ useHandCursor: slot !== 'legend' });
      zone.on('pointerover', () => {
        this.hover = slot;
        this.paintSummary(this.reading());
      });
      zone.on('pointerout', () => {
        if (this.hover !== slot) return;
        this.hover = null;
        this.paintSummary(this.reading());
      });
      zone.on('pointerdown', () => {
        if (slot === 'legend' || this.working) return;
        this.guide = this.guide === slot ? null : slot;
        playSound('ui.click');
        this.paintSheet();
      });
      this.add(zone);
    });
  }

  private renderBar(): void {
    this.infoText = this.text(40, 614, '', 12, TXT.ash, { fontFamily: MENU_FONT.body, wordWrap: { width: 524 }, maxLines: 4, lineSpacing: 2 });
    this.chip(576, 618, 92, 42, 'Undo', () => this.undo());
    this.chip(676, 618, 108, 42, 'Clear all', () => this.clearGrid(null));
    this.chip(792, 618, 112, 42, 'Leave', () => { if (!this.working) this.hooks.close(); });
    this.scribeChip = this.chip(912, 618, 332, 42, 'Scribe the hex', () => void this.scribeHex(), { tone: 'primary' });
  }

  // ---------------------------------------------------------------------------
  //  PAINTING THE INK
  // ---------------------------------------------------------------------------

  /** Repaint the still parts of the sheet and what each grid reads as; the lines themselves live in `tick`. */
  private paintSheet(): void {
    if (this.disposed || !this.base) return;
    const reading = this.reading();
    this.base.clear();
    this.pegs.clear();
    for (let index = 0; index < this.grids.length - 1; index++) {
      if (!(this.grids[index] & BRIDGE_BIT)) dotted(this.base, this.pegAt(index, 5), this.pegAt(index + 1, 3), GOLD, 0.2);
    }
    reading.grids.forEach((grid, index) => this.paintGrid(index, grid));
    this.paintGuide(reading);
    this.paintPen();
    this.syncFx(reading);
    this.greet(reading);
    this.paintSummary(reading);
  }

  private paintGrid(index: number, grid: GridReading): void {
    const { base, pegs } = this;
    const mask = this.grids[index];
    const origin = this.gridOrigin(index);
    const facet = grid.facet;
    const color = facet ? FACETS[facet].color : PALE;
    if (grid.inverted) base.fillStyle(0x6a1030, 0.3).fillRect(origin.x + 1, origin.y + 1, GRID - 2, GRID - 2);
    if (facet) base.lineStyle(1.5, color, 0.85).strokeRect(origin.x + 0.5, origin.y + 0.5, GRID - 1, GRID - 1);
    const seal = this.pegAt(index, SEAL_PEG);
    if (!grid.inverted) dotted(base, seal, this.pegAt(index, SEAL_TARGET), EMBER, 0.28);
    const used = new Set<number>();
    for (const [a, b] of maskEdges(mask)) {
      used.add(a);
      used.add(b);
    }
    for (let peg = 0; peg < 9; peg++) {
      const at = this.pegAt(index, peg);
      pegs.fillStyle(PLATE, 1).fillCircle(at.x, at.y, 6.5);
      if (used.has(peg)) {
        pegs.fillStyle(mix(color, 0xffffff, 0.35), 1).fillCircle(at.x, at.y, 4);
      } else {
        pegs.lineStyle(1, 0x6a5a96, 0.9).strokeCircle(at.x, at.y, 6);
        pegs.fillStyle(0x8e7fc0, 0.8).fillCircle(at.x, at.y, 2.2);
      }
    }
    // The seal: an eye that burns open once it is struck.
    const lit = grid.inverted;
    pegs.fillStyle(lit ? 0x3a0816 : PLATE, 1).fillCircle(seal.x, seal.y, 8.5);
    pegs.lineStyle(1.5, EMBER, lit ? 1 : 0.5).strokeCircle(seal.x, seal.y, 8.5);
    pegs.lineStyle(1.2, lit ? 0xffd6dd : EMBER, lit ? 1 : 0.55).strokeEllipse(seal.x, seal.y, 11, 6);
    pegs.fillStyle(lit ? 0xffffff : EMBER, lit ? 1 : 0.6).fillCircle(seal.x, seal.y, 1.8);

    this.plateGlows[index]?.setVisible(!!facet).setTint(color);
    const texts = this.gridTexts[index];
    if (!texts) return;
    if (!grid.lines) {
      texts.rune.setText('\u00b7  \u00b7  \u00b7').setColor(TXT.dim).setShadow(0, 0, '#000000', 0);
      texts.role.setText('');
      return;
    }
    if (!grid.rune || !facet) {
      const drawn = mask & RUNE_LINES;
      texts.rune.setText(drawn ? 'Unformed' : 'Awaiting a rune').setColor(drawn ? TXT.ember : TXT.ash).setShadow(0, 0, '#000000', 0);
      const count = maskEdges(mask).length;
      texts.role.setText(drawn ? `${count} stroke${count === 1 ? '' : 's'}` : grid.inverted ? 'SEALED' : 'CHAINED');
      return;
    }
    texts.rune.setText(FACETS[facet].label).setColor(css(color)).setShadow(0, 0, css(color), 10, false, true);
    const bits: string[] = [];
    if (grid.role) bits.push(grid.role === FACETS[facet].kind ? KIND_LABEL[grid.role] : `${KIND_LABEL[grid.role]} HERE`);
    if (grid.inverted) bits.push(`INVERTED ${FACETS[grid.rune].label.toUpperCase()}`);
    if (grid.coupled) bits.push('CHAINED \u00bb');
    texts.role.setText(bits.join('  \u00b7  '));
  }

  /** The grimoire rune being traced, ghosted where the hand is working. */
  private paintGuide(reading: HexReading): void {
    if (!this.guide) return;
    const index = this.plateAt(this.pointer) ?? this.pen?.grid ?? this.grids.findIndex((mask) => !(mask & RUNE_LINES));
    if (index < 0 || reading.grids[index].rune === this.guide) return;
    const color = FACETS[this.guide].color;
    for (const [a, b] of maskEdges(RUNES[this.guide].masks[0])) {
      dotted(this.base, this.pegAt(index, a), this.pegAt(index, b), color, 0.8, 5);
    }
  }

  /** Where the pen rests, what it could reach with a seal or a chain, and the stroke being dragged. */
  private paintPen(): void {
    const { pegs, pen } = this;
    const hover = this.hitPeg(this.pointer.x, this.pointer.y);
    if (hover && !(pen && pen.grid === hover.grid && pen.peg === hover.peg)) {
      const at = this.pegAt(hover.grid, hover.peg);
      pegs.lineStyle(1.5, GOLD, 0.6).strokeCircle(at.x, at.y, 11);
    }
    this.penHalo.setVisible(!!pen && !this.working);
    if (!pen || this.working) return;
    const at = this.pegAt(pen.grid, pen.peg);
    this.penHalo.setPosition(at.x, at.y);
    pegs.lineStyle(2, GOLD, 1).strokeCircle(at.x, at.y, 11);
    for (const target of this.linkTargets(pen)) {
      const spot = this.pegAt(target.grid, target.peg);
      pegs.lineStyle(1.5, target.peg === SEAL_PEG || target.peg === SEAL_TARGET ? EMBER : GOLD, 0.8).strokeCircle(spot.x, spot.y, 13);
    }
    if (this.dragging) {
      pegs.lineStyle(5, GOLD, 0.12).lineBetween(at.x, at.y, this.pointer.x, this.pointer.y);
      pegs.lineStyle(1.5, GOLD, 0.6).lineBetween(at.x, at.y, this.pointer.x, this.pointer.y);
    }
  }

  /** The seal and chain strokes open from a peg, not yet drawn. */
  private linkTargets(pen: Peg): Peg[] {
    const { grid, peg } = pen;
    const targets: Peg[] = [];
    if (!(this.grids[grid] & SEAL_BIT)) {
      if (peg === SEAL_PEG) targets.push({ grid, peg: SEAL_TARGET });
      if (peg === SEAL_TARGET) targets.push({ grid, peg: SEAL_PEG });
    }
    if (BRIDGE_FROM.includes(peg) && grid < this.grids.length - 1 && !(this.grids[grid] & BRIDGE_BIT)) {
      targets.push(...BRIDGE_TO.map((to) => ({ grid: grid + 1, peg: to })));
    }
    if (BRIDGE_TO.includes(peg) && grid > 0 && !(this.grids[grid - 1] & BRIDGE_BIT)) {
      targets.push(...BRIDGE_FROM.map((from) => ({ grid: grid - 1, peg: from })));
    }
    return targets;
  }

  private segOf(grid: number, p: number, q: number, fx: FxStyle, centre: Vec2): Seg {
    const a = this.pegAt(grid, p);
    const b = this.pegAt(grid, q);
    const outward = Math.hypot(a.x - centre.x, a.y - centre.y) - Math.hypot(b.x - centre.x, b.y - centre.y);
    const salt = edgeIndex(p, q);
    return { a, b, len: Math.hypot(b.x - a.x, b.y - a.y), salt, reverse: fx.inward ? outward < 0 : outward > 0, key: `e${salt}` };
  }

  private chainSeg(index: number): Seg {
    const a = this.pegAt(index, 5);
    const b = this.pegAt(index + 1, 3);
    return { a, b, len: b.x - a.x, salt: 50 + index, reverse: false, key: 'chain' };
  }

  /** Keep each grid's living look in step with what is drawn on it. */
  private syncFx(reading: HexReading): void {
    reading.grids.forEach((grid, index) => {
      const mask = this.grids[index] & (RUNE_LINES | SEAL_BIT);
      const key = `${grid.facet ?? '-'}|${mask}`;
      const current = this.gridFx[index];
      if (current?.key === key) return;
      for (const emitter of current?.emitters ?? []) emitter.destroy();
      this.gridFx[index] = mask ? this.buildFx(index, grid, key) : null;
    });
  }

  private buildFx(index: number, grid: GridReading, key: string): GridFx {
    const fx = grid.facet ? FX[grid.facet] : RAW_FX;
    const centre = this.plateCentre(index);
    const edges = maskEdges(this.grids[index]);
    const segs = edges.map(([p, q]) => this.segOf(index, p, q, fx, centre));
    const lit = new Set<number>();
    for (const [p, q] of edges) {
      lit.add(p);
      lit.add(q);
    }
    const sealAt = this.pegAt(index, SEAL_PEG);
    const top = this.pegAt(index, SEAL_TARGET);
    const emitters: ParticleEmitter[] = [];
    if (fx.motes && segs.length) {
      emitters.push(this.scene.add.particles(0, 0, textureKey(fx.motes.texture), moteEmitterConfig(fx.motes, alongLines(segs), centre, this.reduced)));
    }
    if (grid.inverted) {
      // Embers rising off the burning eye.
      emitters.push(this.scene.add.particles(sealAt.x, sealAt.y, GLOW.soft, {
        lifespan: { min: 500, max: 900 },
        speed: { min: 6, max: 22 },
        angle: { min: -120, max: -60 },
        gravityY: -30,
        scale: { start: 0.05, end: 0 },
        alpha: { start: 0.9, end: 0 },
        tint: [EMBER, 0xffb070],
        blendMode: ADD,
        frequency: this.reduced ? 360 : 110,
        x: { min: -4, max: 4 },
        y: { min: -3, max: 3 },
      }));
    }
    this.fxMotes.add(emitters);
    return {
      key,
      facet: grid.facet,
      fx,
      segs,
      pegs: [...lit].map((peg) => this.pegAt(index, peg)),
      centre,
      seed: index * 1.73 + 0.4,
      emitters,
      inverted: grid.inverted,
      seal: { a: top, b: sealAt, len: top.y - sealAt.y, salt: 90 + index, reverse: false, key: 'seal' },
    };
  }

  /** Every frame: the living lines, chains and seals, the carving tip, and the bursts. */
  private tick(): void {
    if (this.disposed || !this.fxGlow?.active) return;
    const now = this.scene.time.now;
    const t = now / 1000;
    const reduced = this.reduced;
    const glow = this.fxGlow.clear();
    const core = this.fxCore.clear();
    const top = this.fxTop.clear();
    const carving = new Set(this.carves.filter((carve) => carve.start + carve.dur > now).map((carve) => `${carve.grid}:${carve.key}`));
    for (let index = 0; index < this.grids.length - 1; index++) {
      if (this.grids[index] & BRIDGE_BIT && !carving.has(`${index}:chain`)) this.drawChain(index, t, now);
    }
    this.gridFx.forEach((gfx, index) => {
      if (!gfx) return;
      const { fx, seed } = gfx;
      const strength = strengthOf(fx, t, seed, reduced);
      const live = gfx.segs.filter((seg) => !carving.has(`${index}:${seg.key}`));
      drawLines(glow, core, live, fx, t, seed, strength, reduced);
      for (const seg of live) this.cool(index, seg, fx, now);
      for (const peg of gfx.pegs) glow.fillStyle(fx.glow, 0.3 * strength).fillCircle(peg.x, peg.y, 10);
      if (gfx.facet && !reduced) drawAura(glow, fx, gfx.centre, t, seed, strength);
      this.plateGlows[index]?.setAlpha((gfx.inverted ? 0.3 : 0.24) * (0.5 + 0.5 * strength));
      if (gfx.inverted && !carving.has(`${index}:seal`)) {
        const burn = strengthOf(SEAL_FX, t, seed, reduced);
        drawLines(glow, core, [gfx.seal], SEAL_FX, t, seed, burn, reduced);
        this.cool(index, gfx.seal, SEAL_FX, now);
        glow.fillStyle(EMBER, 0.3 * burn).fillCircle(gfx.seal.b.x, gfx.seal.b.y, 13 + (reduced ? 0 : 2 * Math.sin(t * 5)));
      }
    });
    this.drawCarves(now);
    this.bursts = this.bursts.filter((burst) => {
      const p = (now - burst.start) / burst.dur;
      if (p >= 1) return false;
      if (p >= 0) drawBurst(top, burst.kind, burst.centre, burst.color, p, t, burst.seed);
      return true;
    });
  }

  /** A coupling: a chain of light, its links glinting, the carrier's power running along it. */
  private drawChain(index: number, t: number, now: number): void {
    const glow = this.fxGlow;
    const core = this.fxCore;
    const seg = this.chainSeg(index);
    const carrier = this.gridFx[index]?.facet;
    const charge = carrier ? FX[carrier].glow : GOLD;
    drawLines(glow, core, [seg], CHAIN_FX, t, index, strengthOf(CHAIN_FX, t, index, this.reduced), this.reduced);
    this.cool(index, seg, CHAIN_FX, now);
    const links = Math.max(3, Math.round(seg.len / 11));
    for (let i = 1; i < links; i++) {
      const x = seg.a.x + (seg.len * i) / links;
      core.lineStyle(1.5, GOLD, this.reduced ? 0.95 : 0.6 + 0.4 * Math.sin(t * 6 - i));
      if (i % 2) core.strokeEllipse(x, seg.a.y, 11, 6);
      else core.strokeEllipse(x, seg.a.y, 7, 3);
    }
    if (this.reduced) return;
    for (let k = 0; k < 3; k++) {
      const u = (t * 1.1 + k / 3) % 1;
      const x = seg.a.x + seg.len * u;
      const fade = Math.sin(Math.PI * u);
      glow.fillStyle(charge, 0.6 * fade).fillCircle(x, seg.a.y, 6);
      core.fillStyle(mix(charge, 0xffffff, 0.5), fade).fillCircle(x, seg.a.y, 2.4);
    }
  }

  /** A freshly carved line glows white-hot for a moment, then settles into its rune's colour. */
  private cool(index: number, seg: Seg, fx: FxStyle, now: number): void {
    const key = `${index}:${seg.key}`;
    const done = this.cooling.get(key);
    if (done == null) return;
    const heat = 1 - (now - done) / COOL_MS;
    if (heat <= 0) {
      this.cooling.delete(key);
      return;
    }
    this.fxGlow.lineStyle(12, 0xffffff, 0.22 * heat).lineBetween(seg.a.x, seg.a.y, seg.b.x, seg.b.y);
    this.fxCore.lineStyle(fx.width + 1.5, 0xffffff, heat).lineBetween(seg.a.x, seg.a.y, seg.b.x, seg.b.y);
  }

  /** Lines being cut: a white-hot groove behind a blazing tip that throws sparks. */
  private drawCarves(now: number): void {
    this.carves = this.carves.filter((carve) => {
      const p = (now - carve.start) / carve.dur;
      if (p < 0) return true;
      const fx = carve.key === 'chain' ? CHAIN_FX : carve.key === 'seal' ? SEAL_FX : this.gridFx[carve.grid]?.fx ?? RAW_FX;
      if (p >= 1) {
        this.cooling.set(`${carve.grid}:${carve.key}`, now);
        this.bursts.push({ kind: 'tap', centre: carve.b, color: fx.glow, start: now, dur: BURST_TIME.tap, seed: 0 });
        this.spray(carve.b, fx.glow, 7);
        return false;
      }
      const e = easeOut(p);
      const tip = { x: carve.a.x + (carve.b.x - carve.a.x) * e, y: carve.a.y + (carve.b.y - carve.a.y) * e };
      this.fxGlow.lineStyle(12, fx.glow, 0.32).lineBetween(carve.a.x, carve.a.y, tip.x, tip.y);
      this.fxCore.lineStyle(fx.width + 1.5, 0xffffff, 1).lineBetween(carve.a.x, carve.a.y, tip.x, tip.y);
      this.fxTop.fillStyle(fx.glow, 0.55).fillCircle(tip.x, tip.y, 11);
      this.fxTop.fillStyle(0xffffff, 1).fillCircle(tip.x, tip.y, 3.5);
      this.spray(tip, fx.glow, 2);
      return true;
    });
  }

  private spray(at: Vec2, color: number, count: number): void {
    if (this.reduced) return;
    this.chisel.setParticleTint([color, 0xffffff]);
    this.chisel.emitParticleAt(at.x, at.y, count);
  }

  /** Lines taken away (undone or cleared) crumble into falling motes. */
  private unmake(before: readonly number[]): void {
    const was = readHex(this.paper, before);
    before.forEach((mask, index) => {
      const gone = mask & ~(this.grids[index] ?? 0);
      if (!gone) return;
      this.carves = this.carves.filter((carve) => carve.grid !== index);
      const facet = was.grids[index]?.facet;
      const fx = facet ? FX[facet] : RAW_FX;
      const centre = this.plateCentre(index);
      const segs = maskEdges(gone & RUNE_LINES).map(([p, q]) => this.segOf(index, p, q, fx, centre));
      if (gone & SEAL_BIT) segs.push({ ...this.chainSeg(index), a: this.pegAt(index, SEAL_TARGET), b: this.pegAt(index, SEAL_PEG), len: PEG_GAP });
      if (gone & BRIDGE_BIT && index < before.length - 1) segs.push(this.chainSeg(index));
      if (!segs.length || this.reduced) return;
      const emitter = this.scene.add.particles(0, 0, GLOW.soft, {
        lifespan: { min: 400, max: 900 },
        speed: { min: 6, max: 40 },
        angle: { min: 0, max: 360 },
        gravityY: 160,
        scale: { start: 0.07, end: 0 },
        alpha: { start: 0.95, end: 0 },
        tint: [fx.glow, 0xffffff, mix(fx.glow, 0x000000, 0.4)],
        blendMode: ADD,
        emitting: false,
        emitZone: { type: 'random', source: alongLines(segs) },
      });
      this.fxMotes.add(emitter);
      emitter.explode(segs.length * 10);
      this.scene.time.delayedCall(1000, () => emitter.destroy());
    });
  }

  /** Each rune bursts in its own way as it takes shape, and each chain as it closes, once their carving is done. */
  private greet(reading: HexReading): void {
    const facets = reading.grids.map((grid) => grid.facet);
    const bridges = this.grids.map((mask) => !!(mask & BRIDGE_BIT));
    if (this.celebrate) {
      facets.forEach((facet, index) => {
        if (!facet || facet === this.lastFacets[index]) return;
        const inverted = reading.grids[index].inverted;
        this.afterCarving(index, () => this.formBurst(index, facet, inverted));
      });
      bridges.forEach((on, index) => {
        if (on && !this.lastBridges[index]) this.afterCarving(index, () => this.chainFlare(index));
      });
    }
    this.celebrate = false;
    this.lastFacets = facets;
    this.lastBridges = bridges;
  }

  private afterCarving(grid: number, then: () => void): void {
    const now = this.scene.time.now;
    const end = this.carves.filter((carve) => carve.grid === grid).reduce((last, carve) => Math.max(last, carve.start + carve.dur), now);
    this.scene.time.delayedCall(end - now, () => {
      if (!this.disposed) then();
    });
  }

  /** A rune takes shape: its own burst, a spray of light and motes. A sealed rune also folds in on itself in embers. */
  private formBurst(index: number, facet: Facet, inverted: boolean, quiet = false): void {
    const { scene } = this;
    const fx = FX[facet];
    const centre = this.plateCentre(index);
    const now = scene.time.now;
    if (!quiet) playSound(inverted ? 'spell.psychic' : BURST_SOUND[fx.burst]);
    this.bursts.push({ kind: fx.burst, centre, color: fx.glow, start: now, dur: BURST_TIME[fx.burst], seed: Math.random() * 10 });
    if (inverted) this.bursts.push({ kind: 'vortex', centre, color: EMBER, start: now, dur: BURST_TIME.vortex, seed: 1 });
    if (this.reduced) return;
    const rays = scene.add.image(centre.x, centre.y, GLOW.rays).setTint(fx.glow).setBlendMode(ADD).setScale(0.12).setAlpha(0.9);
    this.add(rays);
    scene.tweens.add({ targets: rays, scale: 0.55, alpha: 0, angle: inverted ? -70 : 70, duration: 760, ease: 'Cubic.Out', onComplete: () => rays.destroy() });
    const motes = BURST_MOTES[fx.burst];
    if (motes) this.explode(centre, motes, [fx.glow, mix(fx.glow, 0xffffff, 0.6)]);
    if (!quiet && (fx.burst === 'blast' || fx.burst === 'quake')) scene.cameras.main.shake(160, 0.004);
  }

  private explode(at: Vec2, spec: MoteBurst, tints: number[]): void {
    const emitter = this.scene.add.particles(at.x, at.y + (spec.low ?? 0), textureKey(spec.texture), burstEmitterConfig(spec, tints));
    this.add(emitter);
    emitter.explode(spec.count);
    this.scene.time.delayedCall(spec.life + 150, () => emitter.destroy());
  }

  private motes(x: number, y: number, color: number, count: number, speed: number, lifespan: number, parent: Phaser.GameObjects.Container = this): void {
    const emitter = this.scene.add.particles(x, y, GLOW.soft, {
      lifespan: { min: lifespan * 0.55, max: lifespan },
      speed: { min: speed * 0.25, max: speed },
      angle: { min: 0, max: 360 },
      scale: { start: 0.12, end: 0, ease: 'Quad.Out' },
      alpha: { start: 1, end: 0, ease: 'Quad.In' },
      tint: [color, 0xffffff, color],
      blendMode: ADD,
      emitting: false,
    });
    parent.add(emitter);
    emitter.explode(this.reduced ? Math.ceil(count * 0.35) : count);
    this.scene.time.delayedCall(lifespan + 150, () => emitter.destroy());
  }

  /** A chain closes: a ring of gold and sparks at its middle. */
  private chainFlare(index: number): void {
    const seg = this.chainSeg(index);
    const mid = { x: (seg.a.x + seg.b.x) / 2, y: seg.a.y };
    playSound('spell.blink');
    this.bursts.push({ kind: 'glimmer', centre: mid, color: GOLD, start: this.scene.time.now, dur: 520, seed: 0 });
    if (!this.reduced) this.explode(mid, { ...BURST_MOTES.arc!, count: 18 }, [GOLD, 0xfff1c0]);
  }

  // ---------------------------------------------------------------------------
  //  THE WEAVE: WHAT THE SHEET MAKES
  // ---------------------------------------------------------------------------

  private paintSummary(reading: HexReading): void {
    if (this.disposed || !this.weave) return;
    const mage = this.scribe();
    const lines = reading.grids.reduce((sum, grid) => sum + grid.lines, 0);
    const key = [this.paper, this.grids.join('.'), this.hover, this.guide, this.message, mage?.mana, this.working].join('|');
    if (key === this.summaryKey) return;
    this.summaryKey = key;
    const problem = this.problem(reading);
    const recipe = reading.recipe;
    this.paintMana(mage, lines);
    this.paintWeave(reading, lines);
    this.scribeChip.setLabel(recipe ? `Scribe the hex  \u00b7  ${recipe.lines} mana` : 'Scribe the hex');
    this.scribeChip.setEnabled(!problem && !this.working);
    const warning = problem && recipe ? problem : '';
    const tracing = this.guide ? `Tracing ${FACETS[this.guide].label}: follow the dotted lines. Click it in the grimoire again to put it away.` : '';
    this.infoText.setText(this.message || warning || tracing || HINT).setColor(this.message ? TXT.bone : warning ? TXT.ember : TXT.ash);
  }

  private paintMana(mage: Mage | undefined, lines: number): void {
    const g = this.manaBar.clear();
    const x = 38;
    const y = 88;
    const width = 240;
    const height = 8;
    g.fillStyle(0x05040a, 1).fillRect(x - 1, y - 1, width + 2, height + 2);
    g.lineStyle(1, RULE, 1).strokeRect(x - 1.5, y - 1.5, width + 3, height + 3);
    if (!mage) {
      this.manaText.setText('');
      return;
    }
    const max = Math.max(1, mage.maxMana);
    const have = (width * Math.max(0, Math.min(mage.mana, max))) / max;
    g.fillStyle(0x5a48d8, 1).fillRect(x, y, have, height);
    g.fillStyle(0x9d8cff, 0.6).fillRect(x, y, have, 2);
    const short = lines > mage.mana;
    if (lines > 0) {
      const cost = Math.min(have, (width * Math.min(lines, max)) / max);
      g.fillStyle(short ? EMBER : GOLD, 0.95).fillRect(x + have - cost, y, cost, height);
    }
    this.manaText
      .setText(`Mana ${mage.mana}/${mage.maxMana}${lines ? `  \u00b7  this sheet takes ${lines}` : ''}`)
      .setColor(short ? TXT.ember : TXT.bone);
  }

  private paintWeave(reading: HexReading, lines: number): void {
    const layer = this.weave;
    layer.removeAll(true);
    const left = WEAVE.x + 18;
    const right = WEAVE.x + WEAVE.w - 18;
    const bottom = WEAVE.y + WEAVE.h - 10;
    const put = (x: number, y: number, value: string, size: number, color: string, style: TextStyle = {}): Phaser.GameObjects.Text => {
      const text = this.scene.add.text(x, y, value, { fontFamily: MENU_FONT.control, fontSize: `${size}px`, color, ...style });
      layer.add(text);
      return text;
    };
    const heading = (value: string, color: string, glow: number | null): Phaser.GameObjects.Text => {
      const text = put(left, WEAVE.y + 26, value, 19, color, { fontFamily: MENU_FONT.display, fontStyle: 'bold', wordWrap: { width: right - left }, maxLines: 2 });
      if (text.height > 30) text.setFontSize(15);
      if (glow != null) text.setShadow(0, 0, css(glow), 10, false, true);
      return text;
    };
    const body = (y: number, value: string, color: string): Phaser.GameObjects.Text =>
      put(left, y, value, 12, color, {
        fontFamily: MENU_FONT.body,
        wordWrap: { width: right - left },
        lineSpacing: 3,
        maxLines: Math.max(1, Math.floor((bottom - y) / 18)),
      });
    const below = (text: Phaser.GameObjects.Text): number => text.y + text.height + 8;

    if (this.hover) {
      put(left, WEAVE.y + 10, 'GRIMOIRE', 11, TXT.gold, { fontStyle: 'bold' });
      if (this.hover === 'legend') {
        const title = heading('Seal and Chain', TXT.gold, VIOLET);
        const end = this.flow(below(title), [{ label: FACETS.wind.label, color: FACETS.wind.color }, { label: FACETS.cyclone.label, color: FACETS.cyclone.color }], ['SEALED'], false);
        body(end + 4, LEGEND, TXT.bone);
        return;
      }
      const base = FACETS[this.hover];
      const inverse = FACETS[RUNES[this.hover].inverse];
      put(right, WEAVE.y + 10, `${KIND_LABEL[base.kind]}  \u00b7  ${costText(base).toUpperCase()}`, 11, TXT.gold, { fontStyle: 'bold' }).setOrigin(1, 0);
      const title = heading(base.label, css(base.color), base.color);
      const end = this.flow(below(title), [{ label: base.label, color: base.color }, { label: inverse.label, color: inverse.color }], ['SEALED'], false);
      body(end + 4, `${base.text}\nSealed, it becomes ${inverse.label} (${costText(inverse)}): ${inverse.text}`, TXT.bone);
      return;
    }

    put(left, WEAVE.y + 10, 'THE WEAVE', 11, TXT.gold, { fontStyle: 'bold' });
    const recipe = reading.recipe;
    if (!recipe) {
      if (lines) put(right, WEAVE.y + 10, `${lines} STROKE${lines === 1 ? '' : 'S'}`, 11, TXT.ash, { fontStyle: 'bold' }).setOrigin(1, 0);
      const title = heading(lines ? 'The weave will not hold' : 'An unwritten sheet', lines ? TXT.ember : TXT.ash, lines ? EMBER : null);
      let y = below(title);
      if (lines && reading.problem) y = below(body(y, reading.problem, TXT.ember));
      body(y, PRIMER, TXT.ash);
      return;
    }
    put(right, WEAVE.y + 10, `DRAW ${recipe.lines}  \u00b7  LOOSE ${hexManaCost(recipe)} MANA  \u00b7  ${ACTION_LABEL[hexAction(recipe)]}`, 11, TXT.gold, {
      fontStyle: 'bold',
    }).setOrigin(1, 0);
    const title = heading(shortName(recipe), TXT.bone, hexTone(recipe));
    const items = recipe.parts.map((part) => ({ label: partLabel(part), color: partTone(part) }));
    const links = recipe.parts.slice(1).map((_, index) => LINK_WORD[couplingMode(recipe.parts[index]) ?? 'impact']);
    const end = this.flow(below(title), items, links, true);
    const text = recipe.parts.map((_, index) => {
      const own = partLines(recipe, index);
      if (index === 0) return `${ROMAN[0]}.  ${own.join(' ')}`;
      const [first = '', ...rest] = own;
      return `${ROMAN[index]}.  ${couplingLine(recipe, index)} ${[first.charAt(0).toLowerCase() + first.slice(1), ...rest].join(' ')}`;
    });
    body(end + 4, text.join('\n'), TXT.bone);
  }

  /** Parts as glowing cartouches joined by arrows naming how each sets off the next. Returns the bottom edge. */
  private flow(top: number, items: { label: string; color: number }[], links: string[], numbered: boolean): number {
    const { scene } = this;
    const layer = this.weave;
    const left = WEAVE.x + 18;
    const right = WEAVE.x + WEAVE.w - 18;
    const glow = scene.add.graphics().setBlendMode(ADD);
    const g = scene.add.graphics();
    layer.add([glow, g]);
    let x = left;
    let row = top;
    items.forEach((item, index) => {
      if (index > 0) {
        const word = scene.add.text(0, 0, links[index - 1] ?? '', { fontFamily: MENU_FONT.control, fontSize: '9px', fontStyle: 'bold', color: TXT.gold });
        const span = Math.max(56, word.width + 18);
        if (x + span > right - 80) {
          x = left;
          row += 38;
        }
        const mid = row + 19;
        glow.lineStyle(5, GOLD, 0.2).lineBetween(x + 2, mid, x + span - 4, mid);
        g.lineStyle(1.5, GOLD, 0.95).lineBetween(x + 2, mid, x + span - 6, mid);
        g.fillStyle(GOLD, 1).fillTriangle(x + span - 2, mid, x + span - 9, mid - 4, x + span - 9, mid + 4);
        word.setPosition(x + span / 2, mid - 3).setOrigin(0.5, 1);
        layer.add(word);
        x += span + 2;
      }
      const label = scene.add.text(0, 0, numbered ? `${ROMAN[index]}   ${item.label}` : item.label, {
        fontFamily: MENU_FONT.control,
        fontSize: '13px',
        fontStyle: 'bold',
        color: css(item.color),
      });
      const width = Math.min(label.width + 24, right - left);
      if (x + width > right && x > left) {
        x = left;
        row += 38;
      }
      glow.lineStyle(7, item.color, 0.16).strokeRoundedRect(x, row + 6, width, 26, 8);
      g.fillStyle(PLATE, 0.96).fillRoundedRect(x, row + 6, width, 26, 8);
      g.lineStyle(1.5, item.color, 0.9).strokeRoundedRect(x, row + 6, width, 26, 8);
      label.setPosition(x + 12, row + 19).setOrigin(0, 0.5);
      layer.add(label);
      x += width + 2;
    });
    return row + 38;
  }

  // ---------------------------------------------------------------------------
  //  THE SCRIBING
  // ---------------------------------------------------------------------------

  /** The sheet gathers power while the hex is set down. */
  private charge(reading: HexReading): void {
    playSound('spell.cast');
    reading.grids.forEach((grid, index) => {
      const facet = grid.facet;
      if (!facet) return;
      this.scene.time.delayedCall(index * 110, () => {
        if (!this.disposed) this.formBurst(index, facet, grid.inverted, true);
      });
    });
  }

  /** The runes lift off the sheet and fold into one point; the Hexzettel bursts out of it. Click to go on. */
  private unveil(recipe: HexRecipe, grids: number[], done: () => void): void {
    const { scene } = this;
    const reduced = this.reduced;
    const centre = { x: GAME_WIDTH / 2, y: 292 };
    const reading = readHex(this.paper, grids);
    const layer = scene.add.container(0, 0);
    this.add(layer);
    let revealed = false;
    let finished = false;
    const finish = (): void => {
      if (finished || this.disposed) return;
      finished = true;
      scene.tweens.add({
        targets: layer,
        alpha: 0,
        duration: 300,
        ease: 'Sine.In',
        onComplete: () => {
          scene.tweens.killTweensOf(layer.list);
          layer.destroy();
          if (!this.disposed) done();
        },
      });
    };
    const veil = scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x040309, 1).setOrigin(0).setAlpha(0).setInteractive();
    veil.on('pointerdown', () => {
      if (revealed) finish();
    });
    layer.add(veil);
    scene.tweens.add({ targets: veil, alpha: 0.8, duration: 320, ease: 'Sine.Out' });

    const drawn = reading.grids.flatMap((grid, index) =>
      grids[index] & RUNE_LINES ? [{ index, color: grid.facet ? FACETS[grid.facet].color : PALE }] : []);
    const flight = reduced ? 0 : 620;
    const stagger = reduced ? 0 : 95;
    drawn.forEach(({ index, color }, order) => {
      const from = this.plateCentre(index);
      const g = scene.add.graphics({ x: from.x, y: from.y }).setBlendMode(ADD);
      for (const [a, b] of glyphSegments(grids[index], 0, 0, PEG_GAP)) {
        g.lineStyle(10, color, 0.25).lineBetween(a.x, a.y, b.x, b.y);
        g.lineStyle(3, mix(color, 0xffffff, 0.5), 1).lineBetween(a.x, a.y, b.x, b.y);
      }
      layer.add(g);
      if (reduced) {
        g.setVisible(false);
        return;
      }
      scene.tweens.add({
        targets: g,
        x: centre.x,
        y: centre.y,
        scale: 0.2,
        alpha: 0.4,
        angle: order % 2 ? -200 : 200,
        duration: flight,
        delay: 200 + order * stagger,
        ease: 'Cubic.In',
        onComplete: () => g.setVisible(false),
      });
    });
    scene.time.delayedCall((reduced ? 200 : 200 + flight) + drawn.length * stagger, () => {
      if (this.disposed || finished) return;
      revealed = true;
      this.reveal(layer, recipe, grids, centre);
      scene.time.delayedCall(reduced ? 1600 : 2800, finish);
    });
  }

  private reveal(layer: Phaser.GameObjects.Container, recipe: HexRecipe, grids: number[], centre: Vec2): void {
    const { scene } = this;
    const tone = hexTone(recipe);
    playSound('dice.crit');
    const flash = scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, tone, 1).setOrigin(0).setAlpha(0.3).setBlendMode(ADD);
    const bloom = scene.add.image(centre.x, centre.y, GLOW.soft).setTint(tone).setBlendMode(ADD).setScale(0.6);
    const rays = scene.add.image(centre.x, centre.y, GLOW.rays).setTint(tone).setBlendMode(ADD).setScale(0.25).setAlpha(0);
    const sigil = scene.add.image(centre.x, centre.y, CIRCLE_OUTER).setTint(tone).setBlendMode(ADD).setScale(0.35).setAlpha(0);
    layer.add([flash, bloom, rays, sigil]);
    scene.tweens.add({ targets: flash, alpha: 0, duration: 460, ease: 'Quad.Out' });
    scene.tweens.add({ targets: bloom, scale: 4.6, alpha: 0.4, duration: 700, ease: 'Cubic.Out' });
    scene.tweens.add({ targets: rays, scale: 1.2, alpha: 0.7, duration: 560, ease: 'Cubic.Out' });
    scene.tweens.add({ targets: sigil, scale: 0.62, alpha: 0.75, duration: 620, ease: 'Back.Out' });
    if (!this.reduced) {
      scene.tweens.add({ targets: rays, angle: 120, duration: 6000 });
      scene.tweens.add({ targets: sigil, angle: -90, duration: 6000 });
      this.motes(centre.x, centre.y, tone, 60, 340, 1400, layer);
      this.motes(centre.x, centre.y, GOLD, 24, 200, 1100, layer);
    }
    const card = this.card(recipe, grids, tone).setPosition(centre.x, centre.y).setScale(0.6).setAlpha(0);
    layer.add(card);
    scene.tweens.add({ targets: card, scale: 1, alpha: 1, duration: 460, delay: 80, ease: 'Back.Out' });
    const prompt = scene.add.text(centre.x, centre.y + 108, 'click to go on', {
      fontFamily: MENU_FONT.control,
      fontSize: '11px',
      color: TXT.ash,
    }).setOrigin(0.5).setAlpha(0);
    layer.add(prompt);
    scene.tweens.add({ targets: prompt, alpha: 0.85, duration: 400, delay: 700 });
  }

  /** The finished Hexzettel: its runes in a row, chained where they couple, and its name. */
  private card(recipe: HexRecipe, grids: number[], tone: number): Phaser.GameObjects.Container {
    const { scene } = this;
    const width = 400;
    const height = 170;
    const card = scene.add.container(0, 0);
    const bg = scene.add.graphics();
    bg.fillStyle(0x05040a, 0.6).fillRoundedRect(-width / 2 + 5, -height / 2 + 7, width, height, 12);
    bg.fillStyle(0x15101f, 0.97).fillRoundedRect(-width / 2, -height / 2, width, height, 12);
    bg.lineStyle(2, GOLD, 0.95).strokeRoundedRect(-width / 2, -height / 2, width, height, 12);
    bg.lineStyle(1, tone, 0.75).strokeRoundedRect(-width / 2 + 7, -height / 2 + 7, width - 14, height - 14, 8);
    const glow = scene.add.graphics().setBlendMode(ADD);
    const glyphs = scene.add.graphics();
    card.add([bg, glow, glyphs]);
    const reading = readHex(recipe.paper, grids);
    const drawn = grids.flatMap((mask, index) => (mask & RUNE_LINES ? [index] : []));
    const step = 42;
    const y = -height / 2 + 50;
    drawn.forEach((index, order) => {
      const facet = reading.grids[index].facet;
      const color = facet ? FACETS[facet].color : PALE;
      const x = -((drawn.length - 1) * step) / 2 + order * step;
      for (const [a, b] of glyphSegments(grids[index], x, y, 8)) {
        glow.lineStyle(5, color, 0.3).lineBetween(a.x, a.y, b.x, b.y);
        glyphs.lineStyle(1.8, mix(color, 0xffffff, 0.35), 1).lineBetween(a.x, a.y, b.x, b.y);
      }
      if (grids[index] & SEAL_BIT) glyphs.fillStyle(EMBER, 1).fillCircle(x, y - 15, 2.2);
      if (grids[index] & BRIDGE_BIT && order < drawn.length - 1) {
        glow.lineStyle(4, GOLD, 0.3).lineBetween(x + 11, y, x + step - 11, y);
        glyphs.lineStyle(1.5, GOLD, 1).lineBetween(x + 11, y, x + step - 11, y);
      }
    });
    const label = scene.add.text(0, -height / 2 + 14, `${recipe.paper === 'fine' ? 'FINE ' : ''}HEXZETTEL SCRIBED`, {
      fontFamily: MENU_FONT.control,
      fontSize: '11px',
      fontStyle: 'bold',
      color: TXT.gold,
    }).setOrigin(0.5, 0);
    const name = scene.add.text(0, -height / 2 + 74, shortName(recipe), {
      fontFamily: MENU_FONT.display,
      fontSize: '18px',
      fontStyle: 'bold',
      color: TXT.bone,
      align: 'center',
      wordWrap: { width: width - 40 },
      maxLines: 2,
    }).setOrigin(0.5, 0).setShadow(0, 0, css(tone), 12, false, true);
    const stats = scene.add.text(0, height / 2 - 28, `Loose for ${hexManaCost(recipe)} mana  \u00b7  ${ACTION_LABEL[hexAction(recipe)].toLowerCase()}`, {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      color: TXT.ash,
    }).setOrigin(0.5, 0);
    card.add([label, name, stats]);
    return card;
  }
}
