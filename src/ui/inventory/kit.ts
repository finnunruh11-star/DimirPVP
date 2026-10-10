// The parts every inventory window is built from: item tiles that sit in a
// grid, a paper doll of what is worn, the item card that explains a selection,
// meters for weight and room, focus that follows the arrow keys across the
// screen, and the dialog that asks before anything is lost.

import Phaser from 'phaser';
import { playSound, unlockAudio } from '../../audio';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config/constants';
import { getItem, RARITY_COLOR, type ItemId } from '../../core/Items';
import { itemRarityColor } from '../../visuals/itemIcons';
import { itemIconTexture } from '../../visuals/itemIconTextures';
import { CabinetChip, type MenuControl } from '../cabinet/controls';
import { isReducedMotion } from '../cabinet/motion';
import { MENU_COLOR, MENU_FONT, MENU_HEX } from '../cabinet/theme';
import { itemFacts, itemKindLine } from './itemInfo';

export const TILE = 58;
export const TILE_GAP = 6;
export const TILE_PITCH = TILE + TILE_GAP;

// -----------------------------------------------------------------------------
//  FOCUS
// -----------------------------------------------------------------------------

export type Direction = 'left' | 'right' | 'up' | 'down';

interface FocusEntry {
  control: MenuControl;
  key: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** Focus that the arrow keys move across the screen to the nearest control that way. */
export class SpatialFocus {
  private entries: FocusEntry[] = [];
  private index = -1;
  /** True while a key, not the pointer, is moving focus. */
  viaKeys = false;

  add<T extends MenuControl>(control: T, key: string, x: number, y: number, w: number, h: number): T {
    const at = this.entries.push({ control, key, cx: x + w / 2, cy: y + h / 2, w, h }) - 1;
    control.setFocusRequest(() => this.focusAt(at, true));
    return control;
  }

  get currentKey(): string | null {
    return this.entries[this.index]?.key ?? null;
  }

  /** Quietly put focus on `key`, or on the first control that can take it. */
  restore(key: string | null): void {
    const at = key == null ? -1 : this.entries.findIndex((entry) => entry.key === key && entry.control.isEnabled);
    const first = this.entries.findIndex((entry) => entry.control.isEnabled);
    this.focusAt(at >= 0 ? at : first, false);
  }

  focusKey(key: string): boolean {
    const at = this.entries.findIndex((entry) => entry.key === key && entry.control.isEnabled);
    if (at < 0) return false;
    this.byKeys(() => this.focusAt(at, true));
    return true;
  }

  move(direction: Direction): void {
    const from = this.entries[this.index];
    if (!from) {
      this.restore(null);
      return;
    }
    const horizontal = direction === 'left' || direction === 'right';
    const sign = direction === 'left' || direction === 'up' ? -1 : 1;
    let best = -1;
    let bestScore = Infinity;
    this.entries.forEach((entry, at) => {
      if (at === this.index || !entry.control.isEnabled) return;
      const primary = (horizontal ? entry.cx - from.cx : entry.cy - from.cy) * sign;
      if (primary <= 2) return;
      const across = horizontal ? Math.abs(entry.cy - from.cy) : Math.abs(entry.cx - from.cx);
      const reach = horizontal ? (entry.h + from.h) / 2 : (entry.w + from.w) / 2;
      const score = primary + Math.max(0, across - reach * 0.5) * 3 + across * 0.2;
      if (score < bestScore) {
        bestScore = score;
        best = at;
      }
    });
    if (best >= 0) this.byKeys(() => this.focusAt(best, true));
  }

  cycle(step: -1 | 1): void {
    const count = this.entries.length;
    for (let offset = 1; offset <= count; offset++) {
      const at = (this.index + step * offset + count * 2) % count;
      if (this.entries[at].control.isEnabled) {
        this.byKeys(() => this.focusAt(at, true));
        return;
      }
    }
  }

  activate(): void {
    this.entries[this.index]?.control.activate();
  }

  private byKeys(run: () => void): void {
    this.viaKeys = true;
    try {
      run();
    } finally {
      this.viaKeys = false;
    }
  }

  private focusAt(at: number, audible: boolean): void {
    const entry = this.entries[at];
    if (!entry || !entry.control.isEnabled) return;
    if (audible && this.index >= 0 && this.index !== at) playSound('ui.hover');
    this.entries.forEach((other, index) => {
      if (index !== at) other.control.setFocused(false);
    });
    this.index = at;
    entry.control.setFocused(true);
  }
}

// -----------------------------------------------------------------------------
//  ITEM TILE
// -----------------------------------------------------------------------------

export interface ItemTileOptions {
  size?: number;
  id: ItemId | null;
  /** Shown in the corner when more than one. */
  count?: number;
  /** An empty tile's caption: HEAD, RING. */
  placeholder?: string;
  /** A small plate in the top corner: 2H, KEY, POUCH. */
  tag?: string;
  tagColor?: number;
  /** A price plate under the tile. */
  price?: string;
  priceColor?: string;
  selected?: boolean;
  /** Present but not usable here: drawn dim with a lock. */
  locked?: boolean;
  /** A shadow of the item, standing in for its second hand. */
  ghost?: boolean;
  onActivate?: () => void;
  onFocus?: () => void;
  /** Lets the tile be picked up and dropped on a target. */
  drag?: { controller: DragController; payload: DragPayload };
}

export class ItemTile extends Phaser.GameObjects.Container implements MenuControl {
  private readonly face: Phaser.GameObjects.Graphics;
  private readonly bracket: Phaser.GameObjects.Graphics;
  private readonly hit: Phaser.GameObjects.Zone;
  private icon?: Phaser.GameObjects.Image;
  private focused = false;
  private pressed = false;
  private focusRequest: (() => void) | null = null;
  readonly size: number;
  readonly isEnabled = true;

