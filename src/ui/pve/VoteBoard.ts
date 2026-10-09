// A party decision on screen: every option in a fixed row, and a head for each
// player who has chosen it (a filled disc in their colour) or is looking at it
// (a ring). Nothing slides, grows or shrinks: a change of votes only repaints
// the rows in place. Docked beside the map for travel plans, or centred over
// everything when the party must answer something that happened.

import Phaser from 'phaser';
import { playSound, unlockAudio } from '../../audio';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config/constants';
import { SceneInput } from '../../engine/SceneInput';
import { SEAT_COLORS } from '../../visuals/PlanMarks';
import { MENU_COLOR, MENU_FONT, MENU_HEX } from '../cabinet/theme';
import { drawPlate, drawRule, drawWindow } from './HudParts';

export interface VoteSeat {
  seat: number;
  name: string;
}

export interface VoteRow {
  id: string;
  label: string;
  detail?: string;
  enabled: boolean;
}

export interface VoteBoardModel {
  title: string;
  titleColor?: string;
  text: string;
  rows: VoteRow[];
  /** Who has chosen each row. */
  picks: Record<string, VoteSeat[]>;
  /** Who is looking at each row without having chosen it. */
  looks: Record<string, VoteSeat[]>;
  /** The row this player chose. */
  mine: string | null;
  mySeat: number;
  status: string;
  /** Plain actions under the rows, nobody votes on these. */
  buttons: VoteRow[];
  /** The choice is made: a light runs over `among` and stops on `final`. `key` names this reveal. */
  reveal?: { key: string; among: string[]; final: string } | null;
}

export interface VoteBoardHooks {
  pick(id: string): void;
  look?(id: string | null): void;
}

export const seatColor = (seat: number): number => SEAT_COLORS[seat % SEAT_COLORS.length];

const INK = 0x120d09;
const HEAD_R = 11;
const PAD = 14;

interface RowView {
  row: VoteRow;
  y: number;
  height: number;
  bg: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  detail: Phaser.GameObjects.Text | null;
  index: Phaser.GameObjects.Text | null;
  heads: Phaser.GameObjects.Text[];
  hit: Phaser.GameObjects.Zone;
  vote: boolean;
}

export class VoteBoard extends Phaser.GameObjects.Container {
  private rows: RowView[] = [];
  private shape = '';
  private model: VoteBoardModel | null = null;
  private hover: string | null = null;
  private focus = -1;
  private left = 0;
  /** The board's upper edge on screen. */
  frameTop = 0;
  private readonly title: Phaser.GameObjects.Text;
  private readonly bodyText: Phaser.GameObjects.Text;
  private readonly status: Phaser.GameObjects.Text;
  private readonly frame: Phaser.GameObjects.Graphics;
  private blocker: Phaser.GameObjects.Zone | null = null;
  private readonly keys: SceneInput | null;
  private readonly boardW: number;
  /** The reveal under way or done: the row the light is on, and whether it has stopped. */
  private revealKey = '';
  private spinAt: string | null = null;
  private landed = false;
  private spinTimer: Phaser.Time.TimerEvent | null = null;

