import Phaser from 'phaser';
import type { ItemId } from '../../core/Items';
import { STAT_DEFS, type StatKey } from '../../core/Stats';
import { SceneInput } from '../../engine/SceneInput';
import { CabinetButton, CabinetChip, MenuFocusGroup, type MenuControl } from '../cabinet/controls';
import {
  MENU_COLOR,
  MENU_FONT,
  MENU_HEX,
  addCabinetBackdrop,
  addRecess,
  addSectionRule,
} from '../cabinet/theme';

export type SwampShopMode = 'waiting' | 'offers' | 'confirm' | 'stats' | 'manage';

export interface SwampOfferView {
  title: string;
  price: number;
  detail: string;
  accent: number;
  enabled: boolean;
}

export interface SwampManageItemView {
  id: ItemId;
  name: string;
  detail: string;
  sellValue: number;
}

export interface SwampShopSnapshot {
  title: string;
  subtitle: string;
  message: string;
  mode: SwampShopMode;
  gold: number;
  overCapacity: boolean;
  offers: SwampOfferView[];
  confirmText?: string;
  manageItems: SwampManageItemView[];
  restLabel: string;
  restEnabled: boolean;
}

export interface SwampShopActions {
  buyOffer(index: number): void;
  confirmBuy(): void;
  cancelSubstate(): void;
  chooseStat(key: StatKey): void;
  openManage(): void;
  sell(id: ItemId): void;
  discard(id: ItemId): void;
  rest(): void;
  leave(): void;
}

class OfferCard extends Phaser.GameObjects.Container implements MenuControl {
  private readonly face: Phaser.GameObjects.Graphics;
  private readonly hit: Phaser.GameObjects.Zone;
  private focused = false;
  private focusRequest: (() => void) | null = null;

  get isEnabled(): boolean {
    return this.offer.enabled;
  }

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    private readonly offer: SwampOfferView,
    private readonly activateCard: () => void,
    private readonly inspect: () => void
  ) {
    super(scene, x, y);
    scene.add.existing(this);
    this.face = scene.add.graphics();
    const title = scene.add.text(14, 15, offer.title, {
      fontFamily: MENU_FONT.display,
      fontSize: '17px',
      fontStyle: 'bold',
      color: offer.enabled ? MENU_HEX.bone : MENU_HEX.disabled,
      fixedWidth: 236,
      wordWrap: { width: 236 },
    });
    const price = scene.add.text(246, 16, `${offer.price}g`, {
      fontFamily: MENU_FONT.control,
      fontSize: '13px',
      fontStyle: 'bold',
      color: offer.enabled ? MENU_HEX.brassLight : MENU_HEX.disabled,
    }).setOrigin(1, 0);
    const body = scene.add.text(14, 62, offer.detail, {
      fontFamily: MENU_FONT.body,
      fontSize: '11px',
      color: MENU_HEX.boneDim,
      fixedWidth: 232,
      wordWrap: { width: 232 },
      maxLines: 6,
    });
    this.hit = scene.add.zone(0, 0, 260, 156).setOrigin(0);
    if (offer.enabled) this.hit.setInteractive({ useHandCursor: true });
    this.add([this.face, title, price, body, this.hit]);
    this.hit.on('pointerover', () => this.focusRequest?.());
    this.hit.on('pointerdown', () => {
      if (offer.enabled) activateCard();
    });
    this.redraw();
  }

  setFocusRequest(request: () => void): void {
    this.focusRequest = request;
  }

  setFocused(focused: boolean): void {
    if (this.focused === focused) return;
    this.focused = focused;
    this.redraw();
    if (focused) this.inspect();
  }

  activate(): void {
    if (this.offer.enabled) this.activateCard();
  }

  adjust(_direction: -1 | 1): boolean {
    return false;
  }

  private redraw(): void {
    this.face.clear();
    this.face.fillStyle(MENU_COLOR.pitch, 1).fillRect(3, 4, 260, 156);
    this.face.fillStyle(MENU_COLOR.charcoalRaised, this.offer.enabled ? 1 : 0.48).fillRect(0, 0, 260, 156);
    this.face.fillStyle(this.offer.accent, this.focused ? 1 : 0.72).fillRect(0, 0, 260, 5);
    this.face.lineStyle(this.focused ? 2 : 1, this.focused ? MENU_COLOR.brassLight : MENU_COLOR.brassDark, 1)
      .strokeRect(0.5, 0.5, 259, 155);
  }
}

