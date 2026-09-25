// The counter of a town shop, opened by talking to its keeper. One window for
// every trade: tabs appear for whatever the shop does (buy, sell, rest,
// bounties, forge), and every action goes straight through the economy.

import Phaser from 'phaser';
import { playSound } from '../../audio';
import { GAME_WIDTH } from '../../config/constants';
import { getItem, RARITY_COLOR, type ItemDef, type ItemId, type Rarity } from '../../core/Items';
import { SceneInput } from '../../engine/SceneInput';
import {
  acceptBounty,
  abandonBounty,
  bountyBoard,
  bountyProgress,
  canClaim,
  claimBounty,
  MAX_ACTIVE_BOUNTIES,
} from '../../pve/exploration/bounties';
import {
  buyItem,
  forge,
  partyOf,
  recipesAt,
  rest,
  sellItem,
  sellOffers,
  shopStock,
  type ShopResult,
} from '../../pve/exploration/economy';
import type { ExplorationRun } from '../../pve/exploration/run';
import type { ShopDef } from '../../pve/exploration/shops';
import { CabinetButton, CabinetChip, MenuFocusGroup } from '../cabinet/controls';
import { addCabinetBackdrop, addRecess, addSectionRule, MENU_COLOR, MENU_FONT, MENU_HEX } from '../cabinet/theme';

type Tab = 'buy' | 'sell' | 'rest' | 'bounties' | 'forge';

const TAB_LABEL: Record<Tab, string> = {
  buy: 'Buy',
  sell: 'Sell',
  rest: 'Rest',
  bounties: 'Bounties',
  forge: 'Forge',
};

const RARITY_NAME: Record<Rarity, string> = {
  common: 'Common',
  consumeable: 'Consumable',
  rare: 'Rare',
  epic: 'Epic',
  unreal: 'Unreal',
  mythical: 'Mythical',
  legendary: 'Legendary',
  lareneg: 'Lareneg',
};

const SLOT_NAME: Record<ItemDef['slot'], string> = {
  hand: 'Hand',
  head: 'Head',
  torso: 'Torso',
  boots: 'Boots',
  accessory: 'Accessory',
  utility: 'Utility',
};

const PER_PAGE = 8;

export interface ShopViewHooks {
  /** The run changed: save it and refresh the HUD. */
  changed(): void;
  close(): void;
  /** Keeper portrait texture key (two-frame sheet). */
  portrait?: string;
  townId: string;
}

export function itemDetail(def: ItemDef): string {
  const kind = def.material ? 'Material' : SLOT_NAME[def.slot];
  return `${RARITY_NAME[def.rarity]} ${kind}  /  ${def.weight}kg\n${def.blurb}`;
}

export class ShopView extends Phaser.GameObjects.Container {
  private readonly sceneInput: SceneInput;
  private focus = new MenuFocusGroup();
  private readonly tabs: Tab[];
  private tab: Tab;
  private page = 0;
  private message = '';
  private armedAbandon: string | null = null;
  private disposed = false;
  private inspectorTitle!: Phaser.GameObjects.Text;
  private inspectorBody!: Phaser.GameObjects.Text;
  private header!: Phaser.GameObjects.Text;

