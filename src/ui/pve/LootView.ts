import Phaser from 'phaser';
import { playSound } from '../../audio';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config/constants';
import { getItem, rarityRank, type ItemId } from '../../core/Items';
import type { Mage } from '../../core/Mage';
import { SceneInput } from '../../engine/SceneInput';
import type { LootEntry } from '../../pve/loot';
import { itemIconTexture } from '../../visuals/itemIconTextures';
import { itemRarityColor } from '../../visuals/itemIcons';
import { CabinetChip } from '../cabinet/controls';
import { isReducedMotion } from '../cabinet/motion';
import { addCabinetBackdrop, addSectionRule, MENU_FONT, MENU_HEX } from '../cabinet/theme';
import { addItemCard, addMeter, DragController, ItemTile, SpatialFocus, type DragPayload } from '../inventory/kit';
import { carriedStacks, kg, RARITY_NAME } from '../inventory/itemInfo';

export interface LootViewModel {
  title: string;
  source: 'chest' | 'search' | 'combat';
  message: string;
  entries: LootEntry[];
  party(): readonly Mage[];
  canTake(entry: number, member: number): boolean;
  take(entry: number, member: number): void;
  canRelease(member: number, id: ItemId): boolean;
  release(member: number, id: ItemId): void;
  canMove(from: number, to: number, id: ItemId): boolean;
  move(from: number, to: number, id: ItemId): void;
  done(): void;
  doneLabel?: string;
  confirmLeave?: boolean;
  gold?: string;
}

const COLUMNS = 7;
const PER_PAGE = 14;
const SIZE = 64;
const PITCH = 110;
const BAGS_Y = GAME_HEIGHT - 230;
type LootPick = { kind: 'loot'; entry: number } | { kind: 'bag'; member: number; id: ItemId };

