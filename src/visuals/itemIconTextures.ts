// Item icons as Phaser textures, made the first time each is asked for.

import Phaser from 'phaser';
import type { ItemId } from '../core/Items';
import { bufferTexture } from '../world/localeRender';
import { itemIconPixels } from './itemIcons';

/** The texture key of `id`'s 16x16 icon. */
export function itemIconTexture(scene: Phaser.Scene, id: ItemId): string {
  return bufferTexture(scene, `item-icon:${id}`, itemIconPixels(id));
}
