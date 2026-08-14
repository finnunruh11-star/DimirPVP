import Phaser from 'phaser';
import { MENU_COLOR, MENU_FONT, MENU_HEX } from './theme';

export interface CabinetButtonOptions {
  width: number;
  height?: number;
  label: string;
  detail?: string;
  index?: string;
  selected?: boolean;
  primary?: boolean;
  enabled?: boolean;
  onActivate: () => void;
  onAdjust?: (direction: -1 | 1) => void;
  onFocus?: () => void;
}

export interface MenuControl {
  readonly isEnabled: boolean;
  setFocusRequest(request: () => void): void;
  setFocused(focused: boolean): void;
  activate(): void;
  adjust(direction: -1 | 1): boolean;
}

export class CabinetButton extends Phaser.GameObjects.Container implements MenuControl {
  private readonly face: Phaser.GameObjects.Graphics;
  private readonly labelText: Phaser.GameObjects.Text;
  private readonly detailText: Phaser.GameObjects.Text;
  private readonly indexText: Phaser.GameObjects.Text;
  private readonly arrowText: Phaser.GameObjects.Text;
  private readonly hit: Phaser.GameObjects.Zone;
  private focused = false;
  private selected: boolean;
  private enabled: boolean;
  private pressed = false;
  private focusRequest: (() => void) | null = null;

  readonly controlWidth: number;
  readonly controlHeight: number;

  get isEnabled(): boolean {
    return this.enabled;
  }

