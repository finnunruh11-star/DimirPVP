// The search window. Say what you are after, see your odds, and roll for it.
// Two shelves (resources and creatures) list every target, each
// marked by how much it belongs here. The roll plays out on a d20 over a meter
// that shows where "nothing", "a lucky turn" and "found" begin.

import Phaser from 'phaser';
import { playSound } from '../../audio';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config/constants';
import { SceneInput } from '../../engine/SceneInput';
import { MINE_ENEMY_DEFS, type MineEnemyKind } from '../../pve/minerun';
import {
  NEAR_MISS,
  type SearchCategory,
  type SearchOutcome,
  type SearchRoll,
  type SearchStanding,
  type SearchTarget,
} from '../../pve/exploration/search';
import { ENEMY_DEFS, type EnemyKind } from '../../pve/swamprun';
import { cssColor, mixColor } from '../../visuals/daylight';
import { ensureGlowTextures, GLOW } from '../../visuals/glowTextures';
import { CREATURE_FRAME_RATIO, creatureSpriteFor, creatureTexture, ensureCreatureSprites } from '../../world/creatureSprite';
import { MAGE_FIRST_FRAME, MAGE_IDLE } from '../../world/mageSprite';
import { CabinetChip, MenuFocusGroup, type MenuControl } from '../cabinet/controls';
import { isReducedMotion } from '../cabinet/motion';
import { addCabinetBackdrop, addRecess, addSectionRule, MENU_COLOR, MENU_FONT, MENU_HEX } from '../cabinet/theme';
import { drawSightingGlyph } from './sightingGlyphs';
import { drawD20 } from './d20';

/** One target on a shelf, as this searcher would roll for it. */
export interface SearchChoice {
  target: SearchTarget;
  bonus: number;
  /** Whose knack the bonus comes from, e.g. "Kara's Int 5". */
  knack: string;
  odds: Record<SearchOutcome, number>;
  /** A job or bounty that wants it. */
  note?: string;
}

export interface SearchViewModel {
  /** "The Northwood, woods". */
  place: string;
  /** Who searches, e.g. "Kara". */
  searcher: string;
  hours: number;
  /** Extra DC from earlier searches of this ground today. */
  pickedOver: number;
  depth: number;
  night: boolean;
  shelves: Record<SearchCategory, SearchChoice[]>;
}

export interface SearchRollResult {
  roll: SearchRoll;
  message: string;
  /** Something to decide once the dice are down. */
  offer?: { go: string; pass: string };
}

export interface SearchViewResult {
  choice: SearchChoice;
  result: SearchRollResult;
  /** The offer was taken. */
  go: boolean;
}

export interface SearchViewHooks {
  /** Make the search; null when it could not be made. */
  roll(choice: SearchChoice): Promise<SearchRollResult | null>;
  close(result: SearchViewResult | null): void;
}

const SHELVES: readonly { id: SearchCategory; label: string; blurb: string }[] = [
  { id: 'resource', label: 'Resources', blurb: 'Herbs, ore and stones.' },
  { id: 'creature', label: 'Creatures', blurb: 'Track something down.' },
];

const STANDING: Record<SearchStanding, { label: string; color: number }> = {
  native: { label: 'NATIVE', color: 0x78b886 },
  scarce: { label: 'SCARCE HERE', color: 0xd9a54a },
  foreign: { label: 'NOT FROM HERE', color: 0xc85e52 },
};

const OUTCOME: Record<SearchOutcome, { label: string; color: number }> = {
  found: { label: 'FOUND', color: 0x86d096 },
  near: { label: 'A LUCKY TURN', color: 0xe6b55a },
  nothing: { label: 'NOTHING', color: 0x948d7e },
};

const ITEM_TINT: Record<string, number> = {
  herbMoonglow: 0xdfe8f5,
  herbWaterleaf: 0x4a90e0,
  herbDeathweed: 0x8a5a9a,
  herbFireblossom: 0xf06a2a,
  oreCoal: 0x4a4a4c,
  oreCopper: 0xcd7a3c,
  oreIron: 0x93a0ae,
  oreGold: 0xe8c44c,
  gemAmethyst: 0xa46bd8,
  gemOnyx: 0x57515e,
  gemEmerald: 0x46c474,
  gemRuby: 0xdd4450,
  gemSapphire: 0x4677de,
  gemDiamond: 0xe2f5ff,
  gemPearl: 0xf0ebe0,
};

const LIST = { x: 58, y: 186, w: 640, h: 446 };
const CARD = { x: 722, y: 186, w: 500, h: 446 };
const ROWS = 8;
const ROW_H = 42;
const ROW_GAP = 5;
/** The dice tumble at least this long, however quickly the result is in. */
const TUMBLE_MS = 950;

const chanceColor = (found: number): number => (found >= 0.6 ? 0x86d096 : found >= 0.3 ? 0xe6b55a : 0xd46a5c);
const percent = (share: number): string => `${Math.round(share * 100)}%`;

function tintOf(target: SearchTarget): number {
  if (target.category === 'creature') {
    if (Object.prototype.hasOwnProperty.call(MINE_ENEMY_DEFS, target.id)) return MINE_ENEMY_DEFS[target.id as MineEnemyKind].tint;
    if (Object.prototype.hasOwnProperty.call(ENEMY_DEFS, target.id)) return ENEMY_DEFS[target.id as EnemyKind].tint ?? 0xe25b4c;
    return 0xe25b4c;
  }
  return ITEM_TINT[target.id] ?? 0xd8cbae;
}

