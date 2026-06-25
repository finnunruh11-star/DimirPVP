import Phaser from 'phaser';
import { COLORS, GAME_HEIGHT, GAME_WIDTH } from './config/constants';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';

// Registering the sample spells (side-effect import). Add your own spell files
// the same way, or import them here.
import './spells/sampleSpells';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: COLORS.bg,
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [MenuScene, GameScene],
});
