// The counter of a town shop, opened by talking to its keeper. One window for
// every trade: tabs appear for whatever the shop does (buy, sell, rest,
// bounties, forge, runes). Buying and selling lay the wares and your goods out
// as tiles with their prices, explain the one selected, and ask how many before
// anything is sold.

import Phaser from 'phaser';
import { playSound } from '../../audio';
import { getItem, type ItemId } from '../../core/Items';
import type { Mage } from '../../core/Mage';
import { packCapacity, packFits, packSlotsUsed } from '../../core/Pack';
import { SceneInput } from '../../engine/SceneInput';
import {
  bountyBoard,
  bountyProgress,
  canClaim,
  MAX_ACTIVE_BOUNTIES,
} from '../../pve/exploration/bounties';
import {
  carriedCount,
  craftersIn,
  itemWorth,
  memberIn,
  moneyLabel,
  partyHasCodex,
  partyOf,
  roomPrice,
  runeOffers,
  sellPrice,
  shopStock,
  type StockSlot,
} from '../../pve/exploration/economy';
import { bloodmoonDue } from '../../pve/exploration/bloodmoon';
import type { RestNap } from '../../pve/exploration/nap';
import type { ExplorationActions, ExplorationIntent } from '../../pve/exploration/intents';
import { partyXpScale } from '../../pve/exploration/coop';
import type { ExplorationRun } from '../../pve/exploration/run';
import type { ShopDef } from '../../pve/exploration/shops';
import { CabinetButton, CabinetChip } from '../cabinet/controls';
import { addCabinetBackdrop, addRecess, addSectionRule, MENU_COLOR, MENU_FONT, MENU_HEX } from '../cabinet/theme';
import {
  addEmptyCard,
  addItemCard,
  addKeyHints,
  addMeter,
  addPanel,
  addPursePlate,
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
import { carriedStacks, FILTERS, kg, matchesFilter, type ItemFilter } from '../inventory/itemInfo';
import { CraftingView } from './CraftingView';

type Tab = 'buy' | 'sell' | 'rest' | 'bounties' | 'forge' | 'runes';

const TAB_LABEL: Record<Tab, string> = {
  buy: 'Buy',
  sell: 'Sell',
  rest: 'Rest',
  bounties: 'Bounties',
  forge: 'Forge',
  runes: 'Runes',
};

const PER_PAGE = 8;
const LIST = { x: 58, y: 186, w: 790, h: 382 };
const CARD = { x: 866, y: 186, w: 356, h: 382 };
const COLUMNS = 11;
const ROW_PITCH = 84;
const WARE_ROWS = 3;
const GRID_X = LIST.x + Math.floor((LIST.w - (COLUMNS * TILE_PITCH - 6)) / 2);

export interface ShopViewHooks {
  /** The run changed: save it and refresh the HUD. */
  changed(): void;
  close(): void;
  /** The party has slept here: play the night. It saves the run and closes the window itself. */
  slept?(nap: RestNap): void;
  /** Keeper portrait texture key (two-frame sheet). */
  portrait?: string;
  townId: string;
  actions: ExplorationActions;
  /** Online: a night is everyone's or nobody's, so the Rest tab calls for one and joins it. */
  inn?: InnHooks;
  /**
   * A free short rest at the inn. Alone it happens at once and says how it went;
   * online the others are asked to join, the window closes and it returns null.
   */
  shortRest?(): string | null;
}

export interface InnCallView {
  /** Who called for the night. */
  by: string;
  /** The call is for this counter. */
  here: boolean;
  /** This player has said yes. */
  joined: boolean;
  waitingFor: string[];
}

export interface InnHooks {
  call(): InnCallView | null;
  propose(): void;
  answer(join: boolean): void;
}

interface RowEntry {
  label: string;
  detail: string;
  enabled: boolean;
  run: () => void;
  inspect?: string;
}

export class ShopView extends Phaser.GameObjects.Container {
  private readonly sceneInput: SceneInput;
  private focus = new SpatialFocus();
  private tabs: Tab[];
  private tab: Tab;
  private page = 0;
  private filter: ItemFilter = 'all';
  private message = '';
  private messageOk = true;
  private armedAbandon: string | null = null;
  private disposed = false;
  private working = false;
  private renderQueued = false;
  /** The ware (by stock key) or carried item selected on the Buy and Sell tabs. */
  private picked: string | null = null;
  private dialog: ConfirmDialog | null = null;
  private inspectorTitle!: Phaser.GameObjects.Text;
  private inspectorBody!: Phaser.GameObjects.Text;
  private primary: (() => void) | null = null;
  /** The crafting bench, open over the counter. */
  private bench: CraftingView | null = null;

  constructor(
    scene: Phaser.Scene,
    private readonly run: ExplorationRun,
    private readonly shop: ShopDef,
    private readonly hooks: ShopViewHooks,
  ) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(120);
    this.tabs = this.openTabs();
    this.tab = hooks.inn?.call()?.here && this.tabs.includes('rest') ? 'rest' : this.tabs[0] ?? 'sell';
    this.sceneInput = new SceneInput(scene);
    const free = (): boolean => !this.bench && !this.disposed;
    const routed = (key: DialogKey, fallback: (event: KeyboardEvent) => void) => (event: KeyboardEvent): void => {
      if (!free()) return;
      if (this.dialog) this.dialog.key(key, event.shiftKey);
      else fallback(event);
    };
    const plain = (run: () => void) => (): void => {
      if (free() && !this.dialog) run();
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
      { key: 'ESC', capture: true, run: routed('ESC', () => { if (!this.working) this.hooks.close(); }) },
      { key: 'Q', run: plain(() => this.cycleTab(-1)) },
      { key: 'E', run: plain(() => this.cycleTab(1)) },
      { key: 'F', run: plain(() => this.primary?.()) },
    ]);
    this.render();
  }

  override destroy(fromScene?: boolean): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dialog?.destroy();
    this.dialog = null;
    this.bench?.destroy();
    this.bench = null;
    this.sceneInput.destroy();
    super.destroy(fromScene);
  }

  /** What this counter offers. */
  private openTabs(): Tab[] {
    const { shop } = this;
    return [
      ...(shop.stock ? (['buy'] as const) : []),
      ...(shop.buys.length ? (['sell'] as const) : []),
      ...(shop.services.includes('rest') ? (['rest'] as const) : []),
      ...(shop.services.includes('bounties') ? (['bounties'] as const) : []),
      ...(shop.services.includes('forge') ? (['forge'] as const) : []),
      ...(shop.services.includes('runes') ? (['runes'] as const) : []),
    ];
  }

  private cycleTab(step: number): void {
    const next = this.tabs[(this.tabs.indexOf(this.tab) + step + this.tabs.length) % this.tabs.length];
    if (next && next !== this.tab) this.setTab(next);
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    this.page = 0;
    this.picked = null;
    this.armedAbandon = null;
    playSound('ui.click');
    this.render();
  }

  private async apply(intent: ExplorationIntent): Promise<void> {
    if (this.working) return;
    this.working = true;
    const result = await this.hooks.actions.apply(intent);
    this.working = false;
    if (this.disposed) return;
    this.message = result.message;
    this.messageOk = result.ok;
    playSound(result.ok ? 'ui.confirm' : 'ui.deny');
    if (result.ok) this.hooks.changed();
    this.render();
  }

  /** Redraw from the run as it now stands (another player's change landed). */
  refresh(): void {
    if (this.disposed) return;
    if (this.bench) this.bench.refresh();
    else if (!this.working && !this.dialog) this.render();
  }

  /** Take the rooms. The night plays out and the window goes with it, so it stays busy from here on. */
  private async sleep(): Promise<void> {
    if (this.working) return;
    this.working = true;
    const from = { day: this.run.day, hour: this.run.hour };
    const result = await this.hooks.actions.apply({ op: 'rest', shop: this.shop.id });
    if (this.disposed) return;
    if (result.ok && this.hooks.slept) {
      this.hooks.slept({ from, to: { day: this.run.day, hour: this.run.hour }, bloodmoon: bloodmoonDue(this.run), message: result.message });
      return;
    }
    this.working = false;
    this.message = result.message;
    this.messageOk = result.ok;
    playSound(result.ok ? 'ui.confirm' : 'ui.deny');
    if (result.ok) this.hooks.changed();
    this.render();
  }

  private get member() {
    return this.hooks.actions.member;
  }

  /** A fixed XP reward as a party of this size is paid it. */
  private xp(base: number): number {
    return Math.round(base * partyXpScale(this.run));
  }

  private renderSoon(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    this.scene.time.delayedCall(0, () => {
      this.renderQueued = false;
      if (!this.disposed && !this.dialog) this.render();
    });
  }

  private pick(key: string, soon = false): void {
    if (this.picked === key) return;
    this.picked = key;
    if (soon) this.renderSoon();
    else this.render();
  }

  private render(): void {
    if (this.disposed) return;
    const keep = this.focus.currentKey;
    this.removeAll(true);
    this.focus = new SpatialFocus();
    this.primary = null;
    const { scene, run, shop } = this;
    this.tabs = this.openTabs();
    if (!this.tabs.includes(this.tab)) this.tab = this.tabs[0] ?? 'sell';
    addCabinetBackdrop(scene, this);

    if (this.hooks.portrait && scene.textures.exists(this.hooks.portrait)) {
      const face = scene.add.image(96, 88, this.hooks.portrait, 0).setScale(5).setOrigin(0.5, 0.75);
      this.add(face);
    }
    const leader = memberIn(run, this.member);
    const who = leader && partyOf(run).length > 1 ? `  /  ${leader.name} at the counter` : '';
    this.add([
      scene.add.text(150, 36, shop.name.toUpperCase(), {
        fontFamily: MENU_FONT.display, fontSize: '29px', fontStyle: 'bold', color: MENU_HEX.bone,
      }).setLetterSpacing(1),
      scene.add.text(152, 78, `${shop.sign}  /  Day ${run.day}${who}`, {
        fontFamily: MENU_FONT.body, fontSize: '14px', color: MENU_HEX.boneDim,
      }),
    ]);
    if (leader) {
      const cap = leader.carryCap();
      const weight = leader.carriedWeight();
      const finite = Number.isFinite(cap);
      const used = packSlotsUsed(leader);
      const room = packCapacity(leader);
      addMeter(scene, this, 660, 40, 170, 'LOAD', `${kg(weight)} / ${finite ? kg(cap) : '\u221E'} kg`,
        finite ? weight / Math.max(1, cap) : 0, 0xb08d4a, { warn: leader.overloaded() });
      addMeter(scene, this, 660, 74, 170, 'SLOTS', `${used} / ${Number.isFinite(room) ? room : '\u221E'}`,
        Number.isFinite(room) ? used / Math.max(1, room) : 0.1, 0x4d7c70, { warn: used > room });
    }
    addPursePlate(scene, this, 856, 52, moneyLabel(run.gold));
    addSectionRule(scene, this, 58, 116, 1164);

    this.tabs.forEach((tab, index) => {
      const x = 58 + index * 190;
      const chip = new CabinetChip(scene, x, 132, {
        width: 176,
        height: 38,
        label: TAB_LABEL[tab],
        tone: this.tab === tab ? 'primary' : 'normal',
        onActivate: () => this.setTab(tab),
      });
      this.add(chip);
      this.focus.add(chip, `tab:${tab}`, x, 132, 176, 38);
    });

    const g = scene.add.graphics();
    g.fillStyle(MENU_COLOR.pitch, 1).fillRect(53, 581, 1174, 92);
    g.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(58, 586, 1164, 82);
    g.lineStyle(1, MENU_COLOR.brassDark, 0.72).strokeRect(58.5, 586.5, 1163, 81);
    this.add(g);
    this.inspectorTitle = scene.add.text(76, 596, this.message ? (this.messageOk ? 'DONE' : 'NOTE') : shop.name.toUpperCase(), {
      fontFamily: MENU_FONT.control, fontSize: '11px', fontStyle: 'bold',
      color: this.message ? (this.messageOk ? MENU_HEX.verdigris : '#e6b55a') : MENU_HEX.brassLight,
    }).setLetterSpacing(2);
    this.inspectorBody = scene.add.text(76, 613, this.message || 'Select a ware or one of your goods to see it. Selling always asks how many first.', {
      fontFamily: MENU_FONT.body, fontSize: '13px', color: this.message ? MENU_HEX.bone : MENU_HEX.boneDim,
      fixedWidth: 860, wordWrap: { width: 860 }, maxLines: 2,
    });
    addKeyHints(scene, this, 76, 648, [['Arrows', 'Move'], ['F', this.tab === 'sell' ? 'Sell' : this.tab === 'buy' ? 'Buy' : 'Act'], ['Q / E', 'Tabs'], ['Esc', 'Leave']]);
    const close = new CabinetChip(scene, 990, 606, {
      width: 212,
      height: 44,
      label: 'Leave Counter',
      tone: 'primary',
      onActivate: () => this.hooks.close(),
    });
    this.add([this.inspectorTitle, this.inspectorBody, close]);

    switch (this.tab) {
      case 'buy': this.renderBuy(leader); break;
      case 'sell': this.renderSell(leader); break;
      case 'rest': this.renderRest(); break;
      case 'bounties': this.renderBounties(); break;
      case 'forge': this.renderForge(); break;
      case 'runes': this.renderRunes(); break;
    }
    this.focus.add(close, 'close', 990, 606, 212, 44);
    this.focus.restore(keep);
  }

  private inspect(title: string, body: string): void {
    this.inspectorTitle.setText(title.toUpperCase()).setColor(MENU_HEX.brassLight);
    this.inspectorBody.setText(body).setColor(MENU_HEX.boneDim);
  }

  // ---------------------------------------------------------------------------
  //  BUY
  // ---------------------------------------------------------------------------

  /** Why `leader` cannot take `slot` home, if they cannot. */
  private buyProblem(leader: Mage | undefined, slot: StockSlot): string | null {
    const def = getItem(slot.id);
    if (slot.sold) return 'Sold out until tomorrow.';
    if (!leader) return 'Nobody at the counter.';
    if (this.run.gold < slot.price) return `Not enough money: ${moneyLabel(slot.price - this.run.gold)} short.`;
    if (def.keyItem && partyOf(this.run).some((mage) => mage.bag.includes(slot.id) || mage.utility.includes(slot.id))) return 'The party already has one.';
    if (!leader.canCarry(def.weight * slot.qty)) return 'Too heavy to carry on top of your load.';
    if (!packFits(leader, Array.from({ length: slot.qty }, () => slot.id))) return 'No room in the pack.';
    return null;
  }

  private renderBuy(leader: Mage | undefined): void {
    const { scene } = this;
    const stock = shopStock(this.run, this.shop);
    addPanel(scene, this, LIST.x, LIST.y, LIST.w, LIST.h, 'Wares', { caption: `${stock.filter((slot) => !slot.sold).length} on the shelf today` });
    const perPage = COLUMNS * WARE_ROWS;
    const pages = Math.max(1, Math.ceil(stock.length / perPage));
    this.page = Math.min(this.page, pages - 1);
    const shown = stock.slice(this.page * perPage, (this.page + 1) * perPage);
    const top = LIST.y + 48;
    const shelf = scene.add.graphics();
    this.add(shelf);
    for (let index = 0; index < perPage; index++) {
      const at = gridSpot(GRID_X, top, COLUMNS, index, ROW_PITCH);
      drawSocket(shelf, at.x, at.y);
    }
    shown.forEach((slot, index) => {
      const at = gridSpot(GRID_X, top, COLUMNS, index, ROW_PITCH);
      const affordable = this.run.gold >= slot.price;
      const tile = new ItemTile(scene, at.x, at.y, {
        id: slot.id,
        count: slot.qty,
        locked: slot.sold,
        tag: slot.sold ? 'SOLD' : undefined,
        tagColor: 0x8a8070,
        price: slot.sold ? '-' : moneyLabel(slot.price),
        priceColor: slot.sold ? MENU_HEX.disabled : affordable ? '#f0d27a' : '#d07a68',
        selected: this.picked === `ware:${slot.key}`,
        onActivate: () => this.pick(`ware:${slot.key}`),
        onFocus: () => {
          if (this.focus.viaKeys) this.pick(`ware:${slot.key}`, true);
        },
      });
      this.add(tile);
      this.focus.add(tile, `ware:${index}`, at.x, at.y, TILE, TILE);
    });
    if (stock.length === 0) this.emptyNote('The shelves are bare today.');
    this.pager(pages);

    addPanel(scene, this, CARD.x, CARD.y, CARD.w, CARD.h, 'Details', { fill: MENU_COLOR.woodDeep });
    const slot = stock.find((entry) => this.picked === `ware:${entry.key}`);
    if (!slot) {
      addEmptyCard(scene, this, CARD.x, CARD.y + 28, CARD.w, CARD.h - 28, 'Browse the shelf', 'Select a ware to see what it does and what it costs.');
      return;
    }
    const def = getItem(slot.id);
    const problem = this.buyProblem(leader, slot);
    const lines: CardLine[] = [
      { label: 'Price', value: `${moneyLabel(slot.price)}${slot.qty > 1 ? ` for ${slot.qty}` : ''}`, color: this.run.gold >= slot.price ? '#f0d27a' : '#d07a68' },
      { label: 'Weight', value: `${kg(def.weight * slot.qty)} kg` },
      { label: 'You carry', value: leader ? `${carriedCount(leader, slot.id) + (leader.equippedItems().filter((id) => id === slot.id).length)}` : '-' },
    ];
    const x = CARD.x + 16;
    const w = CARD.w - 32;
    addItemCard(scene, this, x, CARD.y + 42, w, CARD.y + CARD.h - 62, {
      id: slot.id,
      eyebrow: slot.sold ? 'Sold out' : 'For sale',
      lines,
      note: problem ?? undefined,
      noteColor: '#e6866f',
    });
    const buy = (): void => {
      if (problem || this.working) {
        playSound('ui.deny');
        return;
      }
      void this.apply({ op: 'buy', shop: this.shop.id, key: slot.key });
    };
    const button = new CabinetChip(scene, x, CARD.y + CARD.h - 52, {
      width: w,
      height: 40,
      label: slot.sold ? 'Sold Out' : `Buy for ${moneyLabel(slot.price)}   [F]`,
      tone: problem ? 'normal' : 'primary',
      enabled: !problem,
      onActivate: buy,
    });
    this.primary = buy;
    this.add(button);
    this.focus.add(button, 'act:buy', x, CARD.y + CARD.h - 52, w, 40);
  }

  // ---------------------------------------------------------------------------
  //  SELL
  // ---------------------------------------------------------------------------

  private renderSell(leader: Mage | undefined): void {
    const { scene, shop } = this;
    const stacks = leader ? carriedStacks(leader) : [];
    const priced = stacks.map((stack) => {
      const def = getItem(stack.id);
      const unit = def.keyItem || def.permanentlyBinding ? 0 : sellPrice(shop, def);
      return { ...stack, unit };
    });
    const shown = priced.filter((entry) => matchesFilter(entry.id, this.filter));
    const sellable = shown.filter((entry) => entry.unit > 0);
    addPanel(scene, this, LIST.x, LIST.y, LIST.w, LIST.h, 'Your goods', {
      caption: `${priced.filter((entry) => entry.unit > 0).length} kinds this counter will buy  /  worn gear must be stowed first`,
    });

    const chipW = 96;
    FILTERS.forEach((entry, index) => {
      const x = LIST.x + 14 + index * (chipW + 6);
      const chip = new CabinetChip(scene, x, LIST.y + 38, {
        width: chipW,
        height: 28,
        label: entry.label,
        selected: this.filter === entry.id,
        tone: this.filter === entry.id ? 'positive' : 'normal',
        onActivate: () => {
          if (this.filter === entry.id) return;
          this.filter = entry.id;
          this.page = 0;
          this.render();
        },
      });
      this.add(chip);
      this.focus.add(chip, `filter:${entry.id}`, x, LIST.y + 38, chipW, 28);
    });
    const total = sellable.reduce((sum, entry) => sum + entry.unit * entry.count, 0);
    const bulkX = LIST.x + LIST.w - 14 - 210;
    const bulk = new CabinetChip(scene, bulkX, LIST.y + 38, {
      width: 210,
      height: 28,
      label: `Sell All Shown...  ${total > 0 ? moneyLabel(total) : ''}`,
      tone: 'danger',
      enabled: sellable.length > 0,
      onActivate: () => this.askSellAll(sellable.map((entry) => ({ id: entry.id, count: entry.count, unit: entry.unit }))),
    });
    this.add(bulk);
    this.focus.add(bulk, 'sell-all', bulkX, LIST.y + 38, 210, 28);

    const perPage = COLUMNS * 3;
    const pages = Math.max(1, Math.ceil(shown.length / perPage));
    this.page = Math.min(this.page, pages - 1);
    const top = LIST.y + 80;
    const shelf = scene.add.graphics();
    this.add(shelf);
    for (let index = 0; index < perPage; index++) {
      const at = gridSpot(GRID_X, top, COLUMNS, index, ROW_PITCH - 6);
      drawSocket(shelf, at.x, at.y);
    }
    shown.slice(this.page * perPage, (this.page + 1) * perPage).forEach((entry, index) => {
      const at = gridSpot(GRID_X, top, COLUMNS, index, ROW_PITCH - 6);
      const tile = new ItemTile(scene, at.x, at.y, {
        id: entry.id,
        count: entry.count,
        locked: entry.unit <= 0,
        price: entry.unit > 0 ? moneyLabel(entry.unit) : 'no',
        priceColor: entry.unit > 0 ? '#f0d27a' : MENU_HEX.disabled,
        selected: this.picked === `own:${entry.id}`,
        onActivate: () => this.pick(`own:${entry.id}`),
        onFocus: () => {
          if (this.focus.viaKeys) this.pick(`own:${entry.id}`, true);
        },
      });
      this.add(tile);
      this.focus.add(tile, `own:${index}`, at.x, at.y, TILE, TILE);
    });
    if (shown.length === 0) this.emptyNote(stacks.length ? 'Nothing of this kind in your pack.' : 'Your pack is empty.');
    this.pager(pages);

    addPanel(scene, this, CARD.x, CARD.y, CARD.w, CARD.h, 'Details', { fill: MENU_COLOR.woodDeep });
    const entry = priced.find((stack) => this.picked === `own:${stack.id}`);
    if (!entry) {
      addEmptyCard(scene, this, CARD.x, CARD.y + 28, CARD.w, CARD.h - 28, 'What will you part with?', 'Select one of your goods to see what the keeper offers for it.');
      return;
    }
    const def = getItem(entry.id);
    const worth = itemWorth(def);
    const lines: CardLine[] = [
      { label: 'Offer', value: entry.unit > 0 ? `${moneyLabel(entry.unit)}${entry.count > 1 ? ' each' : ''}` : 'Not bought here', color: entry.unit > 0 ? '#f0d27a' : '#d07a68' },
      { label: 'Carried', value: `${entry.count}` },
      { label: 'Worth', value: `${moneyLabel(worth)}${entry.count > 1 ? ' each' : ''}` },
    ];
    if (entry.count > 1 && entry.unit > 0) lines.push({ label: 'For all', value: moneyLabel(entry.unit * entry.count), color: '#f0d27a' });
    const reason = def.keyItem ? 'A key item. It stays with the party.'
      : def.permanentlyBinding ? 'Bound to you. It cannot be sold.'
      : entry.unit <= 0 ? 'This counter does not buy it. Another trade might.' : undefined;
    const x = CARD.x + 16;
    const w = CARD.w - 32;
    addItemCard(scene, this, x, CARD.y + 42, w, CARD.y + CARD.h - 62, {
      id: entry.id, eyebrow: 'In your pack', lines, note: reason, noteColor: '#e6866f',
    });
    const sell = (): void => {
      if (entry.unit <= 0 || this.working) {
        playSound('ui.deny');
        return;
      }
      this.askSell(entry.id, entry.count, entry.unit);
    };
    const button = new CabinetChip(scene, x, CARD.y + CARD.h - 52, {
      width: w,
      height: 40,
      label: entry.unit > 0 ? 'Sell...   [F]' : 'Not Bought Here',
      tone: entry.unit > 0 ? 'danger' : 'normal',
      enabled: entry.unit > 0,
      onActivate: sell,
    });
    this.primary = sell;
    this.add(button);
    this.focus.add(button, 'act:sell', x, CARD.y + CARD.h - 52, w, 40);
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

  private askSell(id: ItemId, count: number, unit: number): void {
    const def = getItem(id);
    const total = (n: number): string => moneyLabel(unit * n);
    this.openDialog({
      title: `Sell ${def.name}?`,
      body: `${this.shop.name} pays ${moneyLabel(unit)}${count > 1 ? ' each' : ''}. A sale is final.`,
      icon: id,
      quantity: count > 1 ? { max: count, start: 1, describe: (n) => `Sell ${n} for ${total(n)}` } : undefined,
      choices: [{ label: count > 1 ? 'Sell' : `Sell for ${total(1)}`, tone: 'danger', run: (n) => void this.apply({ op: 'sell', shop: this.shop.id, item: id, count: n }) }],
      onClose: () => this.render(),
    });
  }

  private askSellAll(entries: { id: ItemId; count: number; unit: number }[]): void {
    const total = entries.reduce((sum, entry) => sum + entry.unit * entry.count, 0);
    const items = entries.reduce((sum, entry) => sum + entry.count, 0);
    const names = entries.slice(0, 5).map((entry) => `${entry.count > 1 ? `${entry.count}x ` : ''}${getItem(entry.id).name}`).join(', ');
    this.openDialog({
      title: 'Sell everything shown?',
      body: `${items} item${items === 1 ? '' : 's'} for ${moneyLabel(total)}: ${names}${entries.length > 5 ? `, and ${entries.length - 5} more kinds` : ''}. Worn gear is never included. A sale is final.`,
      choices: [{ label: `Sell All for ${moneyLabel(total)}`, tone: 'danger', run: () => void this.apply({ op: 'sell-all', shop: this.shop.id, items: entries.map((entry) => entry.id) }) }],
      onClose: () => this.render(),
    });
  }

  private emptyNote(text: string): void {
    this.add(this.scene.add.text(LIST.x + LIST.w / 2, LIST.y + LIST.h / 2, text, {
      fontFamily: MENU_FONT.body, fontSize: '16px', color: MENU_HEX.boneDim,
    }).setOrigin(0.5));
  }

  private pager(pages: number): void {
    if (pages <= 1) return;
    const y = LIST.y + LIST.h - 38;
    for (const [label, step, x] of [['<  Prev', -1, LIST.x + 14], ['Next  >', 1, LIST.x + LIST.w - 104]] as const) {
      const chip = new CabinetChip(this.scene, x, y, {
        width: 90,
        height: 28,
        label,
        enabled: step < 0 ? this.page > 0 : this.page < pages - 1,
        onActivate: () => { this.page += step; this.render(); },
      });
      this.add(chip);
      this.focus.add(chip, `page:${step}`, x, y, 90, 28);
    }
    this.add(this.scene.add.text(LIST.x + LIST.w / 2, y + 7, `PAGE ${this.page + 1} / ${pages}`, {
      fontFamily: MENU_FONT.control, fontSize: '10px', fontStyle: 'bold', color: MENU_HEX.brass,
    }).setOrigin(0.5, 0).setLetterSpacing(2));
  }

  // ---------------------------------------------------------------------------
  //  SERVICES
  // ---------------------------------------------------------------------------

  private rows(entries: RowEntry[]): void {
    addRecess(this.scene, this, 58, 186, 1164, 382);
    const pages = Math.max(1, Math.ceil(entries.length / PER_PAGE));
    this.page = Math.min(this.page, pages - 1);
    const visible = entries.slice(this.page * PER_PAGE, (this.page + 1) * PER_PAGE);
    visible.forEach((entry, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = 76 + column * 572;
      const y = 200 + row * 84;
      const button = new CabinetButton(this.scene, x, y, {
        width: 556,
        height: 76,
        label: entry.label,
        detail: entry.detail.split('\n')[0],
        index: String(index + 1),
        enabled: entry.enabled,
        onActivate: entry.run,
        onFocus: () => this.inspect(entry.label, entry.inspect ?? entry.detail),
      });
      this.add(button);
      this.focus.add(button, `row:${index}`, x, y, 556, 76);
    });
    if (entries.length === 0) {
      this.add(this.scene.add.text(640, 360, 'Nothing here right now.', {
        fontFamily: MENU_FONT.body,
        fontSize: '16px',
        color: MENU_HEX.boneDim,
      }).setOrigin(0.5));
    }
    if (pages > 1) {
      const previous = new CabinetChip(this.scene, 450, 540, {
        width: 120,
        height: 30,
        label: 'Previous',
        enabled: this.page > 0,
        onActivate: () => { this.page -= 1; this.render(); },
      });
      const next = new CabinetChip(this.scene, 710, 540, {
        width: 120,
        height: 30,
        label: 'Next',
        enabled: this.page < pages - 1,
        onActivate: () => { this.page += 1; this.render(); },
      });
      const label = this.scene.add.text(640, 546, `${this.page + 1} / ${pages}`, {
        fontFamily: MENU_FONT.control,
        fontSize: '12px',
        color: MENU_HEX.boneDim,
      }).setOrigin(0.5, 0);
      this.add([previous, next, label]);
      this.focus.add(previous, 'page:-1', 450, 540, 120, 30);
      this.focus.add(next, 'page:1', 710, 540, 120, 30);
    }
  }

  /** A wide service button in the middle of the counter. */
  private service(key: string, y: number, height: number, options: Omit<ConstructorParameters<typeof CabinetButton>[3], 'width' | 'height'>): void {
    const button = new CabinetButton(this.scene, 290, y, { width: 700, height, ...options });
    this.add(button);
    this.focus.add(button, key, 290, y, 700, height);
  }

  private renderRest(): void {
    addRecess(this.scene, this, 58, 186, 1164, 382);
    if (this.hooks.inn) {
      this.renderInnCall(this.hooks.inn);
      return;
    }
    const price = roomPrice(this.run, this.shop) ?? 0;
    const party = partyOf(this.run);
    const leader = memberIn(this.run, this.member);
    const vitals = leader
      ? leader.alive
        ? `Health ${leader.hp}/${leader.maxHp}  /  Mana ${leader.mana}/${leader.maxMana}  /  Sanity ${leader.sanity}/${leader.maxSanity}`
        : `${leader.name} has fallen and gets up after a night here.`
      : '';
    const leads = this.hooks.actions.leads;
    const rooms = party.length > 1 ? `Rooms for the party (${party.length})` : 'A room for the night';
    const due = bloodmoonDue(this.run);
    this.service('rest', 204, 104, {
      label: `${rooms}  /  ${moneyLabel(price)}`,
      detail: due ? 'The bloodmoon is up. Nobody sleeps through it.' : leads ? '' : 'The host books the rooms for the party.',
      index: '1',
      enabled: leads && !due && this.run.gold >= price,
      onActivate: () => void this.sleep(),
    });
    this.add(this.scene.add.text(640, 420, vitals, {
      fontFamily: MENU_FONT.control,
      fontSize: '15px',
      color: MENU_HEX.bone,
    }).setOrigin(0.5, 0));
    this.addShortRest(322, '2', leads ? null : 'The host decides when the party rests.');
  }

  /** The free short rest, under the rooms: `blocked` says why it cannot be had from here. */
  private addShortRest(y: number, index: string, blocked: string | null): void {
    const rest = this.hooks.shortRest;
    if (!rest) return;
    const online = !!this.hooks.inn;
    this.service('short-rest', y, 76, {
      label: 'Short rest at a table  /  free',
      detail: blocked ?? (online ? 'The others are asked to join.' : ''),
      index,
      enabled: !blocked && !this.working,
      onActivate: () => {
        if (this.working) return;
        const said = rest();
        if (this.disposed) return;
        if (said) {
          this.message = said;
          this.messageOk = true;
        }
        this.render();
      },
    });
  }

  /** Online: call the party in for the night, or answer a call that is out. */
  private renderInnCall(inn: InnHooks): void {
    const price = roomPrice(this.run, this.shop) ?? 0;
    const party = partyOf(this.run);
    const due = bloodmoonDue(this.run);
    const call = inn.call();
    const rooms = `Rooms for the party (${party.length})  /  ${moneyLabel(price)}`;
    let buttons = 0;
    let note: string;
    if (!call) {
      note = 'A night needs everyone. Whoever calls for it pays from the purse; the rest join for free.';
      this.service('inn:1', 230, 96, {
        label: `Call the party in: ${rooms}`,
        detail: due ? 'The bloodmoon is up. Nobody sleeps through it.' : 'Everyone is told. The night starts once all of you have joined here.',
        index: '1',
        enabled: !due && this.run.gold >= price,
        onActivate: () => {
          playSound('ui.confirm');
          inn.propose();
          this.render();
        },
      });
      buttons = 1;
    } else if (!call.here) {
      note = `${call.by} has asked for rooms at another inn. Go there to join, or turn it down.`;
      this.service('inn:1', 230, 72, { label: 'Not tonight', detail: 'Turn the night down: nobody rests.', index: '1', onActivate: () => inn.answer(false) });
      buttons = 1;
    } else if (call.joined) {
      note = call.waitingFor.length
        ? `You're in. Waiting for ${call.waitingFor.join(' and ')} to come to the keeper.`
        : 'Everyone is in. Lights out.';
      this.service('inn:1', 230, 72, { label: 'Changed my mind', detail: 'Call the night off for everyone.', index: '1', onActivate: () => inn.answer(false) });
      buttons = 1;
    } else {
      note = `${call.by} wants to stay the night. ${call.waitingFor.length ? `Still to join: ${call.waitingFor.join(', ')}.` : ''}`;
      this.service('inn:1', 210, 72, {
        label: 'Join the night (free)', detail: rooms, index: '1',
        onActivate: () => {
          playSound('ui.confirm');
          inn.answer(true);
        },
      });
      this.service('inn:2', 294, 72, { label: 'Not tonight', detail: 'Nobody rests unless everyone does.', index: '2', onActivate: () => inn.answer(false) });
      buttons = 2;
    }
    this.add(this.scene.add.text(640, 470, note, {
      fontFamily: MENU_FONT.control,
      fontSize: '15px',
      color: MENU_HEX.bone,
      align: 'center',
      wordWrap: { width: 700 },
    }).setOrigin(0.5, 0));
    this.addShortRest(378, String(buttons + 1), null);
  }

  private renderBounties(): void {
    const town = this.hooks.townId;
    const entries: RowEntry[] = [];
    for (const bounty of this.run.bounties) {
      const progress = bountyProgress(this.run, bounty);
      const claimable = canClaim(this.run, town, bounty);
      const where = bounty.kind === 'deliver' ? `Deliver at ${bounty.target}` : `Claim at ${bounty.town}`;
      const armed = this.armedAbandon === bounty.id;
      entries.push({
        label: claimable ? `Claim: ${bounty.label}` : armed ? `Abandon? ${bounty.label}` : bounty.label,
        detail: `${progress}/${bounty.count}  /  ${moneyLabel(bounty.rewardGold)}, ${this.xp(bounty.rewardXp)} XP  /  ${where}`,
        enabled: true,
        run: () => {
          if (claimable) {
            void this.apply({ op: 'bounty-claim', town, id: bounty.id });
          } else if (armed) {
            this.armedAbandon = null;
            void this.apply({ op: 'bounty-abandon', id: bounty.id });
          } else {
            this.armedAbandon = bounty.id;
            this.message = 'Choose it again to abandon this bounty.';
            this.messageOk = false;
            this.render();
          }
        },
      });
    }
    for (const offer of bountyBoard(this.run, town)) {
      entries.push({
        label: `Notice: ${offer.label}`,
        detail: `Reward ${moneyLabel(offer.rewardGold)}, ${this.xp(offer.rewardXp)} XP${offer.kind === 'deliver' ? '  /  the parcel is handed over now' : ''}`,
        enabled: this.run.bounties.length < MAX_ACTIVE_BOUNTIES,
        run: () => void this.apply({ op: 'bounty-accept', town, id: offer.id }),
      });
    }
    this.rows(entries);
  }

  /** Today's runes, offered by feel rather than by name, to a party with a Hex Codex. */
  private renderRunes(): void {
    if (!partyHasCodex(this.run)) {
      this.rows([{
        label: 'No Hex Codex',
        detail: 'The scribe sells runes only to a party that owns a Hex Codex. It is on the Buy tab.',
        enabled: false,
        run: () => undefined,
      }]);
      return;
    }
    this.rows(runeOffers(this.run, this.shop).map((offer) => ({
      label: offer.sold ? `${offer.hint}  /  learned` : `${offer.hint}  /  ${moneyLabel(offer.price)}`,
      detail: 'The scribe will not say more until it is paid for. Once learned, it lights up on the table with its name and what it becomes sealed.\n'
        + 'Each rune costs five silver more than the last. New runes are offered each day.',
      enabled: !offer.sold && this.run.gold >= offer.price,
      run: () => void this.apply({ op: 'hex-rune', shop: this.shop.id, rune: offer.rune }),
    })));
  }

  private renderForge(): void {
    addRecess(this.scene, this, 58, 186, 1164, 382);
    const crafters = craftersIn(this.run, this.member);
    const objects = partyOf(this.run).some((mage) => mage.spellClass === 'objects');
    this.service('forge', 214, 104, {
      label: 'Crafting bench',
      detail: crafters.length
        ? 'Design a sword, staff, bow or armour from your materials, pour in mana and roll for it.'
        : objects ? 'Only an Objects mage can craft, and only for themselves.' : 'Only an Objects mage can craft.',
      index: '1',
      enabled: crafters.length > 0,
      onActivate: () => this.openBench(),
    });
    this.add(this.scene.add.text(640, 350, [
      'Parts take materials (ores, hides, scales); sockets take focus pieces (gems, cores, fangs).',
      'Score = materials + mana (up to 10) + two d20, keep the higher. A 20 counts 22, a pair 26.',
      'The higher the score, the more effects the item draws from what its materials can lend.',
    ].join('\n'), {
      fontFamily: MENU_FONT.body,
      fontSize: '14px',
      color: MENU_HEX.boneDim,
      align: 'center',
      lineSpacing: 6,
    }).setOrigin(0.5, 0));
  }

  private openBench(): void {
    if (this.bench || this.working) return;
    playSound('ui.open');
    this.setVisible(false);
    const bench: CraftingView = new CraftingView(this.scene, this.run, this.shop, {
      actions: this.hooks.actions,
      changed: () => this.hooks.changed(),
      close: () => {
        if (this.bench !== bench) return;
        bench.destroy();
        this.bench = null;
        if (this.disposed) return;
        playSound('ui.close');
        this.setVisible(true);
        this.render();
      },
    });
    this.bench = bench;
  }
}