  constructor(scene: Phaser.Scene, x: number, y: number, private readonly options: ItemTileOptions) {
    super(scene, x, y);
    scene.add.existing(this);
    const size = this.size = options.size ?? TILE;
    this.face = scene.add.graphics();
    this.bracket = scene.add.graphics();
    this.add(this.face);
    if (options.id) {
      const scale = Math.max(1, Math.floor((size - 8) / 16));
      this.icon = scene.add.image(size / 2, size / 2, itemIconTexture(scene, options.id)).setScale(scale);
      this.icon.setAlpha(options.ghost ? 0.22 : options.locked ? 0.4 : 1);
      this.add(this.icon);
    } else if (options.placeholder) {
      this.add(scene.add.text(size / 2, size / 2, options.placeholder, {
        fontFamily: MENU_FONT.control, fontSize: '9px', fontStyle: 'bold', color: '#5d584d', align: 'center',
      }).setOrigin(0.5).setLetterSpacing(1));
    }
    if (options.count != null && options.count > 1) {
      this.add(scene.add.text(size - 4, size - 2, `${options.count}`, {
        fontFamily: MENU_FONT.control, fontSize: '14px', fontStyle: 'bold', color: MENU_HEX.bone,
      }).setOrigin(1, 1).setStroke('#050505', 4));
    }
    if (options.tag) {
      const tag = scene.add.text(4, 3, options.tag, {
        fontFamily: MENU_FONT.control, fontSize: '9px', fontStyle: 'bold', color: MENU_HEX.ink,
        backgroundColor: Phaser.Display.Color.IntegerToColor(options.tagColor ?? MENU_COLOR.brass).rgba,
        padding: { x: 3, y: 1 },
      });
      this.add(tag);
    }
    if (options.price) {
      this.add(scene.add.text(size / 2, size + 4, options.price, {
        fontFamily: MENU_FONT.control, fontSize: '11px', fontStyle: 'bold', color: options.priceColor ?? MENU_HEX.brassLight,
        align: 'center', fixedWidth: size + 8,
      }).setOrigin(0.5, 0));
    }
    this.add(this.bracket);
    this.hit = scene.add.zone(0, 0, size, size).setOrigin(0).setInteractive({ useHandCursor: true });
    this.add(this.hit);
    this.hit.on('pointerover', () => this.focusRequest?.());
    this.hit.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      unlockAudio();
      this.pressed = true;
      this.y += 1;
      options.drag?.controller.begin(options.drag.payload, pointer);
    });
    const release = (activate: boolean): void => {
      if (!this.pressed) return;
      this.pressed = false;
      this.y -= 1;
      if (activate && !options.drag?.controller.dragging) this.activate();
    };
    this.hit.on('pointerup', () => release(true));
    this.hit.on('pointerout', () => release(false));
    this.redraw();
    if (options.selected && !isReducedMotion()) {
      scene.tweens.add({ targets: this.bracket, alpha: 0.45, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
  }

  override destroy(fromScene?: boolean): void {
    this.scene?.tweens.killTweensOf(this.bracket);
    super.destroy(fromScene);
  }

  setFocusRequest(request: () => void): void {
    this.focusRequest = request;
  }

  setFocused(focused: boolean): void {
    if (this.focused === focused) return;
    this.focused = focused;
    this.redraw();
    if (focused) this.options.onFocus?.();
  }

  activate(): void {
    unlockAudio();
    playSound('ui.click');
    this.options.onActivate?.();
  }

  adjust(): boolean {
    return false;
  }

  private redraw(): void {
    const s = this.size;
    const g = this.face;
    const { id, locked, ghost, selected } = this.options;
    const rarity = id ? itemRarityColor(id) : MENU_COLOR.brassDark;
    g.clear();
    g.fillStyle(MENU_COLOR.pitch, 1).fillRect(2, 3, s, s);
    g.fillStyle(0x0c0e0b, 1).fillRect(0, 0, s, s);
    g.fillStyle(0x151812, 1).fillRect(1, 1, s - 2, Math.floor(s / 2));
    if (id && !ghost) {
      // A soft glow of the item's rarity, brightest at the heart of the well.
      for (const [inset, alpha] of [[2, 0.06], [7, 0.06], [13, 0.07]] as const) {
        g.fillStyle(rarity, locked ? alpha / 2 : alpha).fillRect(inset, inset, s - inset * 2, s - inset * 2);
      }
    }
    g.lineStyle(1, MENU_COLOR.woodEdge, 0.55).lineBetween(1, 1.5, s - 1, 1.5).lineBetween(1.5, 1, 1.5, s - 1);
    g.lineStyle(1, MENU_COLOR.pitch, 1).lineBetween(1, s - 1.5, s - 1, s - 1.5).lineBetween(s - 1.5, 1, s - 1.5, s - 1);
    const edge = this.focused ? MENU_COLOR.brassLight : id && !ghost ? rarity : MENU_COLOR.brassDark;
    g.lineStyle(this.focused ? 2 : 1, edge, id && !ghost ? 0.9 : 0.6).strokeRect(0.5, 0.5, s - 1, s - 1);
    if (id && !ghost && !locked) {
      g.fillStyle(rarity, 1);
      for (const [x, y, w, h] of [[0, 0, 7, 2], [0, 0, 2, 7], [s - 7, s - 2, 7, 2], [s - 2, s - 7, 2, 7]] as const) g.fillRect(x, y, w, h);
    }
    if (this.focused) g.fillStyle(0xffffff, 0.06).fillRect(2, 2, s - 4, s - 4);
    if (locked) {
      g.fillStyle(MENU_COLOR.pitch, 0.35).fillRect(1, 1, s - 2, s - 2);
      const lx = s - 13;
      const ly = 5;
      g.lineStyle(2, MENU_COLOR.boneDim, 0.9).strokeRect(lx + 2, ly, 5, 5);
      g.fillStyle(MENU_COLOR.boneDim, 0.95).fillRect(lx, ly + 4, 9, 7);
      g.fillStyle(MENU_COLOR.pitch, 1).fillRect(lx + 4, ly + 6, 1, 3);
    }
    const b = this.bracket;
    b.clear();
    if (selected) {
      b.lineStyle(2, MENU_COLOR.bone, 1).strokeRect(-1, -1, s + 2, s + 2);
      b.fillStyle(MENU_COLOR.brassLight, 1);
      const o = -5;
      const l = 12;
      for (const [x, y, w, h] of [
        [o, o, l, 3], [o, o, 3, l],
        [s - l - o, o, l, 3], [s - 3 - o, o, 3, l],
        [o, s - 3 - o, l, 3], [o, s - l - o, 3, l],
        [s - l - o, s - 3 - o, l, 3], [s - 3 - o, s - l - o, 3, l],
      ] as const) b.fillRect(x, y, w, h);
    }
  }
}

// -----------------------------------------------------------------------------
//  DRAG AND DROP
// -----------------------------------------------------------------------------

/** What is being carried by the pointer, and where it was picked up. */
export interface DragPayload {
  id: ItemId;
  /** The place it came from: `pack`, `doll:main`, `supplies:3`... */
  from: string;
}

export interface DropTarget {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  accepts(payload: DragPayload): boolean;
}

const DRAG_START_PX = 7;

/**
 * Picks item tiles up and lets them fall on a target. A press that does not
 * travel stays a click; once it moves, the item follows the pointer and every
 * place it may go lights up. The window rebuilds its targets on each redraw.
 */
export class DragController {
  private pending: { payload: DragPayload; x: number; y: number } | null = null;
  private carried: DragPayload | null = null;
  private targets: DropTarget[] = [];
  private ghost: Phaser.GameObjects.Container | null = null;
  private glow: Phaser.GameObjects.Graphics | null = null;
  private hovered: DropTarget | null = null;
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
    private readonly onDrop: (payload: DragPayload, target: DropTarget) => void,
  ) {
    scene.input.on('pointermove', this.move, this);
    scene.input.on('pointerup', this.up, this);
    scene.input.on('pointerupoutside', this.up, this);
  }

  get dragging(): boolean {
    return !!this.carried;
  }

  /** Forget the targets of the last redraw; the new one adds its own. */
  clearTargets(): void {
    this.targets = [];
  }

  addTarget(target: DropTarget): void {
    this.targets.push(target);
  }

  begin(payload: DragPayload, pointer: Phaser.Input.Pointer): void {
    if (this.carried || this.destroyed) return;
    this.pending = { payload, x: pointer.x, y: pointer.y };
  }

  cancel(): void {
    this.pending = null;
    this.carried = null;
    this.hovered = null;
    this.ghost?.destroy();
    this.ghost = null;
    this.glow?.destroy();
    this.glow = null;
  }

  destroy(): void {
    this.cancel();
    this.destroyed = true;
    this.scene.input.off('pointermove', this.move, this);
    this.scene.input.off('pointerup', this.up, this);
    this.scene.input.off('pointerupoutside', this.up, this);
  }

  private move(pointer: Phaser.Input.Pointer): void {
    if (this.destroyed) return;
    if (this.pending && !this.carried) {
      if (!pointer.isDown) {
        this.pending = null;
        return;
      }
      if (Phaser.Math.Distance.Between(this.pending.x, this.pending.y, pointer.x, pointer.y) < DRAG_START_PX) return;
      this.lift(this.pending.payload);
      this.pending = null;
    }
    if (!this.carried || !this.ghost) return;
    this.ghost.setPosition(pointer.x, pointer.y);
    const over = this.targetAt(pointer.x, pointer.y);
    if (over !== this.hovered) {
      this.hovered = over;
      if (over) playSound('ui.hover');
      this.drawGlow();
    }
  }

  private lift(payload: DragPayload): void {
    this.carried = payload;
    const scene = this.scene;
    const shadow = scene.add.rectangle(4, 6, 52, 52, MENU_COLOR.pitch, 0.5);
    const well = scene.add.rectangle(0, 0, 54, 54, 0x0c0e0b, 0.85).setStrokeStyle(2, itemRarityColor(payload.id), 1);
    const icon = scene.add.image(0, 0, itemIconTexture(scene, payload.id)).setScale(3);
    this.ghost = scene.add.container(0, 0, [shadow, well, icon]).setDepth(this.depth + 3).setAlpha(0.92);
    this.glow = scene.add.graphics().setDepth(this.depth + 2);
    playSound('ui.click');
    this.drawGlow();
  }

  private drawGlow(): void {
    const g = this.glow;
    const carried = this.carried;
    if (!g || !carried) return;
    g.clear();
    for (const target of this.targets) {
      if (!target.accepts(carried)) continue;
      const hot = target === this.hovered;
      g.lineStyle(hot ? 3 : 2, hot ? MENU_COLOR.brassLight : MENU_COLOR.verdigris, hot ? 1 : 0.8);
      g.strokeRect(target.x - 3, target.y - 3, target.w + 6, target.h + 6);
      if (hot) g.fillStyle(MENU_COLOR.brassLight, 0.12).fillRect(target.x, target.y, target.w, target.h);
    }
  }

  private targetAt(x: number, y: number): DropTarget | null {
    const carried = this.carried;
    if (!carried) return null;
    return this.targets.find((target) =>
      x >= target.x && x <= target.x + target.w && y >= target.y && y <= target.y + target.h && target.accepts(carried)) ?? null;
  }

  private up(pointer: Phaser.Input.Pointer): void {
    this.pending = null;
    const carried = this.carried;
    if (!carried) return;
    const target = this.targetAt(pointer.x, pointer.y);
    this.cancel();
    if (target) this.onDrop(carried, target);
    else playSound('ui.back');
  }
}

// -----------------------------------------------------------------------------
//  PANELS, METERS, LABELS
// -----------------------------------------------------------------------------

/** A framed panel with a titled band across its top. Returns the band's right-hand caption. */
export function addPanel(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  x: number, y: number, w: number, h: number,
  title: string,
  options: { fill?: number; caption?: string; captionColor?: string } = {},
): Phaser.GameObjects.Text {
  const g = scene.add.graphics();
  g.fillStyle(MENU_COLOR.pitch, 1).fillRect(x - 4, y - 4, w + 8, h + 8);
  g.fillStyle(options.fill ?? MENU_COLOR.felt, 1).fillRect(x, y, w, h);
  g.lineStyle(1, MENU_COLOR.feltLight, 0.3);
  for (let lineY = y + 40; lineY < y + h - 4; lineY += 16) g.lineBetween(x + 8, lineY, x + w - 8, lineY);
  g.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(x, y, w, 28);
  g.fillStyle(MENU_COLOR.woodRaised, 1).fillRect(x, y, w, 2);
  g.lineStyle(1, MENU_COLOR.brassDark, 1).lineBetween(x, y + 28.5, x + w, y + 28.5);
  g.fillStyle(MENU_COLOR.brass, 1).fillRect(x, y + 27, 30, 3);
  g.lineStyle(1, MENU_COLOR.brassDark, 0.75).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  const label = scene.add.text(x + 12, y + 8, title.toUpperCase(), {
    fontFamily: MENU_FONT.control, fontSize: '12px', fontStyle: 'bold', color: MENU_HEX.brassLight,
  }).setLetterSpacing(2);
  const caption = scene.add.text(x + w - 12, y + 8, options.caption ?? '', {
    fontFamily: MENU_FONT.control, fontSize: '12px', fontStyle: 'bold', color: options.captionColor ?? MENU_HEX.boneDim,
  }).setOrigin(1, 0);
  parent.add([g, label, caption]);
  return caption;
}

/** A segmented gauge with its label above: "LOAD   12.5 / 20 kg". */
export function addMeter(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  x: number, y: number, w: number,
  label: string, readout: string,
  share: number, color: number,
  options: { warn?: boolean; height?: number } = {},
): void {
  const h = options.height ?? 8;
  const g = scene.add.graphics();
  const clamped = Phaser.Math.Clamp(share, 0, 1);
  const fill = options.warn ? 0xc9503f : color;
  g.fillStyle(MENU_COLOR.pitch, 1).fillRect(x, y + 17, w, h);
  if (clamped > 0) {
    g.fillStyle(fill, 1).fillRect(x, y + 17, Math.max(2, Math.round(w * clamped)), h);
    g.fillStyle(0xffffff, 0.22).fillRect(x, y + 17, Math.max(2, Math.round(w * clamped)), 2);
  }
  g.lineStyle(1, MENU_COLOR.pitch, 0.7);
  for (let k = 1; k < 10; k++) g.lineBetween(x + (w * k) / 10, y + 18, x + (w * k) / 10, y + 16 + h);
  g.lineStyle(1, MENU_COLOR.brassDark, 1).strokeRect(x + 0.5, y + 16.5, w - 1, h + 1);
  parent.add([
    g,
    scene.add.text(x, y, label, {
      fontFamily: MENU_FONT.control, fontSize: '11px', fontStyle: 'bold', color: MENU_HEX.brass,
    }).setLetterSpacing(2),
    scene.add.text(x + w, y - 1, readout, {
      fontFamily: MENU_FONT.control, fontSize: '12px', fontStyle: 'bold', color: options.warn ? '#e6866f' : MENU_HEX.bone,
    }).setOrigin(1, 0),
  ]);
}

/** The purse as a brass-edged plate. */
export function addPursePlate(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, x: number, y: number, amount: string): number {
  const text = scene.add.text(x + 30, y + 6, amount, {
    fontFamily: MENU_FONT.display, fontSize: '18px', fontStyle: 'bold', color: '#f0d27a',
  });
  const w = Math.ceil(text.width) + 44;
  const g = scene.add.graphics();
  g.fillStyle(MENU_COLOR.pitch, 1).fillRect(x + 2, y + 3, w, 34);
  g.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(x, y, w, 34);
  g.lineStyle(1, MENU_COLOR.brass, 1).strokeRect(x + 0.5, y + 0.5, w - 1, 33);
  // A little stack of coins.
  for (const [dx, dy] of [[0, 4], [0, 0], [4, -4]] as const) {
    g.fillStyle(0x8a6a28, 1).fillEllipse(x + 15 + dx, y + 20 + dy, 14, 7);
    g.fillStyle(0xe8c35a, 1).fillEllipse(x + 15 + dx, y + 18 + dy, 14, 7);
  }
  parent.add([g, text]);
  return w;
}

/** A row of key hints along the bottom: "[F] Equip   [X] Drop". */
export function addKeyHints(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, x: number, y: number, hints: readonly [string, string][]): void {
  let at = x;
  for (const [key, what] of hints) {
    const cap = scene.add.text(at, y, key, {
      fontFamily: MENU_FONT.control, fontSize: '10px', fontStyle: 'bold', color: MENU_HEX.ink,
      backgroundColor: '#a99d83', padding: { x: 4, y: 1 },
    });
    const label = scene.add.text(at + cap.width + 5, y + 1, what, {
      fontFamily: MENU_FONT.control, fontSize: '11px', color: MENU_HEX.boneDim,
    });
    parent.add([cap, label]);
    at += cap.width + label.width + 18;
  }
}

/** Where tile `index` of a grid sits. */
export function gridSpot(x: number, y: number, columns: number, index: number, pitchY = TILE_PITCH): { x: number; y: number } {
  return { x: x + (index % columns) * TILE_PITCH, y: y + Math.floor(index / columns) * pitchY };
}

/** An empty pack slot: a dark socket. */
export function drawSocket(g: Phaser.GameObjects.Graphics, x: number, y: number, size = TILE): void {
  g.fillStyle(0x090a08, 0.9).fillRect(x, y, size, size);
  g.lineStyle(1, MENU_COLOR.feltLight, 0.55).strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
  g.fillStyle(MENU_COLOR.feltLight, 0.5).fillRect(x + size / 2 - 1, y + size / 2 - 1, 2, 2);
}

// -----------------------------------------------------------------------------
//  ITEM CARD
// -----------------------------------------------------------------------------

export interface CardLine {
  label: string;
  value: string;
  color?: string;
}

export interface ItemCardModel {
  id: ItemId;
  /** Over the name: "EQUIPPED  /  MAIN HAND", "IN YOUR PACK". */
  eyebrow?: string;
  lines?: CardLine[];
  /** A warning or reminder under the blurb. */
  note?: string;
  noteColor?: string;
}

/**
 * The selected item, explained: its picture large, its name in its rarity's
 * colour, what kind of thing it is, its chief facts as chips, a few figures
 * and its full text. Fills from `y` down to `bottom`.
 */
export function addItemCard(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  x: number, y: number, w: number, bottom: number,
  model: ItemCardModel,
): void {
  const def = getItem(model.id);
  const rarity = itemRarityColor(model.id);
  const g = scene.add.graphics();
  parent.add(g);
  const well = 76;
  g.fillStyle(MENU_COLOR.pitch, 1).fillRect(x + 2, y + 3, well, well);
  g.fillStyle(0x0c0e0b, 1).fillRect(x, y, well, well);
  for (const [inset, alpha] of [[2, 0.07], [10, 0.08], [20, 0.09]] as const) {
    g.fillStyle(rarity, alpha).fillRect(x + inset, y + inset, well - inset * 2, well - inset * 2);
  }
  g.lineStyle(2, rarity, 0.95).strokeRect(x + 1, y + 1, well - 2, well - 2);
  g.fillStyle(rarity, 1);
  for (const [dx, dy, ww, hh] of [[-3, -3, 12, 3], [-3, -3, 3, 12], [well - 9, well, 12, 3], [well, well - 9, 3, 12]] as const) {
    g.fillRect(x + dx, y + dy, ww, hh);
  }
  parent.add(scene.add.image(x + well / 2, y + well / 2, itemIconTexture(scene, model.id)).setScale(4));

  const textX = x + well + 14;
  const textW = w - well - 14;
  let top = y - 2;
  if (model.eyebrow) {
    parent.add(scene.add.text(textX, top, model.eyebrow.toUpperCase(), {
      fontFamily: MENU_FONT.control, fontSize: '10px', fontStyle: 'bold', color: MENU_HEX.verdigris, fixedWidth: textW,
    }).setLetterSpacing(1));
    top += 15;
  }
  const name = scene.add.text(textX, top, def.name, {
    fontFamily: MENU_FONT.display, fontSize: '20px', fontStyle: 'bold', color: RARITY_COLOR[def.rarity],
    wordWrap: { width: textW }, maxLines: 2,
  }).setStroke('#050505', 2);
  parent.add(name);
  top += Math.ceil(name.height) + 2;
  parent.add(scene.add.text(textX, top, itemKindLine(def).toUpperCase(), {
    fontFamily: MENU_FONT.control, fontSize: '10px', fontStyle: 'bold', color: MENU_HEX.brass,
    wordWrap: { width: textW },
  }).setLetterSpacing(1));

  let cursor = y + well + 14;
  // The chief facts, as chips that wrap.
  const facts = itemFacts(def);
  let chipX = x;
  for (const fact of facts) {
    const chip = scene.add.text(0, 0, fact, {
      fontFamily: MENU_FONT.control, fontSize: '11px', fontStyle: 'bold', color: MENU_HEX.bone,
      padding: { x: 7, y: 3 },
    });
    if (chipX + chip.width > x + w && chipX > x) {
      chipX = x;
      cursor += 24;
    }
    if (cursor + 22 > bottom) {
      chip.destroy();
      break;
    }
    g.fillStyle(MENU_COLOR.charcoalRaised, 1).fillRect(chipX, cursor, chip.width, 20);
    g.lineStyle(1, MENU_COLOR.brassDark, 0.9).strokeRect(chipX + 0.5, cursor + 0.5, chip.width - 1, 19);
    g.fillStyle(rarity, 0.9).fillRect(chipX, cursor, 2, 20);
    chip.setPosition(chipX, cursor);
    parent.add(chip);
    chipX += chip.width + 6;
  }
  if (facts.length) cursor += 30;

  for (const line of model.lines ?? []) {
    if (cursor + 18 > bottom) break;
    g.lineStyle(1, MENU_COLOR.feltLight, 0.5).lineBetween(x, cursor + 18.5, x + w, cursor + 18.5);
    parent.add([
      scene.add.text(x, cursor + 2, line.label.toUpperCase(), {
        fontFamily: MENU_FONT.control, fontSize: '10px', fontStyle: 'bold', color: MENU_HEX.brass,
      }).setLetterSpacing(1),
      scene.add.text(x + w, cursor, line.value, {
        fontFamily: MENU_FONT.control, fontSize: '13px', fontStyle: 'bold', color: line.color ?? MENU_HEX.bone,
      }).setOrigin(1, 0),
    ]);
    cursor += 22;
  }
  cursor += 8;

  const noteSpace = model.note ? 40 : 0;
  const lines = Math.floor((bottom - cursor - noteSpace) / 17);
  if (lines > 0) {
    parent.add(scene.add.text(x, cursor, def.blurb, {
      fontFamily: MENU_FONT.body, fontSize: '13px', color: MENU_HEX.boneDim, lineSpacing: 2,
      wordWrap: { width: w }, maxLines: lines,
    }));
  }
  if (model.note) {
    const note = scene.add.text(x + 10, bottom - noteSpace + 4, model.note, {
      fontFamily: MENU_FONT.control, fontSize: '12px', fontStyle: 'bold', color: model.noteColor ?? '#e6b55a',
      wordWrap: { width: w - 14 }, maxLines: 2,
    });
    g.fillStyle(Phaser.Display.Color.HexStringToColor(model.noteColor ?? '#e6b55a').color, 1).fillRect(x, bottom - noteSpace + 4, 3, Math.max(16, note.height));
    parent.add(note);
  }
}

/** The card's empty state: a hint where an item would be. */
export function addEmptyCard(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, x: number, y: number, w: number, h: number, title: string, body: string): void {
  const g = scene.add.graphics();
  g.lineStyle(1, MENU_COLOR.feltLight, 0.8).strokeRect(x + w / 2 - 38.5, y + h / 2 - 90.5, 76, 76);
  g.lineStyle(1, MENU_COLOR.feltLight, 0.5).strokeRect(x + w / 2 - 30.5, y + h / 2 - 82.5, 60, 60);
  parent.add([
    g,
    scene.add.text(x + w / 2, y + h / 2 + 2, title.toUpperCase(), {
      fontFamily: MENU_FONT.control, fontSize: '12px', fontStyle: 'bold', color: MENU_HEX.brass, align: 'center',
    }).setOrigin(0.5, 0).setLetterSpacing(2),
    scene.add.text(x + w / 2, y + h / 2 + 24, body, {
      fontFamily: MENU_FONT.body, fontSize: '13px', color: MENU_HEX.boneDim, align: 'center',
      wordWrap: { width: w - 40 },
    }).setOrigin(0.5, 0),
  ]);
}

// -----------------------------------------------------------------------------
//  PAPER DOLL
// -----------------------------------------------------------------------------

export type DollSlot = 'cape' | 'head' | 'gloves' | 'main' | 'torso' | 'off' | 'ring1' | 'boots' | 'ring2';

export const DOLL_LABEL: Record<DollSlot, string> = {
  cape: 'CAPE',
  head: 'HEAD',
  gloves: 'GLOVES',
  main: 'MAIN HAND',
  torso: 'TORSO',
  off: 'OFF HAND',
  ring1: 'ACCESSORY',
  boots: 'BOOTS',
  ring2: 'ACCESSORY',
};

/** Slot centres, relative to the doll's top centre. */
const DOLL_AT: Record<DollSlot, { x: number; y: number }> = {
  cape: { x: -92, y: 34 },
  head: { x: 0, y: 34 },
  gloves: { x: 92, y: 34 },
  main: { x: -92, y: 112 },
  torso: { x: 0, y: 112 },
  off: { x: 92, y: 112 },
  ring1: { x: -92, y: 190 },
  boots: { x: 0, y: 190 },
  ring2: { x: 92, y: 190 },
};

export const DOLL_HEIGHT = 236;

/** Can `id` be worn in doll slot `slot`? */
export function dollAccepts(slot: DollSlot, id: ItemId): boolean {
  const kind = getItem(id).slot;
  if (slot === 'main' || slot === 'off') return kind === 'hand';
  if (slot === 'ring1' || slot === 'ring2') return kind === 'accessory';
  return kind === slot;
}

export interface WornView {
  head: ItemId | null;
  torso: ItemId | null;
  cape: ItemId | null;
  gloves: ItemId | null;
  boots: ItemId | null;
  hands: readonly ItemId[];
  offhandOnly?: boolean;
  accessories: readonly ItemId[];
}

export interface DollEntry {
  slot: DollSlot;
  id: ItemId | null;
  /** The off hand, filled by a two-handed weapon in the main. */
  ghost: boolean;
}

export function dollEntries(worn: WornView): DollEntry[] {
  const twoHanded = worn.hands.find((id) => getItem(id).twoHanded);
  const offOnly = worn.hands.length === 1 && worn.offhandOnly && !twoHanded;
  const main = offOnly ? null : worn.hands[0] ?? null;
  const off = offOnly ? worn.hands[0] : twoHanded && worn.hands.length < 2 ? twoHanded : worn.hands[1] ?? null;
  return [
    { slot: 'cape', id: worn.cape, ghost: false },
    { slot: 'head', id: worn.head, ghost: false },
    { slot: 'gloves', id: worn.gloves, ghost: false },
    { slot: 'main', id: main, ghost: false },
    { slot: 'torso', id: worn.torso, ghost: false },
    { slot: 'off', id: off, ghost: !!twoHanded && worn.hands.length < 2 },
    { slot: 'ring1', id: worn.accessories[0] ?? null, ghost: false },
    { slot: 'boots', id: worn.boots, ghost: false },
    { slot: 'ring2', id: worn.accessories[1] ?? null, ghost: false },
  ];
}

/**
 * What is worn, laid out like a body: cape, head and gloves across the top,
 * a hand either side of the torso, accessories either side of the boots,
 * joined by thin brass threads. `tile` builds each slot so the window decides
 * what selecting it does.
 */
export function addPaperDoll(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  cx: number, top: number,
  entries: readonly DollEntry[],
  tile: (entry: DollEntry, x: number, y: number) => ItemTile,
): void {
  const g = scene.add.graphics();
  parent.add(g);
  // A faint figure behind the slots.
  g.fillStyle(MENU_COLOR.feltLight, 0.35);
  g.fillCircle(cx, top + 34, 34);
  g.fillRoundedRect(cx - 40, top + 70, 80, 92, 18);
  g.fillRect(cx - 30, top + 150, 22, 60);
  g.fillRect(cx + 8, top + 150, 22, 60);
  g.lineStyle(1, MENU_COLOR.brassDark, 0.8);
  const at = (slot: DollSlot) => ({ x: cx + DOLL_AT[slot].x, y: top + DOLL_AT[slot].y });
  for (const [a, b] of [
    ['head', 'torso'], ['cape', 'torso'], ['gloves', 'torso'], ['main', 'torso'], ['off', 'torso'],
    ['torso', 'boots'], ['ring1', 'boots'], ['ring2', 'boots'],
  ] as const) {
    const p = at(a);
    const q = at(b);
    g.lineBetween(p.x, p.y, q.x, q.y);
  }
  for (const entry of entries) {
    const p = at(entry.slot);
    const made = tile(entry, p.x - TILE / 2, p.y - TILE / 2 - 6);
    parent.add(made);
    parent.add(scene.add.text(p.x, p.y + TILE / 2 - 3, DOLL_LABEL[entry.slot], {
      fontFamily: MENU_FONT.control, fontSize: '9px', fontStyle: 'bold', color: entry.id ? MENU_HEX.brass : '#5d584d',
    }).setOrigin(0.5, 0).setLetterSpacing(1));
  }
}

// -----------------------------------------------------------------------------
//  CONFIRM DIALOG
// -----------------------------------------------------------------------------

export interface DialogChoice {
  label: string;
  tone?: 'primary' | 'danger' | 'positive' | 'normal';
  enabled?: boolean;
  run: (count: number) => void;
}

export interface DialogOptions {
  title: string;
  body: string;
  icon?: ItemId;
  /** Ask how many, from 1 to `max`; `describe` reads the choice back. */
  quantity?: { max: number; start?: number; describe: (count: number) => string };
  choices: DialogChoice[];
  cancelLabel?: string;
  onClose: () => void;
}

export type DialogKey = 'LEFT' | 'RIGHT' | 'UP' | 'DOWN' | 'ENTER' | 'SPACE' | 'TAB' | 'ESC';

/**
 * Asks before anything is lost or spent: what, how many, and which way.
 * Its window routes keys to it through `key` while it is open.
 */
export class ConfirmDialog extends Phaser.GameObjects.Container {
  private readonly focus = new SpatialFocus();
  private readonly buttons: CabinetChip[] = [];
  private amount: number;
  private countText?: Phaser.GameObjects.Text;
  private describeText?: Phaser.GameObjects.Text;
  private closed = false;

