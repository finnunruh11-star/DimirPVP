import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, FIELD } from '../../config/constants';
import type { WordId } from '../../core/Words';
import {
  TUTORIAL_SPELL_WORDS,
  type TutorialFocus,
  type TutorialStage,
  type TutorialStep,
} from '../../pve/tutorial';
import { bottom, right, type Rect } from '../layout';
import { CabinetChip } from '../cabinet/controls';
import { MENU_COLOR, MENU_FONT, MENU_HEX } from '../cabinet/theme';

export type TutorialEvent =
  | { k: 'command'; cmd: string }
  | { k: 'combo'; words: readonly WordId[] }
  | { k: 'panel'; panel: string }
  | { k: 'inventory-tab'; tab: string }
  | { k: 'reaction' }
  | { k: 'reaction-done' };

/**
 * How much of the overlay is showing. A full-screen menu owns the screen, so the
 * script gets out of the way rather than covering the options it just described.
 */
export type TutorialDisplay = 'full' | 'compact' | 'hidden';

export interface TutorialHooks {
  /** Where on screen the named piece of UI currently is, if it exists at all. */
  resolveFocus(focus: TutorialFocus): Rect | null;
  /** The words selected right now, so a step can open already satisfied. */
  currentCombo(): readonly WordId[];
  /** Perform the world change a step asks for as it opens. */
  stage(stage: TutorialStage): void;
  /** The script ran out, or the player skipped it. */
  finish(): void;
}

const BOX_W = 640;
const BOX_H = 232;
const PAD = 18;
const CHIP_W = 124;
const CHIP_H = 34;
/** Slim strip used while a full-screen panel owns the arena. */
const BAR: Rect = { x: 58, y: GAME_HEIGHT - 58, w: GAME_WIDTH - 116, h: 44 };

/**
 * The guided-tutorial overlay: one textbox, one highlight ring and one arrow,
 * driven by a fixed script. It never blocks the game — steps advance when the
 * player actually performs the action the step asked for, so the fight
 * underneath stays a real fight.
 */
export class TutorialView {
  private readonly root: Phaser.GameObjects.Container;
  private readonly marker: Phaser.GameObjects.Graphics;
  private readonly panel: Phaser.GameObjects.Graphics;
  private readonly chapterText: Phaser.GameObjects.Text;
  private readonly titleText: Phaser.GameObjects.Text;
  private readonly bodyText: Phaser.GameObjects.Text;
  private readonly taskText: Phaser.GameObjects.Text;
  private readonly barText: Phaser.GameObjects.Text;
  private readonly progressText: Phaser.GameObjects.Text;
  private readonly continueChip: CabinetChip;
  private readonly stepSkipChip: CabinetChip;
  private readonly skipChip: CabinetChip;
  private index = -1;
  private display: TutorialDisplay = 'full';
  private boxX = FIELD.x + 24;
  private boxY = bottom(FIELD) - BOX_H - 16;
  private finished = false;
  private destroyed = false;

