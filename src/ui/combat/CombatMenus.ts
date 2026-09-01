import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config/constants';
import { SceneInput } from '../../engine/SceneInput';
import { CabinetButton, CabinetChip, MenuFocusGroup } from '../cabinet/controls';
import { MENU_COLOR, MENU_FONT, MENU_HEX, addRecess } from '../cabinet/theme';

export interface CabinetActionEntry {
  id: string;
  label: string;
  hotkey: string;
  desc: string;
  enabled: boolean;
  reason?: string;
  run: () => void;
}

export interface CabinetActionSection {
  title: string;
  entries: CabinetActionEntry[];
}

export interface ActionMenuOptions {
  title: string;
  sections: CabinetActionSection[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onActivate: (entry: CabinetActionEntry, pointer: boolean) => void;
  onDismiss: (pointer: boolean) => void;
}

export class ActionMenuView extends Phaser.GameObjects.Container {
  readonly rowsPerColumn: number;

  private readonly focus = new MenuFocusGroup();
  private readonly inspectorTitle: Phaser.GameObjects.Text;
  private readonly inspectorBody: Phaser.GameObjects.Text;
  private readonly entries: CabinetActionEntry[];

  constructor(scene: Phaser.Scene, private readonly options: ActionMenuOptions) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(98);
    this.entries = options.sections.flatMap((section) => section.entries);

    const dim = scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.76)
      .setOrigin(0)
      .setInteractive();
    dim.on('pointerdown', () => options.onDismiss(true));
    const frame = scene.add.graphics();
    frame.fillStyle(MENU_COLOR.pitch, 1).fillRect(78, 36, 1124, 648);
    frame.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(88, 46, 1104, 628);
    frame.fillStyle(MENU_COLOR.charcoal, 1).fillRect(102, 60, 1076, 600);
    frame.lineStyle(2, MENU_COLOR.brassDark, 1).strokeRect(102.5, 60.5, 1075, 599);
    frame.fillStyle(options.title === 'REACTION' ? MENU_COLOR.blood : MENU_COLOR.brass, 1)
      .fillRect(102, 60, 1076, 5);
    const title = scene.add.text(128, 82, options.title, {
      fontFamily: MENU_FONT.display,
      fontSize: '26px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    });
    const subtitle = scene.add.text(128, 118, 'Choose a command. Disabled actions remain listed for context.', {
      fontFamily: MENU_FONT.body,
      fontSize: '13px',
      color: MENU_HEX.boneDim,
    });
    const close = new CabinetChip(scene, 1044, 82, {
      width: 108,
      height: 38,
      label: 'Close',
      onActivate: () => options.onDismiss(true),
    });
    this.add([dim, frame, title, subtitle, close]);

    const totalRows = options.sections.reduce((sum, section) => sum + section.entries.length, 0);
    // Section headings also consume vertical space; split earlier so a full
    // action palette always remains inside the 720px canvas.
    const twoColumns = totalRows > 8;
    this.rowsPerColumn = Math.max(1, Math.ceil(totalRows / (twoColumns ? 2 : 1)));
    const columns = this.splitSections(options.sections, twoColumns ? 2 : 1);
    let entryIndex = 0;
    columns.forEach((sections, column) => {
      const x = twoColumns ? 128 + column * 522 : 318;
      const width = twoColumns ? 494 : 644;
      let y = 154;
      for (const section of sections) {
        const heading = scene.add.text(x, y, section.title, {
          fontFamily: MENU_FONT.control,
          fontSize: '10px',
          fontStyle: 'bold',
          color: MENU_HEX.brass,
        });
        this.add(heading);
        y += 20;
        for (const entry of section.entries) {
          const index = entryIndex++;
          const row = new CabinetChip(scene, x, y, {
            width,
            height: 34,
            label: `[${entry.hotkey}]  ${entry.label}`,
            tone: entry.id === 'end' || entry.id === 'pass' ? 'primary' : 'normal',
            enabled: entry.enabled,
            onActivate: () => options.onActivate(entry, true),
            onFocus: () => {
              options.onSelect(index);
              this.showEntry(entry);
            },
          });
          this.add(row);
          this.focus.add(row);
          y += 39;
        }
        y += 7;
      }
    });

    addRecess(scene, this, 128, 574, 1024, 62, MENU_COLOR.woodDeep);
    this.inspectorTitle = scene.add.text(144, 586, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '11px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
    });
    this.inspectorBody = scene.add.text(144, 606, '', {
      fontFamily: MENU_FONT.body,
      fontSize: '12px',
      color: MENU_HEX.boneDim,
      fixedWidth: 980,
      wordWrap: { width: 980 },
    });
    this.add([this.inspectorTitle, this.inspectorBody]);
    this.setSelection(options.selectedIndex);
  }

