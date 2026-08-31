import Phaser from 'phaser';
import { FIELD, GAME_HEIGHT, GAME_WIDTH } from '../../config/constants';
import { MENU_COLOR, MENU_FONT, MENU_HEX } from '../cabinet/theme';
import type { DiceMode } from './dicePreference';
import type { DiceRollView } from './diceFace';
import { drawDieFace, parseSides } from './diceFace';

/**
 * One tray's worth of rolls. `at` is the body the rolls belong to; rolls
 * without one are the cast's own checks and never leave the rail.
 */
export interface DiceGroup {
  at?: { x: number; y: number };
  rolls: DiceRollView[];
}

interface DieView {
  root: Phaser.GameObjects.Container;
  face: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  size: number;
  sides: number;
  value: number;
}

/** One roll in flight: its dice travel together to the body that took it. */
interface Flight {
  dice: DieView[];
  roll: DiceRollView;
  at?: { x: number; y: number };
  slot: number;
}

/** Anything the view fades in and out as a batch. */
type Fading = Phaser.GameObjects.GameObject & {
  alpha: number;
  setAlpha(value: number): unknown;
};

const TIMING = {
  enter: 130,
  tumble: 600,
  read: 240,
  fly: 400,
  linger: 900,
  /** Overhead trays are read in place, so they hold longer than a pooled roll. */
  anchoredLinger: 1350,
  fade: 190,
  tick: 60,
  legacyHold: 780,
} as const;

/** Pooled tray used by the deal-out mode. */
const POOL = {
  gap: 6,
  padX: 22,
  padTop: 34,
  padBottom: 16,
  maxRowWidth: 880,
  minWidth: 280,
  centreY: GAME_HEIGHT - 132,
} as const;

/** Compact tray that sits over a body. */
const SMALL = {
  die: 20,
  dieSmall: 16,
  dieTiny: 13,
  gap: 3,
  rowH: 24,
  padX: 6,
  padY: 5,
  totalW: 30,
  specW: 26,
  maxPerRow: 8,
  lift: 62,
} as const;

/** Full-size centre rail used for cast checks and the legacy mode. */
const MAIN = {
  dieMin: 30,
  dieMax: 46,
  gap: 10,
  rowH: 74,
  padX: 24,
  padTop: 44,
  totalW: 76,
  minWidth: 340,
  maxWidth: 1160,
  centreY: GAME_HEIGHT - 96,
} as const;

const LANDED = { die: 17, gap: 3, rowH: 22, lift: 54, totalW: 30 } as const;

function pooledDieSize(total: number): number {
  if (total <= 8) return 30;
  if (total <= 16) return 24;
  if (total <= 30) return 19;
  return 14;
}

function smallDieSize(count: number): number {
  if (count <= 3) return SMALL.die;
  if (count <= 5) return SMALL.dieSmall;
  return SMALL.dieTiny;
}

function mainDieSize(count: number): number {
  return Phaser.Math.Clamp(
    Math.floor((960 - MAIN.gap * (count - 1)) / count),
    MAIN.dieMin,
    MAIN.dieMax,
  );
}

export class DiceFieldView {
  private readonly parts: Fading[] = [];
  private readonly dice: DieView[] = [];
  private readonly pendingTotals: { text: Phaser.GameObjects.Text; total: number }[] = [];
  private readonly timers = new Set<Phaser.Time.TimerEvent>();
  private readonly waits = new Set<() => void>();
  private tumbler: Phaser.Time.TimerEvent | null = null;
  /**
   * Bumped by every play and every hide. The deal mode leaves its linger
   * running in the background, so continuations must check they still belong
   * to the current roll before touching anything.
   */
  private generation = 0;
  private disposed = false;

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  async play(
    groups: DiceGroup[],
    reducedMotion: boolean,
    speed: number,
    mode: DiceMode,
  ): Promise<void> {
    if (this.disposed || mode === 'none') return;
    const live = groups.filter((group) => group.rolls.length > 0);
    if (live.length === 0) return;
    this.hide();
    const gen = this.generation;
    const pace = Math.max(0.2, speed);
    if (mode === 'sequential') await this.playSequential(live, reducedMotion, pace, gen);
    else if (mode === 'anchored') await this.playAnchored(live, reducedMotion, pace, gen);
    else await this.playDeal(live, reducedMotion, pace, gen);
  }

