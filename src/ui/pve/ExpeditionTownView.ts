import Phaser from 'phaser';
import type { ItemId } from '../../core/Items';
import { SceneInput } from '../../engine/SceneInput';
import { CabinetButton, CabinetChip, MenuFocusGroup } from '../cabinet/controls';
import {
  MENU_COLOR,
  MENU_FONT,
  MENU_HEX,
  addCabinetBackdrop,
  addRecess,
  addSectionRule,
} from '../cabinet/theme';

export type TownTab = 'potions' | 'armor' | 'weapons' | 'guild' | 'donate';

export interface TownItemView {
  id: ItemId;
  name: string;
  price: number;
  detail: string;
  accent: number;
  enabled: boolean;
}

export interface TownRecruitView {
  kind: 'dwarf' | 'elf' | 'human';
  name: string;
  role: string;
  oneRunPrice: number;
  permanentPrice: number;
  hired: boolean;
  permanent: boolean;
  canHire: boolean;
  canPermanent: boolean;
}

export interface TownDonationView {
  seat: number;
  name: string;
  enabled: boolean;
}

export interface ExpeditionTownSnapshot {
  buyerName: string;
  gold: number;
  hostPhase: boolean;
  activeTab: TownTab;
  tabs: { id: TownTab; label: string }[];
  message: string;
  items: TownItemView[];
  page: number;
  pages: number;
  restEnabled: boolean;
  recruits: TownRecruitView[];
  donations: TownDonationView[];
}

export interface ExpeditionTownActions {
  selectTab(tab: TownTab): void;
  buy(id: ItemId): void;
  previousPage(): void;
  nextPage(): void;
  rest(): void;
  recruit(kind: TownRecruitView['kind'], permanent: boolean, price: number): void;
  donate(seat: number): void;
  finish(): void;
}

export class ExpeditionTownView extends Phaser.GameObjects.Container {
  private readonly sceneInput: SceneInput;
  private readonly focus = new MenuFocusGroup();
  private readonly inspectorTitle: Phaser.GameObjects.Text;
  private readonly inspectorBody: Phaser.GameObjects.Text;
  private disposed = false;