  constructor(scene: Phaser.Scene, depth: number, private readonly options: DialogOptions) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(depth);
    const quantity = options.quantity;
    this.amount = quantity ? Phaser.Math.Clamp(quantity.start ?? 1, 1, quantity.max) : 1;
    const w = 600;
    const choices = options.choices.length;
    const rowsOfButtons = Math.ceil((choices + 1) / 3);
    const h = 176 + (quantity ? 92 : 0) + rowsOfButtons * 50;
    const x = Math.round((GAME_WIDTH - w) / 2);
    const y = Math.round((GAME_HEIGHT - h) / 2);
    const dim = scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, MENU_COLOR.pitch, 0.74).setOrigin(0).setInteractive();
    dim.on('pointerdown', () => undefined);
    const g = scene.add.graphics();
    g.fillStyle(MENU_COLOR.pitch, 1).fillRect(x - 6, y - 6, w + 12, h + 12);
    g.fillStyle(MENU_COLOR.charcoal, 1).fillRect(x, y, w, h);
    g.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(x, y, w, 44);
    g.fillStyle(MENU_COLOR.woodRaised, 1).fillRect(x, y, w, 3);
    g.lineStyle(1, MENU_COLOR.brassDark, 1).lineBetween(x, y + 44.5, x + w, y + 44.5);
    g.fillStyle(MENU_COLOR.brass, 1).fillRect(x, y + 43, 44, 3);
    g.lineStyle(2, MENU_COLOR.brassDark, 1).strokeRect(x + 1, y + 1, w - 2, h - 2);
    g.lineStyle(1, MENU_COLOR.brass, 0.5).strokeRect(x + 6.5, y + 6.5, w - 13, h - 13);
    this.add([dim, g]);
    this.add(scene.add.text(x + 22, y + 12, options.title.toUpperCase(), {
      fontFamily: MENU_FONT.display, fontSize: '19px', fontStyle: 'bold', color: MENU_HEX.bone,
    }).setLetterSpacing(1));