  hide(): void {
    this.generation += 1;
    this.stopTumble();
    for (const timer of this.timers) timer.remove();
    this.timers.clear();
    for (const resolve of [...this.waits]) resolve();
    this.waits.clear();
    this.clearParts();
  }

  private stale(gen: number): boolean {
    return this.disposed || this.generation !== gen;
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.hide();
  }

  // ===========================================================================
  //  MODES
  // ===========================================================================

  /** Legacy: one roll at a time on the centre rail, each awaited in turn. */
  private async playSequential(
    groups: DiceGroup[],
    reducedMotion: boolean,
    speed: number,
    gen: number,
  ): Promise<void> {
    const rolls = groups.flatMap((group) => group.rolls);
    for (const roll of rolls) {
      if (this.stale(gen)) return;
      this.clearParts();
      this.buildMainTray([roll], reducedMotion);
      await this.rollOut(reducedMotion, speed, gen);
      if (this.stale(gen)) return;
      await this.wait(TIMING.legacyHold / speed);
      if (this.stale(gen)) return;
      await this.fadeOut(reducedMotion, speed, gen);
    }
  }

  /** Each body gets its own compact tray; every tray rolls at the same time. */
  private async playAnchored(
    groups: DiceGroup[],
    reducedMotion: boolean,
    speed: number,
    gen: number,
  ): Promise<void> {
    const placed: Phaser.Geom.Rectangle[] = [];
    for (const group of groups) {
      if (group.at) this.buildSmallTray(group, reducedMotion, placed);
      else this.buildMainTray(group.rolls, reducedMotion);
    }
    await this.rollOut(reducedMotion, speed, gen);
    if (this.stale(gen)) return;
    await this.wait(TIMING.anchoredLinger / speed);
    if (this.stale(gen)) return;
    await this.fadeOut(reducedMotion, speed, gen);
  }

  /**
   * Pooled: every die rolls jumbled together in one tray, then each roll's dice
   * are dealt out to the body that took them and linger there. Resolves as the
   * dice arrive, so the flinch they explain lands with them rather than after.
   */
  private async playDeal(
    groups: DiceGroup[],
    reducedMotion: boolean,
    speed: number,
    gen: number,
  ): Promise<void> {
    // Nothing to deal out to: a lone cast check belongs on the full rail, not
    // in a pooled tray that would fade out from under it.
    if (!groups.some((group) => group.at)) {
      this.buildMainTray(groups.flatMap((group) => group.rolls), reducedMotion);
      await this.rollOut(reducedMotion, speed, gen);
      if (this.stale(gen)) return;
      await this.wait(TIMING.legacyHold / speed);
      if (this.stale(gen)) return;
      await this.fadeOut(reducedMotion, speed, gen);
      return;
    }

    const flights = this.buildPool(groups, reducedMotion);
    await this.rollOut(reducedMotion, speed, gen);
    if (this.stale(gen)) return;
    await this.wait(TIMING.read / speed);
    if (this.stale(gen)) return;
    this.deal(flights, speed, reducedMotion);
    await this.wait(TIMING.fly / speed);
    if (this.stale(gen)) return;
    // Let the dice sit on their victims while the caller gets on with the hit.
    void this.lingerThenClear(reducedMotion, speed, gen);
  }

  private async lingerThenClear(
    reducedMotion: boolean,
    speed: number,
    gen: number,
  ): Promise<void> {
    await this.wait(TIMING.linger / speed);
    if (this.stale(gen)) return;
    await this.fadeOut(reducedMotion, speed, gen);
  }

  // ===========================================================================
  //  BUILDERS
  // ===========================================================================

