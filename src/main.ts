import Phaser from 'phaser';
import { COLORS, GAME_HEIGHT, GAME_WIDTH } from './config/constants';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';

// Registering the sample spells (side-effect import). Add your own spell files
// the same way, or import them here.
import './spells/sampleSpells';
import './spells/classSpells';

const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: COLORS.bg,
  pixelArt: true,
  render: {
    antialias: false,
    antialiasGL: false,
    roundPixels: true,
    powerPreference: 'high-performance',
  },
  fps: {
    target: 60,
    smoothStep: true,
    forceSetTimeOut: false,
  },
  input: {
    activePointers: 3,
    smoothFactor: 0,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    autoRound: true,
  },
  scene: [MenuScene, GameScene],
  callbacks: {
    postBoot: (game) => {
      const canvas = game.canvas;
      canvas.tabIndex = 0;
      canvas.setAttribute('role', 'application');
      canvas.setAttribute('aria-label', 'Dimir tactical mage arena');
      canvas.addEventListener('pointerdown', () => canvas.focus(), { passive: true });
    },
  },
};

const game = new Phaser.Game(gameConfig);

// Vite can re-evaluate this module during development. Dispose the previous
// Phaser instance so it cannot leave a second canvas or input manager behind.
if (import.meta.hot) import.meta.hot.dispose(() => game.destroy(true));
