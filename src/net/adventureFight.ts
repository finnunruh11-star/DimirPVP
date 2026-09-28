// Every Adventure fight starts here. Solo, it is just the fight. Online, the
// host brings each guest into the same fight with a shared seed and a note of
// who plays which party member, so GameScene can run it in lockstep.

import type Phaser from 'phaser';
import type { MatchConfig } from '../config/MatchConfig';
import { AdventureSession } from './AdventureSession';
import { toFightWire } from './fightWire';

export function startAdventureFight(scene: Phaser.Scene, config: MatchConfig): void {
  scene.scene.stop('LocaleHud');
  const session = AdventureSession.current;
  const combat = config.exploration;
  if (!session?.isHost || !combat) {
    scene.scene.start('Game', config);
    return;
  }
  const seed = (Math.floor(Math.random() * 0x7fffffff) + 1) | 0;
  const exploration = { ...combat, seats: session.memberSeats() };
  session.adopt(combat.run);
  session.startFight(toFightWire(exploration), seed);
  scene.scene.start('Game', { ...config, exploration, net: session.net, localSeat: session.localSeat, seed } satisfies MatchConfig);
}
