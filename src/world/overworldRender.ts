// The world map painted with the town tiles: ground by terrain and region,
// roads and water autotiled, woods, peaks and marsh read from the terrain grid,
// a small model of every place, a shade over ground not yet walked, and the
// light of the hour. Presentation only: nothing here touches the run's rolls.

import Phaser from 'phaser';
import { buildingPixels, type BuildingSpec } from './buildings';
import {
  AUTOTILES,
  cellHash,
  E,
  KENNEY_KEY,
  KENNEY_PROPS,
  N,
  NATURE,
  narrowFrame,
  pickFill,
  S,
  W,
  wideFrame,
} from './kenney';
import { bufferTexture, specKey } from './localeRender';
import { PixelBuffer } from './pixels';
import { bridgePixels, cliffPixels, propPixels, PROPS, type PropKind } from './props';
import { mapShade } from '../visuals/daylight';
import { PLACES, regionAt, terrainAt, terrainFill, type Place, type RegionId, type Terrain, type WorldMap } from '../pve/exploration/world';

export const OW_SCALE = 2;
export const OW_CELL = 16 * OW_SCALE;

const DEPTH = {
  ground: -30,
  overlay: -29,
  cliff: -20,
  nature: -10,
  fog: -3,
  night: -2,
  storm: -1,
  label: 20,
};

const SANDSTONE = 0xe2c28c;

const WATERISH: ReadonlySet<Terrain> = new Set(['water', 'bog', 'bridge']);
const ROADISH: ReadonlySet<Terrain> = new Set(['road', 'bridge']);

export class OverworldView {
  readonly width: number;
  readonly height: number;
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private map?: Phaser.Tilemaps.Tilemap;
  private readonly fog: Phaser.GameObjects.Graphics;
  private readonly night: Phaser.GameObjects.Rectangle;
  private storm?: { haze: Phaser.GameObjects.Graphics; streaks: Phaser.GameObjects.TileSprite };

  constructor(private readonly scene: Phaser.Scene, private readonly world: WorldMap) {
    this.width = world.w * OW_CELL;
    this.height = world.h * OW_CELL;
    this.paintGround();
    this.paintNature();
    this.paintPlaces();
    this.fog = scene.add.graphics().setDepth(DEPTH.fog);
    this.night = scene.add.rectangle(0, 0, this.width, this.height, 0x0a1438, 0.38).setOrigin(0).setDepth(DEPTH.night).setVisible(false);
    this.objects.push(this.fog, this.night);
  }

  destroy(): void {
    for (const obj of this.objects) obj.destroy();
    this.objects.length = 0;
    this.map?.destroy();
  }

  /** Centre of a tile in world pixels. */
  tileCenter(x: number, y: number): { x: number; y: number } {
    return { x: (x + 0.5) * OW_CELL, y: (y + 0.5) * OW_CELL };
  }

  /** Shade every tile the party has not walked. */
  setExplored(mask: Uint8Array): void {
    const { w, h } = this.world;
    const g = this.fog;
    g.clear();
    g.fillStyle(0x0b0d10, 0.5);
    for (let y = 0; y < h; y++) {
      let start = -1;
      for (let x = 0; x <= w; x++) {
        const hidden = x < w && !mask[y * w + x];
        if (hidden && start < 0) start = x;
        if (!hidden && start >= 0) {
          g.fillRect(start * OW_CELL, y * OW_CELL, (x - start) * OW_CELL, OW_CELL);
          start = -1;
        }
      }
    }
  }

  /** Lay the light of the hour over the map: warm at dawn and dusk, deep blue at night. */
  setDaylight(hour: number): void {
    const { color, alpha } = mapShade(hour);
    this.night.setFillStyle(color, alpha).setVisible(alpha > 0.004);
  }

  /** Blowing sand over the whole desert: what was mapped there cannot be seen. */
  setStorm(active: boolean): void {
    if (!active) {
      this.storm?.haze.setVisible(false);
      this.storm?.streaks.setVisible(false);
      return;
    }
    const storm = this.storm ?? this.buildStorm();
    storm.haze.setVisible(true);
    storm.streaks.setVisible(true);
  }

