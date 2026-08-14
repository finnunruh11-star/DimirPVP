import Phaser from 'phaser';
import { STAT_BUILD_DEFS, STAT_BUILD_IDS, STAT_DEFS, type DieResult, type StatBuildId } from '../../core/Stats';
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

export interface StatAssignmentSnapshot {
  title: string;
  dice: readonly DieResult[];
  placement: readonly (number | null)[];
  selectedDie: number | null;
  locked: boolean;
}

export interface StatAssignmentActions {
  selectDie(index: number): void;
  selectSlot(index: number): void;
  applyBuild(build: StatBuildId): void;
  confirm(): void;
}

export class StatAssignmentView extends Phaser.GameObjects.Container {
  private readonly sceneInput: SceneInput;
  private readonly focus = new MenuFocusGroup();
  private disposed = false;

  constructor(
    scene: Phaser.Scene,
    snapshot: StatAssignmentSnapshot,
    actions: StatAssignmentActions
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
      fixedWidth: 910,
    });
    const subtitle = scene.add.text(60, 82, snapshot.locked
      ? 'The other player is assigning the shared dice.'
      : 'Choose a quick build, or select a die and then an attribute socket.', {
      fontFamily: MENU_FONT.body,
      fontSize: '14px',
      color: MENU_HEX.boneDim,
    });
    this.add([title, subtitle]);
    addSectionRule(scene, this, 58, 112, 1164);
    addRecess(scene, this, 58, 132, 1164, 108);
    addRecess(scene, this, 58, 306, 1164, 284);

    const diceHeading = scene.add.text(76, 144, 'ROLLED DICE', {
      fontFamily: MENU_FONT.control,
      fontSize: '11px',
      fontStyle: 'bold',
      color: MENU_HEX.brass,
    });
    this.add(diceHeading);
    const dieWidth = 176;
    snapshot.dice.forEach((die, index) => {
      const slot = snapshot.placement.indexOf(index);
      const selected = snapshot.selectedDie === index;
      const button = new CabinetButton(scene, 76 + index * 188, 166, {
        width: dieWidth,
        height: 58,
        label: `${die.spec.toUpperCase()}  /  ${die.value}`,
        detail: selected ? 'HELD' : slot >= 0 ? STAT_DEFS[slot].name.toUpperCase() : 'AVAILABLE',
        index: String(index + 1),
        selected,
        enabled: !snapshot.locked,
        onActivate: () => actions.selectDie(index),
        onFocus: () => undefined,
      });
      this.add(button);
      this.focus.add(button);
    });

    const buildsHeading = scene.add.text(76, 258, 'QUICK BUILDS', {
      fontFamily: MENU_FONT.control,
      fontSize: '11px',
      fontStyle: 'bold',
      color: MENU_HEX.brass,
    });
    this.add(buildsHeading);
    STAT_BUILD_IDS.forEach((build, index) => {
      const definition = STAT_BUILD_DEFS[build];
      const chip = new CabinetChip(scene, 194 + index * 300, 250, {
        width: 282,
        height: 40,
        label: `[${index + 1}]  ${definition.label.toUpperCase()}`,
        enabled: !snapshot.locked,
        onActivate: () => actions.applyBuild(build),
      });
      this.add(chip);
      this.focus.add(chip);
    });

    const attributesHeading = scene.add.text(76, 318, 'ARCANE ATTRIBUTES', {
      fontFamily: MENU_FONT.control,
      fontSize: '11px',
      fontStyle: 'bold',
      color: MENU_HEX.brass,
    });
    this.add(attributesHeading);
    STAT_DEFS.forEach((definition, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const dieIndex = snapshot.placement[index];
      const value = dieIndex == null ? 'EMPTY' : String(snapshot.dice[dieIndex]?.value ?? '');
      const button = new CabinetButton(scene, 76 + column * 568, 342 + row * 76, {
        width: 550,
        height: 64,
        label: `${definition.name}: ${value}`,
        detail: definition.blurb,
        index: String(index + 1),
        selected: dieIndex != null,
        enabled: !snapshot.locked,
        onActivate: () => actions.selectSlot(index),
      });
      this.add(button);
      this.focus.add(button);
    });

    const complete = snapshot.placement.length === 6 && snapshot.placement.every((value) => value != null);
    const status = scene.add.text(76, 612, snapshot.locked
      ? 'Waiting for the remaining human assignments.'
      : complete
        ? 'Every die is seated. The allocation is ready.'
        : snapshot.selectedDie == null
          ? 'Select an available die or use a quick build.'
          : `Holding ${snapshot.dice[snapshot.selectedDie]?.spec ?? 'die'}: ${snapshot.dice[snapshot.selectedDie]?.value ?? ''}. Choose an attribute.`, {
      fontFamily: MENU_FONT.body,
      fontSize: '13px',
      color: MENU_HEX.boneDim,
      fixedWidth: 760,
    });
    const confirm = new CabinetChip(scene, 970, 606, {
      width: 232,
      height: 44,
      label: snapshot.locked ? 'Waiting...' : 'Confirm Allocation',
      tone: 'primary',
      enabled: complete && !snapshot.locked,
      onActivate: actions.confirm,
    });
    this.add([status, confirm]);
    this.focus.add(confirm);

    this.sceneInput = new SceneInput(scene);
    this.sceneInput.bindKeys([
      { key: 'UP', capture: true, run: () => this.focus.move(-1) },
      { key: 'LEFT', capture: true, run: () => this.focus.move(-1) },
      { key: 'DOWN', capture: true, run: () => this.focus.move(1) },
      { key: 'RIGHT', capture: true, run: () => this.focus.move(1) },
      { key: 'TAB', capture: true, run: (event) => this.focus.move(event.shiftKey ? -1 : 1) },
      { key: 'SPACE', capture: true, run: () => this.focus.activate() },
    ]);
  }

  override destroy(fromScene?: boolean): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sceneInput.destroy();
    super.destroy(fromScene);
  }
}