export class SwampShopView extends Phaser.GameObjects.Container {
  private readonly sceneInput: SceneInput;
  private readonly focus = new MenuFocusGroup();
  private readonly inspectorTitle: Phaser.GameObjects.Text;
  private readonly inspectorBody: Phaser.GameObjects.Text;
  private disposed = false;

  constructor(
    scene: Phaser.Scene,
    private readonly snapshot: SwampShopSnapshot,
    private readonly actions: SwampShopActions
  ) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(96);
    addCabinetBackdrop(scene, this);
    const title = scene.add.text(58, 42, snapshot.title, {
      fontFamily: MENU_FONT.display,
      fontSize: '28px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    });
    const subtitle = scene.add.text(60, 82, snapshot.subtitle, {
      fontFamily: MENU_FONT.body,
      fontSize: '14px',
      color: snapshot.overCapacity ? '#cf8d82' : MENU_HEX.boneDim,
      fixedWidth: 920,
    });
    const gold = scene.add.text(1202, 50, `${snapshot.gold}g`, {
      fontFamily: MENU_FONT.display,
      fontSize: '25px',
      fontStyle: 'bold',
      color: MENU_HEX.ink,
      backgroundColor: '#d8cbae',
      padding: { x: 16, y: 7 },
    }).setOrigin(1, 0);
    this.add([title, subtitle, gold]);
    addSectionRule(scene, this, 58, 112, 1164);
    addRecess(scene, this, 58, 132, 1164, 432);
    addRecess(scene, this, 58, 582, 1164, 86, MENU_COLOR.woodDeep);
    this.inspectorTitle = scene.add.text(76, 594, snapshot.message ? 'LATEST' : 'PARTY SHOP', {
      fontFamily: MENU_FONT.control,
      fontSize: '11px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
    });
    this.inspectorBody = scene.add.text(76, 614, snapshot.message || 'Choose one upgrade, rest the party, manage weight, or leave.', {
      fontFamily: MENU_FONT.body,
      fontSize: '12px',
      color: MENU_HEX.boneDim,
      fixedWidth: 1090,
      wordWrap: { width: 1090 },
      maxLines: 2,
    });
    this.add([this.inspectorTitle, this.inspectorBody]);

    if (snapshot.mode === 'waiting') this.renderWaiting();
    else if (snapshot.mode === 'confirm') this.renderConfirm();
    else if (snapshot.mode === 'stats') this.renderStats();
    else if (snapshot.mode === 'manage') this.renderManage();
    else this.renderOffers();

    this.sceneInput = new SceneInput(scene);
    this.sceneInput.bindKeys([
      { key: 'LEFT', capture: true, run: () => this.focus.move(-1) },
      { key: 'UP', capture: true, run: () => this.focus.move(-1) },
      { key: 'RIGHT', capture: true, run: () => this.focus.move(1) },
      { key: 'DOWN', capture: true, run: () => this.focus.move(1) },
      { key: 'TAB', capture: true, run: (event) => this.focus.move(event.shiftKey ? -1 : 1) },
      { key: 'SPACE', capture: true, run: () => this.focus.activate() },
      { key: 'ENTER', capture: true, run: () => this.focus.activate() },
    ]);
  }

  override destroy(fromScene?: boolean): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sceneInput.destroy();
    super.destroy(fromScene);
  }

  private renderWaiting(): void {
    const text = this.scene.add.text(640, 318, 'ANOTHER PLAYER IS SHOPPING', {
      fontFamily: MENU_FONT.display,
      fontSize: '27px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
    }).setOrigin(0.5);
    this.add(text);
  }

  private renderOffers(): void {
    this.snapshot.offers.forEach((offer, index) => {
      const card = new OfferCard(
        this.scene,
        82 + (index % 4) * 282,
        154 + Math.floor(index / 4) * 176,
        offer,
        () => this.actions.buyOffer(index),
        () => this.inspect(offer.title, offer.detail)
      );
      this.add(card);
      this.focus.add(card);
    });
    const manage = new CabinetChip(this.scene, 180, 520, {
      width: 260,
      height: 36,
      label: 'Sell / Drop Items',
      onActivate: this.actions.openManage,
    });
    const rest = new CabinetChip(this.scene, 510, 520, {
      width: 260,
      height: 36,
      label: this.snapshot.restLabel,
      tone: 'positive',
      enabled: this.snapshot.restEnabled,
      onActivate: this.actions.rest,
    });
    const leave = new CabinetChip(this.scene, 840, 520, {
      width: 260,
      height: 36,
      label: this.snapshot.overCapacity ? 'Over Capacity' : 'Leave Shop',
      tone: 'primary',
      enabled: !this.snapshot.overCapacity,
      onActivate: this.actions.leave,
    });
    this.add([manage, rest, leave]);
    this.focus.add(manage);
    this.focus.add(rest);
    this.focus.add(leave);
  }

