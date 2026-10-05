// What is on the crafting bench, drawn as it is being designed: a sword's hilt
// and blade, a staff's shaft and head, a bow's limbs and string, a cuirass's
// shell and lining, each in its material's colour, sized by the chosen form,
// with every socket shown (a gem in it, or an empty hole). Pure pixels.

import { CRAFT_TEMPLATES, type CraftForm, type CraftTemplateId } from '../core/crafting/data';
import type { ItemId } from '../core/Items';
import { PixelBuffer, shade, tint } from '../world/pixels';
import { craftTint } from './itemIcons';

export const CRAFT_ART_W = 120;
export const CRAFT_ART_H = 48;

export interface CraftArtSpec {
  template: CraftTemplateId;
  form: CraftForm;
  /** One per template part; null while none is chosen. */
  parts: readonly (ItemId | null)[];
  /** One per socket the form has; null for an empty one. */
  sockets: readonly (ItemId | null)[];
}

interface Tone {
  base: number;
  light: number;
  dark: number;
}

const OUTLINE = 0x15100c;
const HOLE = 0x1a1612;
const HOLE_RIM = 0x5a4a38;
const SHINE = 0xfff8e8;

const tone = (base: number): Tone => ({ base, light: tint(base, 0.38), dark: shade(base, 0.4) });

function line(px: PixelBuffer, x0: number, y0: number, x1: number, y1: number, color: number): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const tx = Math.round(x1);
  const ty = Math.round(y1);
  const dx = Math.abs(tx - x);
  const dy = -Math.abs(ty - y);
  const sx = x < tx ? 1 : -1;
  const sy = y < ty ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    px.set(x, y, color);
    if (x === tx && y === ty) return;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

function disc(px: PixelBuffer, cx: number, cy: number, r: number, color: number): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.3) px.set(x, y, color);
    }
  }
}

function poly(px: PixelBuffer, points: readonly (readonly [number, number])[], color: number): void {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
    for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i];
        const [xj, yj] = points[j];
        if (yi > y + 0.5 !== yj > y + 0.5 && x + 0.5 < ((xj - xi) * (y + 0.5 - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) px.set(x, y, color);
    }
  }
}

/** A socket: the gem set in it, or the empty hole. */
function socket(px: PixelBuffer, x: number, y: number, r: number, id: ItemId | null): void {
  if (!id) {
    disc(px, x, y, r, HOLE_RIM);
    disc(px, x, y, Math.max(0.6, r - 1), HOLE);
    return;
  }
  const gem = tone(craftTint(id));
  disc(px, x, y, r, gem.dark);
  disc(px, x - 0.3, y - 0.3, Math.max(0.6, r - 0.8), gem.base);
  px.set(Math.round(x - r / 2), Math.round(y - r / 2), r >= 2 ? SHINE : gem.light);
}

function paintSword(px: PixelBuffer, spec: CraftArtSpec, length: number): void {
  const hilt = tone(craftTint(spec.parts[0]));
  const steel = tone(craftTint(spec.parts[1]));
  const cy = 24;
  const half = spec.form === 'greatsword' ? 4 : spec.form === 'sword' ? 3 : 2;
  const from = 28;
  const to = from + Math.round(8 + 78 * length);
  // The blade, its tip, a bright edge and a fuller down the middle.
  poly(px, [[from, cy - half], [to - half * 2, cy - half], [to, cy], [to - half * 2, cy + half], [from, cy + half]], steel.base);
  line(px, from, cy - half, to - half * 2, cy - half, steel.light);
  line(px, to - half * 2, cy - half, to, cy, steel.light);
  line(px, from, cy + half, to - half * 2, cy + half, steel.dark);
  if (spec.form !== 'dagger') line(px, from + 2, cy, to - half * 3, cy, steel.dark);
  // The hilt: guard, wrapped grip, pommel.
  const guard = half + 5;
  px.rect(23, cy - guard, 4, guard * 2 + 1, hilt.base);
  px.vline(23, cy - guard, guard * 2 + 1, hilt.light);
  px.rect(10, cy - 2, 13, 5, hilt.dark);
  for (let x = 11; x < 23; x += 3) px.vline(x, cy - 2, 5, hilt.base);
  disc(px, 7, cy, 3.2, hilt.base);
  px.set(6, cy - 2, hilt.light);
  const spots: [number, number, number][] = [[7, cy, 2], [25, cy - guard + 2, 1.6], [25, cy + guard - 2, 1.6]];
  spec.sockets.forEach((id, index) => {
    const at = spots[index];
    if (at) socket(px, at[0], at[1], at[2], id);
  });
}