  private buildPool(groups: DiceGroup[], reducedMotion: boolean): Flight[] {
    const flights: Flight[] = [];
    let total = 0;
    for (const group of groups) {
      group.rolls.forEach((roll, index) => {
        flights.push({ dice: [], roll, at: group.at, slot: index });
        total += Math.max(1, roll.rolls.length);
      });
    }

    const size = pooledDieSize(total);
    const step = size + POOL.gap;
    const perRow = Math.max(1, Math.min(total, Math.floor(POOL.maxRowWidth / step)));
    const rows = Math.ceil(total / perRow);
    const gridW = Math.min(total, perRow) * step - POOL.gap;
    const width = Math.max(POOL.minWidth, gridW + POOL.padX * 2);
    const height = POOL.padTop + rows * step + POOL.padBottom;
    const originX = GAME_WIDTH / 2 - gridW / 2 + size / 2;
    const originY = POOL.centreY - (rows * step - POOL.gap) / 2 + size / 2;

    this.trayChrome(GAME_WIDTH / 2, POOL.centreY, width, height, this.poolTitle(groups), true);

    // Interleave so one body's dice are not a neat block: not being able to read
    // the result until it lands is the whole point of the pooled roll.
    const order: { flight: Flight; nth: number }[] = [];
    const counts = flights.map((flight, index) => ({
      index,
      taken: 0,
      left: Math.max(1, flight.roll.rolls.length),
    }));
    let placed = 0;
    while (placed < total) {
      for (const entry of counts) {
        if (entry.left <= 0) continue;
        entry.left -= 1;
        placed += 1;
        order.push({ flight: flights[entry.index], nth: entry.taken++ });
      }
    }

    order.forEach(({ flight, nth }, index) => {
      const col = index % perRow;
      const row = Math.floor(index / perRow);
      const faces = flight.roll.rolls;
      const value = faces.length > 0 ? faces[nth] ?? faces[faces.length - 1] : flight.roll.total;
      const die = this.addDie(
        originX + col * step,
        originY + row * step,
        size,
        parseSides(flight.roll.spec),
        value,
        reducedMotion,
        // A single die has nothing to jumble with, so leave it square.
        reducedMotion || total < 2 ? 0 : 13,
      );
      flight.dice.push(die);
    });

    return flights;
  }

  private poolTitle(groups: DiceGroup[]): string {
    const specs = new Set<string>();
    for (const group of groups) for (const roll of group.rolls) specs.add(roll.spec.toUpperCase());
    const label = groups[0]?.rolls[0]?.label;
    if (groups.length === 1 && groups[0].rolls.length === 1 && label) return label.toUpperCase();
    return [...specs].join('  ·  ');
  }

  private buildSmallTray(
    group: DiceGroup,
    reducedMotion: boolean,
    placed: Phaser.Geom.Rectangle[],
  ): void {
    const rows = group.rolls;
    const showSpec = rows.length > 1;
    const specW = showSpec ? SMALL.specW : 0;
    let widest = 0;
    for (const roll of rows) {
      const shown = Math.min(Math.max(1, roll.rolls.length), SMALL.maxPerRow);
      const size = smallDieSize(shown);
      widest = Math.max(widest, shown * size + (shown - 1) * SMALL.gap);
    }
    const width = SMALL.padX * 2 + specW + widest + 5 + SMALL.totalW;
    const height = SMALL.padY * 2 + rows.length * SMALL.rowH;
    const at = group.at ?? { x: GAME_WIDTH / 2, y: MAIN.centreY };
    const rect = this.reserve(at.x, at.y - SMALL.lift, width, height, placed);
    const cx = rect.x + width / 2;
    const cy = rect.y + height / 2;

    this.parts.push(
      this.scene.add.rectangle(cx + 2, cy + 3, width + 3, height + 3, MENU_COLOR.pitch, 0.7)
        .setDepth(79),
      this.scene.add.rectangle(cx, cy, width, height, MENU_COLOR.woodDeep, 1)
        .setStrokeStyle(1, MENU_COLOR.brassDark)
        .setDepth(79),
    );

    rows.forEach((roll, index) => {
      const y = cy - height / 2 + SMALL.padY + SMALL.rowH / 2 + index * SMALL.rowH;
      const values = roll.rolls.length > 0 ? roll.rolls : [roll.total];
      const shown = Math.min(values.length, SMALL.maxPerRow);
      const size = smallDieSize(shown);
      let x = cx - width / 2 + SMALL.padX;
      if (showSpec) {
        this.parts.push(this.scene.add.text(x, y, roll.spec.toUpperCase(), {
          fontFamily: MENU_FONT.control,
          fontSize: '9px',
          color: MENU_HEX.brassLight,
          fontStyle: 'bold',
        }).setOrigin(0, 0.5).setDepth(80));
        x += specW;
      }
      const sides = parseSides(roll.spec);
      for (let i = 0; i < shown; i++) {
        this.addDie(x + size / 2 + i * (size + SMALL.gap), y, size, sides, values[i], reducedMotion, 0);
      }
      const rowW = shown * size + (shown - 1) * SMALL.gap;
      this.totalPlate(x + rowW + 5 + SMALL.totalW / 2, y, SMALL.totalW, SMALL.rowH - 6, 16, roll.total);
    });
  }

