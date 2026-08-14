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

export type InventoryActionKind = 'consume' | 'throw' | 'equip' | 'unequip' | 'drop-hand' | 'drop-accessory';

export interface InventoryActionView {
  kind: InventoryActionKind;
  label: string;
  tone?: 'normal' | 'positive' | 'danger';
}

export interface InventoryItemView {
  id: ItemId;
  name: string;
  location: string;
  detail: string;
  actions: InventoryActionView[];
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
  equipment: InventoryItemView[];
  supplies: InventoryItemView[];
  statuses: InventoryStatusView[];
}

export interface InventoryActions {
  perform(kind: InventoryActionKind, id: ItemId): void;
  close(): void;
}

type InventoryTab = 'equipment' | 'supplies' | 'statuses';
const PAGE_SIZE = 8;

export class InventoryView extends Phaser.GameObjects.Container {
  private readonly sceneInput: SceneInput;
  private readonly focus = new MenuFocusGroup();
  private readonly contentLayer: Phaser.GameObjects.Container;
  private readonly inspectorTitle: Phaser.GameObjects.Text;
  private readonly inspectorBody: Phaser.GameObjects.Text;
  private readonly tabs = new Map<InventoryTab, CabinetChip>();
  private tab: InventoryTab = 'equipment';
  private page = 0;
  private disposed = false;

  constructor(
    scene: Phaser.Scene,
    private readonly snapshot: InventorySnapshot,
    private readonly actions: InventoryActions
  ) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(snapshot.readOnly ? 100 : 96);
    addCabinetBackdrop(scene, this);

    const title = scene.add.text(58, 42, `${snapshot.mageName.toUpperCase()}  /  INVENTORY`, {
      fontFamily: MENU_FONT.display,
      fontSize: '29px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    });
    const subtitle = scene.add.text(60, 82, `${snapshot.carry}${snapshot.readOnly ? '  /  INSPECTION ONLY' : ''}`, {
      fontFamily: MENU_FONT.body,
      fontSize: '14px',
      color: MENU_HEX.boneDim,
    });
    this.add([title, subtitle]);
    addSectionRule(scene, this, 58, 112, 1164);
    addRecess(scene, this, 58, 186, 1164, 390);
    addRecess(scene, this, 58, 594, 1164, 74, MENU_COLOR.woodDeep);

    const tabDefs: [InventoryTab, string][] = [
      ['equipment', 'Equipment'],
      ['supplies', 'Bag & Supplies'],
      ['statuses', 'Status Effects'],
    ];
    tabDefs.forEach(([id, label], index) => {
      const tab = new CabinetChip(scene, 58 + index * 204, 132, {
        width: 190,
        height: 38,
        label,
        onActivate: () => this.setTab(id),
      });
      this.tabs.set(id, tab);
      this.add(tab);
    });

    this.contentLayer = scene.add.container(0, 0);
    this.inspectorTitle = scene.add.text(76, 606, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '11px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
    });
    this.inspectorBody = scene.add.text(76, 626, '', {
      fontFamily: MENU_FONT.body,
      fontSize: '12px',
      color: MENU_HEX.boneDim,
      fixedWidth: 850,
      wordWrap: { width: 850 },
      maxLines: 2,
    });
    const close = new CabinetChip(scene, 990, 610, {
      width: 212,
      height: 40,
      label: snapshot.readOnly ? 'Return to Map' : 'Close Inventory',
      tone: 'primary',
      onActivate: actions.close,
    });
    this.add([this.contentLayer, this.inspectorTitle, this.inspectorBody, close]);
    this.renderPage();

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

  private setTab(tab: InventoryTab): void {
    if (this.tab === tab) return;
    this.tab = tab;
    this.page = 0;
    this.renderPage();
  }

  private renderPage(): void {
    this.contentLayer.removeAll(true);
    this.focus.clear();
    let activeTabIndex = 0;
    let tabIndex = 0;
    for (const [id, tab] of this.tabs) {
      if (id === this.tab) activeTabIndex = tabIndex;
      this.focus.add(tab);
      tabIndex += 1;
    }
    this.focus.focus(activeTabIndex);

    if (this.tab === 'statuses') this.renderStatuses();
    else this.renderItems(this.tab === 'equipment' ? this.snapshot.equipment : this.snapshot.supplies);
  }

  private renderItems(items: InventoryItemView[]): void {
    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    this.page = Math.min(this.page, pages - 1);
    const visible = items.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE);
    if (visible.length === 0) {
      this.contentLayer.add(this.scene.add.text(82, 216, 'Nothing stored here.', {
        fontFamily: MENU_FONT.body,
        fontSize: '15px',
        color: MENU_HEX.boneDim,
      }));
    }
    visible.forEach((item, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = 76 + column * 568;
      const y = 206 + row * 82;
      const panel = this.scene.add.graphics();
      panel.fillStyle(MENU_COLOR.charcoalRaised, 1).fillRect(x, y, 550, 68);
      panel.fillStyle(MENU_COLOR.brassDark, 1).fillRect(x, y, 5, 68);
      panel.lineStyle(1, MENU_COLOR.brassDark, 0.8).strokeRect(x + 0.5, y + 0.5, 549, 67);
      const name = this.scene.add.text(x + 16, y + 12, item.name, {
        fontFamily: MENU_FONT.control,
        fontSize: '14px',
        fontStyle: 'bold',
        color: MENU_HEX.bone,
        fixedWidth: 280,
      });
      const location = this.scene.add.text(x + 16, y + 37, item.location.toUpperCase(), {
        fontFamily: MENU_FONT.control,
        fontSize: '9px',
        fontStyle: 'bold',
        color: MENU_HEX.brass,
      });
      this.contentLayer.add([panel, name, location]);
      item.actions.slice(0, 2).forEach((action, actionIndex) => {
        const chip = new CabinetChip(this.scene, x + 334 + actionIndex * 100, y + 16, {
          width: 92,
          height: 36,
          label: action.label,
          tone: action.tone,
          enabled: !this.snapshot.readOnly,
          onActivate: () => this.actions.perform(action.kind, item.id),
          onFocus: () => this.inspect(item.name, item.detail),
        });
        this.contentLayer.add(chip);
        this.focus.add(chip);
      });
      if (item.actions.length === 0) {
        const inspect = new CabinetChip(this.scene, x + 434, y + 16, {
          width: 92,
          height: 36,
          label: 'Inspect',
          onActivate: () => this.inspect(item.name, item.detail),
          onFocus: () => this.inspect(item.name, item.detail),
        });
        this.contentLayer.add(inspect);
        this.focus.add(inspect);
      }
    });
    this.addPager(pages);
  }

