import Phaser from 'phaser';
import idle1Url from '../../Sprites/Idle/Idle1.png';
import idle2Url from '../../Sprites/Idle/Idle2.png';
import idle3Url from '../../Sprites/Idle/Idle3.png';
import idle4Url from '../../Sprites/Idle/Idle4.png';
import idle5Url from '../../Sprites/Idle/Idle5.png';
import idle6Url from '../../Sprites/Idle/Idle6.png';
import smokeUrl from '../../../spritesheet/Smoke Bursts/symmetrical_smoke_burst_001/symmetrical_smoke_burst_001_small_brown/spritesheet.png';
import { MENU_COLOR, MENU_FONT, MENU_HEX, addRecess } from '../cabinet/theme';

const IDLE_URLS = [idle1Url, idle2Url, idle3Url, idle4Url, idle5Url, idle6Url];
const IDLE_KEYS = IDLE_URLS.map((_, index) => `menu-mage-idle-${index}`);
const SMOKE_KEY = 'menu-smoke-brown';

export function preloadMenuArt(scene: Phaser.Scene): void {
  IDLE_URLS.forEach((url, index) => scene.load.image(IDLE_KEYS[index], url));
  scene.load.spritesheet(SMOKE_KEY, smokeUrl, { frameWidth: 32, frameHeight: 32 });
}

function ensureAnimations(scene: Phaser.Scene): void {
  if (!scene.anims.exists('menu-mage-idle')) {
    scene.anims.create({
      key: 'menu-mage-idle',
      frames: IDLE_KEYS.map((key) => ({ key })),
      frameRate: 7,
      repeat: -1,
    });
  }
  if (!scene.anims.exists('menu-smoke')) {
    scene.anims.create({
      key: 'menu-smoke',
      frames: scene.anims.generateFrameNumbers(SMOKE_KEY, { start: 0, end: 9 }),
      frameRate: 9,
      repeat: 0,
    });
  }
}

export interface MenuMageStage {
  setCaption(title: string, detail: string): void;
}

export function addMenuMageStage(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container
): MenuMageStage {
  ensureAnimations(scene);
  const root = scene.add.container(0, 0);
  parent.add(root);
  addRecess(scene, root, 844, 112, 358, 520);

  const frame = scene.add.graphics();
  frame.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(865, 132, 316, 34);
  frame.fillStyle(MENU_COLOR.brassDark, 1).fillRect(865, 166, 316, 3);
  frame.fillStyle(MENU_COLOR.pitch, 0.72).fillRect(876, 181, 294, 300);
  frame.lineStyle(1, MENU_COLOR.verdigris, 0.5).strokeRect(876.5, 181.5, 293, 299);
  frame.fillStyle(MENU_COLOR.woodRaised, 1).fillRect(888, 474, 270, 26);
  frame.fillStyle(MENU_COLOR.brassDark, 1).fillRect(904, 500, 238, 7);
  frame.lineStyle(1, MENU_COLOR.brassDark, 0.8);
  frame.strokeCircle(1023, 344, 104);
  frame.strokeCircle(1023, 344, 78);
  frame.lineBetween(919, 344, 1127, 344);
  frame.lineBetween(1023, 240, 1023, 448);
  root.add(frame);

  const smoke = scene.add.sprite(1023, 458, SMOKE_KEY, 0).setVisible(false);
  const mage = scene.add.sprite(1023, 469, IDLE_KEYS[0]).setOrigin(0.5, 1).setScale(12);
  mage.play('menu-mage-idle');
  root.add([smoke, mage]);

  let dustTimer: Phaser.Time.TimerEvent | null = null;
  const scheduleDust = (): void => {
    dustTimer = scene.time.delayedCall(Phaser.Math.Between(3000, 18000), () => {
      if (!root.active || !smoke.active) return;
      smoke
        .setPosition(1023 + Phaser.Math.Between(-24, 24), 458 + Phaser.Math.Between(-8, 8))
        .setScale(Phaser.Math.FloatBetween(4.1, 6.2))
        .setAlpha(Phaser.Math.FloatBetween(0.18, 0.36))
        .setFlipX(Math.random() < 0.5)
        .setVisible(true)
        .play('menu-smoke', true);
    });
  };
  const finishDust = (animation: Phaser.Animations.Animation): void => {
    if (animation.key !== 'menu-smoke') return;
    smoke.setVisible(false);
    scheduleDust();
  };
  smoke.on(Phaser.Animations.Events.ANIMATION_COMPLETE, finishDust);
  root.once(Phaser.GameObjects.Events.DESTROY, () => {
    dustTimer?.remove(false);
    smoke.off(Phaser.Animations.Events.ANIMATION_COMPLETE, finishDust);
  });
  scheduleDust();

  const plaque = scene.add.graphics();
  plaque.fillStyle(MENU_COLOR.bone, 1).fillRect(882, 521, 282, 85);
  plaque.lineStyle(1, MENU_COLOR.brassDark, 1).strokeRect(882.5, 521.5, 281, 84);
  plaque.fillStyle(MENU_COLOR.brass, 1).fillCircle(895, 534, 3).fillCircle(1151, 534, 3);
  root.add(plaque);

  const title = scene.add.text(1023, 535, '', {
    fontFamily: MENU_FONT.control,
    fontSize: '18px',
    fontStyle: 'bold',
    color: MENU_HEX.ink,
  }).setOrigin(0.5, 0);
  const detail = scene.add.text(1023, 560, '', {
    fontFamily: MENU_FONT.body,
    fontSize: '14px',
    color: '#473e31',
    align: 'center',
    fixedWidth: 246,
    wordWrap: { width: 246 },
  }).setOrigin(0.5, 0);
  root.add([title, detail]);

  return {
    setCaption(nextTitle: string, nextDetail: string): void {
      title.setText(nextTitle.toUpperCase());
      detail.setText(nextDetail);
    },
  };
}