// A stall between two players: your pack on the left, both offers side by side
// in the middle, and the selected item explained on the right. Either side can
// change their offer until both accept; any change asks both to accept again.
// Arrows and stacks trade by the count, and a one-sided deal asks first.

import Phaser from 'phaser';
import { playSound } from '../../audio';
import { getItem, type ItemId } from '../../core/Items';
import type { Mage } from '../../core/Mage';
import { packFits } from '../../core/Pack';
import { SceneInput } from '../../engine/SceneInput';
import type { AdventureSession } from '../../net/AdventureSession';
import { MAX_TRADE_ITEMS } from '../../pve/exploration/council';
import { changesHands, itemWorth, memberIn, moneyLabel } from '../../pve/exploration/economy';
import type { ExplorationRun } from '../../pve/exploration/run';
import { CabinetChip } from '../cabinet/controls';
import { addCabinetBackdrop, addSectionRule, MENU_COLOR, MENU_FONT, MENU_HEX } from '../cabinet/theme';
import {
  addEmptyCard,
  addItemCard,
  addKeyHints,
  addMeter,
  addPanel,
  ConfirmDialog,
  drawSocket,
  gridSpot,
  ItemTile,
  SpatialFocus,
  TILE,
  TILE_PITCH,
  type CardLine,
  type DialogKey,
  type DialogOptions,
  type Direction,
} from '../inventory/kit';
import { carriedStacks, kg, stacksOf, type ItemStack } from '../inventory/itemInfo';

const PACK = { x: 58, y: 128, w: 412, h: 444 };
const MINE = { x: 488, y: 128, w: 406, h: 210 };
const THEIRS = { x: 488, y: 356, w: 406, h: 216 };
const CARD = { x: 912, y: 128, w: 310, h: 444 };
const PACK_COLUMNS = 6;
const PACK_ROWS = 5;
const OFFER_COLUMNS = 6;
const OFFER_ROWS = 2;

const tradeable = (id: ItemId): boolean => changesHands(getItem(id)) && !getItem(id).keyItem;

interface Picked {
  from: 'pack' | 'mine' | 'theirs';
  id: ItemId;
}

export class TradeView extends Phaser.GameObjects.Container {
  private readonly sceneInput: SceneInput;
  private readonly unsubscribe: (() => void)[];
  private focus = new SpatialFocus();
  private dialog: ConfirmDialog | null = null;
  private picked: Picked | null = null;
  private page = 0;
  private joined = false;
  private closed = false;
  private renderQueued = false;
  private message = '';
  private lastTheirs: string | null = null;
  private primary: (() => void) | null = null;