  constructor(
    scene: Phaser.Scene,
    private readonly snapshot: ExpeditionTownSnapshot,
    private readonly actions: ExpeditionTownActions
  ) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(98);
    addCabinetBackdrop(scene, this);
    const title = scene.add.text(58, 42, 'SWAMP TOWN', {
      fontFamily: MENU_FONT.display,
      fontSize: '29px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    });
    const subtitle = scene.add.text(60, 82, `${snapshot.buyerName}  /  ${snapshot.gold}g  /  FIXED PRICES`, {
      fontFamily: MENU_FONT.body,
      fontSize: '14px',
      color: MENU_HEX.boneDim,
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

    snapshot.tabs.forEach((tab, index) => {
      const chip = new CabinetChip(scene, 58 + index * 190, 132, {
        width: 176,
        height: 38,
        label: tab.label,
        tone: snapshot.activeTab === tab.id ? 'primary' : 'normal',
        onActivate: () => actions.selectTab(tab.id),
      });
      this.add(chip);
      this.focus.add(chip);
    });
    addRecess(scene, this, 58, 186, 1164, 382);
    addRecess(scene, this, 58, 586, 1164, 82, MENU_COLOR.woodDeep);
    this.inspectorTitle = scene.add.text(76, 598, snapshot.message ? 'LATEST' : 'TOWN', {
      fontFamily: MENU_FONT.control,
      fontSize: '11px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
    });
    this.inspectorBody = scene.add.text(76, 618, snapshot.message || 'Choose a town service.', {
      fontFamily: MENU_FONT.body,
      fontSize: '12px',
      color: MENU_HEX.boneDim,
      fixedWidth: 850,
      wordWrap: { width: 850 },
      maxLines: 2,
    });
    const finish = new CabinetChip(scene, 970, 606, {
      width: 232,
      height: 42,
      label: snapshot.hostPhase ? 'Depart on New Run' : 'Finish Shopping',
      tone: 'primary',
      onActivate: actions.finish,
    });
    this.add([this.inspectorTitle, this.inspectorBody, finish]);
    this.focus.add(finish);

    if (snapshot.activeTab === 'guild') this.renderGuild();
    else if (snapshot.activeTab === 'donate') this.renderDonations();
    else this.renderItems();

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

  private renderItems(): void {
    this.snapshot.items.forEach((item, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const button = new CabinetButton(this.scene, 76 + column * 378, 208 + row * 150, {
        width: 358,
        height: 134,
        label: `${item.name}  /  ${item.price}g`,
        detail: item.detail,
        index: String(index + 1),
        enabled: item.enabled,
        onActivate: () => this.actions.buy(item.id),
        onFocus: () => this.inspect(item.name, item.detail),
      });
      this.add(button);
      this.focus.add(button);
    });
    if (this.snapshot.pages > 1) {
      const previous = new CabinetChip(this.scene, 444, 520, {
        width: 120,
        height: 34,
        label: 'Previous',
        enabled: this.snapshot.page > 0,
        onActivate: this.actions.previousPage,
      });
      const next = new CabinetChip(this.scene, 716, 520, {
        width: 120,
        height: 34,
        label: 'Next',
        enabled: this.snapshot.page < this.snapshot.pages - 1,
        onActivate: this.actions.nextPage,
      });
      const page = this.scene.add.text(640, 527, `${this.snapshot.page + 1} / ${this.snapshot.pages}`, {
        fontFamily: MENU_FONT.control,
        fontSize: '11px',
        color: MENU_HEX.boneDim,
      }).setOrigin(0.5, 0);
      this.add([previous, next, page]);
      this.focus.add(previous);
      this.focus.add(next);
    }
  }

  private renderGuild(): void {
    if (!this.snapshot.hostPhase) {
      const rest = new CabinetButton(this.scene, 365, 300, {
        width: 550,
        height: 100,
        label: 'Rest  /  1g',
        detail: 'Restore half of this explorer’s resources before the next run.',
        index: '1',
        enabled: this.snapshot.restEnabled,
        onActivate: this.actions.rest,
      });
      this.add(rest);
      this.focus.add(rest);
      return;
    }
    this.snapshot.recruits.forEach((recruit, index) => {
      const x = 76 + index * 378;
      const frame = this.scene.add.graphics();
      frame.fillStyle(MENU_COLOR.charcoalRaised, 1).fillRect(x, 218, 358, 240);
      frame.lineStyle(1, MENU_COLOR.brassDark, 1).strokeRect(x + 0.5, 218.5, 357, 239);
      const name = this.scene.add.text(x + 18, 236, recruit.name, {
        fontFamily: MENU_FONT.display,
        fontSize: '19px',
        fontStyle: 'bold',
        color: recruit.permanent ? MENU_HEX.verdigris : MENU_HEX.bone,
        fixedWidth: 320,
      });
      const role = this.scene.add.text(x + 18, 274, recruit.role, {
        fontFamily: MENU_FONT.body,
        fontSize: '12px',
        color: MENU_HEX.boneDim,
        fixedWidth: 320,
        wordWrap: { width: 320 },
      });
      const oneRun = new CabinetChip(this.scene, x + 18, 388, {
        width: 150,
        height: 40,
        label: recruit.permanent ? 'Permanent' : recruit.hired ? 'Hired' : `One Run ${recruit.oneRunPrice}g`,
        enabled: recruit.canHire,
        onActivate: () => this.actions.recruit(recruit.kind, false, recruit.oneRunPrice),
      });
      const permanent = new CabinetChip(this.scene, x + 190, 388, {
        width: 150,
        height: 40,
        label: `Forever ${recruit.permanentPrice}g`,
        tone: 'primary',
        enabled: recruit.canPermanent,
        onActivate: () => this.actions.recruit(recruit.kind, true, recruit.permanentPrice),
      });
      this.add([frame, name, role, oneRun, permanent]);
      this.focus.add(oneRun);
      this.focus.add(permanent);
    });
  }

  private renderDonations(): void {
    if (this.snapshot.donations.length === 0) {
      this.add(this.scene.add.text(640, 330, 'No other players can receive a donation.', {
        fontFamily: MENU_FONT.body,
        fontSize: '16px',
        color: MENU_HEX.boneDim,
      }).setOrigin(0.5));
      return;
    }
    this.snapshot.donations.forEach((donation, index) => {
      const button = new CabinetButton(this.scene, 265, 240 + index * 90, {
        width: 750,
        height: 72,
        label: `Donate 1g to ${donation.name}`,
        detail: 'Transfer one personal gold to this explorer.',
        index: String(index + 1),
        enabled: donation.enabled,
        onActivate: () => this.actions.donate(donation.seat),
      });
      this.add(button);
      this.focus.add(button);
    });
  }

  private inspect(title: string, body: string): void {
    this.inspectorTitle.setText(title.toUpperCase());
    this.inspectorBody.setText(body);
  }
}