    let textX = x + 24;
    if (options.icon) {
      const rarity = itemRarityColor(options.icon);
      g.fillStyle(0x0c0e0b, 1).fillRect(x + 24, y + 62, 64, 64);
      g.fillStyle(rarity, 0.1).fillRect(x + 28, y + 66, 56, 56);
      g.lineStyle(2, rarity, 0.95).strokeRect(x + 25, y + 63, 62, 62);
      this.add(scene.add.image(x + 56, y + 94, itemIconTexture(scene, options.icon)).setScale(3));
      textX = x + 104;
    }
    this.add(scene.add.text(textX, y + 62, options.body, {
      fontFamily: MENU_FONT.body, fontSize: '15px', color: MENU_HEX.bone, lineSpacing: 3,
      wordWrap: { width: x + w - 24 - textX }, maxLines: 5,
    }));

    let rowY = y + 146;
    if (quantity) {
      const mid = x + w / 2;
      g.fillStyle(MENU_COLOR.pitch, 1).fillRect(mid - 70, rowY, 140, 40);
      g.lineStyle(1, MENU_COLOR.brass, 1).strokeRect(mid - 69.5, rowY + 0.5, 139, 39);
      this.countText = scene.add.text(mid, rowY + 20, '', {
        fontFamily: MENU_FONT.display, fontSize: '22px', fontStyle: 'bold', color: '#f0d27a',
      }).setOrigin(0.5);
      this.add(this.countText);
      const step = (label: string, dx: number, width: number, run: () => void, key: string): void => {
        const chip = new CabinetChip(scene, mid + dx, rowY + 2, { width, height: 36, label, onActivate: run });
        this.add(chip);
        this.focus.add(chip, key, mid + dx, rowY + 2, width, 36);
      };
      step('Min', -232, 64, () => this.setCount(1), 'q:min');
      step('-1', -158, 78, () => this.setCount(this.amount - 1), 'q:-1');
      step('+1', 80, 78, () => this.setCount(this.amount + 1), 'q:+1');
      step('All', 168, 64, () => this.setCount(quantity.max), 'q:all');
      this.describeText = scene.add.text(mid, rowY + 52, '', {
        fontFamily: MENU_FONT.control, fontSize: '14px', fontStyle: 'bold', color: MENU_HEX.brassLight, align: 'center',
      }).setOrigin(0.5, 0);
      this.add(this.describeText);
      rowY += 92;
    }

