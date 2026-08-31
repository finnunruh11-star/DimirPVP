import Phaser from 'phaser';
import type { DamageType } from '../core/Damage';
import type { Mage } from '../core/Mage';
import type { CombatFeedback } from '../effects/effects';
import { MENU_COLOR, MENU_FONT, MENU_HEX } from '../ui/cabinet/theme';

export const DAMAGE_COLORS: Record<DamageType, number> = {
  pierce: 0xd9d5c7,
  shatter: 0xe4c06a,
  shadow: 0x9b7ac4,
  corrosive: 0x92ba62,
  slashing: 0xd98472,
  heat: 0xf27a4f,
  light: 0xf0dc84,
  typeless: 0xe7e6df,
  generic: MENU_COLOR.bone,
  cleansing: 0x8fc8bb,
  healing: 0x72bd91,
};

interface LaneState {
  count: number;
  lastAt: number;
}

export class CombatFeedbackLayer {
  private readonly active = new Set<Phaser.GameObjects.Container>();
  private readonly lanes = new Map<Mage, LaneState>();
  private sequence = 0;
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly reducedMotion: () => boolean,
  ) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  show(mage: Mage, feedback: CombatFeedback): void {
    if (this.destroyed) return;
    const now = this.scene.time.now;
    const laneState = this.lanes.get(mage) ?? { count: 0, lastAt: -Infinity };
    if (now - laneState.lastAt > 520) laneState.count = 0;
    const lane = laneState.count % 4;
    laneState.count += 1;
    laneState.lastAt = now;
    this.lanes.set(mage, laneState);

    const sequence = this.sequence++;
    const reduced = this.reducedMotion();
    const color = this.colorFor(feedback);
    const main = this.mainLabel(feedback);
    const detail = this.detailLabel(feedback);
    const direction = sequence % 2 === 0 ? -1 : 1;
    const originX = mage.x + direction * (lane % 2) * 13;
    const originY = mage.y - 52 - lane * 19;
    const root = this.scene.add.container(originX, originY).setDepth(90);
    const ticks = this.scene.add.graphics();
    const mainText = this.scene.add.text(0, 0, main, {
      fontFamily: MENU_FONT.display,
      fontSize: feedback.kind === 'damage' || feedback.kind === 'sanityDamage' ? '23px' : '18px',
      fontStyle: 'bold',
      color: Phaser.Display.Color.IntegerToColor(color).rgba,
      stroke: '#080907',
      strokeThickness: 4,
      align: 'center',
    }).setOrigin(0.5);
    const detailText = this.scene.add.text(0, 20, detail, {
      fontFamily: MENU_FONT.control,
      fontSize: '9px',
      fontStyle: 'bold',
      color: feedback.critical ? '#17130f' : MENU_HEX.bone,
      backgroundColor: feedback.critical ? '#d2bd7f' : '#17110ded',
      padding: { x: 5, y: 2 },
      align: 'center',
    }).setOrigin(0.5);
    root.add([ticks, mainText, detailText]);
    this.active.add(root);

    ticks.lineStyle(2, color, 0.72);
    const tickCount = feedback.critical ? 8 : 4;
    for (let index = 0; index < tickCount; index++) {
      const angle = (index / tickCount) * Math.PI * 2 + sequence * 0.37;
      const inner = feedback.critical ? 18 : 14;
      const outer = feedback.critical ? 25 : 19;
      ticks.lineBetween(
        Math.cos(angle) * inner,
        Math.sin(angle) * inner,
        Math.cos(angle) * outer,
        Math.sin(angle) * outer,
      );
    }

    const cleanup = (): void => {
      if (!this.active.delete(root)) return;
      this.scene.tweens.killTweensOf(root);
      this.scene.tweens.killTweensOf(ticks);
      if (root.active) root.destroy(true);
    };

    if (reduced) {
      root.setScale(1).setAlpha(1);
      this.scene.tweens.add({
        targets: root,
        alpha: 0,
        delay: 260,
        duration: 140,
        ease: 'Sine.Out',
        onComplete: cleanup,
      });
      return;
    }

    root.setScale(0.64).setAlpha(0);
    this.scene.tweens.add({
      targets: root,
      scale: { from: 0.64, to: feedback.critical ? 1.18 : 1 },
      alpha: { from: 0, to: 1 },
      duration: feedback.critical ? 150 : 115,
      ease: 'Back.Out',
    });
    this.scene.tweens.add({
      targets: root,
      x: originX + direction * (10 + lane * 2),
      y: originY - (feedback.critical ? 48 : 38),
      alpha: 0,
      delay: feedback.critical ? 330 : 260,
      duration: feedback.critical ? 500 : 430,
      ease: 'Cubic.Out',
      onComplete: cleanup,
    });
    this.scene.tweens.add({
      targets: ticks,
      angle: direction * (feedback.critical ? 28 : 15),
      scale: feedback.critical ? 1.32 : 1.16,
      alpha: 0,
      duration: feedback.critical ? 470 : 340,
      ease: 'Sine.Out',
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    for (const root of this.active) {
      this.scene.tweens.killTweensOf(root);
      if (root.active) root.destroy(true);
    }
    this.active.clear();
    this.lanes.clear();
  }

  private colorFor(feedback: CombatFeedback): number {
    if (feedback.kind === 'heal') return 0x72bd91;
    if (feedback.kind === 'sanityHeal') return 0xb68bc5;
    if (feedback.kind === 'sanityDamage') return 0xd184c5;
    if (feedback.kind === 'immune') return 0xb5b0a4;
    if (feedback.kind === 'miss') return 0x8da89d;
    if (feedback.kind === 'blocked') return MENU_COLOR.brassLight;
    return DAMAGE_COLORS[feedback.damageType ?? 'generic'];
  }

  private mainLabel(feedback: CombatFeedback): string {
    if (feedback.kind === 'damage' || feedback.kind === 'sanityDamage') {
      return feedback.amount != null ? `-${feedback.amount}` : 'HIT';
    }
    if (feedback.kind === 'heal' || feedback.kind === 'sanityHeal') {
      return feedback.amount != null ? `+${feedback.amount}` : 'RESTORED';
    }
    if (feedback.kind === 'immune') return 'IMMUNE';
    if (feedback.kind === 'miss') return 'MISSED';
    return 'BLOCKED';
  }

  private detailLabel(feedback: CombatFeedback): string {
    if (feedback.critical) return feedback.label ? `CRITICAL / ${feedback.label}` : 'CRITICAL';
    if (feedback.label) return feedback.label.toUpperCase();
    if (feedback.kind === 'sanityDamage') return 'SANITY';
    if (feedback.kind === 'sanityHeal') return 'SANITY RESTORED';
    if (feedback.kind === 'heal') return 'HEALTH RESTORED';
    if (feedback.damageType) return feedback.damageType.toUpperCase();
    return feedback.kind.toUpperCase();
  }
}