function paintStaff(px: PixelBuffer, spec: CraftArtSpec, length: number): void {
  const wood = tone(craftTint(spec.parts[0]));
  const crown = tone(craftTint(spec.parts[1]));
  const wand = spec.form === 'wand';
  const cy = 26;
  const from = 6;
  const tip = from + Math.round(26 + 70 * length);
  const thick = wand ? 1 : 2;
  px.rect(from, cy - thick, tip - from, thick * 2 + 1, wood.base);
  line(px, from, cy - thick, tip, cy - thick, wood.light);
  line(px, from, cy + thick, tip, cy + thick, wood.dark);
  px.rect(from - 2, cy - thick - 1, 3, thick * 2 + 3, wood.dark);
  // The head: a ring of prongs round the first socket.
  const r = wand ? 5 : 7;
  const hx = tip + r - 1;
  disc(px, hx, cy, r, crown.base);
  disc(px, hx - 1, cy - 1, r - 1, crown.light);
  disc(px, hx, cy, r - 1, crown.base);
  for (const dy of [-r - 2, r + 2]) {
    line(px, hx - 2, cy + Math.sign(dy) * (r - 1), hx + 1, cy + dy, crown.dark);
  }
  socket(px, hx, cy, r - 2.2, spec.sockets[0] ?? null);
  // Further sockets sit in bands down the shaft.
  spec.sockets.slice(1).forEach((id, index) => {
    const x = tip - 6 - index * 9;
    px.rect(x - 2, cy - thick - 1, 5, thick * 2 + 3, crown.dark);
    socket(px, x, cy, 1.6, id);
  });
}

function paintBow(px: PixelBuffer, spec: CraftArtSpec, length: number): void {
  const limb = tone(craftTint(spec.parts[0]));
  const cord = tone(craftTint(spec.parts[1]));
  const cx = 60;
  const half = Math.round(20 + 38 * length);
  const top = 9;
  const base = 39;
  const yAt = (x: number): number => base - (base - top) * (1 - ((x - cx) / half) ** 2);
  line(px, cx - half, base, cx + half, base, cord.light);
  for (let x = cx - half; x <= cx + half; x++) {
    const y = yAt(x);
    const thick = Math.abs(x - cx) < half * 0.2 ? 3 : 2;
    for (let t = 0; t < thick; t++) px.set(x, Math.round(y) + t, t === 0 ? limb.light : limb.base);
    px.set(x, Math.round(y) + thick, limb.dark);
  }
  px.rect(cx - 4, top - 1, 9, 6, limb.dark);
  px.hline(cx - 4, top - 1, 9, limb.base);
  for (const end of [cx - half, cx + half]) disc(px, end, base - 1, 1.6, cord.dark);
  const spots: [number, number][] = [[cx, top + 2], [cx - 9, yAt(cx - 9) + 1]];
  spec.sockets.forEach((id, index) => {
    const at = spots[index];
    if (at) socket(px, at[0], at[1], 1.8, id);
  });
}

function paintArmor(px: PixelBuffer, spec: CraftArtSpec): void {
  const shell = tone(craftTint(spec.parts[0]));
  const lining = tone(craftTint(spec.parts[1]));
  const cx = 60;
  const w = spec.form === 'plate' ? 46 : spec.form === 'mail' ? 40 : 34;
  const l = cx - w / 2;
  const r = cx + w / 2;
  const body: [number, number][] = [
    [l, 9], [cx - 7, 6], [cx, 14], [cx + 7, 6], [r, 9], [r - 1, 18], [r - 5, 21], [r - 4, 43], [l + 4, 43], [l + 5, 21], [l + 1, 18],
  ];
  poly(px, body, lining.base);
  poly(px, body.map(([x, y]): [number, number] => [x + (x < cx ? 1.5 : x > cx ? -1.5 : 0), y + (y < 20 ? 1.5 : -1)]), shell.base);
  line(px, cx - 7, 7, cx, 15, lining.light);
  line(px, cx + 7, 7, cx, 15, lining.dark);
  if (spec.form === 'mail') {
    for (let y = 19; y < 41; y += 2) for (let x = Math.round(l + 7) + (y % 4 === 1 ? 1 : 0); x < r - 6; x += 2) px.set(x, y, shell.dark);
  }
  if (spec.form === 'plate') {
    for (const y of [24, 31, 38]) line(px, l + 6, y, r - 6, y, shell.dark);
    disc(px, l + 3, 12, 5, shell.light);
    disc(px, r - 3, 12, 5, shell.light);
    disc(px, l + 3, 12, 3.4, shell.base);
    disc(px, r - 3, 12, 3.4, shell.base);
  }
  line(px, cx, 16, cx, 42, shell.light);
  line(px, l + 5, 42, r - 5, 42, lining.dark);
  const spots: [number, number][] = [[cx, 22], [cx, 30]];
  spec.sockets.forEach((id, index) => {
    const at = spots[index];
    if (at) socket(px, at[0], at[1], 2, id);
  });
}

/** The thing on the bench as designed so far. */
export function paintCraft(spec: CraftArtSpec): PixelBuffer {
  const px = new PixelBuffer(CRAFT_ART_W, CRAFT_ART_H);
  const length = CRAFT_TEMPLATES[spec.template].sizes.find((size) => size.form === spec.form)?.length ?? 1;
  switch (spec.template) {
    case 'sword': paintSword(px, spec, length); break;
    case 'staff': paintStaff(px, spec, length); break;
    case 'bow': paintBow(px, spec, length); break;
    case 'armor': paintArmor(px, spec); break;
  }
  px.outline(OUTLINE);
  return px;
}