    const all: DialogChoice[] = [
      ...options.choices,
      { label: options.cancelLabel ?? 'Cancel', tone: 'normal', run: () => undefined },
    ];
    const perRow = Math.min(3, all.length);
    const buttonW = Math.floor((w - 48 - (perRow - 1) * 12) / perRow);
    all.forEach((choice, index) => {
      const row = Math.floor(index / perRow);
      const col = index % perRow;
      const bx = x + 24 + col * (buttonW + 12);
      const by = rowY + row * 50;
      const cancel = index === all.length - 1;
      const chip = new CabinetChip(scene, bx, by, {
        width: buttonW,
        height: 40,
        label: choice.label,
        tone: choice.tone ?? 'primary',
        enabled: choice.enabled ?? true,
        onActivate: () => (cancel ? this.cancel() : this.choose(choice)),
      });
      this.buttons.push(chip);
      this.add(chip);
      this.focus.add(chip, `c:${index}`, bx, by, buttonW, 40);
    });
    this.focus.restore(options.choices.findIndex((choice) => choice.enabled ?? true) >= 0
      ? `c:${options.choices.findIndex((choice) => choice.enabled ?? true)}`
      : `c:${all.length - 1}`);
    this.setCount(this.amount);
    if (!isReducedMotion()) {
      this.setAlpha(0);
      scene.tweens.add({ targets: this, alpha: 1, duration: 140, ease: 'Sine.Out' });
    }
    playSound('ui.open');
  }

  key(key: DialogKey, shift = false): void {
    if (this.closed) return;
    const quantity = !!this.options.quantity;
    switch (key) {
      case 'ESC': this.cancel(); break;
      case 'ENTER':
      case 'SPACE': this.focus.activate(); break;
      case 'TAB': this.focus.cycle(shift ? -1 : 1); break;
      case 'LEFT':
        if (quantity) this.setCount(this.amount - (shift ? 10 : 1));
        else this.focus.move('left');
        break;
      case 'RIGHT':
        if (quantity) this.setCount(this.amount + (shift ? 10 : 1));
        else this.focus.move('right');
        break;
      case 'UP': this.focus.move('up'); break;
      case 'DOWN': this.focus.move('down'); break;
    }
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  cancel(): void {
    if (this.closed) return;
    playSound('ui.back');
    this.finish();
  }

  private choose(choice: DialogChoice): void {
    if (this.closed) return;
    const count = this.amount;
    this.finish();
    choice.run(count);
  }

  private finish(): void {
    this.closed = true;
    this.options.onClose();
    this.destroy();
  }

  private setCount(value: number): void {
    const quantity = this.options.quantity;
    if (!quantity) return;
    const next = Phaser.Math.Clamp(Math.round(value), 1, quantity.max);
    if (next !== this.amount) playSound('ui.hover');
    this.amount = next;
    this.countText?.setText(`${next} / ${quantity.max}`);
    this.describeText?.setText(quantity.describe(next));
  }
}