  private renderStatuses(): void {
    const pages = Math.max(1, Math.ceil(this.snapshot.statuses.length / PAGE_SIZE));
    this.page = Math.min(this.page, pages - 1);
    const visible = this.snapshot.statuses.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE);
    if (visible.length === 0) {
      this.contentLayer.add(this.scene.add.text(82, 216, 'No active status effects.', {
        fontFamily: MENU_FONT.body,
        fontSize: '15px',
        color: MENU_HEX.boneDim,
      }));
    }
    visible.forEach((status, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const button = new CabinetButton(this.scene, 76 + column * 568, 206 + row * 82, {
        width: 550,
        height: 68,
        label: status.name,
        detail: status.duration,
        index: String(index + 1),
        onActivate: () => this.inspect(status.name, status.detail),
        onFocus: () => this.inspect(status.name, status.detail),
      });
      this.contentLayer.add(button);
      this.focus.add(button);
    });
    this.addPager(pages);
  }

  private addPager(pages: number): void {
    if (pages <= 1) return;
    const previous = new CabinetChip(this.scene, 468, 536, {
      width: 110,
      height: 30,
      label: 'Previous',
      enabled: this.page > 0,
      onActivate: () => {
        this.page -= 1;
        this.renderPage();
      },
    });
    const next = new CabinetChip(this.scene, 702, 536, {
      width: 110,
      height: 30,
      label: 'Next',
      enabled: this.page < pages - 1,
      onActivate: () => {
        this.page += 1;
        this.renderPage();
      },
    });
    const page = this.scene.add.text(640, 543, `${this.page + 1} / ${pages}`, {
      fontFamily: MENU_FONT.control,
      fontSize: '11px',
      color: MENU_HEX.boneDim,
    }).setOrigin(0.5, 0);
    this.contentLayer.add([previous, next, page]);
    this.focus.add(previous);
    this.focus.add(next);
  }

  private inspect(title: string, detail: string): void {
    this.inspectorTitle.setText(title.toUpperCase());
    this.inspectorBody.setText(detail);
  }
}