  private renderConfirm(): void {
    const text = this.scene.add.text(640, 250, this.snapshot.confirmText ?? 'Buy this item anyway?', {
      fontFamily: MENU_FONT.body,
      fontSize: '18px',
      color: MENU_HEX.bone,
      fixedWidth: 820,
      align: 'center',
      wordWrap: { width: 820 },
    }).setOrigin(0.5, 0);
    const buy = new CabinetButton(this.scene, 238, 392, {
      width: 380,
      height: 66,
      label: 'Buy Anyway',
      detail: 'You must sell or discard enough weight before leaving.',
      index: '1',
      primary: true,
      onActivate: this.actions.confirmBuy,
    });
    const cancel = new CabinetButton(this.scene, 662, 392, {
      width: 380,
      height: 66,
      label: 'Cancel',
      detail: 'Return to the available offers.',
      index: '2',
      onActivate: this.actions.cancelSubstate,
    });
    this.add([text, buy, cancel]);
    this.focus.add(buy);
    this.focus.add(cancel);
  }

  private renderStats(): void {
    const heading = this.scene.add.text(640, 170, 'CHOOSE A PERMANENT +1D3 ATTRIBUTE', {
      fontFamily: MENU_FONT.control,
      fontSize: '14px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
    }).setOrigin(0.5);
    this.add(heading);
    STAT_DEFS.forEach((definition, index) => {
      const button = new CabinetButton(this.scene, 100 + (index % 2) * 550, 210 + Math.floor(index / 2) * 88, {
        width: 530,
        height: 72,
        label: definition.name,
        detail: definition.blurb,
        index: String(index + 1),
        onActivate: () => this.actions.chooseStat(definition.key),
      });
      this.add(button);
      this.focus.add(button);
    });
    const cancel = new CabinetChip(this.scene, 540, 496, {
      width: 200,
      height: 40,
      label: 'Cancel',
      onActivate: this.actions.cancelSubstate,
    });
    this.add(cancel);
    this.focus.add(cancel);
  }

  private renderManage(): void {
    const visible = this.snapshot.manageItems.slice(0, 12);
    visible.forEach((item, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = 82 + column * 568;
      const y = 148 + row * 58;
      const frame = this.scene.add.graphics();
      frame.fillStyle(MENU_COLOR.charcoalRaised, 1).fillRect(x, y, 550, 48);
      frame.lineStyle(1, MENU_COLOR.brassDark, 1).strokeRect(x + 0.5, y + 0.5, 549, 47);
      const name = this.scene.add.text(x + 14, y + 7, item.name, {
        fontFamily: MENU_FONT.control,
        fontSize: '13px',
        fontStyle: 'bold',
        color: MENU_HEX.bone,
        fixedWidth: 278,
      });
      const detail = this.scene.add.text(x + 14, y + 28, item.detail, {
        fontFamily: MENU_FONT.body,
        fontSize: '10px',
        color: MENU_HEX.boneDim,
        fixedWidth: 278,
      });
      this.add([frame, name, detail]);
      if (item.sellValue > 0) {
        const sell = new CabinetChip(this.scene, x + 310, y + 9, {
          width: 104,
          height: 30,
          label: `Sell ${item.sellValue}g`,
          tone: 'positive',
          onActivate: () => this.actions.sell(item.id),
        });
        this.add(sell);
        this.focus.add(sell);
      }
      const drop = new CabinetChip(this.scene, x + 428, y + 9, {
        width: 104,
        height: 30,
        label: 'Discard',
        tone: 'danger',
        onActivate: () => this.actions.discard(item.id),
      });
      this.add(drop);
      this.focus.add(drop);
    });
    const back = new CabinetChip(this.scene, 535, 506, {
      width: 210,
      height: 34,
      label: this.snapshot.overCapacity ? 'Still Over Capacity' : 'Back to Shop',
      tone: this.snapshot.overCapacity ? 'danger' : 'primary',
      enabled: !this.snapshot.overCapacity,
      onActivate: this.actions.cancelSubstate,
    });
    this.add(back);
    this.focus.add(back);
  }

  private inspect(title: string, body: string): void {
    this.inspectorTitle.setText(title.toUpperCase());
    this.inspectorBody.setText(body);
  }
}