  setSelection(index: number): void {
    if (index < 0 || index >= this.entries.length) return;
    this.focus.focus(index);
    this.showEntry(this.entries[index]);
  }

  private showEntry(entry: CabinetActionEntry): void {
    this.inspectorTitle.setText(entry.label.toUpperCase());
    this.inspectorBody
      .setText(entry.enabled ? entry.desc : entry.reason ?? entry.desc)
      .setColor(entry.enabled ? MENU_HEX.boneDim : '#cf8d82');
  }

  private splitSections(sections: CabinetActionSection[], count: number): CabinetActionSection[][] {
    if (count === 1) return [sections];
    const total = sections.reduce((sum, section) => sum + section.entries.length + 1, 0);
    const columns: CabinetActionSection[][] = [[], []];
    let used = 0;
    for (const section of sections) {
      const weight = section.entries.length + 1;
      const column = used > 0 && used + weight / 2 > total / 2 ? 1 : 0;
      columns[column].push(section);
      if (column === 0) used += weight;
    }
    return columns;
  }
}

export interface ChoiceOption<T extends string> {
  id: T;
  label: string;
  detail: string;
  enabled?: boolean;
}

export class ChoiceMenuView<T extends string> extends Phaser.GameObjects.Container {
  private readonly sceneInput: SceneInput;
  private readonly focus = new MenuFocusGroup();
  private disposed = false;

