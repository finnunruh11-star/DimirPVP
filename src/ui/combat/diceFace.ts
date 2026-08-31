import Phaser from 'phaser';
import { MENU_COLOR } from '../cabinet/theme';

export interface DiceRollView {
  spec: string;
  total: number;
  rolls: number[];
  label?: string;
}

/** Sides implied by a spec string ("2d6+1" -> 6). Defaults to 6. */
export function parseSides(spec: string): number {
  const match = /d(\d+)/i.exec(spec);
  return match ? parseInt(match[1], 10) : 6;
}

/** Draw one bone die. d6 shows pips; anything else shows the number. */
export function drawDieFace(
  graphics: Phaser.GameObjects.Graphics,
  label: Phaser.GameObjects.Text,
  size: number,
  value: number,
  sides: number,
): void {
  const half = size / 2;
  graphics.clear();
  graphics.fillStyle(MENU_COLOR.pitch, 1).fillRect(-half + 3, -half + 4, size, size);
  graphics.fillStyle(MENU_COLOR.bone, 1).fillRect(-half, -half, size, size);
  graphics.lineStyle(2, MENU_COLOR.brassDark, 1).strokeRect(-half + 1, -half + 1, size - 2, size - 2);
  graphics.lineStyle(1, MENU_COLOR.brassLight, 0.7);
  graphics.lineBetween(-half + 5, -half + 5, half - 5, -half + 5);
  graphics.lineBetween(-half + 5, -half + 5, -half + 5, half - 5);

  if (sides !== 6 || value < 1 || value > 6) {
    label.setText(String(value)).setVisible(true);
    return;
  }

  label.setVisible(false);
  const inset = size * 0.23;
  const pips: Record<number, [number, number][]> = {
    1: [[0, 0]],
    2: [[-inset, -inset], [inset, inset]],
    3: [[-inset, -inset], [0, 0], [inset, inset]],
    4: [[-inset, -inset], [inset, -inset], [-inset, inset], [inset, inset]],
    5: [[-inset, -inset], [inset, -inset], [0, 0], [-inset, inset], [inset, inset]],
    6: [[-inset, -inset], [-inset, 0], [-inset, inset], [inset, -inset], [inset, 0], [inset, inset]],
  };
  graphics.fillStyle(MENU_COLOR.ink, 1);
  for (const [x, y] of pips[value]) graphics.fillCircle(x, y, Math.max(2.5, size * 0.07));
}
