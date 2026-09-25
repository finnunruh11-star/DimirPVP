// Paints a LocaleModel into a Phaser scene: two tilemap layers of Kenney ground,
// then every building, prop and plant as a depth-sorted image, and the
// shopkeepers at their doors. Generated art becomes cached canvas textures.

import Phaser from 'phaser';
import sheetUrl from '../assets/arena/kenney/roguelikeSheet_transparent.png';
import { buildingPixels } from './buildings';
import { KENNEY_FRAME, KENNEY_KEY, TILE_PX, TILE_SCALE } from './kenney';
import type { LocaleModel, LocaleSprite } from './locale';
import { keeperPixels } from './npcs';
import { PixelBuffer } from './pixels';
import { bridgePixels, cliffPixels, fencePixels, lavaPixels, propPixels, wallPixels, PROPS } from './props';

export function preloadLocaleAssets(scene: Phaser.Scene): void {
  if (!scene.textures.exists(KENNEY_KEY)) scene.load.spritesheet(KENNEY_KEY, sheetUrl, KENNEY_FRAME);
}

/** Copy a pixel buffer into a cached canvas texture, optionally split into frames. */
export function bufferTexture(scene: Phaser.Scene, key: string, px: PixelBuffer, frameW?: number): string {
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, px.w, px.h);
  if (!tex) return key;
  const ctx = tex.getContext();
  const img = ctx.createImageData(px.w, px.h);
  for (let i = 0; i < px.data.length; i++) {
    const c = px.data[i];
    if (c < 0) continue;
    img.data[i * 4] = (c >> 16) & 255;
    img.data[i * 4 + 1] = (c >> 8) & 255;
    img.data[i * 4 + 2] = c & 255;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  tex.refresh();
  if (frameW) {
    for (let f = 0; f * frameW < px.w; f++) tex.add(f, 0, f * frameW, 0, frameW, px.h);
  }
  return key;
}