  constructor(
    scene: Phaser.Scene,
    private readonly steps: readonly TutorialStep[],
    private readonly hooks: TutorialHooks,
    private readonly reducedMotion: boolean
  ) {
    this.root = scene.add.container(0, 0).setDepth(220);
    this.marker = scene.add.graphics();
    this.panel = scene.add.graphics();
    this.chapterText = scene.add.text(0, 0, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      fontStyle: 'bold',
      color: MENU_HEX.brass,
    });
    this.titleText = scene.add.text(0, 0, '', {
      fontFamily: MENU_FONT.display,
      fontSize: '23px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    });
    this.bodyText = scene.add.text(0, 0, '', {
      fontFamily: MENU_FONT.body,
      fontSize: '14px',
      color: MENU_HEX.bone,
      fixedWidth: BOX_W - PAD * 2,
      wordWrap: { width: BOX_W - PAD * 2 },
      lineSpacing: 2,
    });
    this.taskText = scene.add.text(0, 0, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '14px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
      fixedWidth: BOX_W - PAD * 2,
      wordWrap: { width: BOX_W - PAD * 2 },
    });
    this.barText = scene.add.text(0, 0, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '14px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
      fixedWidth: BAR.w - 32 - CHIP_W * 2 - 16,
      maxLines: 2,
    });
    this.progressText = scene.add.text(0, 0, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '11px',
      color: MENU_HEX.boneDim,
    }).setOrigin(1, 0);
    this.continueChip = new CabinetChip(scene, 0, 0, {
      width: CHIP_W,
      height: CHIP_H,
      label: 'Continue \u25b8',
      tone: 'primary',
      onActivate: () => this.advance(),
    });
    // A scripted step waits on the AI as well as the player, so every step needs
    // a way past it or an uncooperative dummy could strand the lesson.
    this.stepSkipChip = new CabinetChip(scene, 0, 0, {
      width: CHIP_W,
      height: CHIP_H,
      label: 'Skip step \u25b8',
      onActivate: () => this.advance(),
    });
    this.skipChip = new CabinetChip(scene, 0, 0, {
      width: CHIP_W,
      height: CHIP_H,
      label: 'End tutorial',
      onActivate: () => this.finish(),
    });
    this.root.add([
      this.marker,
      this.panel,
      this.chapterText,
      this.titleText,
      this.bodyText,
      this.taskText,
      this.barText,
      this.progressText,
      this.continueChip,
      this.stepSkipChip,
      this.skipChip,
    ]);
    this.showStep(0);
  }

  get active(): boolean {
    return !this.finished && !this.destroyed;
  }

  /** The step currently on screen, for callers that need its id. */
  get stepId(): string | null {
    return this.steps[this.index]?.id ?? null;
  }

  /**
   * Whether a click at this point belongs to the tutorial. Its buttons only fire
   * on pointer-UP, so the scene has to reject the pointer-DOWN itself or the
   * same click would also aim at the arena underneath.
   */
  blocksPointer(x: number, y: number): boolean {
    if (!this.active || this.display === 'hidden') return false;
    const rect = this.display === 'compact'
      ? BAR
      : { x: this.boxX, y: this.boxY, w: BOX_W, h: BOX_H };
    return x >= rect.x && x <= right(rect) && y >= rect.y && y <= bottom(rect);
  }

  setDisplay(display: TutorialDisplay): void {
    if (this.display === display || !this.active) return;
    this.display = display;
    this.applyDisplay();
  }

  /** Feed a player action in; the step advances only if it is the one asked for. */
  notify(event: TutorialEvent): void {
    if (!this.active) return;
    const step = this.steps[this.index];
    if (!step) return;
    const trigger = step.trigger;
    switch (trigger.on) {
      case 'command':
        if (event.k === 'command' && event.cmd === trigger.cmd) this.advance();
        break;
      case 'combo':
        if (event.k === 'combo' && sameWords(event.words, TUTORIAL_SPELL_WORDS)) this.advance();
        break;
      case 'panel':
        if (event.k === 'panel' && event.panel === trigger.panel) this.advance();
        break;
      case 'inventory-tab':
        if (event.k === 'inventory-tab' && event.tab === 'statuses') this.advance();
        break;
      case 'reaction':
        if (event.k === 'reaction') this.advance();
        break;
      case 'reaction-done':
        if (event.k === 'reaction-done') this.advance();
        break;
      default:
        break;
    }
  }

  /** Redraw the ring and arrow; call once per frame. */
  tick(time: number): void {
    this.marker.clear();
    if (!this.active || this.display !== 'full') return;
    const step = this.steps[this.index];
    const rect = step?.focus ? this.hooks.resolveFocus(step.focus) : null;
    if (!rect) return;
    const pulse = this.reducedMotion ? 0.5 : (Math.sin(time / 260) + 1) / 2;
    const pad = 7 + pulse * 5;
    const x = rect.x - pad;
    const y = rect.y - pad;
    const w = rect.w + pad * 2;
    const h = rect.h + pad * 2;
    this.marker.lineStyle(3, MENU_COLOR.brassLight, 0.55 + pulse * 0.35);
    this.marker.strokeRect(x, y, w, h);
    this.marker.lineStyle(2, MENU_COLOR.brassLight, 0.95);
    const arm = Math.min(18, w / 3, h / 3);
    for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const cx = x + sx * w;
      const cy = y + sy * h;
      this.marker.lineBetween(cx, cy, cx + (sx ? -arm : arm), cy);
      this.marker.lineBetween(cx, cy, cx, cy + (sy ? -arm : arm));
    }
    this.drawArrow(rect, pulse);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.root.destroy(true);
  }

  private drawArrow(rect: Rect, pulse: number): void {
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const bx = this.boxX + BOX_W / 2;
    const by = this.boxY + BOX_H / 2;
    let dx = bx - cx;
    let dy = by - cy;
    const length = Math.hypot(dx, dy);
    if (length < 1) return;
    dx /= length;
    dy /= length;
    // Walk out to the edge of the highlight box along that heading, so a wide
    // target gets its arrow on the side rather than floating over a corner.
    const halfW = rect.w / 2 + 16;
    const halfH = rect.h / 2 + 16;
    const scale = Math.min(
      halfW / Math.max(Math.abs(dx), 1e-6),
      halfH / Math.max(Math.abs(dy), 1e-6)
    );
    const lift = 4 + pulse * 10;
    const tipX = cx + dx * (scale + lift);
    const tipY = cy + dy * (scale + lift);
    const baseX = tipX + dx * 28;
    const baseY = tipY + dy * 28;
    const px = -dy * 11;
    const py = dx * 11;
    this.marker.fillStyle(MENU_COLOR.pitch, 0.65);
    this.marker.fillTriangle(tipX + dx * 3, tipY + dy * 3, baseX + px, baseY + py, baseX - px, baseY - py);
    this.marker.fillStyle(MENU_COLOR.brassLight, 1);
    this.marker.fillTriangle(tipX, tipY, baseX + px, baseY + py, baseX - px, baseY - py);
    this.marker.lineStyle(3, MENU_COLOR.brassLight, 0.9);
    this.marker.lineBetween(baseX, baseY, baseX + dx * 22, baseY + dy * 22);
  }

  private advance(): void {
    if (!this.active) return;
    if (this.index + 1 >= this.steps.length) {
      this.finish();
      return;
    }
    this.showStep(this.index + 1);
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.marker.clear();
    this.root.setVisible(false);
    this.hooks.finish();
  }

  private showStep(index: number): void {
    this.index = index;
    const step = this.steps[index];
    if (!step) {
      this.finish();
      return;
    }
    this.placeBox(step.focus ? this.hooks.resolveFocus(step.focus) : null);
    this.chapterText.setText(step.chapter.toUpperCase());
    this.titleText.setText(step.title);
    this.bodyText.setText(step.body);
    this.taskText.setText(step.task ?? '');
    this.barText.setText(step.task ? `${step.title} \u2014 ${step.task}` : step.title);
    this.progressText.setText(`${index + 1} / ${this.steps.length}`);
    this.applyDisplay();
    for (const stage of step.stages ?? []) this.hooks.stage(stage);
    // A word step can open with its answer already selected (the player was
    // ahead of the script), and no further toggle would ever be reported.
    if (step.trigger.on === 'combo' && sameWords(this.hooks.currentCombo(), TUTORIAL_SPELL_WORDS)) {
      this.advance();
    }
  }

  /**
   * Park the box clear of whatever the arrow points at. Field steps ask for a
   * click on the field, so the box takes the opposite corner — landing on the
   * very spot the player is being told to click is worse than showing no box.
   */
  private placeBox(focus: Rect | null): void {
    const left = FIELD.x + 24;
    const rightSide = right(FIELD) - BOX_W - 24;
    const top = FIELD.y + 16;
    const low = bottom(FIELD) - BOX_H - 16;
    if (!focus) {
      this.boxX = left;
      this.boxY = low;
      return;
    }
    const cx = focus.x + focus.w / 2;
    const cy = focus.y + focus.h / 2;
    if (cy < FIELD.y) {
      this.boxX = left;
      this.boxY = low;
    } else if (cy > bottom(FIELD)) {
      this.boxX = left;
      this.boxY = top;
    } else {
      this.boxX = cx > GAME_WIDTH / 2 ? left : rightSide;
      this.boxY = cy < FIELD.y + FIELD.h / 2 ? low : top;
    }
  }

  private applyDisplay(): void {
    const hidden = this.display === 'hidden';
    const compact = this.display === 'compact';
    this.root.setVisible(!hidden);
    if (hidden) {
      this.marker.clear();
      return;
    }
    const waiting = this.steps[this.index]?.trigger.on !== 'confirm';
    for (const item of [this.chapterText, this.titleText, this.bodyText, this.taskText, this.progressText]) {
      item.setVisible(!compact);
    }
    this.barText.setVisible(compact);
    this.continueChip.setVisible(!waiting);
    this.stepSkipChip.setVisible(waiting);
    this.layout();
    this.drawPanel();
  }

  private layout(): void {
    if (this.display === 'compact') {
      const chipY = BAR.y + (BAR.h - CHIP_H) / 2;
      const chipX = right(BAR) - 12 - CHIP_W;
      this.barText.setPosition(BAR.x + 16, BAR.y + 14);
      this.continueChip.setPosition(chipX, chipY);
      this.stepSkipChip.setPosition(chipX, chipY);
      this.skipChip.setPosition(chipX - CHIP_W - 8, chipY);
      return;
    }
    const x = this.boxX;
    const y = this.boxY;
    this.chapterText.setPosition(x + PAD, y + 14);
    this.titleText.setPosition(x + PAD, y + 32);
    this.bodyText.setPosition(x + PAD, y + 66);
    this.progressText.setPosition(x + BOX_W - PAD, y + 14);
    this.taskText.setPosition(x + PAD, y + BOX_H - 72);
    const chipY = y + BOX_H - 44;
    const chipX = x + BOX_W - PAD - CHIP_W;
    this.continueChip.setPosition(chipX, chipY);
    this.stepSkipChip.setPosition(chipX, chipY);
    this.skipChip.setPosition(chipX - CHIP_W - 8, chipY);
  }

  private drawPanel(): void {
    const g = this.panel;
    g.clear();
    const compact = this.display === 'compact';
    const x = compact ? BAR.x : this.boxX;
    const y = compact ? BAR.y : this.boxY;
    const w = compact ? BAR.w : BOX_W;
    const h = compact ? BAR.h : BOX_H;
    g.fillStyle(MENU_COLOR.pitch, 0.92).fillRect(x + 4, y + 5, w, h);
    g.fillStyle(MENU_COLOR.charcoal, 0.97).fillRect(x, y, w, h);
    g.lineStyle(2, MENU_COLOR.brass, 1).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    g.fillStyle(MENU_COLOR.brass, 1).fillRect(x, y, 5, h);
    if (compact) return;
    g.lineStyle(1, MENU_COLOR.brassDark, 0.85).lineBetween(x + PAD, y + 60, x + w - PAD, y + 60);
    g.lineStyle(1, MENU_COLOR.brassDark, 0.85)
      .lineBetween(x + PAD, y + h - 80, x + w - PAD, y + h - 80);
  }
}

function sameWords(a: readonly WordId[], b: readonly WordId[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((word, index) => word === sortedB[index]);
}