  constructor(scene: Phaser.Scene, private readonly modal: boolean, private readonly hooks: VoteBoardHooks) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(modal ? 96 : 10);
    this.boardW = modal ? 680 : 420;
    if (modal) this.add(scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.72).setOrigin(0).setInteractive());
    this.frame = scene.add.graphics();
    this.title = scene.add.text(0, 0, '', {
      fontFamily: MENU_FONT.display,
      fontSize: modal ? '22px' : '20px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
    });
    this.bodyText = scene.add.text(0, 0, '', {
      fontFamily: MENU_FONT.body,
      fontSize: modal ? '14px' : '12px',
      color: MENU_HEX.bone,
      lineSpacing: 3,
      wordWrap: { width: this.boardW - PAD * 2 },
      maxLines: modal ? 8 : 3,
    });
    this.status = scene.add.text(0, 0, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      color: MENU_HEX.boneDim,
      wordWrap: { width: this.boardW - PAD * 2 },
      maxLines: 2,
    });
    this.add([this.frame, this.title, this.bodyText, this.status]);
    this.keys = modal ? new SceneInput(scene) : null;
    this.keys?.bindKeys([
      ...['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'].map((key, index) => ({ key, run: () => this.pickIndex(index) })),
      { key: 'UP', capture: true, run: () => this.moveFocus(-1) },
      { key: 'DOWN', capture: true, run: () => this.moveFocus(1) },
      { key: 'ENTER', capture: true, run: () => this.pickFocused() },
      { key: 'SPACE', capture: true, run: () => this.pickFocused() },
    ]);
  }

  override destroy(fromScene?: boolean): void {
    this.spinTimer?.remove();
    this.keys?.destroy();
    super.destroy(fromScene);
  }

  /** Show `model`, repainting in place when only votes and words changed. */
  show(model: VoteBoardModel): void {
    this.model = model;
    const reveal = model.reveal;
    if (!reveal && this.revealKey) {
      this.spinTimer?.remove();
      this.revealKey = '';
      this.spinAt = null;
      this.landed = false;
    }
    if (this.bodyText.text !== model.text) this.bodyText.setText(model.text);
    const bodyH = model.text ? Math.ceil(this.bodyText.height) : 0;
    const shape = [...model.rows.map((row) => `r:${row.id}`), ...model.buttons.map((row) => `b:${row.id}`), `t${bodyH}`].join('|');
    if (shape !== this.shape) this.build(model, shape, bodyH);
    if (this.modal) {
      if (this.title.text !== model.title) this.title.setText(model.title);
    } else {
      this.fit(this.title, model.title, this.boardW - PAD * 2);
    }
    this.title.setColor(model.titleColor ?? MENU_HEX.brassLight);
    if (!this.revealKey && this.status.text !== model.status) this.status.setText(model.status);
    for (const view of this.rows) {
      const row = (view.vote ? model.rows : model.buttons).find((entry) => entry.id === view.row.id) ?? view.row;
      view.row = row;
      this.fit(view.label, row.label, this.boardW - PAD * 2 - (view.vote ? 130 : 50));
      if (view.detail && view.detail.text !== (row.detail ?? '')) view.detail.setText(row.detail ?? '');
      this.paintRow(view);
    }
    if (reveal && reveal.key !== this.revealKey) this.startReveal(reveal);
  }

  /** Run a light over the options it came down to, slowing until it stops on the one chosen. */
  private startReveal(reveal: { key: string; among: string[]; final: string }): void {
    this.revealKey = reveal.key;
    this.spinTimer?.remove();
    const among = reveal.among.length ? reveal.among : [reveal.final];
    const finalAt = Math.max(0, among.indexOf(reveal.final));
    const land = (): void => {
      this.spinAt = reveal.final;
      this.landed = true;
      const label = this.rows.find((view) => view.row.id === reveal.final)?.row.label ?? '';
      this.status.setText(among.length > 1 ? `A tie! The lots fall on: ${label}` : `Chosen: ${label}`);
      playSound('ui.confirm');
      for (const view of this.rows) this.paintRow(view);
    };
    if (among.length === 1) {
      land();
      return;
    }
    this.status.setText('A tie! Drawing lots...');
    // The same number of hops on every screen, so the light stops together everywhere.
    const hops = among.length * 3 + finalAt;
    let hop = 0;
    const next = (): void => {
      this.spinAt = among[hop % among.length];
      playSound('ui.hover');
      for (const view of this.rows) this.paintRow(view);
      if (hop >= hops) {
        land();
        return;
      }
      hop += 1;
      const t = hop / hops;
      this.spinTimer = this.scene.time.delayedCall(70 + t * t * 260, next);
    };
    next();
  }

  /** The digit keys pick the n-th option (votes first, then plain actions). */
  pickIndex(index: number): void {
    const view = this.rows[index];
    if (view) this.activate(view);
  }

  private build(model: VoteBoardModel, shape: string, bodyTextH: number): void {
    this.shape = shape;
    for (const view of this.rows) {
      for (const part of [view.bg, view.label, view.detail, view.index, view.hit, ...view.heads]) part?.destroy();
    }
    this.blocker?.destroy();
    this.rows = [];
    this.focus = -1;
    this.hover = null;
    const scene = this.scene;
    const voteH = this.modal ? 66 : 44;
    const buttonH = this.modal ? 34 : 28;
    const gap = 6;
    const bodyH = model.text ? bodyTextH + 12 : 0;
    const statusH = 42;
    const head = this.modal ? 70 : 44;
    const height = head + bodyH
      + model.rows.length * (voteH + gap)
      + (model.buttons.length ? 6 + model.buttons.length * (buttonH + gap) : 0)
      + statusH;
    const left = this.modal ? (GAME_WIDTH - this.boardW) / 2 : GAME_WIDTH - this.boardW - 16;
    const top = this.modal ? Math.max(20, (GAME_HEIGHT - height) / 2) : GAME_HEIGHT - 44 - height;
    this.left = left;
    this.frameTop = top;
    this.drawFrame(left, top, height);
    // Clicks on the board stay on the board instead of reaching the map below.
    this.blocker = scene.add.zone(left, top, this.boardW, height).setOrigin(0).setInteractive();
    this.addAt(this.blocker, this.modal ? 2 : 1);
    if (this.modal) this.title.setOrigin(0.5, 0).setPosition(GAME_WIDTH / 2, top + 22);
    else this.title.setPosition(left + PAD, top + 12);
    this.bodyText.setPosition(left + PAD, top + head - 2).setVisible(!!model.text);
    let y = top + head + bodyH;
    let number = 0;
    const addRow = (row: VoteRow, vote: boolean): void => {
      const h = vote ? voteH : buttonH;
      const bg = scene.add.graphics();
      const label = scene.add.text(left + PAD + 46, y + (vote ? 8 : h / 2), '', {
        fontFamily: MENU_FONT.control,
        fontSize: vote ? (this.modal ? '16px' : '14px') : '12px',
        fontStyle: 'bold',
        color: MENU_HEX.bone,
      }).setOrigin(0, vote ? 0 : 0.5);
      const detail = vote ? scene.add.text(left + PAD + 46, y + (this.modal ? 30 : 25), '', {
        fontFamily: MENU_FONT.body,
        fontSize: this.modal ? '12px' : '11px',
        color: MENU_HEX.boneDim,
        wordWrap: { width: this.boardW - PAD * 2 - 140 },
        maxLines: this.modal ? 2 : 1,
      }) : null;
      number += 1;
      const index = number <= 9 ? scene.add.text(left + PAD + 26, y + h / 2, String(number), {
        fontFamily: MENU_FONT.control,
        fontSize: '13px',
        fontStyle: 'bold',
        color: MENU_HEX.ink,
      }).setOrigin(0.5) : null;
      const heads = vote ? [0, 1, 2].map((slot) => scene.add.text(left + this.boardW - PAD - HEAD_R - 6 - slot * (HEAD_R * 2 + 5), y + h / 2, '', {
        fontFamily: MENU_FONT.control,
        fontSize: '12px',
        fontStyle: 'bold',
        color: MENU_HEX.ink,
      }).setOrigin(0.5)) : [];
      const hit = scene.add.zone(left + PAD, y, this.boardW - PAD * 2, h).setOrigin(0).setInteractive({ useHandCursor: true });
      const view: RowView = { row, y, height: h, bg, label, detail, index, heads, hit, vote };
      hit.on('pointerover', () => this.setHover(view));
      hit.on('pointerout', () => {
        if (this.hover === view.row.id) this.setHover(null);
      });
      hit.on('pointerdown', () => this.activate(view));
      this.add([bg, label, ...(detail ? [detail] : []), ...(index ? [index] : []), ...heads, hit]);
      this.rows.push(view);
      y += h + gap;
    };
    for (const row of model.rows) addRow(row, true);
    if (model.buttons.length) y += 6;
    for (const row of model.buttons) addRow(row, false);
    this.status.setPosition(left + PAD, top + height - statusH + 6);
  }

  private drawFrame(left: number, top: number, height: number): void {
    const g = this.frame.clear();
    if (this.modal) {
      drawWindow(g, left, top, this.boardW, height);
      drawRule(g, GAME_WIDTH / 2, top + 56, 160);
      return;
    }
    drawPlate(g, left, top, this.boardW, height);
  }

  private paintRow(view: RowView): void {
    const model = this.model;
    if (!model) return;
    const { row, y, height } = view;
    const left = this.left + PAD;
    const width = this.boardW - PAD * 2;
    const mine = view.vote && model.mine === row.id;
    const picks = view.vote ? model.picks[row.id] ?? [] : [];
    const looks = view.vote ? (model.looks[row.id] ?? []).filter((seat) => !picks.some((pick) => pick.seat === seat.seat)) : [];
    const hovered = this.hover === row.id || this.rows[this.focus] === view;
    const myColor = seatColor(model.mySeat);
    const g = view.bg.clear();
    g.fillStyle(MENU_COLOR.pitch, 1).fillRect(left + 2, y + 3, width, height);
    g.fillStyle(hovered && row.enabled ? MENU_COLOR.woodRaised : MENU_COLOR.charcoalRaised, row.enabled ? 1 : 0.6).fillRect(left, y, width, height);
    if (mine) g.fillStyle(myColor, 0.22).fillRect(left, y, width, height);
    const lit = view.vote && this.spinAt === row.id;
    if (lit) g.fillStyle(MENU_COLOR.brassLight, this.landed ? 0.45 : 0.3).fillRect(left, y, width, height);
    // The edge shows everyone who chose this, one stripe each.
    const stripes = picks.length ? picks.map((seat) => seatColor(seat.seat)) : [MENU_COLOR.brassDark];
    const stripe = height / stripes.length;
    stripes.forEach((color, i) => g.fillStyle(color, 1).fillRect(left, y + i * stripe, 7, Math.ceil(stripe)));
    g.fillStyle(row.enabled ? MENU_COLOR.bone : MENU_COLOR.disabled, 1).fillRect(left + 16, y + height / 2 - 10, 20, 20);
    g.lineStyle(lit ? 3 : mine ? 2 : 1, lit ? MENU_COLOR.brassLight : mine ? myColor : hovered && row.enabled ? MENU_COLOR.brassLight : MENU_COLOR.brassDark, 1)
      .strokeRect(left + 0.5, y + 0.5, width - 1, height - 1);
    view.label.setColor(row.enabled ? MENU_HEX.bone : MENU_HEX.disabled);
    view.detail?.setColor(row.enabled ? MENU_HEX.boneDim : MENU_HEX.disabled);
    const seats = [...picks.map((seat) => ({ seat, filled: true })), ...looks.map((seat) => ({ seat, filled: false }))].slice(0, view.heads.length);
    view.heads.forEach((head, slot) => {
      const entry = seats[slot];
      const letter = entry ? (entry.seat.name.trim()[0] ?? '?').toUpperCase() : '';
      if (head.text !== letter) head.setText(letter);
      if (!entry) return;
      const color = seatColor(entry.seat.seat);
      g.fillStyle(INK, 0.9).fillCircle(head.x, head.y, HEAD_R + 2);
      if (entry.filled) g.fillStyle(color, 1).fillCircle(head.x, head.y, HEAD_R);
      else g.lineStyle(2, color, 1).strokeCircle(head.x, head.y, HEAD_R - 1);
      head.setColor(entry.filled ? '#120d09' : `#${color.toString(16).padStart(6, '0')}`);
    });
  }

  private setHover(view: RowView | null): void {
    const id = view?.row.id ?? null;
    if (this.hover === id) return;
    this.hover = id;
    for (const row of this.rows) this.paintRow(row);
    if (!view || view.vote) this.hooks.look?.(view?.row.enabled ? id : null);
  }

  private moveFocus(step: number): void {
    if (!this.rows.length) return;
    this.focus = (this.focus + step + this.rows.length) % this.rows.length;
    playSound('ui.hover');
    for (const row of this.rows) this.paintRow(row);
    const view = this.rows[this.focus];
    if (view.vote) this.hooks.look?.(view.row.enabled ? view.row.id : null);
  }

  private pickFocused(): void {
    const view = this.rows[this.focus];
    if (view) this.activate(view);
  }

  private activate(view: RowView): void {
    unlockAudio();
    if (this.revealKey && view.vote) return;
    if (!view.row.enabled) {
      playSound('ui.deny');
      return;
    }
    playSound(view.vote ? 'ui.confirm' : 'ui.click');
    this.hooks.pick(view.row.id);
  }

  /** Cut `value` down with an ellipsis until it fits `max` px. */
  private fit(text: Phaser.GameObjects.Text, value: string, max: number): void {
    if (text.getData('full') === value) return;
    text.setData('full', value);
    text.setText(value);
    let cut = value.length;
    while (cut > 1 && text.width > max) {
      cut -= 1;
      text.setText(`${value.slice(0, cut).trimEnd()}...`);
    }
  }
}
