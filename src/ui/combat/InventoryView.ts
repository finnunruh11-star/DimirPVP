// The inventory in a fight, opened with [I]: a paper doll of what is worn and
// held, the bag as a grid, and a card for the selected item with its actions.
// Equipping and stowing cost a bonus action, so anything that loses an item asks
// first. The Status Effects tab lists what is riding on the mage.

import Phaser from 'phaser';
import { playSound } from '../../audio';
import { getItem, WORN_SLOTS, type ItemId } from '../../core/Items';
import { SceneInput } from '../../engine/SceneInput';
import { CabinetButton, CabinetChip } from '../cabinet/controls';
import { MENU_COLOR, MENU_FONT, MENU_HEX, addCabinetBackdrop, addSectionRule } from '../cabinet/theme';
import {
  addEmptyCard,
  addItemCard,
  addKeyHints,
  addPanel,
  addPaperDoll,
  ConfirmDialog,
  dollAccepts,
  dollEntries,
  DOLL_LABEL,
  DragController,
  drawSocket,
  gridSpot,
  ItemTile,
  SpatialFocus,
  TILE,
  TILE_PITCH,
  type DialogKey,
  type Direction,
  type DollEntry,
  type DollSlot,
  type DragPayload,
  type DropTarget,
} from '../inventory/kit';
import { compareItems } from '../inventory/itemInfo';
import { addJourneyStrip, type JourneyView } from '../pve/JourneyStrip';

export type InventoryActionKind = 'consume' | 'throw' | 'hex' | 'equip' | 'swap-hands' | 'unequip' | 'drop-hand' | 'drop-accessory' | 'pouch-store' | 'pouch-remove';

export interface InventoryActionView {
  kind: InventoryActionKind;
  label: string;
  tone?: 'normal' | 'positive' | 'danger';
  /** Ask before acting: what is about to happen and the button that does it. */
  confirm?: { title: string; body: string; label: string };
}

export interface InventoryItemView {
  id: ItemId;
  name: string;
  location: string;
  detail: string;
  actions: InventoryActionView[];
  /** How many of it this row stands for. */
  count?: number;
  /** A small plate on its tile: POUCH, READY. */
  tag?: string;
}

export interface InventoryStatusView {
  name: string;
  duration: string;
  detail: string;
}

export interface InventorySnapshot {
  mageName: string;
  carry: string;
  readOnly: boolean;
  offhandOnly?: boolean;
  equipment: InventoryItemView[];
  supplies: InventoryItemView[];
  statuses: InventoryStatusView[];
  /** On an exploration run: the day and hour, and the party's level. */
  journey?: JourneyView;
}

export interface InventoryActions {
  perform(kind: InventoryActionKind, id: ItemId, replace?: ItemId, hand?: 'main' | 'off'): void;
  close(): void;
  tabChanged?(tab: string): void;
}

type InventoryTab = 'items' | 'statuses';

const DOLL = { x: 58, y: 170, w: 300, h: 402 };
const BAG = { x: 376, y: 170, w: 470, h: 402 };
const CARD = { x: 864, y: 170, w: 358, h: 402 };
const COLUMNS = 7;
const ROWS = 5;
const PAGE = COLUMNS * ROWS;
const GRID = { x: BAG.x + Math.floor((BAG.w - (COLUMNS * TILE_PITCH - 6)) / 2), y: BAG.y + 42 };
const STATUS_PAGE = 8;

interface Selection {
  from: 'equipment' | 'supplies';
  index: number;
}

export class InventoryView extends Phaser.GameObjects.Container {
  private readonly sceneInput: SceneInput;
  private focus = new SpatialFocus();
  private tab: InventoryTab = 'items';
  private page = 0;
  private selection: Selection | null = null;
  private dialog: ConfirmDialog | null = null;
  private disposed = false;
  private renderQueued = false;
  private footerTitle?: Phaser.GameObjects.Text;
  private footerBody?: Phaser.GameObjects.Text;
  private primary: (() => void) | null = null;
  private readonly supplies: InventoryItemView[];
  private readonly drag: DragController;
  /** The doll as last drawn, to tell what a drop would displace. */
  private doll: DollEntry[] = [];