  constructor(scene: Phaser.Scene, x: number, y: number, private readonly options: CabinetButtonOptions) {
    super(scene, x, y);
    scene.add.existing(this);
    this.controlWidth = options.width;
    this.controlHeight = options.height ?? 76;
    this.selected = options.selected ?? false;
    this.enabled = options.enabled ?? true;

    this.face = scene.add.graphics();
    this.labelText = scene.add.text(68, options.detail ? 14 : this.controlHeight / 2, options.label, {
      fontFamily: MENU_FONT.control,
      fontSize: options.primary ? '24px' : '21px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    }).setOrigin(0, options.detail ? 0 : 0.5);
    this.detailText = scene.add.text(68, 44, options.detail ?? '', {
      fontFamily: MENU_FONT.body,
      fontSize: '14px',
      color: MENU_HEX.boneDim,
      fixedWidth: options.width - 118,
    });
    this.indexText = scene.add.text(29, this.controlHeight / 2, options.index ?? '', {
      fontFamily: MENU_FONT.control,
      fontSize: '15px',
      fontStyle: 'bold',
      color: MENU_HEX.ink,
    }).setOrigin(0.5);
    this.arrowText = scene.add.text(options.width - 28, this.controlHeight / 2, options.onAdjust ? '< >' : '>', {
      fontFamily: MENU_FONT.control,
      fontSize: options.onAdjust ? '14px' : '24px',
      fontStyle: 'bold',
      color: MENU_HEX.brass,
    }).setOrigin(0.5);
    this.hit = scene.add.zone(0, 0, options.width, this.controlHeight).setOrigin(0);
    this.hit.setInteractive({ useHandCursor: this.enabled });
    this.add([this.face, this.labelText, this.detailText, this.indexText, this.arrowText, this.hit]);

    this.hit.on('pointerover', () => {
      if (this.enabled) this.focusRequest?.();
    });
    this.hit.on('pointerdown', () => {
      if (!this.enabled) return;
      this.pressed = true;
      this.y += 1;
      this.redraw();
    });
    const release = (activate: boolean): void => {
      if (!this.pressed) return;
      this.pressed = false;
      this.y -= 1;
      this.redraw();
      if (activate && this.enabled) this.options.onActivate();
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
    if (focused) this.options.onFocus?.();
  }

  setSelected(selected: boolean): void {
    if (this.selected === selected) return;
    this.selected = selected;
    this.redraw();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) this.hit.setInteractive({ useHandCursor: true });
    else this.hit.disableInteractive();
    this.redraw();
  }

  setCopy(label: string, detail?: string): void {
    this.labelText.setText(label);
    if (detail != null) this.detailText.setText(detail);
  }

  activate(): void {
    if (this.enabled) this.options.onActivate();
  }

  adjust(direction: -1 | 1): boolean {
    if (!this.enabled || !this.options.onAdjust) return false;
    this.options.onAdjust(direction);
    return true;
  }

  private redraw(): void {
    const width = this.controlWidth;
    const height = this.controlHeight;
    const raised = this.options.primary || this.focused || this.selected;
    const fill = this.options.primary
      ? MENU_COLOR.bone
      : raised
        ? MENU_COLOR.woodRaised
        : MENU_COLOR.charcoalRaised;
    const border = this.focused ? MENU_COLOR.brassLight : this.selected ? MENU_COLOR.verdigris : MENU_COLOR.brassDark;

    this.face.clear();
    this.face.fillStyle(MENU_COLOR.pitch, 1).fillRect(3, 4, width, height);
    this.face.fillStyle(fill, this.enabled ? 1 : 0.55).fillRect(0, 0, width, height);
    this.face.lineStyle(this.focused ? 2 : 1, border, 1).strokeRect(0.5, 0.5, width - 1, height - 1);
    this.face.fillStyle(this.selected ? MENU_COLOR.verdigris : MENU_COLOR.brass, 1).fillRect(0, 0, 6, height);
    this.face.fillStyle(this.options.primary ? MENU_COLOR.brass : MENU_COLOR.bone, this.enabled ? 1 : 0.48)
      .fillRect(13, 13, 34, height - 26);
    this.face.lineStyle(1, MENU_COLOR.ink, 0.45).strokeRect(13.5, 13.5, 33, height - 27);
    if (this.focused) {
      this.face.fillStyle(MENU_COLOR.brassLight, 1).fillRect(56, 10, 2, height - 20);
      this.face.fillStyle(MENU_COLOR.brassLight, 1).fillRect(width - 10, 8, 3, 14);
      this.face.fillRect(width - 10, height - 22, 3, 14);
    }

    const mainColor = this.options.primary ? MENU_HEX.ink : this.enabled ? MENU_HEX.bone : MENU_HEX.disabled;
    this.labelText.setColor(mainColor);
    this.detailText.setColor(this.enabled ? MENU_HEX.boneDim : MENU_HEX.disabled);
    this.arrowText.setColor(this.options.primary ? MENU_HEX.ink : this.focused ? MENU_HEX.brassLight : MENU_HEX.brass);
    this.indexText.setAlpha(this.enabled ? 1 : 0.55);
    this.setAlpha(this.enabled ? 1 : 0.72);
  }
}

export interface CabinetChipOptions {
  width: number;
  height: number;
  label: string;
  tone?: 'normal' | 'positive' | 'danger' | 'primary';
  accent?: number;
  selected?: boolean;
  enabled?: boolean;
  onActivate: () => void;
  onFocus?: () => void;
}

export class CabinetChip extends Phaser.GameObjects.Container implements MenuControl {
  private readonly face: Phaser.GameObjects.Graphics;
  private readonly labelText: Phaser.GameObjects.Text;
  private readonly hit: Phaser.GameObjects.Zone;
  private focused = false;
  private selected: boolean;
  private enabled: boolean;
  private pressed = false;
  private focusRequest: (() => void) | null = null;

  get isEnabled(): boolean {
    return this.enabled;
  }

  constructor(scene: Phaser.Scene, x: number, y: number, private readonly options: CabinetChipOptions) {
    super(scene, x, y);
    scene.add.existing(this);
    this.setSize(options.width, options.height);
    this.selected = options.selected ?? false;
    this.enabled = options.enabled ?? true;
    this.face = scene.add.graphics();
    this.labelText = scene.add.text(options.width / 2, options.height / 2, options.label, {
      fontFamily: MENU_FONT.control,
      fontSize: options.height <= 34 ? '12px' : '14px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
      align: 'center',
      fixedWidth: options.width - 10,
    }).setOrigin(0.5);
    this.hit = scene.add.zone(0, 0, options.width, options.height).setOrigin(0);
    this.add([this.face, this.labelText, this.hit]);
    this.setEnabled(this.enabled);

    this.hit.on('pointerover', () => {
      if (this.enabled) this.focusRequest?.();
    });
    this.hit.on('pointerdown', () => {
      if (!this.enabled) return;
      this.pressed = true;
      this.y += 1;
      this.redraw();
    });
    const release = (activate: boolean): void => {
      if (!this.pressed) return;
      this.pressed = false;
      this.y -= 1;
      this.redraw();
      if (activate && this.enabled) this.options.onActivate();
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
    if (focused) this.options.onFocus?.();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) this.hit.setInteractive({ useHandCursor: true });
    else this.hit.disableInteractive();
    this.redraw();
  }

  setSelected(selected: boolean): void {
    this.selected = selected;
    this.redraw();
  }

  setLabel(label: string): void {
    this.labelText.setText(label);
  }

  activate(): void {
    if (this.enabled) this.options.onActivate();
  }

  adjust(_direction: -1 | 1): boolean {
    return false;
  }

  private redraw(): void {
    const { width, height } = this.options;
    const tone = this.options.tone ?? 'normal';
    const primary = tone === 'primary';
    const accent = this.options.accent ?? (tone === 'danger'
      ? MENU_COLOR.blood
      : tone === 'positive'
        ? MENU_COLOR.verdigris
        : MENU_COLOR.brass);
    this.face.clear();
    this.face.fillStyle(MENU_COLOR.pitch, 1).fillRect(2, 3, width, height);
    this.face.fillStyle(primary ? MENU_COLOR.bone : this.selected ? MENU_COLOR.woodRaised : MENU_COLOR.charcoalRaised, this.enabled ? 1 : 0.55)
      .fillRect(0, 0, width, height);
    this.face.fillStyle(accent, this.enabled ? 1 : 0.4).fillRect(0, 0, 4, height);
    this.face.lineStyle(this.focused ? 2 : 1, this.focused ? MENU_COLOR.brassLight : this.selected ? accent : MENU_COLOR.brassDark, 1)
      .strokeRect(0.5, 0.5, width - 1, height - 1);
    if (this.selected) {
      this.face.fillStyle(MENU_COLOR.brassLight, 1).fillRect(width - 12, 7, 4, height - 14);
    }
    this.labelText.setColor(primary ? MENU_HEX.ink : this.enabled ? MENU_HEX.bone : MENU_HEX.disabled);
    this.setAlpha(this.enabled ? 1 : 0.68);
  }
}

export interface WordPlateOptions {
  width: number;
  height: number;
  label: string;
  accent: number;
  reaction?: boolean;
  selectedOrder?: number;
  onActivate: () => void;
  onFocus?: () => void;
}

export class WordPlate extends Phaser.GameObjects.Container implements MenuControl {
  private readonly face: Phaser.GameObjects.Graphics;
  private readonly labelText: Phaser.GameObjects.Text;
  private readonly metaText: Phaser.GameObjects.Text;
  private readonly hit: Phaser.GameObjects.Zone;
  private focused = false;
  private selectedOrder: number;
  private meta = '';
  private accent: number;
  private pressed = false;
  private focusRequest: (() => void) | null = null;

  readonly isEnabled = true;

  constructor(scene: Phaser.Scene, x: number, y: number, private readonly options: WordPlateOptions) {
    super(scene, x, y);
    scene.add.existing(this);
    this.selectedOrder = options.selectedOrder ?? 0;
    this.accent = options.accent;
    this.face = scene.add.graphics();
    this.labelText = scene.add.text(options.width / 2, options.height / 2 - 7, options.label, {
      fontFamily: MENU_FONT.control,
      fontSize: options.height < 56 ? '15px' : '18px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    }).setOrigin(0.5);
    this.metaText = scene.add.text(options.width / 2, options.height - 12, '', {
      fontFamily: MENU_FONT.control,
      fontSize: options.height < 56 ? '9px' : '10px',
      fontStyle: 'bold',
      color: MENU_HEX.boneDim,
    }).setOrigin(0.5);
    this.hit = scene.add.zone(0, 0, options.width, options.height).setOrigin(0);
    this.hit.setInteractive({ useHandCursor: true });
    this.add([this.face, this.labelText, this.metaText, this.hit]);

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
    if (focused) this.options.onFocus?.();
  }

  setSelectedOrder(order: number): void {
    this.selectedOrder = order;
    this.redraw();
  }

  setCopy(label: string, meta: string, accent = this.accent): void {
    this.labelText.setText(label);
    this.meta = meta;
    this.accent = accent;
    this.redraw();
  }

  activate(): void {
    this.options.onActivate();
  }

  adjust(_direction: -1 | 1): boolean {
    return false;
  }

  private redraw(): void {
    const { width, height } = this.options;
    const selected = this.selectedOrder > 0;
    this.face.clear();
    this.face.fillStyle(MENU_COLOR.pitch, 1).fillRect(2, 3, width, height);
    this.face.fillStyle(selected ? MENU_COLOR.bone : MENU_COLOR.charcoalRaised, 1)
      .fillRect(0, 0, width, height);
    this.face.fillStyle(this.accent, selected || this.focused ? 1 : 0.68).fillRect(0, 0, width, 5);
    this.face.lineStyle(this.focused ? 2 : 1, this.focused ? MENU_COLOR.brassLight : MENU_COLOR.brassDark, 1)
      .strokeRect(0.5, 0.5, width - 1, height - 1);
    if (selected) {
      this.face.fillStyle(MENU_COLOR.brass, 1).fillCircle(12, 13, 5);
      this.face.fillStyle(MENU_COLOR.ink, 1).fillCircle(12, 13, 2);
    }
    if (this.focused) {
      this.face.fillStyle(MENU_COLOR.brassLight, 1).fillRect(7, height - 8, width - 14, 2);
    }
    this.labelText.setColor(selected ? MENU_HEX.ink : MENU_HEX.bone);
    this.metaText
      .setColor(selected ? '#514735' : MENU_HEX.boneDim)
      .setText(selected ? `SLOT ${this.selectedOrder} · ${this.meta}` : this.meta);
  }
}

export class MenuFocusGroup {
  private controls: MenuControl[] = [];
  private index = -1;

  add<T extends MenuControl>(control: T): T {
    const index = this.controls.push(control) - 1;
    control.setFocusRequest(() => this.focus(index));
    if (this.index < 0) this.focus(0);
    return control;
  }

  focus(index: number): void {
    if (this.controls.length === 0) return;
    const next = (index + this.controls.length) % this.controls.length;
    if (!this.controls[next].isEnabled) return;
    this.controls.forEach((control, controlIndex) => control.setFocused(controlIndex === next));
    this.index = next;
  }

  move(direction: -1 | 1): void {
    if (this.controls.length === 0) return;
    for (let offset = 1; offset <= this.controls.length; offset++) {
      const next = (this.index + direction * offset + this.controls.length) % this.controls.length;
      if (this.controls[next].isEnabled) {
        this.focus(next);
        return;
      }
    }
  }

  adjust(direction: -1 | 1): boolean {
    return this.controls[this.index]?.adjust(direction) ?? false;
  }

  activate(): void {
    this.controls[this.index]?.activate();
  }

  clear(): void {
    this.controls = [];
    this.index = -1;
  }
}