  constructor(
    scene: Phaser.Scene,
    private readonly session: AdventureSession,
    private readonly run: ExplorationRun,
    private readonly place: string,
    private readonly done: () => void,
  ) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(120);
    this.sceneInput = new SceneInput(scene);
    const routed = (key: DialogKey, fallback: (event: KeyboardEvent) => void) => (event: KeyboardEvent): void => {
      if (this.closed) return;
      if (this.dialog) this.dialog.key(key, event.shiftKey);
      else fallback(event);
    };
    const arrow = (direction: Direction) => (): void => this.focus.move(direction);
    this.sceneInput.bindKeys([
      { key: 'LEFT', capture: true, run: routed('LEFT', arrow('left')) },
      { key: 'RIGHT', capture: true, run: routed('RIGHT', arrow('right')) },
      { key: 'UP', capture: true, run: routed('UP', arrow('up')) },
      { key: 'DOWN', capture: true, run: routed('DOWN', arrow('down')) },
      { key: 'TAB', capture: true, run: routed('TAB', (event) => this.focus.cycle(event.shiftKey ? -1 : 1)) },
      { key: 'SPACE', capture: true, run: routed('SPACE', () => this.focus.activate()) },
      { key: 'ENTER', capture: true, run: routed('ENTER', () => this.focus.activate()) },
      { key: 'ESC', capture: true, run: routed('ESC', () => this.leave()) },
      { key: 'F', run: () => { if (!this.closed && !this.dialog) this.primary?.(); } },
    ]);
    this.unsubscribe = [session.on('x-council', () => this.render()), session.on('x-run', () => this.render())];
    this.render();
  }

  override destroy(fromScene?: boolean): void {
    if (!this.closed) this.closed = true;
    for (const off of this.unsubscribe) off();
    this.dialog?.destroy();
    this.dialog = null;
    this.sceneInput.destroy();
    super.destroy(fromScene);
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.done();
  }

  /** Close the stall for both sides; nothing moves. */
  private leave(): void {
    this.session.say({ op: 'trade-cancel' });
    playSound('ui.back');
    this.finish();
  }

  private renderSoon(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    this.scene.time.delayedCall(0, () => {
      this.renderQueued = false;
      if (!this.closed && !this.dialog) this.render();
    });
  }

  private pick(picked: Picked, soon = false): void {
    if (this.picked?.from === picked.from && this.picked.id === picked.id) return;
    this.picked = picked;
    if (soon) this.renderSoon();
    else this.render();
  }

  private offer(items: ItemId[]): void {
    this.message = '';
    this.session.say({ op: 'trade-offer', items: items.slice(0, MAX_TRADE_ITEMS) });
    playSound('ui.click');
  }

  // ---------------------------------------------------------------------------

  private render(): void {
    if (this.closed) return;
    const trade = this.session.council.trade;
    const me = this.session.localSeat;
    const mineHere = !!trade && trade.place === this.place && (trade.by === me || trade.with === me);
    if (!mineHere && (this.joined || (trade && (trade.place !== this.place || trade.with != null)))) {
      this.finish();
      return;
    }
    if (this.dialog) return;
    const keep = this.focus.currentKey;
    this.removeAll(true);
    this.focus = new SpatialFocus();
    this.primary = null;
    const { scene } = this;
    addCabinetBackdrop(scene, this);
    this.add(scene.add.text(58, 34, 'PLAYER TRADE', {
      fontFamily: MENU_FONT.display, fontSize: '30px', fontStyle: 'bold', color: MENU_HEX.bone,
    }).setLetterSpacing(3));
    addSectionRule(scene, this, 58, 116, 1164);

    if (!trade || !mineHere) {
      this.add(scene.add.text(640, 330, 'Opening trade...', {
        fontFamily: MENU_FONT.display, fontSize: '22px', color: MENU_HEX.boneDim,
      }).setOrigin(0.5));
      this.footer(null, false, false);
      this.focus.restore(keep);
      return;
    }
    this.joined = true;
    const other = trade.by === me ? trade.with : trade.by;
    const mine = trade.offers[me] ?? [];
    const theirs = other == null ? [] : trade.offers[other] ?? [];
    const theirsKey = JSON.stringify(theirs);
    if (this.lastTheirs != null && this.lastTheirs !== theirsKey && other != null) {
      this.message = `${this.session.nameOf(other)} changed their offer.`;
      playSound('ui.hover');
    }
    this.lastTheirs = theirsKey;
    const owner = this.session.member ? memberIn(this.run, this.session.member) : undefined;

    this.add(scene.add.text(60, 78, other == null
      ? 'Waiting for another player to join.'
      : `Trading with ${this.session.nameOf(other)}. Both must accept.`, {
      fontFamily: MENU_FONT.body, fontSize: '14px', color: MENU_HEX.boneDim,
    }));
    if (owner) this.header(owner, mine, theirs);

    this.renderPack(owner, mine);
    this.renderOffer(MINE, 'Your offer', mine, 'mine', trade.ready[me], other != null);
    this.renderOffer(THEIRS, other == null ? 'Their offer' : `${this.session.nameOf(other)} offers`, theirs, 'theirs', other != null && trade.ready[other], other != null);
    this.renderCard(owner, mine, theirs);
    const fits = !owner || this.fits(owner, mine, theirs);
    this.footer(other, trade.ready[me], fits, mine, theirs);
    this.focus.restore(keep);
  }

  private fits(owner: Mage, mine: readonly ItemId[], theirs: readonly ItemId[]): boolean {
    const gain = theirs.reduce((sum, id) => sum + getItem(id).weight, 0) - mine.reduce((sum, id) => sum + getItem(id).weight, 0);
    return packFits(owner, theirs, mine) && owner.canCarry(gain);
  }

  private header(owner: Mage, mine: readonly ItemId[], theirs: readonly ItemId[]): void {
    const cap = owner.carryCap();
    const finite = Number.isFinite(cap);
    const now = owner.carriedWeight();
    const gain = theirs.reduce((sum, id) => sum + getItem(id).weight, 0) - mine.reduce((sum, id) => sum + getItem(id).weight, 0);
    const after = now + gain;
    const over = finite && after > cap + 1e-6;
    addMeter(this.scene, this, 660, 44, 260, 'LOAD AFTER TRADE',
      `${kg(Math.max(0, after))} / ${finite ? kg(cap) : '\u221E'} kg${gain ? `  (${gain > 0 ? '+' : ''}${kg(gain)})` : ''}`,
      finite ? after / Math.max(1, cap) : 0, 0xb08d4a, { warn: over });
    const room = packFits(owner, theirs, mine);
    this.add(this.scene.add.text(940, 44, room ? 'BAG OK' : 'BAG FULL', {
      fontFamily: MENU_FONT.control, fontSize: '11px', fontStyle: 'bold', color: room ? MENU_HEX.verdigris : '#e6866f',
    }).setLetterSpacing(2));
  }

  private renderPack(owner: Mage | undefined, mine: readonly ItemId[]): void {
    const { scene } = this;
    const stacks = owner ? carriedStacks(owner) : [];
    const offered = new Map<ItemId, number>();
    for (const id of mine) offered.set(id, (offered.get(id) ?? 0) + 1);
    addPanel(scene, this, PACK.x, PACK.y, PACK.w, PACK.h, 'Your bag');
    const perPage = PACK_COLUMNS * PACK_ROWS;
    const pages = Math.max(1, Math.ceil(stacks.length / perPage));
    this.page = Math.min(this.page, pages - 1);
    const gx = PACK.x + Math.floor((PACK.w - (PACK_COLUMNS * TILE_PITCH - 6)) / 2);
    const gy = PACK.y + 44;
    const sockets = scene.add.graphics();
    this.add(sockets);
    for (let index = 0; index < perPage; index++) {
      const at = gridSpot(gx, gy, PACK_COLUMNS, index);
      drawSocket(sockets, at.x, at.y);
    }
    stacks.slice(this.page * perPage, (this.page + 1) * perPage).forEach((stack, index) => {
      const at = gridSpot(gx, gy, PACK_COLUMNS, index);
      const left = stack.count - (offered.get(stack.id) ?? 0);
      const can = tradeable(stack.id);
      const tile = new ItemTile(scene, at.x, at.y, {
        id: stack.id,
        count: Math.max(0, left),
        locked: !can || left <= 0,
        tag: !can ? undefined : left <= 0 ? 'OFFERED' : offered.has(stack.id) ? `-${offered.get(stack.id)}` : undefined,
        tagColor: 0x6e9e91,
        selected: this.picked?.from !== 'theirs' && this.picked?.id === stack.id,
        onActivate: () => this.pick({ from: 'pack', id: stack.id }),
        onFocus: () => {
          if (this.focus.viaKeys) this.pick({ from: 'pack', id: stack.id }, true);
        },
      });
      this.add(tile);
      this.focus.add(tile, `pack:${index}`, at.x, at.y, TILE, TILE);
    });
    if (pages > 1) {
      const y = PACK.y + PACK.h - 40;
      for (const [label, step, x] of [['<  Prev', -1, PACK.x + 14], ['Next  >', 1, PACK.x + PACK.w - 104]] as const) {
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

  private renderOffer(box: typeof MINE, title: string, items: readonly ItemId[], from: 'mine' | 'theirs', accepted: boolean, partner: boolean): void {
    const { scene } = this;
    const stacks = stacksOf(items);
    const weight = items.reduce((sum, id) => sum + getItem(id).weight, 0);
    const worth = items.reduce((sum, id) => sum + itemWorth(getItem(id)), 0);
    addPanel(scene, this, box.x, box.y, box.w, box.h, title, {
      caption: !partner ? '' : accepted ? 'ACCEPTED' : 'deciding...',
      captionColor: accepted ? '#8fdfa0' : MENU_HEX.boneDim,
      fill: accepted ? 0x1b2e22 : undefined,
    });
    const gx = box.x + Math.floor((box.w - (OFFER_COLUMNS * TILE_PITCH - 6)) / 2);
    const gy = box.y + 42;
    const sockets = scene.add.graphics();
    this.add(sockets);
    const cells = OFFER_COLUMNS * OFFER_ROWS;
    for (let index = 0; index < cells; index++) {
      const at = gridSpot(gx, gy, OFFER_COLUMNS, index);
      drawSocket(sockets, at.x, at.y);
    }
    stacks.slice(0, cells).forEach((stack, index) => {
      const at = gridSpot(gx, gy, OFFER_COLUMNS, index);
      const tile = new ItemTile(scene, at.x, at.y, {
        id: stack.id,
        count: stack.count,
        selected: this.picked?.from === from && this.picked.id === stack.id,
        onActivate: () => this.pick({ from, id: stack.id }),
        onFocus: () => {
          if (this.focus.viaKeys) this.pick({ from, id: stack.id }, true);
        },
      });
      this.add(tile);
      this.focus.add(tile, `${from}:${index}`, at.x, at.y, TILE, TILE);
    });
    if (stacks.length > cells) {
      this.add(scene.add.text(box.x + box.w - 14, gy + 2 * TILE_PITCH - 2, `+${stacks.length - cells} more kinds`, {
        fontFamily: MENU_FONT.control, fontSize: '11px', color: MENU_HEX.boneDim,
      }).setOrigin(1, 0));
    }
    if (!stacks.length) {
      this.add(scene.add.text(box.x + box.w / 2, gy + TILE_PITCH - 3, from === 'mine' ? 'Nothing offered.' : partner ? 'Nothing offered yet.' : '', {
        fontFamily: MENU_FONT.body, fontSize: '13px', color: MENU_HEX.boneDim, backgroundColor: '#0c0e0b', padding: { x: 8, y: 4 },
      }).setOrigin(0.5));
    }
    this.add(scene.add.text(box.x + 14, box.y + box.h - 24, `${items.length} item${items.length === 1 ? '' : 's'}  /  ${kg(weight)} kg  /  worth ${moneyLabel(worth)}`, {
      fontFamily: MENU_FONT.control, fontSize: '12px', fontStyle: 'bold', color: MENU_HEX.brassLight,
    }));
  }

  private renderCard(owner: Mage | undefined, mine: readonly ItemId[], theirs: readonly ItemId[]): void {
    const { scene } = this;
    addPanel(scene, this, CARD.x, CARD.y, CARD.w, CARD.h, 'Details', { fill: MENU_COLOR.woodDeep });
    const picked = this.picked;
    const carried = owner ? carriedStacks(owner) : [];
    const have = (id: ItemId): number => carried.find((stack: ItemStack) => stack.id === id)?.count ?? 0;
    const offered = (id: ItemId): number => mine.filter((entry) => entry === id).length;
    const valid = picked && (picked.from === 'theirs' ? theirs.includes(picked.id) : have(picked.id) > 0);
    if (!picked || !valid) {
      addEmptyCard(scene, this, CARD.x, CARD.y + 28, CARD.w, CARD.h - 28, 'Nothing selected', '');
      return;
    }
    const id = picked.id;
    const def = getItem(id);
    const x = CARD.x + 14;
    const w = CARD.w - 28;
    const lines: CardLine[] = [];
    let note: string | undefined;
    if (picked.from === 'theirs') {
      const count = theirs.filter((entry) => entry === id).length;
      lines.push({ label: 'Offered to you', value: `${count}` });
      lines.push({ label: 'Weight', value: `${kg(def.weight * count)} kg` });
      lines.push({ label: 'Worth', value: moneyLabel(itemWorth(def) * count) });
      addItemCard(scene, this, x, CARD.y + 42, w, CARD.y + CARD.h - 14, { id, eyebrow: 'In their offer', lines });
      return;
    }
    const count = have(id);
    const out = offered(id);
    const left = count - out;
    const can = tradeable(id);
    lines.push({ label: 'Carried', value: `${count}` });
    lines.push({ label: 'In your offer', value: `${out}`, color: out ? '#8fdfa0' : undefined });
    lines.push({ label: 'Worth', value: `${moneyLabel(itemWorth(def))}${count > 1 ? ' each' : ''}` });
    if (!can) note = def.keyItem ? 'Key item. Cannot be traded.' : `${def.name} cannot be traded.`;
    else if (mine.length >= MAX_TRADE_ITEMS) note = 'Your offer is full.';
    addItemCard(scene, this, x, CARD.y + 42, w, CARD.y + CARD.h - 150, {
      id, eyebrow: picked.from === 'mine' ? 'In your offer' : 'In your bag', lines, note, noteColor: '#e6866f',
    });

    const room = MAX_TRADE_ITEMS - mine.length;
    const add = (n: number): void => {
      const take = Math.min(n, left, room);
      if (take <= 0) return;
      this.offer([...mine, ...Array.from({ length: take }, () => id)]);
    };
    const takeBack = (n: number): void => {
      const next = [...mine];
      for (let k = 0; k < n; k++) {
        const at = next.lastIndexOf(id);
        if (at < 0) break;
        next.splice(at, 1);
      }
      this.offer(next);
    };
    const canAdd = can && left > 0 && room > 0;
    const top = CARD.y + CARD.h - 138;
    const half = Math.floor((w - 8) / 2);
    const buttons: [string, string, number, number, number, boolean, 'primary' | 'normal' | 'danger', () => void][] = [
      ['add1', 'Offer 1   [F]', x, top, w, canAdd, 'primary', () => add(1)],
      ['addN', 'Offer Some...', x, top + 46, half, canAdd && left > 1, 'normal', () => this.askOffer(id, Math.min(left, room), add)],
      ['addAll', `Offer All (${Math.max(0, Math.min(left, room))})`, x + half + 8, top + 46, half, canAdd, 'normal', () => add(left)],
      ['back1', 'Take Back 1', x, top + 92, half, out > 0, 'normal', () => takeBack(1)],
      ['backAll', 'Take Back All', x + half + 8, top + 92, half, out > 0, 'normal', () => takeBack(out)],
    ];
    if (picked.from === 'mine' && out > 0) {
      buttons[0] = ['back1', 'Take Back 1   [F]', x, top, w, true, 'primary', () => takeBack(1)];
      buttons[3] = ['add1', 'Offer 1 More', x, top + 92, half, canAdd, 'normal', () => add(1)];
    }
    this.primary = buttons[0][5] ? buttons[0][7] : null;
    for (const [key, label, bx, by, bw, enabled, tone, run] of buttons) {
      const chip = new CabinetChip(scene, bx, by, { width: bw, height: 38, label, tone: enabled ? tone : 'normal', enabled, onActivate: run });
      this.add(chip);
      this.focus.add(chip, `act:${key}`, bx, by, bw, 38);
    }
  }

  private askOffer(id: ItemId, max: number, add: (n: number) => void): void {
    const def = getItem(id);
    this.openDialog({
      title: `Offer ${def.name}`,
      body: 'How many?',
      icon: id,
      quantity: { max, start: max, describe: (n) => `Offer ${n}${def.weight > 0 ? `  /  ${kg(def.weight * n)} kg` : ''}` },
      choices: [{ label: 'Offer', tone: 'primary', run: (n) => add(n) }],
      onClose: () => this.render(),
    });
  }

  private openDialog(options: DialogOptions): void {
    if (this.dialog) return;
    this.dialog = new ConfirmDialog(this.scene, this.depth + 5, {
      ...options,
      onClose: () => {
        this.dialog = null;
        options.onClose();
      },
    });
  }

  private accept(other: number, mine: readonly ItemId[], theirs: readonly ItemId[]): void {
    this.message = '';
    if (!theirs.length) {
      const names = stacksOf(mine).slice(0, 4).map((stack) => `${stack.count > 1 ? `${stack.count}x ` : ''}${getItem(stack.id).name}`).join(', ');
      this.openDialog({
        title: 'Give it away?',
        body: `${this.session.nameOf(other)} offers nothing back. Accepting gives away ${names}${stacksOf(mine).length > 4 ? ', and more' : ''}.`,
        choices: [{ label: 'Give Away', tone: 'primary', run: () => this.session.say({ op: 'trade-ready' }) }],
        cancelLabel: 'Not Yet',
        onClose: () => this.render(),
      });
      return;
    }
    playSound('ui.confirm');
    this.session.say({ op: 'trade-ready' });
  }

  private footer(other: number | null, ready: boolean, fits: boolean, mine: readonly ItemId[] = [], theirs: readonly ItemId[] = []): void {
    const { scene } = this;
    const g = scene.add.graphics();
    g.fillStyle(MENU_COLOR.pitch, 1).fillRect(53, 583, 1174, 90);
    g.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(58, 588, 1164, 80);
    g.lineStyle(1, MENU_COLOR.brassDark, 0.72).strokeRect(58.5, 588.5, 1163, 79);
    this.add(g);
    const status = other == null ? 'Waiting for another player.'
      : !fits ? 'Their offer does not fit in your bag or weight limit.'
      : ready ? `You accepted. Waiting for ${this.session.nameOf(other)}.`
      : !mine.length && !theirs.length ? 'Both offers are empty.'
      : '';
    const title = this.message ? 'NOTE' : 'TRADE';
    this.add([
      scene.add.text(76, 596, title, {
        fontFamily: MENU_FONT.control, fontSize: '11px', fontStyle: 'bold', color: this.message ? '#e6b55a' : MENU_HEX.brassLight,
      }).setLetterSpacing(2),
      scene.add.text(76, 613, this.message || status, {
        fontFamily: MENU_FONT.body, fontSize: '13px', color: this.message || !fits ? MENU_HEX.bone : MENU_HEX.boneDim,
        fixedWidth: 760, wordWrap: { width: 760 }, maxLines: 2,
      }),
    ]);
    addKeyHints(scene, this, 76, 648, [['Arrows', 'Move'], ['F', 'Offer / take back'], ['Enter', 'Press'], ['Esc', 'Close trade']]);
    const canAccept = other != null && !ready && fits && (mine.length > 0 || theirs.length > 0);
    const accept = new CabinetChip(scene, 866, 604, {
      width: 196,
      height: 46,
      label: ready ? 'Accepted' : 'Accept Trade',
      tone: canAccept ? 'positive' : 'normal',
      selected: ready,
      enabled: canAccept,
      onActivate: () => { if (other != null) this.accept(other, mine, theirs); },
    });
    const close = new CabinetChip(scene, 1074, 604, {
      width: 132,
      height: 46,
      label: 'Close Trade',
      tone: 'danger',
      onActivate: () => this.leave(),
    });
    this.add([accept, close]);
    this.focus.add(accept, 'accept', 866, 604, 196, 46);
    this.focus.add(close, 'close', 1074, 604, 132, 46);
  }
}