/** A target's emblem, centred on the graphics' origin and about `size` px across. */
function drawTargetGlyph(g: Phaser.GameObjects.Graphics, target: SearchTarget, size: number): void {
  const s = size / 40;
  const color = tintOf(target);
  if (target.category === 'creature') return drawSightingGlyph(g, 'pack', size);
  if (target.resource === 'herb') return drawSightingGlyph(g, 'herbs', size);
  const pts = (list: [number, number][], dx = 0, dy = 0): Phaser.Math.Vector2[] =>
    list.map(([x, y]) => new Phaser.Math.Vector2((x + dx) * s, (y + dy) * s));
  if (target.resource === 'gem') {
    const outline: [number, number][] = [[-15, -6], [-8, -15], [8, -15], [15, -6], [0, 17]];
    g.fillStyle(0x120d09, 0.85).fillPoints(pts(outline, 1.6, 2.2), true);
    g.fillStyle(mixColor(color, 0x000000, 0.25), 1).fillPoints(pts(outline), true);
    g.fillStyle(color, 1).fillPoints(pts([[-15, -6], [-8, -15], [8, -15], [15, -6]]), true);
    g.fillStyle(mixColor(color, 0xffffff, 0.45), 1).fillPoints(pts([[-8, -15], [0, -6], [8, -15]]), true);
    g.fillStyle(mixColor(color, 0xffffff, 0.2), 1).fillPoints(pts([[-15, -6], [0, -6], [0, 17]]), true);
    g.lineStyle(Math.max(1, 1.2 * s), mixColor(color, 0xffffff, 0.6), 0.8);
    g.strokePoints(pts(outline), true);
    g.lineBetween(-15 * s, -6 * s, 15 * s, -6 * s);
    return;
  }
  // Ore: a lump of rock with the metal showing through.
  const lump: [number, number][] = [[-15, 4], [-11, -9], [-2, -15], [10, -11], [16, -1], [12, 12], [-3, 15], [-13, 11]];
  g.fillStyle(0x120d09, 0.85).fillPoints(pts(lump, 1.6, 2.2), true);
  g.fillStyle(0x5d554c, 1).fillPoints(pts(lump), true);
  g.fillStyle(0x7a7066, 1).fillPoints(pts([[-11, -9], [-2, -15], [10, -11], [2, -4], [-8, -2]]), true);
  for (const [x, y, r] of [[-5, 3, 3.4], [6, -4, 2.6], [3, 8, 2.2], [-9, -3, 1.8], [9, 5, 1.6]] as const) {
    g.fillStyle(color, 1).fillCircle(x * s, y * s, r * s);
    g.fillStyle(mixColor(color, 0xffffff, 0.5), 0.9).fillCircle((x - 0.6) * s, (y - 0.6) * s, r * 0.4 * s);
  }
}

/** A row on a shelf: emblem, name and standing on the left, DC and the chance of finding it on the right. */
class SearchRow extends Phaser.GameObjects.Container implements MenuControl {
  readonly isEnabled = true;
  private readonly face: Phaser.GameObjects.Graphics;
  private focused = false;
  private selected = false;
  private focusRequest: (() => void) | null = null;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    private readonly rowW: number,
    private readonly choice: SearchChoice,
    private readonly onPick: () => void,
    private readonly onFocus: () => void,
  ) {
    super(scene, x, y);
    scene.add.existing(this);
    const { target, odds } = choice;
    const standing = STANDING[target.standing];
    this.face = scene.add.graphics();
    const glyph = scene.add.graphics({ x: 25, y: ROW_H / 2 });
    drawTargetGlyph(glyph, target, 26);
    const name = scene.add.text(52, 5, target.label, {
      fontFamily: MENU_FONT.control,
      fontSize: '15px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    });
    const tag = scene.add.text(52, 24, choice.note ? `${standing.label}  ·  ${choice.note}` : standing.label, {
      fontFamily: MENU_FONT.control,
      fontSize: '10px',
      fontStyle: 'bold',
      color: cssColor(choice.note ? 0xe6c77a : standing.color),
    }).setLetterSpacing(1);
    const dc = scene.add.text(rowW - 150, ROW_H / 2, `DC ${target.dc}`, {
      fontFamily: MENU_FONT.control,
      fontSize: '13px',
      color: MENU_HEX.boneDim,
    }).setOrigin(0, 0.5);
    const chance = scene.add.text(rowW - 16, 15, percent(odds.found), {
      fontFamily: MENU_FONT.display,
      fontSize: '19px',
      fontStyle: 'bold',
      color: cssColor(chanceColor(odds.found)),
    }).setOrigin(1, 0.5);
    const bar = scene.add.graphics({ x: rowW - 76, y: 30 });
    bar.fillStyle(MENU_COLOR.pitch, 1).fillRect(0, 0, 60, 5);
    bar.fillStyle(OUTCOME.near.color, 0.85).fillRect(60 - Math.round(60 * (odds.found + odds.near)), 0, Math.round(60 * odds.near), 5);
    bar.fillStyle(OUTCOME.found.color, 1).fillRect(60 - Math.round(60 * odds.found), 0, Math.round(60 * odds.found), 5);
    const hit = scene.add.zone(0, 0, rowW, ROW_H).setOrigin(0).setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => this.focusRequest?.());
    hit.on('pointerdown', () => {
      playSound('ui.click');
      this.onPick();
    });
    this.add([this.face, glyph, name, tag, dc, chance, bar, hit]);
    this.redraw();
  }

  setFocusRequest(request: () => void): void {
    this.focusRequest = request;
  }

  setFocused(focused: boolean): void {
    if (this.focused === focused) return;
    this.focused = focused;
    this.redraw();
    if (focused) this.onFocus();
  }

  setSelected(selected: boolean): void {
    this.selected = selected;
    this.redraw();
  }

  activate(): void {
    playSound('ui.click');
    this.onPick();
  }

  adjust(): boolean {
    return false;
  }

  private redraw(): void {
    const w = this.rowW;
    const standing = STANDING[this.choice.target.standing];
    const g = this.face;
    g.clear();
    g.fillStyle(MENU_COLOR.pitch, 1).fillRect(2, 3, w, ROW_H);
    g.fillStyle(this.selected || this.focused ? MENU_COLOR.woodRaised : MENU_COLOR.charcoalRaised, 1).fillRect(0, 0, w, ROW_H);
    g.fillStyle(standing.color, this.choice.target.standing === 'foreign' ? 0.55 : 1).fillRect(0, 0, 4, ROW_H);
    g.lineStyle(this.focused ? 2 : 1, this.focused ? MENU_COLOR.brassLight : MENU_COLOR.brassDark, 1).strokeRect(0.5, 0.5, w - 1, ROW_H - 1);
    if (this.selected) g.fillStyle(MENU_COLOR.brassLight, 1).fillRect(w - 6, 8, 3, ROW_H - 16);
  }
}