  constructor(
    scene: Phaser.Scene,
    private readonly run: ExplorationRun,
    private readonly shop: ShopDef,
    private readonly hooks: ShopViewHooks,
  ) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(120);
    this.tabs = [
      ...(shop.stock ? (['buy'] as const) : []),
      ...(shop.buys.length ? (['sell'] as const) : []),
      ...(shop.services.includes('rest') ? (['rest'] as const) : []),
      ...(shop.services.includes('bounties') ? (['bounties'] as const) : []),
      ...(shop.services.includes('forge') ? (['forge'] as const) : []),
    ];
    this.tab = this.tabs[0] ?? 'sell';
    this.sceneInput = new SceneInput(scene);
    this.sceneInput.bindKeys([
      { key: 'LEFT', capture: true, run: () => this.focus.move(-1) },
      { key: 'UP', capture: true, run: () => this.focus.move(-1) },
      { key: 'RIGHT', capture: true, run: () => this.focus.move(1) },
      { key: 'DOWN', capture: true, run: () => this.focus.move(1) },
      { key: 'TAB', capture: true, run: (event) => this.focus.move(event.shiftKey ? -1 : 1) },
      { key: 'SPACE', capture: true, run: () => this.focus.activate() },
      { key: 'ENTER', capture: true, run: () => this.focus.activate() },
      { key: 'ESC', capture: true, run: () => this.hooks.close() },
      { key: 'Q', run: () => this.cycleTab(-1) },
      { key: 'E', run: () => this.cycleTab(1) },
    ]);
    this.render();
  }

  override destroy(fromScene?: boolean): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sceneInput.destroy();
    super.destroy(fromScene);
  }

  private cycleTab(step: number): void {
    const next = this.tabs[(this.tabs.indexOf(this.tab) + step + this.tabs.length) % this.tabs.length];
    if (next && next !== this.tab) this.setTab(next);
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    this.page = 0;
    this.armedAbandon = null;
    playSound('ui.click');
    this.render();
  }

  private apply(result: ShopResult): void {
    this.message = result.message;
    playSound(result.ok ? 'ui.confirm' : 'ui.deny');
    if (result.ok) this.hooks.changed();
    this.render();
  }

  private render(): void {
    this.removeAll(true);
    this.focus = new MenuFocusGroup();
    const { scene, run, shop } = this;
    addCabinetBackdrop(scene, this);

    if (this.hooks.portrait && scene.textures.exists(this.hooks.portrait)) {
      const face = scene.add.image(96, 88, this.hooks.portrait, 0).setScale(5).setOrigin(0.5, 0.75);
      this.add(face);
    }
    const title = scene.add.text(150, 42, shop.name.toUpperCase(), {
      fontFamily: MENU_FONT.display,
      fontSize: '29px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    });
    const leader = partyOf(run)[0];
    const carried = leader ? `${leader.carriedWeight().toFixed(1)}/${leader.carryCap()}kg` : '';
    this.header = scene.add.text(152, 82, `${shop.sign}  /  Day ${run.day}  /  Carrying ${carried}`, {
      fontFamily: MENU_FONT.body,
      fontSize: '14px',
      color: MENU_HEX.boneDim,
    });
    const gold = scene.add.text(1202, 50, `${run.gold}g`, {
      fontFamily: MENU_FONT.display,
      fontSize: '25px',
      fontStyle: 'bold',
      color: MENU_HEX.ink,
      backgroundColor: '#d8cbae',
      padding: { x: 16, y: 7 },
    }).setOrigin(1, 0);
    this.add([title, this.header, gold]);
    addSectionRule(scene, this, 58, 116, 1164);

    this.tabs.forEach((tab, index) => {
      const chip = new CabinetChip(scene, 58 + index * 190, 132, {
        width: 176,
        height: 38,
        label: TAB_LABEL[tab],
        tone: this.tab === tab ? 'primary' : 'normal',
        onActivate: () => this.setTab(tab),
      });
      this.add(chip);
      this.focus.add(chip);
    });

    addRecess(scene, this, 58, 186, 1164, 382);
    addRecess(scene, this, 58, 586, 1164, 82, MENU_COLOR.woodDeep);
    this.inspectorTitle = scene.add.text(76, 596, this.message ? 'LATEST' : shop.name.toUpperCase(), {
      fontFamily: MENU_FONT.control,
      fontSize: '11px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
    });
    this.inspectorBody = scene.add.text(76, 614, this.message || 'Q / E switch tabs. Esc leaves the counter.', {
      fontFamily: MENU_FONT.body,
      fontSize: '12px',
      color: MENU_HEX.boneDim,
      fixedWidth: 860,
      wordWrap: { width: 860 },
      maxLines: 3,
    });
    const close = new CabinetChip(scene, 990, 606, {
      width: 212,
      height: 42,
      label: 'Leave Counter',
      tone: 'primary',
      onActivate: () => this.hooks.close(),
    });
    this.add([this.inspectorTitle, this.inspectorBody, close]);

    switch (this.tab) {
      case 'buy': this.renderBuy(); break;
      case 'sell': this.renderSell(); break;
      case 'rest': this.renderRest(); break;
      case 'bounties': this.renderBounties(); break;
      case 'forge': this.renderForge(); break;
    }
    this.focus.add(close);
  }

  private inspect(title: string, body: string): void {
    this.inspectorTitle.setText(title.toUpperCase());
    this.inspectorBody.setText(body);
  }

  private rows(entries: { label: string; detail: string; enabled: boolean; accent?: string; run: () => void; inspect?: string }[]): void {
    const pages = Math.max(1, Math.ceil(entries.length / PER_PAGE));
    this.page = Math.min(this.page, pages - 1);
    const visible = entries.slice(this.page * PER_PAGE, (this.page + 1) * PER_PAGE);
    visible.forEach((entry, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const button = new CabinetButton(this.scene, 76 + column * 572, 200 + row * 84, {
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
      this.focus.add(button);
    });
    if (entries.length === 0) {
      this.add(this.scene.add.text(GAME_WIDTH / 2, 360, 'Nothing here right now.', {
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
      this.focus.add(previous);
      this.focus.add(next);
    }
  }

  private renderBuy(): void {
    const stock = shopStock(this.run, this.shop);
    this.rows(stock.map((slot) => {
      const def = getItem(slot.id);
      const name = `${def.name}${slot.qty > 1 ? ` x${slot.qty}` : ''}`;
      return {
        label: slot.sold ? `${name}  /  sold out` : `${name}  /  ${slot.price}g`,
        detail: itemDetail(def),
        enabled: !slot.sold && this.run.gold >= slot.price,
        run: () => this.apply(buyItem(this.run, this.shop.id, slot.key)),
      };
    }));
  }

  private renderSell(): void {
    const offers = sellOffers(this.run, this.shop);
    const entries = offers.map((offer) => {
      const def = getItem(offer.id);
      return {
        label: `${offer.name} x${offer.count}  /  ${offer.unit}g each`,
        detail: itemDetail(def),
        enabled: true,
        run: () => this.apply(sellItem(this.run, this.shop.id, offer.id, false)),
      };
    });
    if (offers.length > 1) {
      const total = offers.reduce((sum, offer) => sum + offer.unit * offer.count, 0);
      entries.unshift({
        label: `Sell everything listed  /  ${Math.floor(total * 2) / 2}g`,
        detail: `${offers.reduce((sum, offer) => sum + offer.count, 0)} items this shop will take.`,
        enabled: true,
        run: () => this.sellAll(offers.map((offer) => offer.id)),
      });
    }
    this.rows(entries);
  }

  private sellAll(ids: ItemId[]): void {
    let gold = 0;
    for (const id of ids) {
      const before = this.run.gold;
      if (sellItem(this.run, this.shop.id, id, true).ok) gold += this.run.gold - before;
    }
    this.apply({ ok: gold > 0, message: gold > 0 ? `Sold the lot for ${gold}g.` : 'Nothing sold.' });
  }

  private renderRest(): void {
    const price = this.shop.restPrice ?? 0;
    const leader = partyOf(this.run)[0];
    const vitals = leader
      ? `Health ${leader.hp}/${leader.maxHp}  /  Mana ${leader.mana}/${leader.maxMana}  /  Sanity ${leader.sanity}/${leader.maxSanity}`
      : '';
    const button = new CabinetButton(this.scene, 290, 250, {
      width: 700,
      height: 110,
      label: `Rent a room for the night  /  ${price}g`,
      detail: `Restores 75% of health, mana, sanity and word charges. Day ${this.run.day + 1} dawns and every shop restocks.`,
      index: '1',
      enabled: this.run.gold >= price,
      onActivate: () => this.apply(rest(this.run, this.shop.id)),
    });
    const now = this.scene.add.text(640, 400, vitals, {
      fontFamily: MENU_FONT.control,
      fontSize: '15px',
      color: MENU_HEX.bone,
    }).setOrigin(0.5, 0);
    this.add([button, now]);
    this.focus.add(button);
  }

  private renderBounties(): void {
    const town = this.hooks.townId;
    const entries: Parameters<ShopView['rows']>[0] = [];
    for (const bounty of this.run.bounties) {
      const progress = bountyProgress(this.run, bounty);
      const claimable = canClaim(this.run, town, bounty);
      const where = bounty.kind === 'deliver' ? `Deliver at ${bounty.target}` : `Claim at ${bounty.town}`;
      const armed = this.armedAbandon === bounty.id;
      entries.push({
        label: claimable ? `Claim: ${bounty.label}` : armed ? `Abandon? ${bounty.label}` : bounty.label,
        detail: `${progress}/${bounty.count}  /  ${bounty.rewardGold}g, ${bounty.rewardXp} XP  /  ${where}`,
        enabled: true,
        run: () => {
          if (claimable) {
            this.apply(claimBounty(this.run, town, bounty.id));
          } else if (armed) {
            this.armedAbandon = null;
            this.apply(abandonBounty(this.run, bounty.id));
          } else {
            this.armedAbandon = bounty.id;
            this.message = 'Choose it again to abandon this bounty.';
            this.render();
          }
        },
      });
    }
    for (const offer of bountyBoard(this.run, town)) {
      entries.push({
        label: `Notice: ${offer.label}`,
        detail: `Reward ${offer.rewardGold}g, ${offer.rewardXp} XP${offer.kind === 'deliver' ? '  /  the parcel is handed over now' : ''}`,
        enabled: this.run.bounties.length < MAX_ACTIVE_BOUNTIES,
        run: () => this.apply(acceptBounty(this.run, town, offer.id)),
      });
    }
    this.rows(entries);
  }

  private renderForge(): void {
    const recipes = recipesAt(this.run, this.shop);
    this.rows(recipes.map((recipe) => {
      const def = getItem(recipe.output);
      const needs = recipe.inputs.map((input) => `${getItem(input.id).name} ${input.have}/${input.need}`).join(', ');
      return {
        label: `${def.name}  /  ${recipe.gold}g`,
        detail: `${needs}`,
        inspect: `${needs}\n${itemDetail(def)}`,
        enabled: recipe.ready,
        accent: RARITY_COLOR[def.rarity],
        run: () => this.apply(forge(this.run, this.shop.id, recipe.id)),
      };
    }));
  }
}