  private buildMainTray(rolls: DiceRollView[], reducedMotion: boolean): void {
    const sizes = rolls.map((roll) => {
      const count = Math.max(1, roll.rolls.length);
      const size = mainDieSize(count);
      return { count, size, width: count * size + (count - 1) * MAIN.gap };
    });
    const widest = Math.max(...sizes.map((entry) => entry.width));
    const title = rolls[0]?.label ?? rolls[0]?.spec ?? '';
    const width = Phaser.Math.Clamp(
      Math.max(MAIN.padX * 2 + widest + MAIN.totalW + 20, title.length * 10 + 60),
      MAIN.minWidth,
      MAIN.maxWidth,
    );
    const height = MAIN.padTop + rolls.length * MAIN.rowH + 12;
    const cx = GAME_WIDTH / 2;
    const cy = MAIN.centreY;
    this.trayChrome(cx, cy, width, height, title, false);

    rolls.forEach((roll, index) => {
      const { count, size, width: rowW } = sizes[index];
      const y = cy - height / 2 + MAIN.padTop + MAIN.rowH / 2 + index * MAIN.rowH;
      this.parts.push(
        this.scene.add.rectangle(cx, y, width - 24, size + 22, MENU_COLOR.felt, 1)
          .setStrokeStyle(1, MENU_COLOR.woodEdge)
          .setDepth(79),
        this.scene.add.text(cx - width / 2 + 16, y - size / 2 - 12, roll.spec.toUpperCase(), {
          fontFamily: MENU_FONT.control,
          fontSize: '12px',
          color: MENU_HEX.brassLight,
        }).setOrigin(0, 0.5).setDepth(80),
      );

      const sides = parseSides(roll.spec);
      const values = roll.rolls.length > 0 ? roll.rolls : [roll.total];
      const blockW = rowW + 14 + MAIN.totalW;
      const startX = cx - blockW / 2 + size / 2;
      for (let i = 0; i < count; i++) {
        this.addDie(startX + i * (size + MAIN.gap), y, size, sides, values[i], reducedMotion, 0);
      }
      this.totalPlate(cx - blockW / 2 + rowW + 14 + MAIN.totalW / 2, y, MAIN.totalW, 52, 25, roll.total);
    });
  }

  private trayChrome(
    cx: number,
    cy: number,
    width: number,
    height: number,
    title: string,
    felt: boolean,
  ): void {
    const chrome: Fading[] = [
      this.scene.add.rectangle(cx + 6, cy + 8, width + 8, height + 8, MENU_COLOR.pitch, 1).setDepth(78),
      this.scene.add.rectangle(cx, cy, width, height, MENU_COLOR.woodDeep, 1)
        .setStrokeStyle(2, MENU_COLOR.brassDark).setDepth(78),
      this.scene.add.rectangle(cx, cy - height / 2 + 9, width - 18, 5, MENU_COLOR.brass, 1).setDepth(79),
      this.scene.add.text(cx, cy - height / 2 + 25, title, {
        fontFamily: MENU_FONT.display,
        fontSize: '17px',
        color: MENU_HEX.bone,
        fontStyle: 'bold',
        fixedWidth: width - 30,
        align: 'center',
      }).setOrigin(0.5).setDepth(80),
    ];
    if (felt) {
      chrome.splice(2, 0, this.scene.add
        .rectangle(cx, cy + 6, width - 20, height - 40, MENU_COLOR.felt, 1)
        .setStrokeStyle(1, MENU_COLOR.woodEdge)
        .setDepth(78));
    }
    for (const part of chrome) part.setData('tray', true);
    this.parts.push(...chrome);
  }