  constructor(
    scene: Phaser.Scene,
    private readonly snapshot: InventorySnapshot,
    private readonly actions: InventoryActions
  ) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(snapshot.readOnly ? 100 : 96);
    this.drag = new DragController(scene, this.depth + 5, (payload, target) => this.dropped(payload, target));
    this.supplies = snapshot.supplies
      .map((item, index) => ({ item, index }))
      .sort((a, b) => compareItems(a.item.id, b.item.id) || a.index - b.index)
      .map(({ item }) => item);
    this.sceneInput = new SceneInput(scene);
    const routed = (key: DialogKey, fallback: (event: KeyboardEvent) => void) => (event: KeyboardEvent): void => {
      if (this.disposed) return;
      if (this.dialog) this.dialog.key(key, event.shiftKey);
      else fallback(event);
    };
    const arrow = (direction: Direction) => (): void => this.focus.move(direction);
    this.sceneInput.bindKeys([
      { key: 'LEFT', capture: true, run: routed('LEFT', arrow('left')) },
      { key: 'UP', capture: true, run: routed('UP', arrow('up')) },
      { key: 'RIGHT', capture: true, run: routed('RIGHT', arrow('right')) },
      { key: 'DOWN', capture: true, run: routed('DOWN', arrow('down')) },
      { key: 'TAB', capture: true, run: routed('TAB', (event) => this.focus.cycle(event.shiftKey ? -1 : 1)) },
      { key: 'SPACE', capture: true, run: routed('SPACE', () => this.focus.activate()) },
      { key: 'ENTER', capture: true, run: routed('ENTER', () => this.focus.activate()) },
    ]);
    this.render();
  }

  override destroy(fromScene?: boolean): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dialog?.destroy();
    this.dialog = null;
    this.drag.destroy();
    this.sceneInput.destroy();
    super.destroy(fromScene);
  }

  /** Gear let go over a doll slot (put it on) or over the bag (take it off): ask first, it costs a bonus action. */
  private dropped(payload: DragPayload, target: DropTarget): void {
    if (this.dialog || this.disposed || this.snapshot.readOnly) return;
    const index = Number(payload.from.slice(payload.from.indexOf(':') + 1));
    if (target.key === 'bag') {
      const item = this.snapshot.equipment[index];
      const action = item?.actions.find((entry) => entry.kind === 'unequip');
      if (!item || !action) return;
      const confirm = action.confirm ?? { title: `Unequip ${item.name}?`, body: 'It goes back into your bag.', label: 'Unequip' };
      this.askBonus(item, action, confirm.title, confirm.body, confirm.label);
      return;
    }
    const slot = target.key.slice('doll:'.length) as DollSlot;
    if (payload.from.startsWith('equipment:')) {
      const held = this.snapshot.equipment[index];
      const source = this.doll.find((entry) => !entry.ghost && entry.id === held?.id)?.slot;
      if (held && source !== slot && (slot === 'main' || slot === 'off')) this.actions.perform('swap-hands', held.id);
      return;
    }
    const item = this.supplies[index];
    const action = item?.actions.find((entry) => entry.kind === 'equip');
    if (!item || !action) return;
    const occupant = this.doll.find((entry) => entry.slot === slot)?.id ?? null;
    const replace = occupant ?? undefined;
    const outgoing = getItem(item.id).twoHanded
      ? this.doll.filter((entry) => (entry.slot === 'main' || entry.slot === 'off') && entry.id && !entry.ghost).map((entry) => entry.id!)
      : replace ? [replace] : [];
    const swap = outgoing.map((id) => ` ${getItem(id).name}${getItem(id).torchCombats != null ? ' is put away (a used torch is destroyed).' : ' goes into your bag.'}`).join('');
    this.askBonus(item, action, `Equip ${item.name}?`, `It goes on in your ${DOLL_LABEL[slot].toLowerCase()} slot.${swap}`, 'Equip', replace, slot === 'main' || slot === 'off' ? slot : undefined);
  }

  private askBonus(item: InventoryItemView, action: InventoryActionView, title: string, body: string, label: string, replace?: ItemId, hand?: 'main' | 'off'): void {
    this.dialog = new ConfirmDialog(this.scene, this.depth + 5, {
      title,
      body: `${body}\n\nThis costs a bonus action.`,
      icon: item.id,
      choices: [{ label: `${label} (Bonus Action)`, tone: action.tone === 'danger' ? 'danger' : 'primary', run: () => this.actions.perform(action.kind, item.id, replace, hand) }],
      onClose: () => {
        this.dialog = null;
        if (!this.disposed) this.render();
      },
    });
  }

  /** Something the game refused: said in the footer until the next redraw. */
  notice(message: string): void {
    if (this.disposed) return;
    playSound('ui.deny');
    this.footerTitle?.setText('CANNOT DO THAT').setColor('#e6b55a');
    this.footerBody?.setText(message).setColor(MENU_HEX.bone);
  }

  /** Esc while a question is open answers it with "no"; true when it did. */
  consumeEscape(): boolean {
    if (!this.dialog) return false;
    this.dialog.key('ESC');
    return true;
  }

  private setTab(tab: InventoryTab): void {
    if (this.tab === tab) return;
    this.tab = tab;
    this.page = 0;
    playSound('ui.click');
    this.render();
    this.actions.tabChanged?.(tab);
  }

  private renderSoon(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    this.scene.time.delayedCall(0, () => {
      this.renderQueued = false;
      if (!this.disposed && !this.dialog) this.render();
    });
  }

  private select(selection: Selection | null, soon = false): void {
    if (this.selection?.from === selection?.from && this.selection?.index === selection?.index) return;
    this.selection = selection;
    if (soon) this.renderSoon();
    else this.render();
  }

  private render(): void {
    if (this.disposed) return;
    const keep = this.focus.currentKey;
    this.removeAll(true);
    this.focus = new SpatialFocus();
    this.drag.clearTargets();
    this.primary = null;
    const { scene, snapshot } = this;
    addCabinetBackdrop(scene, this);
    this.add([
      scene.add.text(58, 34, `${snapshot.mageName.toUpperCase()}`, {
        fontFamily: MENU_FONT.display, fontSize: '29px', fontStyle: 'bold', color: MENU_HEX.bone,
      }).setLetterSpacing(2),
      scene.add.text(60, 76, `INVENTORY  /  ${snapshot.carry}${snapshot.readOnly ? '  /  VIEW ONLY' : ''}`, {
        fontFamily: MENU_FONT.control, fontSize: '13px', fontStyle: 'bold',
        color: /OVERLOADED|Heavy/.test(snapshot.carry) ? '#e6b55a' : MENU_HEX.boneDim,
      }).setLetterSpacing(1),
    ]);
    if (snapshot.journey) addJourneyStrip(scene, this, 1222, 34, snapshot.journey);
    addSectionRule(scene, this, 58, 112, 1164);

    const tabs: [InventoryTab, string][] = [
      ['items', 'Items'],
      ['statuses', `Status Effects${snapshot.statuses.length ? `  (${snapshot.statuses.length})` : ''}`],
    ];
    tabs.forEach(([id, label], index) => {
      const x = 58 + index * 204;
      const chip = new CabinetChip(scene, x, 124, {
        width: 190,
        height: 34,
        label,
        tone: this.tab === id ? 'primary' : 'normal',
        onActivate: () => this.setTab(id),
      });
      this.add(chip);
      this.focus.add(chip, `tab:${id}`, x, 124, 190, 34);
    });
    if (!snapshot.readOnly) {
      this.add(scene.add.text(1222, 134, 'Equipping and stowing cost a bonus action.', {
        fontFamily: MENU_FONT.control, fontSize: '12px', color: MENU_HEX.brass,
      }).setOrigin(1, 0));
    }

    this.renderDoll();
    if (this.tab === 'statuses') this.renderStatuses();
    else {
      this.renderBag();
      this.renderCard();
    }
    this.renderFooter();
    this.focus.restore(keep ?? (this.tab === 'items' ? 'cell:0' : null));
  }

  private viewOf(selection: Selection | null): InventoryItemView | null {
    if (!selection) return null;
    return (selection.from === 'equipment' ? this.snapshot.equipment : this.supplies)[selection.index] ?? null;
  }

  private renderDoll(): void {
    const { scene, snapshot } = this;
    addPanel(scene, this, DOLL.x, DOLL.y, DOLL.w, DOLL.h, 'Worn & held', { caption: `${snapshot.equipment.length} items` });
    // Which equipment row fills which slot of the doll.
    const rows = snapshot.equipment.map((item, index) => ({ item, index, slot: getItem(item.id).slot }));
    const take = (slot: string): { item: InventoryItemView; index: number } | undefined => {
      const at = rows.findIndex((row) => row.slot === slot);
      return at >= 0 ? rows.splice(at, 1)[0] : undefined;
    };
    const bySlot = new Map<DollSlot, { item: InventoryItemView; index: number }>();
    for (const slot of WORN_SLOTS) {
      const row = take(slot);
      if (row) bySlot.set(slot, row);
    }
    const hands = [take('hand'), take('hand')].filter((row): row is NonNullable<typeof row> => !!row);
    const rings = [take('accessory'), take('accessory')].filter((row): row is NonNullable<typeof row> => !!row);
    if (hands[0]) bySlot.set(hands.length === 1 && snapshot.offhandOnly ? 'off' : 'main', hands[0]);
    if (hands[1]) bySlot.set('off', hands[1]);
    if (rings[0]) bySlot.set('ring1', rings[0]);
    if (rings[1]) bySlot.set('ring2', rings[1]);
    const wornId = (slot: DollSlot): ItemId | null => bySlot.get(slot)?.item.id ?? null;
    const entries = dollEntries({
      head: wornId('head'),
      torso: wornId('torso'),
      cape: wornId('cape'),
      gloves: wornId('gloves'),
      boots: wornId('boots'),
      hands: hands.map((row) => row.item.id),
      offhandOnly: snapshot.offhandOnly,
      accessories: rings.map((row) => row.item.id),
    });
    this.doll = entries;
    const live = !snapshot.readOnly;
    addPaperDoll(scene, this, DOLL.x + DOLL.w / 2, DOLL.y + 40, entries, (entry, x, y) => {
      const row = entry.ghost ? undefined : bySlot.get(entry.slot);
      const selection: Selection | null = row ? { from: 'equipment', index: row.index } : null;
      const stowable = !!row && row.item.actions.some((action) => action.kind === 'unequip');
      const tile = new ItemTile(scene, x, y, {
        id: entry.id,
        ghost: entry.ghost,
        tag: row && /bound/i.test(row.item.location) ? 'BOUND' : entry.id && getItem(entry.id).twoHanded ? '2H' : undefined,
        tagColor: row && /bound/i.test(row.item.location) ? 0xc9503f : undefined,
        selected: !!row && this.selection?.from === 'equipment' && this.selection.index === row.index,
        drag: live && stowable && row ? { controller: this.drag, payload: { id: row.item.id, from: `equipment:${row.index}` } } : undefined,
        onActivate: () => this.select(selection),
        onFocus: () => {
          if (this.focus.viaKeys && this.tab === 'items') this.select(selection, true);
        },
      });
      this.focus.add(tile, `doll:${entry.slot}`, x, y, TILE, TILE);
      if (live) {
        this.drag.addTarget({
          key: `doll:${entry.slot}`, x, y, w: TILE, h: TILE,
          accepts: (payload) => dollAccepts(entry.slot, payload.id) && (payload.from.startsWith('supplies:')
            || ((entry.slot === 'main' || entry.slot === 'off') && payload.from.startsWith('equipment:') && !getItem(payload.id).twoHanded)),
        });
      }
      return tile;
    });
    const extra = rows.length ? `Also worn: ${rows.map((row) => row.item.name).join(', ')}` : '';
    this.add(scene.add.text(DOLL.x + 16, DOLL.y + DOLL.h - 104, [
      extra,
      snapshot.readOnly ? 'View only.' : '',
    ].filter(Boolean).join('\n\n'), {
      fontFamily: MENU_FONT.body, fontSize: '12px', color: MENU_HEX.boneDim, wordWrap: { width: DOLL.w - 32 }, lineSpacing: 2,
    }));
  }

  private renderBag(): void {
    const { scene } = this;
    const items = this.supplies;
    const total = items.reduce((sum, item) => sum + (item.count ?? 1), 0);
    addPanel(scene, this, BAG.x, BAG.y, BAG.w, BAG.h, 'Bag & supplies', { caption: `${total} carried  /  sorted by kind` });
    const pages = Math.max(1, Math.ceil(items.length / PAGE));
    this.page = Math.min(this.page, pages - 1);
    const sockets = scene.add.graphics();
    this.add(sockets);
    for (let index = 0; index < PAGE; index++) {
      const at = gridSpot(GRID.x, GRID.y, COLUMNS, index);
      drawSocket(sockets, at.x, at.y);
    }
    items.slice(this.page * PAGE, (this.page + 1) * PAGE).forEach((item, offset) => {
      const index = this.page * PAGE + offset;
      const at = gridSpot(GRID.x, GRID.y, COLUMNS, offset);
      const selection: Selection = { from: 'supplies', index };
      const tile = new ItemTile(scene, at.x, at.y, {
        id: item.id,
        count: item.count,
        tag: item.tag,
        tagColor: item.tag === 'READY' ? 0x8fdfa0 : 0xa98b50,
        selected: this.selection?.from === 'supplies' && this.selection.index === index,
        drag: !this.snapshot.readOnly && item.actions.some((action) => action.kind === 'equip')
          ? { controller: this.drag, payload: { id: item.id, from: `supplies:${index}` } }
          : undefined,
        onActivate: () => this.select(selection),
        onFocus: () => {
          if (this.focus.viaKeys) this.select(selection, true);
        },
      });
      this.add(tile);
      this.focus.add(tile, `cell:${offset}`, at.x, at.y, TILE, TILE);
    });
    if (!this.snapshot.readOnly) {
      this.drag.addTarget({
        key: 'bag', x: BAG.x, y: BAG.y, w: BAG.w, h: BAG.h,
        accepts: (payload) => payload.from.startsWith('equipment:'),
      });
    }
    if (!items.length) {
      this.add(scene.add.text(BAG.x + BAG.w / 2, GRID.y + 150, 'The bag is empty.', {
        fontFamily: MENU_FONT.body, fontSize: '15px', color: MENU_HEX.boneDim, backgroundColor: '#0c0e0b', padding: { x: 8, y: 4 },
      }).setOrigin(0.5));
    }
    if (pages > 1) {
      const y = BAG.y + BAG.h - 38;
      for (const [label, step, x] of [['<  Prev', -1, BAG.x + 14], ['Next  >', 1, BAG.x + BAG.w - 104]] as const) {
        const chip = new CabinetChip(scene, x, y, {
          width: 90, height: 28, label,
          enabled: step < 0 ? this.page > 0 : this.page < pages - 1,
          onActivate: () => { this.page += step; this.render(); },
        });
        this.add(chip);
        this.focus.add(chip, `page:${step}`, x, y, 90, 28);
      }
    }
  }

  private renderCard(): void {
    const { scene } = this;
    addPanel(scene, this, CARD.x, CARD.y, CARD.w, CARD.h, 'Details', { fill: MENU_COLOR.woodDeep });
    const item = this.viewOf(this.selection);
    if (!item) {
      addEmptyCard(scene, this, CARD.x, CARD.y + 28, CARD.w, CARD.h - 28, 'Nothing selected', '');
      return;
    }
    const actions = this.snapshot.readOnly ? [] : item.actions.slice(0, 4);
    const rows = actions.length === 0 ? 0 : actions.length === 1 ? 1 : Math.ceil(actions.length / 2);
    const x = CARD.x + 16;
    const w = CARD.w - 32;
    const actionsTop = CARD.y + CARD.h - 14 - rows * 46;
    const def = getItem(item.id);
    addItemCard(scene, this, x, CARD.y + 42, w, actionsTop - 10, {
      id: item.id,
      eyebrow: item.location,
      lines: item.count && item.count > 1 ? [{ label: 'Carried', value: `${item.count}` }] : [],
      note: item.detail !== def.blurb ? item.detail : undefined,
      noteColor: MENU_HEX.verdigris,
    });
    const half = Math.floor((w - 10) / 2);
    actions.forEach((action, index) => {
      const wide = actions.length === 1 || (actions.length === 3 && index === 0);
      const slot = actions.length === 3 ? (index === 0 ? 0 : index + 1) : index;
      const row = Math.floor(slot / 2);
      const col = wide ? 0 : slot % 2;
      const bx = x + col * (half + 10);
      const by = actionsTop + row * 46;
      const bw = wide ? w : half;
      const run = (): void => this.act(item, action);
      const chip = new CabinetChip(scene, bx, by, {
        width: bw,
        height: 38,
        label: action.confirm ? `${action.label}...` : action.label,
        tone: action.tone === 'danger' ? 'danger' : action.tone === 'positive' ? 'positive' : 'normal',
        onActivate: run,
      });
      if (index === 0) this.primary = run;
      this.add(chip);
      this.focus.add(chip, `act:${index}`, bx, by, bw, 38);
    });
  }

  private act(item: InventoryItemView, action: InventoryActionView): void {
    if (this.dialog || this.snapshot.readOnly) return;
    const confirm = action.confirm;
    if (!confirm) {
      this.actions.perform(action.kind, item.id);
      return;
    }
    this.dialog = new ConfirmDialog(this.scene, this.depth + 5, {
      title: confirm.title,
      body: confirm.body,
      icon: item.id,
      choices: [{ label: confirm.label, tone: action.tone === 'danger' ? 'danger' : 'primary', run: () => this.actions.perform(action.kind, item.id) }],
      onClose: () => {
        this.dialog = null;
        if (!this.disposed) this.render();
      },
    });
  }

  private renderStatuses(): void {
    const { scene, snapshot } = this;
    const x = BAG.x;
    const w = CARD.x + CARD.w - BAG.x;
    addPanel(scene, this, x, BAG.y, w, BAG.h, 'Status effects', { caption: `${snapshot.statuses.length} active` });
    const pages = Math.max(1, Math.ceil(snapshot.statuses.length / STATUS_PAGE));
    this.page = Math.min(this.page, pages - 1);
    const visible = snapshot.statuses.slice(this.page * STATUS_PAGE, (this.page + 1) * STATUS_PAGE);
    if (!visible.length) {
      this.add(scene.add.text(x + w / 2, BAG.y + BAG.h / 2, 'No active status effects.', {
        fontFamily: MENU_FONT.body, fontSize: '15px', color: MENU_HEX.boneDim,
      }).setOrigin(0.5));
    }
    const colW = Math.floor((w - 40) / 2);
    visible.forEach((status, index) => {
      const bx = x + 14 + (index % 2) * (colW + 12);
      const by = BAG.y + 42 + Math.floor(index / 2) * 80;
      const button = new CabinetButton(scene, bx, by, {
        width: colW,
        height: 70,
        label: status.name,
        detail: status.duration,
        index: String(index + 1),
        onActivate: () => this.inspect(status.name, status.detail),
        onFocus: () => this.inspect(status.name, status.detail),
      });
      this.add(button);
      this.focus.add(button, `status:${index}`, bx, by, colW, 70);
    });
    if (pages > 1) {
      const y = BAG.y + BAG.h - 38;
      for (const [label, step, px] of [['<  Prev', -1, x + 14], ['Next  >', 1, x + w - 104]] as const) {
        const chip = new CabinetChip(scene, px, y, {
          width: 90, height: 28, label,
          enabled: step < 0 ? this.page > 0 : this.page < pages - 1,
          onActivate: () => { this.page += step; this.render(); },
        });
        this.add(chip);
        this.focus.add(chip, `spage:${step}`, px, y, 90, 28);
      }
    }
  }

  private inspect(title: string, detail: string): void {
    this.footerTitle?.setText(title.toUpperCase());
    this.footerBody?.setText(detail);
  }

  private renderFooter(): void {
    const { scene, snapshot } = this;
    const g = scene.add.graphics();
    g.fillStyle(MENU_COLOR.pitch, 1).fillRect(53, 583, 1174, 90);
    g.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(58, 588, 1164, 80);
    g.lineStyle(1, MENU_COLOR.brassDark, 0.72).strokeRect(58.5, 588.5, 1163, 79);
    this.add(g);
    this.footerTitle = scene.add.text(76, 596, this.tab === 'statuses' ? 'STATUS EFFECTS' : 'INVENTORY', {
      fontFamily: MENU_FONT.control, fontSize: '11px', fontStyle: 'bold', color: MENU_HEX.brassLight,
    }).setLetterSpacing(2);
    this.footerBody = scene.add.text(76, 613, '', {
      fontFamily: MENU_FONT.body, fontSize: '13px', color: MENU_HEX.boneDim,
      fixedWidth: 860, wordWrap: { width: 860 }, maxLines: 2,
    });
    this.add([this.footerTitle, this.footerBody]);
    addKeyHints(scene, this, 76, 648, [['Arrows', 'Move'], ['Enter', 'Press'], ['Tab', 'Next'], ['Esc / I', 'Close']]);
    const close = new CabinetChip(scene, 1010, 606, {
      width: 196,
      height: 44,
      label: snapshot.readOnly ? 'Return to Map' : 'Close Inventory',
      tone: 'primary',
      onActivate: this.actions.close,
    });
    this.add(close);
    this.focus.add(close, 'close', 1010, 606, 196, 44);
  }
}