  constructor(
    scene: Phaser.Scene,
    titleText: string,
    subtitleText: string,
    options: readonly ChoiceOption<T>[],
    choose: (id: T) => void,
    dismiss?: () => void
  ) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(97);
    const dim = scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.76)
      .setOrigin(0);
    if (dismiss) dim.setInteractive().on('pointerdown', dismiss);
    const width = 620;
    const height = 236 + options.length * 76;
    const left = (GAME_WIDTH - width) / 2;
    const top = (GAME_HEIGHT - height) / 2;
    const frame = scene.add.graphics();
    frame.fillStyle(MENU_COLOR.pitch, 1).fillRect(left - 8, top - 8, width + 16, height + 16);
    frame.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(left, top, width, height);
    frame.fillStyle(MENU_COLOR.charcoal, 1).fillRect(left + 14, top + 14, width - 28, height - 28);
    frame.lineStyle(2, MENU_COLOR.brassDark, 1).strokeRect(left + 14.5, top + 14.5, width - 29, height - 29);
    frame.fillStyle(MENU_COLOR.amethyst, 1).fillRect(left + 14, top + 14, width - 28, 5);
    const title = scene.add.text(GAME_WIDTH / 2, top + 38, titleText, {
      fontFamily: MENU_FONT.display,
      fontSize: '24px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    }).setOrigin(0.5, 0);
    const subtitle = scene.add.text(GAME_WIDTH / 2, top + 72, subtitleText, {
      fontFamily: MENU_FONT.body,
      fontSize: '13px',
      color: MENU_HEX.boneDim,
      fixedWidth: width - 70,
      align: 'center',
      wordWrap: { width: width - 70 },
    }).setOrigin(0.5, 0);
    this.add([dim, frame, title, subtitle]);

    options.forEach((option, index) => {
      const button = new CabinetButton(scene, left + 38, top + 122 + index * 76, {
        width: width - 76,
        height: 64,
        label: option.label,
        detail: option.detail,
        index: String(index + 1),
        enabled: option.enabled ?? true,
        onActivate: () => choose(option.id),
      });
      this.add(button);
      this.focus.add(button);
    });
    if (dismiss) {
      const close = new CabinetChip(scene, GAME_WIDTH / 2 - 70, top + height - 58, {
        width: 140,
        height: 36,
        label: 'Cancel',
        onActivate: dismiss,
      });
      this.add(close);
      this.focus.add(close);
    }

    this.sceneInput = new SceneInput(scene);
    this.sceneInput.bindKeys([
      { key: 'UP', capture: true, run: () => this.focus.move(-1) },
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

export class PagedChoiceMenuView<T extends string> extends Phaser.GameObjects.Container {
  private readonly sceneInput: SceneInput;
  private readonly content: Phaser.GameObjects.Container;
  private readonly pageText: Phaser.GameObjects.Text;
  private readonly focus = new MenuFocusGroup();
  private page = 0;
  private disposed = false;

  constructor(
    scene: Phaser.Scene,
    titleText: string,
    subtitleText: string,
    private readonly options: readonly ChoiceOption<T>[],
    private readonly choose: (id: T) => void,
    private readonly dismiss: () => void,
  ) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(105);

    const left = 130;
    const top = 62;
    const width = 1020;
    const height = 596;
    const dim = scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.78)
      .setOrigin(0)
      .setInteractive();
    dim.on('pointerdown', dismiss);
    const frame = scene.add.graphics();
    frame.fillStyle(MENU_COLOR.pitch, 1).fillRect(left - 8, top - 8, width + 16, height + 16);
    frame.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(left, top, width, height);
    frame.fillStyle(MENU_COLOR.charcoal, 1).fillRect(left + 14, top + 14, width - 28, height - 28);
    frame.lineStyle(2, MENU_COLOR.brassDark, 1).strokeRect(left + 14.5, top + 14.5, width - 29, height - 29);
    frame.fillStyle(MENU_COLOR.amethyst, 1).fillRect(left + 14, top + 14, width - 28, 5);
    const title = scene.add.text(GAME_WIDTH / 2, top + 37, titleText, {
      fontFamily: MENU_FONT.display,
      fontSize: '25px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    }).setOrigin(0.5, 0);
    const subtitle = scene.add.text(GAME_WIDTH / 2, top + 74, subtitleText, {
      fontFamily: MENU_FONT.body,
      fontSize: '13px',
      color: MENU_HEX.boneDim,
      fixedWidth: width - 100,
      align: 'center',
      wordWrap: { width: width - 100 },
    }).setOrigin(0.5, 0);
    this.content = scene.add.container(0, 0);
    this.pageText = scene.add.text(GAME_WIDTH / 2, top + height - 80, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      color: MENU_HEX.brassLight,
    }).setOrigin(0.5);
    this.add([dim, frame, title, subtitle, this.content, this.pageText]);

    this.sceneInput = new SceneInput(scene);
    this.sceneInput.bindKeys([
      { key: 'UP', capture: true, run: () => this.focus.move(-1) },
      { key: 'DOWN', capture: true, run: () => this.focus.move(1) },
      { key: 'TAB', capture: true, run: (event) => this.focus.move(event.shiftKey ? -1 : 1) },
      { key: 'LEFT', capture: true, run: () => this.changePage(-1) },
      { key: 'RIGHT', capture: true, run: () => this.changePage(1) },
      { key: 'SPACE', capture: true, run: () => this.focus.activate() },
      { key: 'ENTER', capture: true, run: () => this.focus.activate() },
      { key: 'ESC', capture: true, run: dismiss },
    ]);
    this.renderPage();
  }

  private get pageCount(): number {
    return Math.max(1, Math.ceil(this.options.length / 8));
  }

  private changePage(direction: -1 | 1): void {
    const next = Phaser.Math.Clamp(this.page + direction, 0, this.pageCount - 1);
    if (next === this.page) return;
    this.page = next;
    this.renderPage();
  }

  private renderPage(): void {
    this.content.removeAll(true);
    this.focus.clear();
    const start = this.page * 8;
    const visible = this.options.slice(start, start + 8);
    visible.forEach((option, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const button = new CabinetButton(this.scene, 164 + column * 486, 188 + row * 82, {
        width: 466,
        height: 70,
        label: option.label,
        detail: option.detail,
        index: String(start + index + 1),
        enabled: option.enabled ?? true,
        onActivate: () => this.choose(option.id),
      });
      this.content.add(button);
      this.focus.add(button);
    });

    const previous = new CabinetChip(this.scene, 164, 595, {
      width: 132,
      height: 36,
      label: 'Previous',
      enabled: this.page > 0,
      onActivate: () => this.changePage(-1),
    });
    const cancel = new CabinetChip(this.scene, 570, 595, {
      width: 140,
      height: 36,
      label: 'Cancel',
      tone: 'danger',
      onActivate: this.dismiss,
    });
    const next = new CabinetChip(this.scene, 984, 595, {
      width: 132,
      height: 36,
      label: 'Next',
      enabled: this.page < this.pageCount - 1,
      onActivate: () => this.changePage(1),
    });
    this.content.add([previous, cancel, next]);
    this.focus.add(previous);
    this.focus.add(cancel);
    this.focus.add(next);
    this.pageText.setText(`PAGE ${this.page + 1} / ${this.pageCount}`);
  }

  override destroy(fromScene?: boolean): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sceneInput.destroy();
    super.destroy(fromScene);
  }
}

export interface MultiSelectOption<T extends string> {
  id: T;
  label: string;
  detail: string;
}

export class MultiSelectView<T extends string> extends Phaser.GameObjects.Container {
  private readonly sceneInput: SceneInput;
  private readonly focus = new MenuFocusGroup();
  private readonly selected = new Set<T>();
  private readonly buttons = new Map<T, CabinetButton>();
  private readonly confirm: CabinetChip;
  private disposed = false;

  constructor(
    scene: Phaser.Scene,
    titleText: string,
    subtitleText: string,
    options: readonly MultiSelectOption<T>[],
    private readonly maximum: number,
    finish: (selected: T[]) => void
  ) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(110);
    const dim = scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.78).setOrigin(0);
    const frame = scene.add.graphics();
    frame.fillStyle(MENU_COLOR.pitch, 1).fillRect(128, 74, 1024, 572);
    frame.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(138, 84, 1004, 552);
    frame.fillStyle(MENU_COLOR.charcoal, 1).fillRect(152, 98, 976, 524);
    frame.lineStyle(2, MENU_COLOR.brassDark, 1).strokeRect(152.5, 98.5, 975, 523);
    frame.fillStyle(MENU_COLOR.brass, 1).fillRect(152, 98, 976, 5);
    const title = scene.add.text(640, 120, titleText, {
      fontFamily: MENU_FONT.display,
      fontSize: '25px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    }).setOrigin(0.5, 0);
    const subtitle = scene.add.text(640, 157, subtitleText, {
      fontFamily: MENU_FONT.body,
      fontSize: '13px',
      color: MENU_HEX.boneDim,
      fixedWidth: 900,
      align: 'center',
    }).setOrigin(0.5, 0);
    this.add([dim, frame, title, subtitle]);
    options.forEach((option, index) => {
      const button = new CabinetButton(scene, 178 + (index % 2) * 472, 206 + Math.floor(index / 2) * 94, {
        width: 450,
        height: 78,
        label: option.label,
        detail: option.detail,
        index: String(index + 1),
        onActivate: () => this.toggle(option.id),
      });
      this.buttons.set(option.id, button);
      this.add(button);
      this.focus.add(button);
    });
    this.confirm = new CabinetChip(scene, 510, 556, {
      width: 260,
      height: 44,
      label: 'Choose at least one',
      tone: 'primary',
      enabled: false,
      onActivate: () => finish([...this.selected]),
    });
    this.add(this.confirm);
    this.focus.add(this.confirm);
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

  private toggle(id: T): void {
    if (this.selected.has(id)) this.selected.delete(id);
    else if (this.selected.size < this.maximum) this.selected.add(id);
    for (const [option, button] of this.buttons) button.setSelected(this.selected.has(option));
    this.confirm.setEnabled(this.selected.size > 0);
    this.confirm.setLabel(this.selected.size > 0
      ? `Confirm ${this.selected.size}/${this.maximum}`
      : 'Choose at least one');
  }
}