export function specKey(value: unknown): string {
  const text = JSON.stringify(value);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export interface KeeperSprite {
  shop: string;
  name: string;
  sprite: Phaser.GameObjects.Sprite;
  x: number;
  y: number;
}

/** Tiles along each side of one streamed chunk of sprites. */
const STREAM_CHUNK = 16;

export class LocaleView {
  readonly keepers: KeeperSprite[] = [];
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private map?: Phaser.Tilemaps.Tilemap;
  /** Where new images go: the view's own list, or the chunk being painted. */
  private sink: Phaser.GameObjects.GameObject[] = this.objects;
  private readonly pending = new Map<string, LocaleSprite[]>();
  private readonly live = new Map<string, Phaser.GameObjects.GameObject[]>();
  private streamRange = '';

  /** `stream` paints sprites only near the camera; call `stream()` each frame. */
  constructor(private readonly scene: Phaser.Scene, readonly model: LocaleModel, options: { stream?: boolean } = {}) {
    this.paintGround();
    if (options.stream) {
      for (const sprite of model.sprites) {
        const at = sprite.t === 'building' ? sprite.placement : sprite;
        const key = `${Math.floor(at.x / STREAM_CHUNK)},${Math.floor(at.y / STREAM_CHUNK)}`;
        const list = this.pending.get(key);
        if (list) list.push(sprite);
        else this.pending.set(key, [sprite]);
      }
    } else {
      const shadows = scene.add.graphics().setDepth(-5);
      this.objects.push(shadows);
      for (const sprite of model.sprites) this.paintSprite(sprite, shadows);
    }
    this.paintKeepers();
  }

  /** Paint the chunks around `view` (world pixels) and drop the ones long out of sight. */
  stream(view: Phaser.Geom.Rectangle): void {
    if (!this.pending.size && !this.live.size) return;
    const size = STREAM_CHUNK * TILE_PX;
    const x0 = Math.floor(view.x / size) - 1;
    const y0 = Math.floor(view.y / size) - 1;
    const x1 = Math.floor(view.right / size) + 1;
    const y1 = Math.floor(view.bottom / size) + 1;
    const range = `${x0},${y0},${x1},${y1}`;
    if (range === this.streamRange) return;
    this.streamRange = range;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const key = `${cx},${cy}`;
        if (this.live.has(key)) continue;
        const chunk: Phaser.GameObjects.GameObject[] = [];
        this.live.set(key, chunk);
        const sprites = this.pending.get(key);
        if (!sprites) continue;
        const shadows = this.scene.add.graphics().setDepth(-5);
        chunk.push(shadows);
        this.sink = chunk;
        for (const sprite of sprites) this.paintSprite(sprite, shadows);
        this.sink = this.objects;
      }
    }
    for (const [key, chunk] of this.live) {
      const [cx, cy] = key.split(',').map(Number);
      if (cx >= x0 - 1 && cx <= x1 + 1 && cy >= y0 - 1 && cy <= y1 + 1) continue;
      for (const obj of chunk) obj.destroy();
      this.live.delete(key);
    }
  }

  get worldWidth(): number {
    return this.model.w * TILE_PX;
  }

  get worldHeight(): number {
    return this.model.h * TILE_PX;
  }

  destroy(): void {
    for (const obj of this.objects) obj.destroy();
    this.objects.length = 0;
    for (const chunk of this.live.values()) for (const obj of chunk) obj.destroy();
    this.live.clear();
    this.map?.destroy();
  }

  private paintGround(): void {
    const { model, scene } = this;
    const map = scene.make.tilemap({ tileWidth: 16, tileHeight: 16, width: model.w, height: model.h });
    this.map = map;
    const tiles = map.addTilesetImage(KENNEY_KEY, KENNEY_KEY, 16, 16, 0, 1, 0);
    if (!tiles) return;
    const ground = map.createBlankLayer('ground', tiles, 0, 0);
    const overlay = map.createBlankLayer('overlay', tiles, 0, 0);
    if (!ground || !overlay) return;
    ground.setScale(TILE_SCALE).setDepth(-20);
    overlay.setScale(TILE_SCALE).setDepth(-19);
    for (let y = 0; y < model.h; y++) {
      for (let x = 0; x < model.w; x++) {
        const i = y * model.w + x;
        ground.putTileAt(model.ground[i], x, y);
        if (model.overlay[i] >= 0) overlay.putTileAt(model.overlay[i], x, y);
      }
    }
  }

  private image(key: string, x: number, y: number, depth: number, frame?: string | number): Phaser.GameObjects.Image {
    const img = this.scene.add.image(x * TILE_PX, y * TILE_PX, key, frame).setOrigin(0, 0).setScale(TILE_SCALE).setDepth(depth * TILE_SCALE);
    this.sink.push(img);
    return img;
  }

  private paintSprite(sprite: LocaleSprite, shadows: Phaser.GameObjects.Graphics): void {
    const { scene } = this;
    switch (sprite.t) {
      case 'kenney': {
        this.image(KENNEY_KEY, sprite.x, sprite.y, sprite.depth, sprite.frame);
        if (sprite.depth > 2) {
          shadows.fillStyle(0x000000, 0.16).fillEllipse((sprite.x + 0.5) * TILE_PX, sprite.depth * TILE_SCALE - 5, TILE_PX * 0.7, 12);
        }
        return;
      }
      case 'prop': {
        const key = `prop:${sprite.kind}:${sprite.color ?? ''}:${sprite.flip ? 1 : 0}`;
        bufferTexture(scene, key, propPixels(sprite.kind, { color: sprite.color, flip: sprite.flip }));
        this.image(key, sprite.x, sprite.y, sprite.depth);
        const size = PROPS[sprite.kind];
        if (size.solid !== 'none') {
          shadows.fillStyle(0x000000, 0.16).fillEllipse((sprite.x + size.w / 2) * TILE_PX, sprite.depth * TILE_SCALE - 5, size.w * TILE_PX * 0.8, 12);
        }
        return;
      }
      case 'fence':
        this.image(bufferTexture(scene, `fence:${sprite.mask}`, fencePixels(sprite.mask)), sprite.x, sprite.y, sprite.depth);
        return;
      case 'wall': {
        const stone = this.model.def.wallStone ?? 0x9a9ea6;
        this.image(bufferTexture(scene, `wall:${sprite.mask}:${stone}`, wallPixels(sprite.mask, stone)), sprite.x, sprite.y, sprite.depth);
        return;
      }
      case 'bridge': {
        const key = `bridge:${sprite.vertical ? 'v' : 'h'}:${sprite.stone ? 's' : 'w'}`;
        this.image(bufferTexture(scene, key, bridgePixels(sprite.vertical, sprite.stone)), sprite.x, sprite.y, sprite.depth);
        return;
      }
      case 'cliff': {
        const key = `cliff:${sprite.mask}:${sprite.variant}`;
        this.image(bufferTexture(scene, key, cliffPixels(sprite.mask, sprite.variant)), sprite.x, sprite.y, sprite.depth).setDepth(-17);
        return;
      }
      case 'lava': {
        const key = `lava:${sprite.mask}`;
        if (!scene.textures.exists(key)) {
          const sheet = new PixelBuffer(32, 16);
          sheet.stamp(lavaPixels(0, sprite.mask), 0, 0);
          sheet.stamp(lavaPixels(1, sprite.mask), 16, 0);
          bufferTexture(scene, key, sheet, 16);
        }
        const anim = `lava-flow:${sprite.mask}`;
        if (!scene.anims.exists(anim)) {
          scene.anims.create({ key: anim, frames: scene.anims.generateFrameNumbers(key, { start: 0, end: 1 }), frameRate: 2, repeat: -1 });
        }
        const lava = scene.add.sprite(sprite.x * TILE_PX, sprite.y * TILE_PX, key, 0).setOrigin(0, 0).setScale(TILE_SCALE).setDepth(-18);
        lava.play({ key: anim, startFrame: (sprite.x + sprite.y) % 2 });
        this.sink.push(lava);
        return;
      }
      case 'building': {
        const { placement } = sprite;
        const key = `bld:${specKey(placement.spec)}`;
        bufferTexture(scene, key, buildingPixels(placement.spec));
        this.image(key, placement.x, placement.y, sprite.depth);
        shadows.fillStyle(0x000000, 0.2).fillRect(
          placement.x * TILE_PX + 6,
          (placement.y + placement.spec.h) * TILE_PX - 4,
          placement.spec.w * TILE_PX - 12,
          10,
        );
        return;
      }
    }
  }

  private paintKeepers(): void {
    const { scene } = this;
    for (const keeper of this.model.keepers) {
      const key = `keeper:${keeper.look}`;
      bufferTexture(scene, key, keeperPixels(keeper.look), 16);
      const anim = `keeper-idle:${keeper.look}`;
      if (!scene.anims.exists(anim)) {
        scene.anims.create({ key: anim, frames: scene.anims.generateFrameNumbers(key, { start: 0, end: 1 }), frameRate: 1.6, repeat: -1 });
      }
      const x = (keeper.x + 0.5) * TILE_PX;
      const y = (keeper.y + 1) * TILE_PX - 2;
      const sprite = scene.add.sprite(x, y, key, 0).setOrigin(0.5, 1).setScale(TILE_SCALE).setDepth(y);
      sprite.play({ key: anim, startFrame: keeper.x % 2 });
      this.objects.push(sprite);
      this.keepers.push({ shop: keeper.shop, name: keeper.name, sprite, x: keeper.x, y: keeper.y });
    }
  }
}
