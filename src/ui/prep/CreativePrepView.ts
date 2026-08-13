import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config/constants';
import { ITEM_DEFS, RARITY_COLOR, getItem, type ItemDef, type ItemId } from '../../core/Items';
import { STAT_DEFS, type StatKey } from '../../core/Stats';
import { SceneInput } from '../../engine/SceneInput';
import { PRESET_SLOTS, type PresetSlots } from '../creativePresets';
import { CabinetChip, MenuFocusGroup, type MenuControl } from '../menu/controls';
import {
  MENU_COLOR,
  MENU_FONT,
  MENU_HEX,
  addCabinetBackdrop,
  addRecess,
  addSectionRule,
} from '../menu/theme';

const PAGE_SIZE = 12;

export interface CreativePrepSnapshot {
  mageName: string;
  confirmLabel: string;
  stats: Record<StatKey, number>;
  items: readonly ItemId[];
  page: number;
  presets: PresetSlots;
}

export interface CreativePrepActions {
  adjustStat(key: StatKey, amount: number): void;
  addItem(id: ItemId): void;
  setPage(page: number): void;
  undoItem(): void;
  clearItems(): void;
  loadPreset(slot: number): void;
  savePreset(slot: number, name: string): void;
  clearPreset(slot: number): void;
  confirm(): void;
}

interface NameDialog {
  root: Phaser.GameObjects.Container;
  valueText: Phaser.GameObjects.Text;
  value: string;
  slot: number;
}

interface CatalogPlateOptions {
  width: number;
  height: number;
  item: ItemDef;
  count: number;
  onActivate: () => void;
  onFocus: () => void;
}

class CatalogPlate extends Phaser.GameObjects.Container implements MenuControl {
  private readonly face: Phaser.GameObjects.Graphics;
  private readonly nameText: Phaser.GameObjects.Text;
  private readonly metaText: Phaser.GameObjects.Text;
  private readonly countText: Phaser.GameObjects.Text;
  private readonly hit: Phaser.GameObjects.Zone;
  private focused = false;
  private pressed = false;
  private focusRequest: (() => void) | null = null;

  readonly isEnabled = true;

  constructor(scene: Phaser.Scene, x: number, y: number, private readonly options: CatalogPlateOptions) {
    super(scene, x, y);
    scene.add.existing(this);
    this.face = scene.add.graphics();
    this.nameText = scene.add.text(12, 13, options.item.name, {
      fontFamily: MENU_FONT.control,
      fontSize: '14px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
      fixedWidth: options.width - 24,
      wordWrap: { width: options.width - 24 },
    });
    this.metaText = scene.add.text(12, options.height - 20, `${options.item.slot.toUpperCase()} / ${options.item.rarity.toUpperCase()}`, {
      fontFamily: MENU_FONT.control,
      fontSize: '9px',
      fontStyle: 'bold',
      color: RARITY_COLOR[options.item.rarity],
    });
    this.countText = scene.add.text(options.width - 11, options.height - 18, options.count ? `x${options.count}` : '', {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
    }).setOrigin(1, 0);
    this.hit = scene.add.zone(0, 0, options.width, options.height).setOrigin(0).setInteractive({ useHandCursor: true });
    this.add([this.face, this.nameText, this.metaText, this.countText, this.hit]);
    this.hit.on('pointerover', () => this.focusRequest?.());
    this.hit.on('pointerdown', () => {
      this.pressed = true;
      this.y += 1;
      this.redraw();
    });
    const release = (activate: boolean): void => {
      if (!this.pressed) return;
      this.pressed = false;
      this.y -= 1;
      this.redraw();
      if (activate) this.options.onActivate();
    };
    this.hit.on('pointerup', () => release(true));
    this.hit.on('pointerout', () => release(false));
    this.redraw();
  }

  setFocusRequest(request: () => void): void {
    this.focusRequest = request;
  }

  setFocused(focused: boolean): void {
    if (this.focused === focused) return;
    this.focused = focused;
    this.redraw();
    if (focused) this.options.onFocus();
  }

  activate(): void {
    this.options.onActivate();
  }