  private buildStorm(): { haze: Phaser.GameObjects.Graphics; streaks: Phaser.GameObjects.TileSprite } {
    const { scene, world } = this;
    const haze = scene.add.graphics().setDepth(DEPTH.storm);
    haze.fillStyle(0xcfa66c, 0.72);
    let minX = world.w;
    let minY = world.h;
    let maxX = 0;
    let maxY = 0;
    for (let y = 0; y < world.h; y++) {
      let start = -1;
      for (let x = 0; x <= world.w; x++) {
        const desert = x < world.w && regionAt(world, x, y) === 'white';
        if (desert && start < 0) start = x;
        if (!desert && start >= 0) {
          haze.fillRect(start * OW_CELL, y * OW_CELL, (x - start) * OW_CELL, OW_CELL);
          minX = Math.min(minX, start);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y + 1);
          start = -1;
        }
      }
    }
    const key = 'ow-sand-streaks';
    if (!scene.textures.exists(key)) {
      const px = new PixelBuffer(96, 48);
      for (let i = 0; i < 40; i++) {
        const roll = cellHash(i, 7, 91);
        const x = roll % 96;
        const y = (roll >>> 8) % 48;
        const len = 6 + ((roll >>> 16) % 16);
        const color = i % 3 === 0 ? 0xfff1d0 : 0xe8cd98;
        for (let d = 0; d < len; d++) px.set((x + d) % 96, y, color);
      }
      bufferTexture(scene, key, px);
    }
    const w = (maxX - minX) * OW_CELL;
    const h = (maxY - minY) * OW_CELL;
    const streaks = scene.add.tileSprite(minX * OW_CELL, minY * OW_CELL, w, h, key).setOrigin(0).setDepth(DEPTH.storm + 0.5).setAlpha(0.7);
    streaks.setTileScale(OW_SCALE, OW_SCALE);
    streaks.setMask(haze.createGeometryMask());
    scene.tweens.add({ targets: streaks, tilePositionX: -96 * 40, tilePositionY: 48 * 6, duration: 16000, repeat: -1 });
    this.objects.push(haze, streaks);
    this.storm = { haze, streaks };
    return this.storm;
  }

  private terrain(x: number, y: number): Terrain {
    return terrainAt(this.world, x, y);
  }

  private paintGround(): void {
    const { scene, world } = this;
    const map = scene.make.tilemap({ tileWidth: 16, tileHeight: 16, width: world.w, height: world.h });
    this.map = map;
    const tiles = map.addTilesetImage(KENNEY_KEY, KENNEY_KEY, 16, 16, 0, 1, 0);
    if (!tiles) return;
    const ground = map.createBlankLayer('ow-ground', tiles, 0, 0);
    const overlay = map.createBlankLayer('ow-overlay', tiles, 0, 0);
    if (!ground || !overlay) return;
    ground.setScale(OW_SCALE).setDepth(DEPTH.ground);
    overlay.setScale(OW_SCALE).setDepth(DEPTH.overlay);
    const is = (set: ReadonlySet<Terrain>, x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < world.w && y < world.h && set.has(this.terrain(x, y));
    for (let y = 0; y < world.h; y++) {
      for (let x = 0; x < world.w; x++) {
        const terrain = this.terrain(x, y);
        ground.putTileAt(pickFill(terrainFill(terrain, regionAt(world, x, y)), x, y), x, y);
        if (ROADISH.has(terrain) && terrain !== 'bridge') {
          const mask = (is(ROADISH, x, y - 1) ? N : 0) | (is(ROADISH, x + 1, y) ? E : 0) | (is(ROADISH, x, y + 1) ? S : 0) | (is(ROADISH, x - 1, y) ? W : 0);
          overlay.putTileAt(narrowFrame(AUTOTILES.dirt, mask), x, y);
        } else if (WATERISH.has(terrain)) {
          overlay.putTileAt(wideFrame(AUTOTILES.water.wide, (dx, dy) => is(WATERISH, x + dx, y + dy) || !this.inside(x + dx, y + dy)), x, y);
        }
      }
    }
  }

  private inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.world.w && y < this.world.h;
  }

  private image(key: string, x: number, y: number, depth: number, frame?: number): Phaser.GameObjects.Image {
    const img = this.scene.add.image(x, y, key, frame).setOrigin(0, 0).setScale(OW_SCALE).setDepth(depth);
    this.objects.push(img);
    return img;
  }

  /** A Kenney sprite on tile (x, y), sorted by how low it stands. */
  private kenney(frame: number, x: number, y: number, bottomRow = y): void {
    this.image(KENNEY_KEY, x * OW_CELL, y * OW_CELL, DEPTH.nature + (bottomRow + 1) * 0.01, frame);
  }

  private tree(frames: number | readonly number[], x: number, y: number): void {
    if (typeof frames === 'number') {
      this.kenney(frames, x, y);
      return;
    }
    this.kenney(frames[0], x, y - 1, y);
    this.kenney(frames[1], x, y, y);
  }

  private prop(kind: PropKind, x: number, y: number): void {
    const size = PROPS[kind];
    const key = bufferTexture(this.scene, `prop:${kind}::0`, propPixels(kind));
    this.image(key, x * OW_CELL, (y - (size.h - 1)) * OW_CELL, DEPTH.nature + (y + 1) * 0.01);
  }

  private paintNature(): void {
    const { world } = this;
    for (let y = 0; y < world.h; y++) {
      for (let x = 0; x < world.w; x++) {
        const terrain = this.terrain(x, y);
        const region = regionAt(world, x, y);
        const roll = cellHash(x, y, 29) % 1000;
        switch (terrain) {
          case 'forest':
            if (roll < 850) this.forestTree(region, x, y, roll);
            break;
          case 'mountain': {
            const rock = (dx: number, dy: number): boolean => !this.inside(x + dx, y + dy) || this.terrain(x + dx, y + dy) === 'mountain';
            const mask = (rock(0, -1) ? N : 0) | (rock(1, 0) ? E : 0) | (rock(0, 1) ? S : 0) | (rock(-1, 0) ? W : 0);
            const key = bufferTexture(this.scene, `cliff:${mask}:${roll % 4}`, cliffPixels(mask, roll % 4));
            const cliff = this.image(key, x * OW_CELL, y * OW_CELL, DEPTH.cliff);
            if (region === 'white') cliff.setTint(SANDSTONE);
            break;
          }
          case 'dunes':
            if (roll < 16) this.prop('rock', x, y);
            else if (roll < 26) this.prop('deadtree', x, y);
            else if (roll < 34) this.prop('bones', x, y);
            break;
          case 'flats':
            if (roll < 90) this.prop('rock', x, y);
            else if (roll < 120) this.kenney(NATURE.twigs, x, y);
            else if (roll < 140) this.prop('deadtree', x, y);
            break;
          case 'hills':
            if (roll < 110) this.prop('rock', x, y);
            else if (roll < 190) this.tree(NATURE.pineTall, x, y);
            else if (roll < 230) this.kenney(NATURE.stump, x, y);
            else if (roll < 260 && region === 'red') this.prop('emberrock', x, y);
            break;
          case 'swamp':
            if (roll < 70) this.prop('deadtree', x, y);
            else if (roll < 120) this.kenney(NATURE.weeds, x, y);
            else if (roll < 150) this.prop('mushrooms', x, y);
            else if (roll < 160) this.prop('bones', x, y);
            break;
          case 'sand':
            if (roll < 50) this.kenney(NATURE.tuft[roll % NATURE.tuft.length], x, y);
            break;
          case 'plains':
            this.plainsDecor(region, x, y, roll);
            break;
          case 'bridge': {
            const vertical = ROADISH.has(this.terrain(x, y - 1)) || ROADISH.has(this.terrain(x, y + 1));
            const key = bufferTexture(this.scene, `bridge:${vertical ? 'v' : 'h'}:w`, bridgePixels(vertical));
            this.image(key, x * OW_CELL, y * OW_CELL, DEPTH.overlay + 0.5);
            break;
          }
          default:
            break;
        }
      }
    }
  }

  private forestTree(region: RegionId, x: number, y: number, roll: number): void {
    // A tall tree's crown needs open sky above it.
    const tallOk = y > 0 && this.terrain(x, y - 1) !== 'mountain';
    switch (region) {
      case 'forest':
        if (tallOk && roll < 420) this.tree(roll % 3 === 0 ? NATURE.pineTallDark : roll % 3 === 1 ? NATURE.treeTall : NATURE.pineTall, x, y);
        else this.tree(roll % 2 ? NATURE.treeRound : NATURE.pineDark, x, y);
        return;
      case 'black':
        if (roll < 300) this.prop('deadtree', x, y);
        else this.tree(roll % 2 ? NATURE.treeRoundDark : NATURE.bushDark, x, y);
        return;
      case 'red':
        this.tree(tallOk && roll < 400 ? NATURE.pineTall : NATURE.pine, x, y);
        return;
      case 'lake':
        this.tree(roll % 3 === 0 ? NATURE.pine : NATURE.treeRound, x, y);
        return;
      case 'capitol':
        if (tallOk && roll < 300) this.tree(roll % 2 ? NATURE.treeTall : NATURE.fruitTree, x, y);
        else this.tree(roll % 2 ? NATURE.treeRound : NATURE.bush, x, y);
        return;
      case 'white':
        if (tallOk) this.prop('palm', x, y);
        return;
    }
  }

  private plainsDecor(region: RegionId, x: number, y: number, roll: number): void {
    if (region === 'white') {
      // The oasis: palms round the water, grass between.
      if (roll < 420 && y > 0) this.prop('palm', x, y);
      else if (roll < 520) this.kenney(NATURE.tuft[roll % NATURE.tuft.length], x, y);
      return;
    }
    if (roll >= 90) return;
    switch (region) {
      case 'forest':
      case 'capitol':
      case 'lake':
        if (roll < 30) this.kenney(NATURE.flowers[roll % NATURE.flowers.length], x, y);
        else if (roll < 65) this.kenney(NATURE.tuft[roll % NATURE.tuft.length], x, y);
        else if (roll < 80) this.kenney(NATURE.bush, x, y);
        else this.prop('rock', x, y);
        return;
      case 'red':
        if (roll < 40) this.prop('rock', x, y);
        else if (roll < 60) this.kenney(NATURE.twigs, x, y);
        else this.kenney(NATURE.bushAutumn, x, y);
        return;
      case 'black':
        if (roll < 40) this.kenney(NATURE.weeds, x, y);
        else if (roll < 60) this.prop('mushrooms', x, y);
        else this.kenney(NATURE.bushDark, x, y);
        return;
    }
  }

  private building(spec: BuildingSpec, tileX: number, tileY: number, dx = 0, dy = 0): void {
    const key = `bld:${specKey(spec)}`;
    bufferTexture(this.scene, key, buildingPixels(spec));
    const scale = 1.25;
    const x = (tileX + 0.5) * OW_CELL + dx;
    const y = (tileY + 0.9) * OW_CELL + dy;
    const img = this.scene.add.image(x, y, key).setOrigin(0.5, 1).setScale(scale).setDepth(DEPTH.nature + (tileY + 1) * 0.01 + 0.005);
    this.objects.push(img);
  }

  private label(place: Place): void {
    const city = place.kind === 'city';
    const text = this.scene.add.text((place.x + 0.5) * OW_CELL, (place.y + 1.1) * OW_CELL, place.name, {
      fontFamily: 'Georgia, serif',
      fontSize: city ? '16px' : '13px',
      fontStyle: 'bold',
      color: city ? '#f3e2b0' : '#e8d8c8',
      stroke: '#120d09',
      strokeThickness: 4,
    }).setOrigin(0.5, 0).setDepth(DEPTH.label);
    this.objects.push(text);
  }

  /** A little model of every place, drawn around its tile. */
  private paintPlaces(): void {
    for (const place of PLACES) {
      const { x, y } = place;
      switch (place.id) {
        case 'capitol':
          this.building({ w: 6, h: 5, wallRows: 2, roof: 'slate', wall: 'stone', door: 2, windows: [1, 4], banner: 0x2f4f86 }, x, y, 0, -4);
          this.building({ w: 3, h: 3, roof: 'red', wall: 'plaster', door: 1 }, x, y, -64, 10);
          this.building({ w: 3, h: 3, roof: 'blue', wall: 'plaster', door: 1 }, x, y, 64, 10);
          break;
        case 'oakhaven':
          this.building({ w: 4, h: 4, roof: 'green', wall: 'darkwood', door: 1, windows: [3], chimney: 2 }, x, y, -20, 0);
          this.building({ w: 3, h: 3, roof: 'thatch', wall: 'wood', door: 1 }, x, y, 40, 8);
          break;
        case 'pennybruck':
          this.building({ w: 3, h: 3, roof: 'slate', wall: 'stone', door: 1, chimney: 2 }, x, y, -16, 0);
          this.building({ w: 3, h: 3, roof: 'charcoal', wall: 'stone', door: 1 }, x, y, 30, 8);
          break;
        case 'hearthfire':
          this.building({ w: 5, h: 4, roof: 'rust', wall: 'brick', door: 2, chimney: 3 }, x, y, -10, -4);
          this.building({ w: 3, h: 3, roof: 'charcoal', wall: 'stone', door: 1, chimney: 1 }, x, y, 54, 6);
          break;
        case 'kerusai':
          this.building({ w: 4, h: 3, roof: 'plum', wall: 'darkwood', door: 1 }, x, y, -18, -2);
          this.building({ w: 3, h: 3, roof: 'thatch', wall: 'darkwood', door: 1 }, x, y, 38, 6);
          break;
        case 'thassa':
          this.building({ w: 4, h: 3, roof: 'teal', wall: 'plaster', door: 1, windows: [3] }, x, y, -18, -2);
          this.building({ w: 3, h: 3, roof: 'blue', wall: 'plaster', door: 1 }, x, y, 36, 8);
          break;
        case 'nerogril':
          this.building({ w: 4, h: 3, roof: 'thatch', wall: 'sandstone', door: 1, windows: [3] }, x, y, -16, -2);
          this.prop('tent', x + 1, y);
          break;
        case 'theocracy':
          this.building({ w: 6, h: 6, wallRows: 3, roof: 'teal', wall: 'plaster', door: 2, windows: [1, 4], banner: 0xe7c24a }, x, y, 0, -6);
          this.building({ w: 3, h: 3, roof: 'thatch', wall: 'sandstone', door: 1 }, x, y, -64, 10);
          this.building({ w: 3, h: 3, roof: 'teal', wall: 'sandstone', door: 1 }, x, y, 64, 10);
          break;
        case 'small-forest':
          this.tree(NATURE.pineTallDark, x - 1, y);
          this.tree(NATURE.treeTallDark, x + 1, y);
          this.kenney(KENNEY_PROPS.signpost[0], x, y);
          break;
        case 'red-wilds': {
          const glow = this.scene.add.ellipse((x + 0.5) * OW_CELL, (y + 0.3) * OW_CELL, 44, 20, 0xd8561f, 0.85).setDepth(DEPTH.nature);
          this.scene.tweens.add({ targets: glow, alpha: 0.45, yoyo: true, repeat: -1, duration: 1100, ease: 'Sine.InOut' });
          this.objects.push(glow);
          this.prop('emberrock', x - 1, y);
          this.prop('deadtree', x + 1, y);
          break;
        }
        case 'mines':
          this.prop('cave', x, y);
          break;
        case 'swamps':
          this.kenney(KENNEY_PROPS.gravestones[1], x - 1, y);
          this.kenney(KENNEY_PROPS.gravestones[3], x + 1, y);
          this.prop('deadtree', x, y - 1);
          break;
      }
      this.label(place);
    }
  }
}