export class SearchView extends Phaser.GameObjects.Container {
  private readonly sceneInput: SceneInput;
  private focus = new MenuFocusGroup();
  private shelf: SearchCategory;
  private page = 0;
  private selected: SearchChoice | null = null;
  private rows: SearchRow[] = [];
  private card?: Phaser.GameObjects.Container;
  private stage?: Phaser.GameObjects.Container;
  private stageFocus = new MenuFocusGroup();
  private stageKeys: ((key: 'go' | 'pass') => void) | null = null;
  private rolling = false;
  private disposed = false;
  private readonly reduced = isReducedMotion();

  constructor(scene: Phaser.Scene, private readonly model: SearchViewModel, private readonly hooks: SearchViewHooks) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(120);
    ensureGlowTextures(scene);
    this.shelf = SHELVES.find((entry) => model.shelves[entry.id].length)?.id ?? 'resource';
    this.sceneInput = new SceneInput(scene);
    const pick = (run: () => void) => (): void => {
      if (!this.rolling) run();
    };
    const staged = (run: () => void) => (): void => {
      if (this.rolling) run();
    };
    this.sceneInput.bindKeys([
      { key: 'LEFT', capture: true, run: () => (this.rolling ? this.stageFocus.move(-1) : this.focus.move(-1)) },
      { key: 'UP', capture: true, run: () => (this.rolling ? this.stageFocus.move(-1) : this.focus.move(-1)) },
      { key: 'RIGHT', capture: true, run: () => (this.rolling ? this.stageFocus.move(1) : this.focus.move(1)) },
      { key: 'DOWN', capture: true, run: () => (this.rolling ? this.stageFocus.move(1) : this.focus.move(1)) },
      { key: 'TAB', capture: true, run: (event) => (this.rolling ? this.stageFocus : this.focus).move(event.shiftKey ? -1 : 1) },
      { key: 'ENTER', capture: true, run: () => (this.rolling ? this.stageFocus.activate() : this.focus.activate()) },
      { key: 'SPACE', capture: true, run: () => (this.rolling ? this.stageFocus.activate() : this.focus.activate()) },
      { key: 'Q', run: pick(() => this.cycleShelf(-1)) },
      { key: 'E', run: pick(() => this.cycleShelf(1)) },
      { key: 'ONE', run: staged(() => this.stageKeys?.('go')) },
      { key: 'TWO', run: staged(() => this.stageKeys?.('pass')) },
      { key: 'ESC', capture: true, run: () => (this.rolling ? this.stageKeys?.('pass') : this.hooks.close(null)) },
    ]);
    this.render();
  }

  override destroy(fromScene?: boolean): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sceneInput.destroy();
    this.stage?.destroy();
    this.stage = undefined;
    if (this.scene) this.scene.tweens.killTweensOf(this.list);
    super.destroy(fromScene);
  }

  // ---------------------------------------------------------------------------
  //  THE SHELVES
  // ---------------------------------------------------------------------------

  private cycleShelf(step: number): void {
    const open = SHELVES.filter((entry) => this.model.shelves[entry.id].length);
    const at = open.findIndex((entry) => entry.id === this.shelf);
    const next = open[(at + step + open.length) % open.length];
    if (next && next.id !== this.shelf) this.setShelf(next.id);
  }

  private setShelf(shelf: SearchCategory): void {
    this.shelf = shelf;
    this.page = 0;
    this.selected = null;
    playSound('ui.click');
    this.render();
  }

  private render(): void {
    this.removeAll(true);
    this.rows = [];
    this.card = undefined;
    this.focus = new MenuFocusGroup();
    const { scene, model } = this;
    addCabinetBackdrop(scene, this);

    const title = scene.add.text(72, 38, 'SEARCH THE AREA', {
      fontFamily: MENU_FONT.display,
      fontSize: '29px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    });
    const when = model.night ? '  ·  night: the country is more dangerous' : '';
    const sub = scene.add.text(74, 80, `${model.place}  ·  Depth ${model.depth}${when}  ·  ${model.searcher} searches  ·  ${model.hours} h each`, {
      fontFamily: MENU_FONT.body,
      fontSize: '14px',
      color: MENU_HEX.boneDim,
    });
    const fresh = model.pickedOver <= 0;
    const plate = scene.add.text(1206, 50, fresh ? 'FRESH GROUND' : `PICKED OVER  +${model.pickedOver} DC`, {
      fontFamily: MENU_FONT.control,
      fontSize: '14px',
      fontStyle: 'bold',
      color: MENU_HEX.ink,
      backgroundColor: fresh ? '#78b886' : '#e6b55a',
      padding: { x: 14, y: 8 },
    }).setOrigin(1, 0);
    this.add([title, sub, plate]);
    addSectionRule(scene, this, 58, 116, 1164);

    SHELVES.forEach((entry, index) => {
      const count = model.shelves[entry.id].length;
      const chip = new CabinetChip(scene, 58 + index * 214, 132, {
        width: 200,
        height: 38,
        label: `${entry.label}  (${count})`,
        tone: this.shelf === entry.id ? 'primary' : 'normal',
        enabled: count > 0,
        onActivate: () => this.setShelf(entry.id),
      });
      this.add(chip);
      this.focus.add(chip);
    });
    const blurb = SHELVES.find((entry) => entry.id === this.shelf)?.blurb ?? '';
    this.add(scene.add.text(1222, 151, `${blurb}  Q / E switch.`, {
      fontFamily: MENU_FONT.body,
      fontSize: '13px',
      color: MENU_HEX.boneDim,
    }).setOrigin(1, 0.5));

    addRecess(scene, this, LIST.x, LIST.y, LIST.w, LIST.h);
    addRecess(scene, this, CARD.x, CARD.y, CARD.w, CARD.h, MENU_COLOR.woodDeep);

    const shelf = model.shelves[this.shelf];
    const pages = Math.max(1, Math.ceil(shelf.length / ROWS));
    this.page = Math.min(this.page, pages - 1);
    const visible = shelf.slice(this.page * ROWS, (this.page + 1) * ROWS);
    if (!this.selected || !visible.includes(this.selected)) this.selected = visible[0] ?? null;
    visible.forEach((choice, index) => {
      const row = new SearchRow(scene, LIST.x + 12, LIST.y + 12 + index * (ROW_H + ROW_GAP), LIST.w - 24, choice,
        () => void this.rollFor(choice),
        () => this.select(choice));
      this.rows.push(row);
      this.add(row);
    });
    // Rows come first in the keyboard order after the tabs, so arrowing down reaches them.
    for (const row of this.rows) this.focus.add(row);
    if (pages > 1) {
      const y = LIST.y + LIST.h - 34;
      const previous = new CabinetChip(scene, LIST.x + 12, y, {
        width: 120,
        height: 28,
        label: 'Previous',
        enabled: this.page > 0,
        onActivate: () => { this.page -= 1; this.selected = null; this.render(); },
      });
      const next = new CabinetChip(scene, LIST.x + LIST.w - 132, y, {
        width: 120,
        height: 28,
        label: 'Next',
        enabled: this.page < pages - 1,
        onActivate: () => { this.page += 1; this.selected = null; this.render(); },
      });
      const label = scene.add.text(LIST.x + LIST.w / 2, y + 14, `Page ${this.page + 1} / ${pages}`, {
        fontFamily: MENU_FONT.control,
        fontSize: '12px',
        color: MENU_HEX.boneDim,
      }).setOrigin(0.5);
      this.add([previous, next, label]);
      this.focus.add(previous);
      this.focus.add(next);
    }

    const go = new CabinetChip(scene, CARD.x + 24, CARD.y + CARD.h - 62, {
      width: 300,
      height: 42,
      label: `Search  (${model.hours} h)`,
      tone: 'primary',
      enabled: shelf.length > 0,
      onActivate: () => {
        if (this.selected) void this.rollFor(this.selected);
      },
    });
    const back = new CabinetChip(scene, CARD.x + 340, CARD.y + CARD.h - 62, {
      width: CARD.w - 364,
      height: 42,
      label: 'Back',
      onActivate: () => this.hooks.close(null),
    });
    this.add([go, back]);
    this.focus.add(go);
    this.focus.add(back);

    this.add(scene.add.text(76, 664, 'Arrows: choose     Enter: search     Q / E: shelf     Esc: back', {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      color: MENU_HEX.boneDim,
    }).setOrigin(0, 0.5));
    this.renderCard();
    // Land the keyboard on the first target rather than the tabs.
    const first = this.rows.findIndex((row) => row.isEnabled);
    if (first >= 0) this.focus.focus(SHELVES.length + first);
  }

  private select(choice: SearchChoice): void {
    if (this.selected === choice && this.card) return;
    this.selected = choice;
    this.renderCard();
  }

  /** The chosen target up close: what it is, where it belongs, and the odds of the roll. */
  private renderCard(): void {
    this.card?.destroy();
    const { scene } = this;
    const card = scene.add.container(CARD.x, CARD.y);
    this.card = card;
    this.add(card);
    this.rows.forEach((row, index) => row.setSelected(this.model.shelves[this.shelf][this.page * ROWS + index] === this.selected));
    const choice = this.selected;
    if (!choice) {
      card.add(scene.add.text(CARD.w / 2, CARD.h / 2, 'Nothing to look for here.', {
        fontFamily: MENU_FONT.body,
        fontSize: '15px',
        color: MENU_HEX.boneDim,
      }).setOrigin(0.5));
      return;
    }
    const { target, odds } = choice;
    const standing = STANDING[target.standing];
    const tint = tintOf(target);

    const mx = 92;
    const my = 92;
    const aura = scene.add.image(mx, my, GLOW.soft).setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setScale(1.25).setAlpha(0.28);
    const medal = scene.add.graphics({ x: mx, y: my });
    medal.fillStyle(MENU_COLOR.ink, 1).fillCircle(1.5, 3, 60);
    medal.fillStyle(MENU_COLOR.pitch, 1).fillCircle(0, 0, 59);
    medal.lineStyle(3, MENU_COLOR.brass, 1).strokeCircle(0, 0, 56);
    medal.lineStyle(1, MENU_COLOR.brassLight, 0.7).strokeCircle(0, 0, 51);
    medal.fillStyle(mixColor(tint, 0x000000, 0.78), 1).fillCircle(0, 0, 49);
    medal.fillStyle(mixColor(tint, 0x000000, 0.64), 1).fillCircle(0, -5, 42);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      medal.fillStyle(MENU_COLOR.brassLight, 0.8).fillCircle(Math.cos(a) * 56, Math.sin(a) * 56, 1.2);
    }
    card.add([aura, medal]);
    const figure = target.category === 'creature' ? this.creatureFigure(target.id, mx, my + 32, 70) : null;
    if (figure) {
      card.add(figure);
    } else {
      const glyph = scene.add.graphics({ x: mx, y: my });
      drawTargetGlyph(glyph, target, 58);
      card.add(glyph);
      if (!this.reduced) {
        glyph.setScale(0.6);
        scene.tweens.add({ targets: glyph, scale: 1, duration: 320, ease: 'Back.Out' });
      }
    }
    if (!this.reduced) scene.tweens.add({ targets: aura, alpha: 0.5, scale: 1.45, duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.InOut' });

    let size = 26;
    const name = scene.add.text(176, 30, target.label, {
      fontFamily: MENU_FONT.display,
      fontSize: `${size}px`,
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    });
    while (name.width > CARD.w - 196 && size > 16) name.setFontSize(--size);
    const kind = target.category === 'resource'
      ? { herb: 'Herb', ore: 'Ore', gem: 'Gemstone' }[target.resource ?? 'herb']
      : 'Creature';
    const tag = scene.add.text(177, 68, `${kind.toUpperCase()}  ·  ${standing.label}`, {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      fontStyle: 'bold',
      color: cssColor(standing.color),
    }).setLetterSpacing(2);
    const home = scene.add.text(177, 90, `At home in: ${target.home}`, {
      fontFamily: MENU_FONT.body,
      fontSize: '13px',
      color: MENU_HEX.boneDim,
      wordWrap: { width: CARD.w - 196 },
      lineSpacing: 2,
    });
    card.add([name, tag, home]);
    if (choice.note) {
      card.add(scene.add.text(177, 144, choice.note, {
        fontFamily: MENU_FONT.control,
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#e6c77a',
      }));
    }

    const rule = scene.add.graphics();
    rule.lineStyle(1, MENU_COLOR.brassDark, 0.85).lineBetween(24, 186, CARD.w - 24, 186);
    rule.fillStyle(MENU_COLOR.brass, 1).fillRect(24, 184, 34, 4);
    card.add(rule);
    card.add(scene.add.text(24, 200, 'THE ROLL', {
      fontFamily: MENU_FONT.control,
      fontSize: '11px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
    }).setLetterSpacing(3));
    const formula = choice.bonus > 0 ? `d20 + ${choice.bonus}   vs   DC ${target.dc}` : `d20   vs   DC ${target.dc}`;
    card.add(scene.add.text(24, 218, formula, {
      fontFamily: MENU_FONT.display,
      fontSize: '24px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    }));
    const why = [
      choice.bonus > 0 ? `+${choice.bonus} from ${choice.knack}.` : `${choice.knack} adds nothing.`,
      target.standing === 'foreign' ? 'It does not belong here: much harder.' : target.standing === 'scarce' ? 'Seldom met this close to a town.' : '',
      this.model.pickedOver > 0 ? `Searched already today: +${this.model.pickedOver} DC.` : '',
    ].filter(Boolean).join(' ');
    card.add(scene.add.text(24, 254, why, {
      fontFamily: MENU_FONT.body,
      fontSize: '12px',
      color: MENU_HEX.boneDim,
      wordWrap: { width: CARD.w - 48 },
    }));

    const barY = 292;
    const barW = CARD.w - 48;
    const bar = scene.add.graphics({ x: 24, y: barY });
    const segments: [SearchOutcome, number][] = [['nothing', odds.nothing], ['near', odds.near], ['found', odds.found]];
    let at = 0;
    bar.fillStyle(MENU_COLOR.pitch, 1).fillRect(-2, -2, barW + 4, 22);
    for (const [outcome, share] of segments) {
      const w = Math.round(barW * share);
      if (w <= 0) continue;
      bar.fillStyle(mixColor(OUTCOME[outcome].color, 0x000000, 0.2), 1).fillRect(at, 0, w, 18);
      bar.fillStyle(mixColor(OUTCOME[outcome].color, 0xffffff, 0.18), 1).fillRect(at, 0, w, 4);
      at += w;
    }
    bar.lineStyle(1, MENU_COLOR.brassDark, 1).strokeRect(-1.5, -1.5, barW + 3, 21);
    card.add(bar);
    const legend = scene.add.text(24, barY + 30,
      `Found ${percent(odds.found)}     Lucky turn ${percent(odds.near)}     Nothing ${percent(odds.nothing)}`, {
        fontFamily: MENU_FONT.control,
        fontSize: '13px',
        color: MENU_HEX.bone,
      });
    const rules = scene.add.text(24, barY + 50, `Miss by ${NEAR_MISS} or less and you still turn up something good. A natural 20 always finds it.`, {
      fontFamily: MENU_FONT.body,
      fontSize: '12px',
      color: MENU_HEX.boneDim,
      wordWrap: { width: CARD.w - 48 },
    });
    card.add([legend, rules]);
  }

  /** The creature itself in the medal: its own art, or the tinted figure it fights as. */
  private creatureFigure(kind: string, x: number, y: number, height: number): Phaser.GameObjects.Sprite | null {
    const { scene } = this;
    const art = creatureSpriteFor(kind);
    ensureCreatureSprites(scene, art);
    const texture = art ? creatureTexture(art) : MAGE_FIRST_FRAME;
    if (!scene.textures.exists(texture)) return null;
    const sprite = scene.add.sprite(x, y, texture).setOrigin(0.5, 1);
    const idle = art ? `enemy-${art}-idle` : MAGE_IDLE;
    if (scene.anims.exists(idle)) sprite.play(idle);
    // Creature sheets pad their frames; the figure itself is about 1 / CREATURE_FRAME_RATIO of one.
    sprite.setScale((height * (art ? CREATURE_FRAME_RATIO * 0.8 : 1)) / Math.max(1, sprite.height));
    if (!art) sprite.setTint(tintOf({ category: 'creature', id: kind } as SearchTarget));
    return sprite;
  }

  // ---------------------------------------------------------------------------
  //  THE ROLL
  // ---------------------------------------------------------------------------

  private async rollFor(choice: SearchChoice): Promise<void> {
    if (this.rolling || this.disposed) return;
    this.rolling = true;
    this.selected = choice;
    const { scene } = this;
    const stage = scene.add.container(0, 0).setDepth(125);
    this.stage = stage;
    this.stageFocus = new MenuFocusGroup();
    const dim = scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, MENU_COLOR.pitch, 0.8).setOrigin(0).setInteractive();
    const W = 660;
    const H = 540;
    const left = (GAME_WIDTH - W) / 2;
    const top = (GAME_HEIGHT - H) / 2;
    const tint = tintOf(choice.target);
    const frame = scene.add.graphics();
    frame.fillStyle(MENU_COLOR.pitch, 0.9).fillRect(left + 6, top + 7, W, H);
    frame.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(left, top, W, H);
    frame.fillStyle(MENU_COLOR.charcoal, 1).fillRect(left + 9, top + 9, W - 18, H - 18);
    frame.fillStyle(MENU_COLOR.felt, 1).fillRect(left + 22, top + 86, W - 44, 160);
    frame.lineStyle(1, MENU_COLOR.feltLight, 0.4);
    for (let y = top + 98; y < top + 246; y += 16) frame.lineBetween(left + 30, y, left + W - 30, y);
    frame.lineStyle(2, MENU_COLOR.brassDark, 1).strokeRect(left + 9.5, top + 9.5, W - 19, H - 19);
    frame.lineStyle(1, MENU_COLOR.brass, 0.55).strokeRect(left + 0.5, top + 0.5, W - 1, H - 1);
    frame.lineStyle(1, MENU_COLOR.brassDark, 0.9).strokeRect(left + 22.5, top + 86.5, W - 45, 159);
    frame.fillStyle(tint, 1).fillRect(left + 9, top + 9, W - 18, 4);
    for (const [x, y] of [[left + 4, top + 4], [left + W - 4, top + 4], [left + 4, top + H - 4], [left + W - 4, top + H - 4]]) {
      frame.fillStyle(MENU_COLOR.ink, 1).fillCircle(x, y + 0.5, 3);
      frame.fillStyle(MENU_COLOR.brass, 1).fillCircle(x, y, 2.4);
    }
    const kicker = scene.add.text(GAME_WIDTH / 2, top + 30, `SEARCHING  ·  ${this.model.searcher.toUpperCase()}  ·  ${this.model.hours} H`, {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      fontStyle: 'bold',
      color: cssColor(mixColor(tint, 0xffffff, 0.3)),
    }).setOrigin(0.5).setLetterSpacing(3);
    const title = scene.add.text(GAME_WIDTH / 2, top + 58, choice.target.label, {
      fontFamily: MENU_FONT.display,
      fontSize: '26px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    }).setOrigin(0.5);
    stage.add([dim, frame, kicker, title]);

    // The die: a bone d20 tumbling over the felt.
    const dieX = GAME_WIDTH / 2;
    const dieY = top + 166;
    const glow = scene.add.image(dieX, dieY, GLOW.soft).setTint(MENU_COLOR.brassLight).setBlendMode(Phaser.BlendModes.ADD).setScale(1.6).setAlpha(0.18);
    const rays = scene.add.image(dieX, dieY, GLOW.rays).setBlendMode(Phaser.BlendModes.ADD).setScale(0.55).setAlpha(0);
    const die = scene.add.container(dieX, dieY);
    const body = scene.add.graphics();
    const face = scene.add.text(0, 6, '20', {
      fontFamily: MENU_FONT.display,
      fontSize: '34px',
      fontStyle: 'bold',
      color: MENU_HEX.ink,
    }).setOrigin(0.5);
    die.add([body, face]);
    drawD20(body, MENU_COLOR.bone);
    const formula = scene.add.text(GAME_WIDTH / 2, top + 268, choice.bonus > 0 ? `d20 + ${choice.bonus}   vs   DC ${choice.target.dc}` : `d20   vs   DC ${choice.target.dc}`, {
      fontFamily: MENU_FONT.control,
      fontSize: '15px',
      fontStyle: 'bold',
      color: MENU_HEX.boneDim,
    }).setOrigin(0.5);
    stage.add([glow, rays, die, formula]);

    const meter = this.buildMeter(stage, left + 60, top + 302, W - 120, choice);
    const stamp = scene.add.text(GAME_WIDTH / 2, top + 382, '', {
      fontFamily: MENU_FONT.display,
      fontSize: '24px',
      fontStyle: 'bold',
      color: MENU_HEX.ink,
      padding: { x: 18, y: 6 },
    }).setOrigin(0.5).setVisible(false);
    const natural = scene.add.text(GAME_WIDTH / 2, top + 350, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
    }).setOrigin(0.5).setLetterSpacing(3).setVisible(false);
    const message = scene.add.text(GAME_WIDTH / 2, top + 412, '', {
      fontFamily: MENU_FONT.body,
      fontSize: '15px',
      color: MENU_HEX.bone,
      align: 'center',
      wordWrap: { width: W - 80 },
    }).setOrigin(0.5, 0).setAlpha(0);
    stage.add([stamp, natural, message]);

    stage.setAlpha(0);
    scene.tweens.add({ targets: stage, alpha: 1, duration: this.reduced ? 90 : 180 });
    playSound('dice.roll');
    const tumble = scene.time.addEvent({
      delay: 70,
      loop: true,
      callback: () => face.setText(String(1 + Math.floor(Math.random() * 20))),
    });
    if (!this.reduced) {
      scene.tweens.add({ targets: die, angle: { from: -28, to: 28 }, duration: 150, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      scene.tweens.add({ targets: die, scale: { from: 0.86, to: 1.08 }, duration: 110, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
    const started = scene.time.now;
    const result = await this.hooks.roll(choice);
    if (this.disposed) return;
    const left_ = TUMBLE_MS - (scene.time.now - started);
    if (left_ > 0) await this.wait(this.reduced ? Math.min(left_, 250) : left_);
    if (this.disposed) return;
    tumble.remove(false);
    scene.tweens.killTweensOf(die);
    die.setAngle(0);

    if (!result) {
      face.setText('?');
      drawD20(body, MENU_COLOR.boneDim);
      stamp.setText('NO ANSWER').setBackgroundColor('#948d7e').setVisible(true);
      message.setText('The search could not be made. Try again.').setAlpha(1);
      playSound('ui.deny');
      this.offerButtons(stage, top + H - 64, choice, null);
      return;
    }

    const { roll } = result;
    const look = OUTCOME[roll.outcome];
    const crit = roll.die === 20;
    const fumble = roll.die === 1;
    face.setText(String(roll.die));
    drawD20(body, crit ? 0xf3dc8a : fumble ? 0xc27a70 : mixColor(MENU_COLOR.bone, look.color, 0.35));
    die.setScale(this.reduced ? 1 : 1.32);
    if (!this.reduced) scene.tweens.add({ targets: die, scale: 1, duration: 360, ease: 'Back.Out' });
    glow.setTint(look.color);
    scene.tweens.add({ targets: glow, alpha: 0.55, scale: 2.1, duration: 240, yoyo: true, hold: 200, ease: 'Sine.Out' });
    if (crit && !this.reduced) {
      rays.setTint(0xffe7a0);
      scene.tweens.add({ targets: rays, alpha: 0.7, scale: 0.9, angle: 40, duration: 900, yoyo: true, ease: 'Sine.InOut' });
    }
    const ring = scene.add.graphics({ x: dieX, y: dieY });
    ring.lineStyle(3, look.color, 1).strokeCircle(0, 0, 52);
    stage.add(ring);
    scene.tweens.add({ targets: ring, scale: 2.2, alpha: 0, duration: 520, ease: 'Cubic.Out', onComplete: () => ring.destroy() });
    playSound(crit ? 'dice.crit' : fumble ? 'dice.fumble' : roll.outcome === 'found' ? 'ui.confirm' : roll.outcome === 'near' ? 'travel.notice' : 'ui.back');

    formula.setText(roll.bonus > 0 ? `${roll.die} + ${roll.bonus} = ${roll.total}   vs   DC ${roll.dc}` : `${roll.die}   vs   DC ${roll.dc}`).setColor(MENU_HEX.bone);
    meter(roll.total);
    await this.wait(this.reduced ? 60 : 380);
    if (this.disposed) return;
    if (crit || fumble) natural.setText(crit ? 'NATURAL 20' : 'NATURAL 1').setColor(cssColor(crit ? 0xf3dc8a : 0xd46a5c)).setVisible(true);
    stamp.setText(look.label).setBackgroundColor(cssColor(look.color)).setVisible(true);
    if (!this.reduced) {
      stamp.setScale(1.6).setAlpha(0);
      scene.tweens.add({ targets: stamp, scale: 1, alpha: 1, duration: 260, ease: 'Back.Out' });
    }
    message.setText(result.message);
    scene.tweens.add({ targets: message, alpha: 1, duration: this.reduced ? 60 : 260, delay: this.reduced ? 0 : 120 });
    this.offerButtons(stage, top + H - 64, choice, result);
  }

  /** The meter under the die: where nothing, a lucky turn and finding it begin. Returns the marker's mover. */
  private buildMeter(stage: Phaser.GameObjects.Container, x: number, y: number, w: number, choice: SearchChoice): (total: number) => void {
    const { scene } = this;
    const dc = choice.target.dc;
    const low = 1 + choice.bonus;
    const high = Math.max(20 + choice.bonus, dc + 2);
    const span = Math.max(1, high - low + 1);
    const px = (value: number): number => x + ((Phaser.Math.Clamp(value, low, high) - low + 0.5) / span) * w;
    const g = scene.add.graphics();
    g.fillStyle(MENU_COLOR.pitch, 1).fillRect(x - 3, y - 3, w + 6, 20);
    const nearFrom = Phaser.Math.Clamp(dc - NEAR_MISS, low, high + 1);
    const foundFrom = Phaser.Math.Clamp(dc, low, high + 1);
    const edge = (value: number): number => x + ((value - low) / span) * w;
    const paint = (from: number, to: number, color: number): void => {
      const a = edge(from);
      const b = edge(to);
      if (b <= a) return;
      g.fillStyle(mixColor(color, 0x000000, 0.25), 1).fillRect(a, y, b - a, 14);
      g.fillStyle(mixColor(color, 0xffffff, 0.15), 1).fillRect(a, y, b - a, 3);
    };
    paint(low, nearFrom, OUTCOME.nothing.color);
    paint(nearFrom, foundFrom, OUTCOME.near.color);
    paint(foundFrom, high + 1, OUTCOME.found.color);
    g.lineStyle(1, MENU_COLOR.brassDark, 1).strokeRect(x - 1.5, y - 1.5, w + 3, 17);
    const dcX = edge(foundFrom);
    g.lineStyle(2, MENU_COLOR.brassLight, 1).lineBetween(dcX, y - 7, dcX, y + 21);
    const dcLabel = scene.add.text(dcX, y + 24, `DC ${dc}`, {
      fontFamily: MENU_FONT.control,
      fontSize: '11px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
    }).setOrigin(0.5, 0);
    const marker = scene.add.graphics({ x: x, y: y - 6 });
    marker.fillStyle(MENU_COLOR.ink, 1).fillTriangle(-8, -12, 8, -12, 0, 1);
    marker.fillStyle(MENU_COLOR.bone, 1).fillTriangle(-6, -11, 6, -11, 0, -1);
    marker.setAlpha(0);
    stage.add([g, dcLabel, marker]);
    return (total: number) => {
      marker.setAlpha(1).setX(x);
      scene.tweens.add({ targets: marker, x: px(total), duration: this.reduced ? 80 : 420, ease: 'Cubic.Out' });
    };
  }

  private offerButtons(stage: Phaser.GameObjects.Container, y: number, choice: SearchChoice, result: SearchRollResult | null): void {
    const { scene } = this;
    const finish = (go: boolean): void => {
      if (this.disposed) return;
      this.stageKeys = null;
      this.hooks.close(result ? { choice, result, go } : null);
    };
    if (result?.offer) {
      const go = new CabinetChip(scene, GAME_WIDTH / 2 - 250, y, {
        width: 300,
        height: 42,
        label: `1   ${result.offer.go}`,
        tone: 'primary',
        onActivate: () => finish(true),
      });
      const pass = new CabinetChip(scene, GAME_WIDTH / 2 + 62, y, {
        width: 188,
        height: 42,
        label: `2   ${result.offer.pass}`,
        onActivate: () => finish(false),
      });
      stage.add([go, pass]);
      this.stageFocus.add(go);
      this.stageFocus.add(pass);
      this.stageKeys = (key) => finish(key === 'go');
      return;
    }
    const done = new CabinetChip(scene, GAME_WIDTH / 2 - 130, y, {
      width: 260,
      height: 42,
      label: 'Continue',
      tone: 'primary',
      onActivate: () => finish(false),
    });
    stage.add(done);
    this.stageFocus.add(done);
    this.stageKeys = () => finish(false);
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (ms <= 0 || this.disposed) {
        resolve();
        return;
      }
      this.scene.time.delayedCall(ms, () => resolve());
    });
  }
}