  private totalPlate(
    x: number,
    y: number,
    width: number,
    height: number,
    fontSize: number,
    total: number,
    reveal: 'now' | 'onLand' = 'onLand',
  ): void {
    const text = this.scene.add.text(x, y, reveal === 'now' ? String(total) : '', {
      fontFamily: MENU_FONT.display,
      fontSize: `${fontSize}px`,
      color: MENU_HEX.ink,
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(82);
    this.parts.push(
      this.scene.add.rectangle(x, y, width, height, MENU_COLOR.brass, 1)
        .setStrokeStyle(1, MENU_COLOR.brassLight)
        .setDepth(81),
      text,
    );
    // The total is the answer the dice are still working out; showing it while
    // they tumble gives the result away before the roll reads as finished.
    if (reveal === 'onLand') this.pendingTotals.push({ text, total });
  }

  private addDie(
    x: number,
    y: number,
    size: number,
    sides: number,
    value: number,
    reducedMotion: boolean,
    jitter: number,
  ): DieView {
    const face = this.scene.add.graphics();
    const label = this.scene.add.text(0, 0, '', {
      fontFamily: MENU_FONT.control,
      fontSize: `${Math.max(9, Math.round(size * 0.55))}px`,
      color: MENU_HEX.ink,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    const root = this.scene.add.container(x, y, [face, label]).setDepth(81);
    if (jitter > 0) root.setAngle(Phaser.Math.Between(-jitter, jitter));
    const die: DieView = { root, face, label, size, sides, value };
    drawDieFace(face, label, size, reducedMotion ? value : 1, sides);
    this.dice.push(die);
    this.parts.push(root);
    return die;
  }

  /** Claim a rectangle above a body, pushed clear of trays already placed. */
  private reserve(
    x: number,
    y: number,
    width: number,
    height: number,
    placed: Phaser.Geom.Rectangle[],
  ): Phaser.Geom.Rectangle {
    const cx = Phaser.Math.Clamp(
      x,
      FIELD.x + width / 2 + 4,
      Math.max(FIELD.x + width / 2 + 4, FIELD.x + FIELD.w - width / 2 - 4),
    );
    const cy = Math.max(height / 2 + 6, y);
    const rect = new Phaser.Geom.Rectangle(cx - width / 2, cy - height / 2, width, height);
    for (let guard = 0; guard < 12; guard++) {
      const clash = placed.find((other) => Phaser.Geom.Rectangle.Overlaps(other, rect));
      if (!clash) break;
      rect.y = clash.y - height - 6;
      if (rect.y < 6) {
        rect.y = clash.y + clash.height + 6;
        rect.x = Phaser.Math.Clamp(rect.x + width * 0.55, FIELD.x + 4, FIELD.x + FIELD.w - width - 4);
      }
    }
    placed.push(rect);
    return rect;
  }

  /** Send each roll's dice to the body that took it and stamp its total there. */
  private deal(flights: Flight[], speed: number, reducedMotion: boolean): void {
    const tray = this.parts.filter((part) => part.getData?.('tray'));
    if (tray.length > 0) {
      if (reducedMotion) for (const part of tray) part.setAlpha(0);
      else {
        this.scene.tweens.add({
          targets: tray,
          alpha: 0,
          duration: (TIMING.fly * 0.6) / speed,
          ease: 'Sine.In',
        });
      }
    }

    for (const flight of flights) {
      // A cast check has nowhere to go; let it ride out on the rail.
      if (!flight.at) continue;
      const count = flight.dice.length;
      const rowW = count * LANDED.die + (count - 1) * LANDED.gap;
      const blockW = rowW + 5 + LANDED.totalW;
      const cx = Phaser.Math.Clamp(
        flight.at.x,
        FIELD.x + blockW / 2 + 4,
        Math.max(FIELD.x + blockW / 2 + 4, FIELD.x + FIELD.w - blockW / 2 - 4),
      );
      const cy = Math.max(LANDED.rowH, flight.at.y - LANDED.lift - flight.slot * LANDED.rowH);
      const startX = cx - blockW / 2 + LANDED.die / 2;

      flight.dice.forEach((die, index) => {
        const toX = startX + index * (LANDED.die + LANDED.gap);
        const scale = LANDED.die / die.size;
        if (reducedMotion) {
          die.root.setPosition(toX, cy).setScale(scale).setAngle(0);
          return;
        }
        this.scene.tweens.add({
          targets: die.root,
          x: toX,
          y: cy,
          scale,
          angle: 0,
          delay: (index * 24) / speed,
          duration: TIMING.fly / speed,
          ease: 'Cubic.InOut',
        });
      });

      const before = this.parts.length;
      this.totalPlate(
        cx + blockW / 2 - LANDED.totalW / 2,
        cy,
        LANDED.totalW,
        LANDED.die + 3,
        16,
        flight.roll.total,
        'now',
      );
      const plate = this.parts.slice(before);
      if (reducedMotion) continue;
      for (const part of plate) part.setAlpha(0);
      this.scene.tweens.add({
        targets: plate,
        alpha: 1,
        delay: (TIMING.fly * 0.7) / speed,
        duration: 140 / speed,
      });
    }
  }

  // ===========================================================================
  //  SEQUENCE PRIMITIVES
  // ===========================================================================

  /** Fade the tray in, tumble the dice, then show their faces. */
  private async rollOut(reducedMotion: boolean, speed: number, gen: number): Promise<void> {
    if (reducedMotion) {
      this.revealTotals(false, speed);
      await this.wait(TIMING.read / speed);
      return;
    }
    for (const part of this.parts) part.setAlpha(0);
    this.scene.tweens.add({
      targets: [...this.parts],
      alpha: 1,
      duration: TIMING.enter / speed,
      ease: 'Sine.Out',
    });
    this.tumbler = this.scene.time.addEvent({
      delay: TIMING.tick / speed,
      loop: true,
      callback: () => {
        for (const die of this.dice) {
          drawDieFace(
            die.face,
            die.label,
            die.size,
            1 + Math.floor(Math.random() * die.sides),
            die.sides,
          );
        }
      },
    });
    await this.wait(TIMING.tumble / speed);
    this.stopTumble();
    if (this.stale(gen)) return;
    for (const die of this.dice) {
      drawDieFace(die.face, die.label, die.size, die.value, die.sides);
      this.scene.tweens.add({
        targets: die.root,
        scale: { from: die.root.scale * 1.16, to: die.root.scale },
        duration: 110 / speed,
        ease: 'Quad.Out',
      });
    }
    this.revealTotals(true, speed);
  }

  /** Stamp the totals the dice were still working out. */
  private revealTotals(animate: boolean, speed: number): void {
    for (const pending of this.pendingTotals) {
      if (!pending.text.active) continue;
      pending.text.setText(String(pending.total));
      if (!animate) continue;
      this.scene.tweens.add({
        targets: pending.text,
        scale: { from: 1.3, to: 1 },
        duration: 130 / speed,
        ease: 'Back.Out',
      });
    }
    this.pendingTotals.length = 0;
  }

  private async fadeOut(reducedMotion: boolean, speed: number, gen: number): Promise<void> {
    if (!reducedMotion && this.parts.length > 0) {
      this.scene.tweens.add({
        targets: [...this.parts],
        alpha: 0,
        duration: TIMING.fade / speed,
      });
      await this.wait(TIMING.fade / speed);
    }
    if (this.stale(gen)) return;
    this.clearParts();
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        this.waits.delete(done);
        resolve();
      };
      this.waits.add(done);
      const timer = this.scene.time.delayedCall(Math.max(1, ms), () => {
        this.timers.delete(timer);
        done();
      });
      this.timers.add(timer);
    });
  }

  private stopTumble(): void {
    this.tumbler?.remove();
    this.tumbler = null;
  }

  private clearParts(): void {
    for (const part of this.parts) {
      this.scene.tweens.killTweensOf(part);
      if (part.active) part.destroy();
    }
    this.parts.length = 0;
    this.dice.length = 0;
    this.pendingTotals.length = 0;
  }
}
