import type { BossArt } from '../rig';

const ROWS: readonly (readonly [number, number, number])[] = [
  [20, 30, 30], [20, 30, 21], [19, 31, 21], [17, 32, 21],
  [17, 33, 21], [17, 33, 21], [17, 33, 22], [17, 34, 21],
  [17, 34, 21], [18, 34, 22], [18, 35, 22], [18, 36, 22],
  [18, 37, 22], [18, 37, 23], [18, 38, 23], [18, 38, 23],
  [18, 38, 23], [18, 38, 23], [18, 38, 23], [18, 38, 23],
  [18, 39, 24], [18, 39, 25], [19, 40, 25], [19, 40, 26],
  [19, 40, 26], [19, 40, 26], [19, 40, 26], [19, 40, 26],
  [21, 41, 29], [22, 41, 32], [22, 28, 23], [22, 36, 26],
  [22, 36, 26], [22, 36, 26], [21, 36, 25], [20, 37, 25],
  [21, 39, 26], [22, 40, 26], [24, 40, 26], [28, 40, 28],
  [28, 40, 28], [30, 39, 30],
];

export const moay: BossArt = {
  w: 64,
  h: 64,
  ground: 50,
  pixel: 3,
  frames: { idle: 1, walk: 1, attack: 1, hurt: 1, death: 1 },
  rate: { idle: 5, walk: 5, attack: 5, hurt: 5, death: 5 },
  ink: 0x1c1c1c,
  ember: 0x827e5b,
  crumble: false,
  outlined: true,
  static: true,
  draw(canvas) {
    ROWS.forEach(([left, right, front], index) => {
      canvas.rect(left, index + 8, right - left, 1, 0x4c4a35);
      canvas.rect(front, index + 8, right - front, 1, 0x827e5b);
    });
    canvas.rect(20, 8, 10, 1, 0x1c1c1c);
    canvas.rect(19, 10, 1, 1, 0x1c1c1c);
    canvas.rect(17, 11, 3, 1, 0x1c1c1c);
    const gaps: readonly (readonly [number, number, number, number])[] = [
      [26, 16, 4, 1], [27, 17, 3, 1], [33, 25, 5, 1],
      [32, 26, 6, 1], [35, 28, 4, 1], [34, 29, 1, 1],
      [20, 26, 1, 10], [19, 36, 2, 1], [23, 38, 5, 1],
    ];
    for (const [left, top, width, height] of gaps) {
      for (let row = top; row < top + height; row++) {
        for (let column = left; column < left + width; column++) canvas.px.set(column, row, -1);
      }
    }
  },
};