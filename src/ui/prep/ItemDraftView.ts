import Phaser from 'phaser';
import { RARITY_COLOR, getItem, type ItemId } from '../../core/Items';
import { SceneInput } from '../../engine/SceneInput';
import { CabinetChip, MenuFocusGroup, type MenuControl } from '../cabinet/controls';
import {
  MENU_COLOR,
  MENU_FONT,
  MENU_HEX,
  addCabinetBackdrop,
  addRecess,
  addSectionRule,
} from '../cabinet/theme';

export interface ItemDraftSnapshot {
  title: string;
  subtitle: string;
  options: readonly ItemId[];
  picks: readonly ItemId[];
  locked: boolean;
}

export interface ItemDraftActions {
  pick(index: number): void;
}

class DraftCard extends Phaser.GameObjects.Container implements MenuControl {
  private readonly face: Phaser.GameObjects.Graphics;
  private readonly hit: Phaser.GameObjects.Zone;
  private focused = false;
  private focusRequest: (() => void) | null = null;
  readonly isEnabled: boolean;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    private readonly id: ItemId,
    enabled: boolean,
    private readonly activateCard: () => void,
    private readonly inspect: (title: string, body: string) => void
  ) {
    super(scene, x, y);
    scene.add.existing(this);
    this.isEnabled = enabled;
    const definition = getItem(id);
    this.face = scene.add.graphics();
    const name = scene.add.text(18, 22, definition.name, {
      fontFamily: MENU_FONT.display,
      fontSize: '20px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
      fixedWidth: 230,
      wordWrap: { width: 230 },
    });
    const meta = scene.add.text(18, 88, `${definition.rarity.toUpperCase()}  /  ${definition.slot.toUpperCase()}  /  ${definition.weight}kg`, {
      fontFamily: MENU_FONT.control,
      fontSize: '10px',
      fontStyle: 'bold',
      color: RARITY_COLOR[definition.rarity],
      fixedWidth: 230,
    });
    const body = scene.add.text(18, 116, definition.blurb, {
      fontFamily: MENU_FONT.body,
      fontSize: '13px',
      color: MENU_HEX.boneDim,
      fixedWidth: 230,
      wordWrap: { width: 230 },
      maxLines: 9,
    });
    this.hit = scene.add.zone(0, 0, 266, 338).setOrigin(0);
    if (enabled) this.hit.setInteractive({ useHandCursor: true });
    this.add([this.face, name, meta, body, this.hit]);
    this.hit.on('pointerover', () => this.focusRequest?.());
    this.hit.on('pointerdown', () => {
      if (this.isEnabled) this.activateCard();
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
    if (focused) {
      const definition = getItem(this.id);
      this.inspect(definition.name, definition.blurb);
    }
  }

  activate(): void {
    if (this.isEnabled) this.activateCard();
  }

  adjust(_direction: -1 | 1): boolean {
    return false;
  }

  private redraw(): void {
    const definition = getItem(this.id);
    const accent = Phaser.Display.Color.HexStringToColor(RARITY_COLOR[definition.rarity]).color;
    this.face.clear();
    this.face.fillStyle(MENU_COLOR.pitch, 1).fillRect(3, 4, 266, 338);
    this.face.fillStyle(MENU_COLOR.charcoalRaised, this.isEnabled ? 1 : 0.5).fillRect(0, 0, 266, 338);
    this.face.fillStyle(accent, this.focused ? 1 : 0.72).fillRect(0, 0, 266, 6);
    this.face.lineStyle(this.focused ? 2 : 1, this.focused ? MENU_COLOR.brassLight : MENU_COLOR.brassDark, 1)
      .strokeRect(0.5, 0.5, 265, 337);
    if (this.focused) this.face.fillStyle(MENU_COLOR.brassLight, 1).fillRect(12, 324, 242, 2);
  }
}

export class ItemDraftView extends Phaser.GameObjects.Container {
  private readonly sceneInput: SceneInput;
  private readonly focus = new MenuFocusGroup();
  private readonly inspectorTitle: Phaser.GameObjects.Text;
  private readonly inspectorBody: Phaser.GameObjects.Text;
  private disposed = false;

  constructor(
    scene: Phaser.Scene,
    snapshot: ItemDraftSnapshot,
    actions: ItemDraftActions
  ) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(95);
    addCabinetBackdrop(scene, this);

    const title = scene.add.text(58, 42, snapshot.title.toUpperCase(), {
      fontFamily: MENU_FONT.display,
      fontSize: '28px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
      fixedWidth: 900,
    });
    const subtitle = scene.add.text(60, 82, snapshot.locked ? 'Waiting for the remaining human drafts.' : snapshot.subtitle, {
      fontFamily: MENU_FONT.body,
      fontSize: '14px',
      color: MENU_HEX.boneDim,
      fixedWidth: 1120,
    });
    this.add([title, subtitle]);
    addSectionRule(scene, this, 58, 112, 1164);
    addRecess(scene, this, 58, 132, 1164, 364);

    this.inspectorTitle = scene.add.text(76, 520, 'ITEM DRAFT', {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
    });
    this.inspectorBody = scene.add.text(76, 540, snapshot.locked ? 'Another player is choosing equipment.' : 'Select one item to continue.', {
      fontFamily: MENU_FONT.body,
      fontSize: '13px',
      color: MENU_HEX.boneDim,
      fixedWidth: 760,
      wordWrap: { width: 760 },
      maxLines: 3,
    });
    this.add([this.inspectorTitle, this.inspectorBody]);

    snapshot.options.forEach((id, index) => {
      const card = new DraftCard(
        scene,
        76 + index * 282,
        148,
        id,
        !snapshot.locked,
        () => actions.pick(index),
        (cardTitle, body) => {
          this.inspectorTitle.setText(cardTitle.toUpperCase());
          this.inspectorBody.setText(body);
        }
      );
      this.add(card);
      this.focus.add(card);
    });

    const pickedNames = snapshot.picks.map((id) => getItem(id).name);
    const cart = scene.add.text(76, 610, pickedNames.length
      ? `DRAFTED  /  ${pickedNames.join('  /  ')}`
      : snapshot.locked ? 'DRAFT LOCKED' : 'NO ITEMS DRAFTED YET', {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
      fixedWidth: 860,
      wordWrap: { width: 860 },
    });
    const hint = new CabinetChip(scene, 970, 598, {
      width: 232,
      height: 42,
      label: snapshot.locked ? 'Waiting...' : 'Choose a Card',
      enabled: false,
      onActivate: () => undefined,
    });
    this.add([cart, hint]);

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
}