  adjust(_direction: -1 | 1): boolean {
    return false;
  }

  private redraw(): void {
    const { width, height, item, count } = this.options;
    const accent = Phaser.Display.Color.HexStringToColor(RARITY_COLOR[item.rarity]).color;
    this.face.clear();
    this.face.fillStyle(MENU_COLOR.pitch, 1).fillRect(2, 3, width, height);
    this.face.fillStyle(count ? MENU_COLOR.woodRaised : MENU_COLOR.charcoalRaised, 1).fillRect(0, 0, width, height);
    this.face.fillStyle(accent, this.focused ? 1 : 0.72).fillRect(0, 0, width, 4);
    this.face.lineStyle(this.focused ? 2 : 1, this.focused ? MENU_COLOR.brassLight : MENU_COLOR.brassDark, 1)
      .strokeRect(0.5, 0.5, width - 1, height - 1);
    if (count) {
      this.face.fillStyle(MENU_COLOR.brassDark, 1).fillRect(width - 48, height - 24, 38, 18);
    }
  }
}

export class CreativePrepView extends Phaser.GameObjects.Container {
  private readonly sceneInput: SceneInput;
  private readonly focus = new MenuFocusGroup();
  private readonly inspectorTitle: Phaser.GameObjects.Text;
  private readonly inspectorBody: Phaser.GameObjects.Text;
  private nameDialog: NameDialog | null = null;
  private disposed = false;

  constructor(
    scene: Phaser.Scene,
    private readonly snapshot: CreativePrepSnapshot,
    private readonly actions: CreativePrepActions
  ) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(98);
    addCabinetBackdrop(scene, this);