export class LootView extends Phaser.GameObjects.Container {
  private readonly keys: SceneInput;
  private readonly drag: DragController;
  private focus = new SpatialFocus();
  private picked: LootPick = { kind: 'loot', entry: 0 };
  private page = 0;
  private readonly bagPages = new Map<number, number>();
  private closed = false;
  private ready = false;
  private leaving = false;
  private message = '';
  private readonly animated: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, private readonly model: LootViewModel) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(390);
    this.keys = new SceneInput(scene);
    this.drag = new DragController(scene, 391, (payload, target) => {
      const picked = this.dragPick(payload);
      if (target.key === 'haul') this.release(picked);
      else this.put(picked, Number(target.key));
    });
    this.keys.bindKeys([
      { key: 'LEFT', capture: true, run: () => this.focus.move('left') },
      { key: 'RIGHT', capture: true, run: () => this.focus.move('right') },
      { key: 'UP', capture: true, run: () => this.focus.move('up') },
      { key: 'DOWN', capture: true, run: () => this.focus.move('down') },
      { key: 'TAB', capture: true, run: (event) => this.focus.cycle(event.shiftKey ? -1 : 1) },
      { key: 'ENTER', capture: true, run: () => this.focus.activate() },
      { key: 'SPACE', capture: true, run: () => this.focus.activate() },
      { key: 'ESC', capture: true, run: () => this.finish() },
    ]);
    this.render(true);
    playSound('ui.confirm');
  }

  refresh(message = ''): void {
    this.message = message;
    this.leaving = false;
    this.render();
  }

  markReady(): void {
    this.ready = true;
    this.refresh('Waiting for the rest of the party.');
  }

  override destroy(fromScene?: boolean): void {
    this.closed = true;
    this.stopAnimations();
    this.drag.destroy();
    this.keys.destroy();
    super.destroy(fromScene);
  }

  private stopAnimations(): void {
    for (const target of this.animated) this.scene.tweens.killTweensOf(target);
    this.animated.length = 0;
  }

  private text(x: number, y: number, value: string, width: number, size = 14, color: string = MENU_HEX.boneDim): Phaser.GameObjects.Text {
    const text = this.scene.add.text(x, y, value, {
      fontFamily: MENU_FONT.control, fontSize: `${size}px`, color,
      wordWrap: { width, useAdvancedWrap: true }, fixedWidth: width, lineSpacing: 3,
    });
    this.add(text);
    return text;
  }

  private render(reveal = false): void {
    if (this.closed) return;
    const keep = this.focus.currentKey;
    this.stopAnimations();
    this.drag.cancel();
    this.drag.clearTargets();
    this.removeAll(true);
    this.focus = new SpatialFocus();
    const { scene, model } = this;
    addCabinetBackdrop(scene, this);
    this.add(scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0).setOrigin(0).setInteractive());
    this.text(58, 32, model.title, 870, 30, MENU_HEX.bone).setFontFamily(MENU_FONT.display);
    this.text(58, 82, model.message, 690, 15).setMaxLines(3);
    if (model.gold) this.text(932, 42, model.gold, 290, 20, MENU_HEX.brassLight).setAlign('right');
    addSectionRule(scene, this, 58, 148, GAME_WIDTH - 116);
    this.drawSource(reveal);
    const available = model.entries.map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.count > 0 || (entry.taken ?? 0) > 0);
    const pages = Math.max(1, Math.ceil(available.length / PER_PAGE));
    this.page = Math.min(this.page, pages - 1);
    if ((this.picked.kind === 'loot' && !model.entries[this.picked.entry])
      || (this.picked.kind === 'bag' && !model.party()[this.picked.member])) {
      this.picked = { kind: 'loot', entry: available[0]?.index ?? 0 };
    }
    this.text(58, 166, available.length ? 'THE HAUL' : 'NOTHING LEFT BEHIND', 460, 12, MENU_HEX.verdigris);
    if (this.picked.kind === 'bag') {
      this.chip(552, 158, 230, 'Leave on ground', () => this.release(this.picked),
        !this.ready && model.canRelease(this.picked.member, this.picked.id));
    }
    this.drag.addTarget({ key: 'haul', x: 50, y: 198, w: 750, h: 218,
      accepts: (payload) => {
        const picked = this.dragPick(payload);
        return !this.ready && picked.kind === 'bag' && model.canRelease(picked.member, picked.id);
      } });
    available.slice(this.page * PER_PAGE, (this.page + 1) * PER_PAGE).forEach(({ entry, index }, slot) => {
      const x = 58 + (slot % COLUMNS) * PITCH;
      const y = 204 + Math.floor(slot / COLUMNS) * PITCH;
      const tile = new ItemTile(scene, x, y, {
        id: entry.id, count: entry.count + (entry.taken ?? 0), size: SIZE,
        selected: this.picked.kind === 'loot' && index === this.picked.entry,
        tag: entry.count === 0 ? 'PACKED' : undefined,
        onActivate: () => { this.picked = { kind: 'loot', entry: index }; this.render(); },
        drag: entry.count > 0 ? { controller: this.drag, payload: { id: entry.id, from: `${index}` } } : undefined,
      });
      this.add(tile);
      this.focus.add(tile, `loot:${index}`, x, y, SIZE, SIZE);
      const def = getItem(entry.id);
      this.text(x - 8, y + SIZE + 6, def.name, 96, 11, MENU_HEX.bone).setAlign('center').setMaxLines(2);
      if (rarityRank(def.rarity) >= rarityRank('rare')) this.shine(tile, itemRarityColor(entry.id), slot);
      if (reveal && !isReducedMotion()) {
        tile.setPosition(776, 112).setAlpha(0).setScale(0.35);
        scene.tweens.add({ targets: tile, x, y, alpha: 1, scaleX: 1, scaleY: 1,
          duration: 560, delay: 240 + slot * 65, ease: 'Back.Out' });
        this.animated.push(tile);
      }
    });
    if (pages > 1) {
      this.chip(58, 426, 48, '<', () => { this.page = (this.page + pages - 1) % pages; this.render(); });
      this.text(118, 433, `${this.page + 1} / ${pages}`, 96, 12);
      this.chip(220, 426, 48, '>', () => { this.page = (this.page + 1) % pages; this.render(); });
    }
    const picked = this.picked.kind === 'loot' ? model.entries[this.picked.entry] : this.picked;
    if (picked) {
      const eyebrow = this.picked.kind === 'bag' ? `${model.party()[this.picked.member].name}'s bag`
        : `${RARITY_NAME[getItem(picked.id).rarity] || 'Supply'} / ${model.entries[this.picked.entry].count > 0
          ? `${model.entries[this.picked.entry].count} remaining` : 'Packed'}`;
      addItemCard(scene, this, 858, 174, 364, BAGS_Y - 16, {
        id: picked.id, eyebrow,
      });
    } else {
      this.text(858, 208, model.entries.length ? 'The spoils are packed.' : 'No items found.', 350, 22, MENU_HEX.bone);
    }
    addSectionRule(scene, this, 58, BAGS_Y - 8, GAME_WIDTH - 116);
    this.drawBags();
    this.text(58, GAME_HEIGHT - 48, this.message, 900, 13, MENU_HEX.brassLight);
    this.chip(GAME_WIDTH - 240, GAME_HEIGHT - 62, 182,
      this.ready ? 'Ready' : this.leaving ? 'Leave the rest' : model.doneLabel ?? 'Continue', () => this.finish(), !this.ready);
    this.focus.restore(keep);
  }

  private chip(x: number, y: number, width: number, label: string, run: () => void, enabled = true): void {
    const chip = new CabinetChip(this.scene, x, y, { width, height: 36, label, enabled, onActivate: run });
    this.add(chip);
    this.focus.add(chip, `${x}:${y}`, x, y, width, 36);
  }

  private drawBags(): void {
    const party = this.model.party();
    const width = (GAME_WIDTH - 116 - Math.max(0, party.length - 1) * 24) / Math.max(1, party.length);
    party.forEach((mage, member) => {
      const x = 58 + member * (width + 24);
      const fits = this.canPut(this.picked, member);
      this.text(x + 64, BAGS_Y + 12, mage.name, width - 70, 17, MENU_HEX.bone).setMaxLines(1);
      const bag = this.scene.add.image(x + 26, BAGS_Y + 38, itemIconTexture(this.scene, 'smallBag')).setScale(3);
      this.add(bag);
      const cap = mage.carryCap();
      addMeter(this.scene, this, x, BAGS_Y + 70, width - 4, 'CARRIED',
        `${kg(mage.carriedWeight())} / ${Number.isFinite(cap) ? kg(cap) : 'Unlimited'} kg`,
        Number.isFinite(cap) ? mage.carriedWeight() / Math.max(1, cap) : 0, 0x77b2a3,
        { warn: mage.carriedWeight() > cap });
      this.chip(x + 64, BAGS_Y + 34, Math.min(width - 70, 244), fits ? 'Put in bag' : 'Unavailable',
        () => this.put(this.picked, member), fits);
      this.drag.addTarget({ key: `${member}`, x, y: BAGS_Y + 4, w: width, h: 146,
        accepts: (payload) => this.canPut(this.dragPick(payload), member) });
      const stacks = carriedStacks(mage);
      const columns = Math.max(1, Math.min(8, Math.floor((width - 82) / 48)));
      const pages = Math.max(1, Math.ceil(stacks.length / columns));
      const page = Math.min(this.bagPages.get(member) ?? 0, pages - 1);
      this.bagPages.set(member, page);
      stacks.slice(page * columns, (page + 1) * columns).forEach((stack, slot) => {
        const at = x + slot * 48;
        const movable = !this.ready && this.model.canRelease(member, stack.id);
        const tile = new ItemTile(this.scene, at, BAGS_Y + 108, {
          id: stack.id, count: stack.count, size: 42,
          selected: this.picked.kind === 'bag' && this.picked.member === member && this.picked.id === stack.id,
          locked: !movable,
          onActivate: () => { this.picked = { kind: 'bag', member, id: stack.id }; this.render(); },
          drag: movable ? { controller: this.drag, payload: { id: stack.id, from: `bag:${member}` } } : undefined,
        });
        this.add(tile);
        this.focus.add(tile, `bag:${member}:${stack.id}`, at, BAGS_Y + 108, 42, 42);
      });
      if (stacks.length === 0) this.text(x, BAGS_Y + 116, 'Bag empty', width - 88, 12);
      if (pages > 1) {
        this.chip(x + width - 78, BAGS_Y + 110, 34, '<', () => {
          this.bagPages.set(member, (page + pages - 1) % pages); this.render();
        });
        this.chip(x + width - 38, BAGS_Y + 110, 34, '>', () => {
          this.bagPages.set(member, (page + 1) % pages); this.render();
        });
      }
    });
  }

  private dragPick(payload: DragPayload): LootPick {
    return payload.from.startsWith('bag:')
      ? { kind: 'bag', member: Number(payload.from.slice(4)), id: payload.id }
      : { kind: 'loot', entry: Number(payload.from) };
  }

  private canPut(picked: LootPick, member: number): boolean {
    return !this.ready && (picked.kind === 'loot' ? this.model.canTake(picked.entry, member)
      : this.model.canMove(picked.member, member, picked.id));
  }

  private put(picked: LootPick, member: number): void {
    if (!this.canPut(picked, member)) {
      playSound('ui.deny');
      this.refresh('That item does not fit in this bag.');
      return;
    }
    this.leaving = false;
    if (picked.kind === 'loot') this.model.take(picked.entry, member);
    else this.model.move(picked.member, member, picked.id);
  }

  private release(picked: LootPick): void {
    if (this.ready || picked.kind !== 'bag' || !this.model.canRelease(picked.member, picked.id)) return;
    this.leaving = false;
    this.model.release(picked.member, picked.id);
  }

  private finish(): void {
    if (this.closed || this.ready) return;
    if (this.model.confirmLeave !== false && !this.leaving && this.model.entries.some((entry) => entry.count > 0)) {
      this.leaving = true;
      this.message = 'Unclaimed items will be left behind.';
      this.render();
      return;
    }
    this.model.done();
  }

  private drawSource(reveal: boolean): void {
    const source = this.scene.add.container(776, 112);
    this.add(source);
    const art = this.scene.add.graphics();
    source.add(art);
    if (this.model.source === 'chest') {
      art.fillStyle(0x171d19).fillRect(-42, -18, 84, 42);
      art.fillStyle(0x8c5f38).fillRect(-38, -12, 76, 34);
      art.fillStyle(0xe1bb65).fillRect(-30, -12, 7, 34).fillRect(23, -12, 7, 34);
      art.fillStyle(0xffe4a0).fillRect(-6, -14, 12, 13);
      const lid = this.scene.add.rectangle(0, -22, 84, 17, 0xb48349).setStrokeStyle(3, 0xe1bb65);
      source.add(lid);
      if (!isReducedMotion()) {
        this.scene.tweens.add({ targets: lid, y: -40, angle: -12, duration: 420, ease: 'Back.Out' });
        this.animated.push(lid);
      } else lid.setY(-40).setAngle(-12);
    } else {
      art.lineStyle(5, 0xdfe6d8);
      if (this.model.source === 'combat') {
        art.lineBetween(-23, -24, 23, 20).lineBetween(23, -24, -23, 20);
        art.lineStyle(5, 0xd6b96a).lineBetween(-28, 6, -10, 24).lineBetween(28, 6, 10, 24);
      } else {
        art.strokeCircle(-6, -8, 20).lineBetween(9, 8, 28, 27);
      }
    }
    if (reveal && !isReducedMotion()) {
      source.setAlpha(0);
      this.scene.tweens.add({ targets: source, alpha: 1, duration: 220 });
      this.animated.push(source);
    }
  }

  private shine(tile: ItemTile, color: number, offset: number): void {
    const rim = this.scene.add.graphics().lineStyle(2, color, 0.8).strokeRect(-3, -3, SIZE + 6, SIZE + 6);
    const glint = this.scene.add.graphics();
    glint.fillStyle(0xffffff).fillRect(-7, -1, 14, 2).fillRect(-1, -7, 2, 14);
    glint.fillStyle(color).fillRect(-3, -3, 6, 6);
    glint.setPosition(SIZE - 5, 5);
    tile.add([rim, glint]);
    if (isReducedMotion()) return;
    this.scene.tweens.add({ targets: rim, alpha: 0.25, duration: 1100, delay: offset * 90, yoyo: true, repeat: -1 });
    this.scene.tweens.add({ targets: glint, alpha: 0.1, scaleX: 0.4, scaleY: 0.4,
      duration: 760, delay: offset * 120, yoyo: true, repeat: -1 });
    this.animated.push(rim, glint);
  }
}