    const title = scene.add.text(58, 42, 'CREATIVE PREPARATION', {
      fontFamily: MENU_FONT.display,
      fontSize: '30px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    });
    const subtitle = scene.add.text(60, 82, 'Set attributes directly and assemble any starting kit.', {
      fontFamily: MENU_FONT.body,
      fontSize: '15px',
      color: MENU_HEX.boneDim,
    });
    const magePlaque = scene.add.text(1204, 52, snapshot.mageName.toUpperCase(), {
      fontFamily: MENU_FONT.control,
      fontSize: '15px',
      fontStyle: 'bold',
      color: MENU_HEX.ink,
      backgroundColor: '#d8cbae',
      padding: { x: 14, y: 8 },
    }).setOrigin(1, 0);
    this.add([title, subtitle, magePlaque]);
    addSectionRule(scene, this, 58, 112, 1164);
    addRecess(scene, this, 58, 132, 352, 410);
    addRecess(scene, this, 430, 132, 792, 410);
    addRecess(scene, this, 58, 562, 1164, 116, MENU_COLOR.woodDeep);

    const attributesHeading = scene.add.text(76, 146, 'ATTRIBUTES', {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      fontStyle: 'bold',
      color: MENU_HEX.brass,
    });
    const catalogueHeading = scene.add.text(448, 146, 'ITEM CATALOGUE / SELECT TO ADD', {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      fontStyle: 'bold',
      color: MENU_HEX.brass,
    });
    this.inspectorTitle = scene.add.text(448, 448, 'CREATIVE KIT', {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
    });
    this.inspectorBody = scene.add.text(448, 466, 'Choose an attribute control or item to inspect it.', {
      fontFamily: MENU_FONT.body,
      fontSize: '12px',
      color: MENU_HEX.boneDim,
      fixedWidth: 742,
      wordWrap: { width: 742 },
    });
    this.add([attributesHeading, catalogueHeading, this.inspectorTitle, this.inspectorBody]);

    this.buildStats();
    this.buildCatalogue();
    this.buildFooter();

    this.sceneInput = new SceneInput(scene);
    const navigate = (event: KeyboardEvent, direction: -1 | 1): void => {
      event.preventDefault();
      if (!this.nameDialog) this.focus.move(direction);
    };
    this.sceneInput.bindKeys([
      { key: 'UP', run: (event) => navigate(event, -1) },
      { key: 'LEFT', run: (event) => navigate(event, -1) },
      { key: 'DOWN', run: (event) => navigate(event, 1) },
      { key: 'RIGHT', run: (event) => navigate(event, 1) },
      { key: 'TAB', run: (event) => navigate(event, event.shiftKey ? -1 : 1) },
      { key: 'ENTER', run: (event) => {
        event.preventDefault();
        if (this.nameDialog) this.finishName(true);
        else this.focus.activate();
      } },
      { key: 'SPACE', run: (event) => {
        event.preventDefault();
        if (!this.nameDialog) this.focus.activate();
      } },
      { key: 'BACKSPACE', run: (event) => {
        if (!this.nameDialog) return;
        event.preventDefault();
        this.nameDialog.value = this.nameDialog.value.slice(0, -1);
        this.updateNameText();
      }, allowRepeat: true },
      { key: 'ESC', run: () => {
        if (this.nameDialog) this.finishName(false);
      } },
    ]);
    this.sceneInput.bindAnyKey((event) => {
      if (!this.nameDialog || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key.length !== 1 || this.nameDialog.value.length >= 24) return;
      this.nameDialog.value += event.key;
      this.updateNameText();
    }, true);
  }

  override destroy(fromScene?: boolean): void {
    if (this.disposed) return;
    this.disposed = true;
    this.nameDialog?.root.destroy(true);
    this.nameDialog = null;
    this.sceneInput.destroy();
    super.destroy(fromScene);
  }

  private buildStats(): void {
    const sockets = this.scene.add.graphics();
    this.add(sockets);
    STAT_DEFS.forEach((definition, index) => {
      const y = 176 + index * 57;
      const label = this.scene.add.text(76, y + 8, definition.name, {
        fontFamily: MENU_FONT.control,
        fontSize: '15px',
        fontStyle: 'bold',
        color: MENU_HEX.bone,
      });
      sockets.fillStyle(MENU_COLOR.pitch, 1).fillRect(176, y, 54, 34);
      sockets.fillStyle(MENU_COLOR.bone, 1).fillRect(180, y + 4, 46, 26);
      sockets.lineStyle(1, MENU_COLOR.brassDark, 1).strokeRect(180.5, y + 4.5, 45, 25);
      const value = this.scene.add.text(203, y + 17, String(this.snapshot.stats[definition.key]), {
        fontFamily: MENU_FONT.control,
        fontSize: '16px',
        fontStyle: 'bold',
        color: MENU_HEX.ink,
      }).setOrigin(0.5);
      this.add([label, value]);
      const adjustments = [-10, -1, 1, 10] as const;
      adjustments.forEach((amount, adjustmentIndex) => {
        const chip = new CabinetChip(this.scene, 238 + adjustmentIndex * 41, y, {
          width: 36,
          height: 34,
          label: amount > 0 ? `+${amount}` : String(amount),
          tone: amount < 0 ? 'danger' : 'positive',
          onActivate: () => this.actions.adjustStat(definition.key, amount),
          onFocus: () => this.setInspector(definition.name, definition.blurb),
        });
        this.add(chip);
        this.focus.add(chip);
      });
    });
  }

  private buildCatalogue(): void {
    const catalogue = ITEM_DEFS.filter((definition) => !definition.enemyOnly);
    const pages = Math.max(1, Math.ceil(catalogue.length / PAGE_SIZE));
    const page = Math.max(0, Math.min(pages - 1, this.snapshot.page));
    const counts = new Map<ItemId, number>();
    for (const id of this.snapshot.items) counts.set(id, (counts.get(id) ?? 0) + 1);
    const visible = catalogue.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    visible.forEach((definition, index) => {
      const column = index % 4;
      const row = Math.floor(index / 4);
      const plate = new CatalogPlate(this.scene, 448 + column * 188, 176 + row * 88, {
        width: 176,
        height: 76,
        item: definition,
        count: counts.get(definition.id) ?? 0,
        onActivate: () => this.actions.addItem(definition.id),
        onFocus: () => this.setInspector(
          definition.name,
          `${definition.slot} / ${definition.rarity} / ${definition.weight}kg. ${this.brief(definition.blurb)}`
        ),
      });
      this.add(plate);
      this.focus.add(plate);
    });

    const previous = new CabinetChip(this.scene, 448, 504, {
      width: 104,
      height: 28,
      label: 'Previous',
      enabled: page > 0,
      onActivate: () => this.actions.setPage(page - 1),
      onFocus: () => this.setInspector('PREVIOUS PAGE', 'Show the previous twelve catalogue items.'),
    });
    const next = new CabinetChip(this.scene, 1086, 504, {
      width: 104,
      height: 28,
      label: 'Next',
      enabled: page < pages - 1,
      onActivate: () => this.actions.setPage(page + 1),
      onFocus: () => this.setInspector('NEXT PAGE', 'Show the next twelve catalogue items.'),
    });
    const pageText = this.scene.add.text(870, 510, `PAGE ${page + 1} / ${pages}`, {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      fontStyle: 'bold',
      color: MENU_HEX.boneDim,
    }).setOrigin(0.5, 0);
    this.add([previous, next, pageText]);
    this.focus.add(previous);
    this.focus.add(next);
  }

  private buildFooter(): void {
    const savedLabel = this.scene.add.text(76, 574, 'SAVED BUILDS', {
      fontFamily: MENU_FONT.control,
      fontSize: '11px',
      fontStyle: 'bold',
      color: MENU_HEX.brass,
    });
    this.add(savedLabel);
    for (let slot = 0; slot < PRESET_SLOTS; slot++) {
      const preset = this.snapshot.presets[slot];
      const x = 76 + slot * 220;
      const plaque = this.scene.add.graphics();
      plaque.fillStyle(MENU_COLOR.charcoalRaised, 1).fillRect(x, 592, 204, 28);
      plaque.lineStyle(1, MENU_COLOR.brassDark, 1).strokeRect(x + 0.5, 592.5, 203, 27);
      const name = this.scene.add.text(x + 10, 599, preset?.name ?? `Build ${slot + 1} / empty`, {
        fontFamily: MENU_FONT.control,
        fontSize: '12px',
        fontStyle: 'bold',
        color: preset ? MENU_HEX.bone : MENU_HEX.disabled,
        fixedWidth: 184,
      });
      this.add([plaque, name]);
      const load = new CabinetChip(this.scene, x, 628, {
        width: 60,
        height: 30,
        label: 'Load',
        tone: 'positive',
        enabled: !!preset,
        onActivate: () => this.actions.loadPreset(slot),
        onFocus: () => this.setInspector('LOAD BUILD', preset ? `Replace the current setup with ${preset.name}.` : 'This slot is empty.'),
      });
      const save = new CabinetChip(this.scene, x + 68, 628, {
        width: 60,
        height: 30,
        label: 'Save',
        onActivate: () => this.openNameDialog(slot, preset?.name ?? `Build ${slot + 1}`),
        onFocus: () => this.setInspector('SAVE BUILD', 'Store the current attributes and complete item list in this slot.'),
      });
      const clear = new CabinetChip(this.scene, x + 136, 628, {
        width: 68,
        height: 30,
        label: 'Clear',
        tone: 'danger',
        enabled: !!preset,
        onActivate: () => this.actions.clearPreset(slot),
        onFocus: () => this.setInspector('CLEAR BUILD', preset ? `Erase ${preset.name} from local storage.` : 'This slot is empty.'),
      });
      this.add([load, save, clear]);
      this.focus.add(load);
      this.focus.add(save);
      this.focus.add(clear);
    }

    const last = this.snapshot.items[this.snapshot.items.length - 1];
    const kitLabel = this.scene.add.text(750, 577, `${this.snapshot.items.length} ITEM${this.snapshot.items.length === 1 ? '' : 'S'} SELECTED`, {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    });
    const kitDetail = this.scene.add.text(750, 598, last ? `Last added: ${getItem(last).name}` : 'No starting equipment selected.', {
      fontFamily: MENU_FONT.body,
      fontSize: '12px',
      color: MENU_HEX.boneDim,
      fixedWidth: 450,
    });
    const undo = new CabinetChip(this.scene, 750, 628, {
      width: 98,
      height: 30,
      label: 'Undo Last',
      enabled: !!last,
      onActivate: this.actions.undoItem,
      onFocus: () => this.setInspector('UNDO LAST', last ? `Remove the latest ${getItem(last).name}.` : 'No item can be removed.'),
    });
    const clearItems = new CabinetChip(this.scene, 856, 628, {
      width: 98,
      height: 30,
      label: 'Clear Kit',
      tone: 'danger',
      enabled: this.snapshot.items.length > 0,
      onActivate: this.actions.clearItems,
      onFocus: () => this.setInspector('CLEAR KIT', 'Remove every selected starting item.'),
    });
    const confirm = new CabinetChip(this.scene, 970, 620, {
      width: 232,
      height: 38,
      label: this.snapshot.confirmLabel,
      tone: 'primary',
      onActivate: this.actions.confirm,
      onFocus: () => this.setInspector('KIT COMPLETE', 'Apply these attributes and items, then begin the run.'),
    });
    this.add([kitLabel, kitDetail, undo, clearItems, confirm]);
    this.focus.add(undo);
    this.focus.add(clearItems);
    this.focus.add(confirm);
  }

  private setInspector(title: string, body: string): void {
    this.inspectorTitle.setText(title.toUpperCase());
    this.inspectorBody.setText(body);
  }

  private brief(text: string): string {
    return text.length <= 180 ? text : `${text.slice(0, 177)}...`;
  }

  private openNameDialog(slot: number, initial: string): void {
    if (this.nameDialog) return;
    const root = this.scene.add.container(0, 0);
    this.add(root);
    const blocker = this.scene.add.zone(0, 0, GAME_WIDTH, GAME_HEIGHT).setOrigin(0).setInteractive();
    const surface = this.scene.add.graphics();
    surface.fillStyle(MENU_COLOR.pitch, 1).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    surface.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(330, 218, 620, 282);
    surface.fillStyle(MENU_COLOR.charcoal, 1).fillRect(346, 234, 588, 250);
    surface.lineStyle(2, MENU_COLOR.brassDark, 1).strokeRect(346, 234, 588, 250);
    surface.fillStyle(MENU_COLOR.bone, 1).fillRect(392, 330, 496, 58);
    surface.lineStyle(1, MENU_COLOR.brass, 1).strokeRect(392.5, 330.5, 495, 57);
    const title = this.scene.add.text(640, 265, 'NAME THIS BUILD', {
      fontFamily: MENU_FONT.display,
      fontSize: '24px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    }).setOrigin(0.5, 0);
    const note = this.scene.add.text(640, 299, 'Up to 24 characters.', {
      fontFamily: MENU_FONT.body,
      fontSize: '13px',
      color: MENU_HEX.boneDim,
    }).setOrigin(0.5, 0);
    const valueText = this.scene.add.text(410, 347, initial, {
      fontFamily: MENU_FONT.control,
      fontSize: '18px',
      fontStyle: 'bold',
      color: MENU_HEX.ink,
      fixedWidth: 460,
    });
    const cancel = new CabinetChip(this.scene, 492, 418, {
      width: 132,
      height: 40,
      label: 'Cancel',
      onActivate: () => this.finishName(false),
    });
    const save = new CabinetChip(this.scene, 656, 418, {
      width: 132,
      height: 40,
      label: 'Save Build',
      tone: 'primary',
      onActivate: () => this.finishName(true),
    });
    root.add([blocker, surface, title, note, valueText, cancel, save]);
    this.nameDialog = { root, valueText, value: initial.slice(0, 24), slot };
    this.updateNameText();
  }

  private updateNameText(): void {
    const dialog = this.nameDialog;
    if (!dialog) return;
    dialog.valueText.setText(dialog.value || ' ');
  }

  private finishName(save: boolean): void {
    const dialog = this.nameDialog;
    if (!dialog) return;
    const name = dialog.value.trim() || `Build ${dialog.slot + 1}`;
    this.nameDialog = null;
    dialog.root.destroy(true);
    if (save) this.actions.savePreset(dialog.slot, name);
  }
}