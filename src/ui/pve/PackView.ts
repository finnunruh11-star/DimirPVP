// The traveller's pack outside a fight: what is worn, what is carried, and the
// words on the rack. Equip, stow, drop or hand to a companion; nothing here costs an action.

import Phaser from 'phaser';
import { playSound } from '../../audio';
import { MAGE_CLASS_DEFS, type MageClass } from '../../core/Classes';
import { getItem, type ItemId } from '../../core/Items';
import type { Mage } from '../../core/Mage';
import { isModifierWord, WORDS } from '../../core/Words';
import { SceneInput } from '../../engine/SceneInput';
import { partyXpScale } from '../../pve/exploration/coop';
import { memberIn, moneyLabel, partyOf } from '../../pve/exploration/economy';
import type { ExplorationActions, ExplorationIntent } from '../../pve/exploration/intents';
import type { ExplorationRun } from '../../pve/exploration/run';
import { xpToNext } from '../../pve/progression';
import { CabinetButton, CabinetChip, MenuFocusGroup } from '../cabinet/controls';
import { addCabinetBackdrop, addRecess, addSectionRule, MENU_COLOR, MENU_FONT, MENU_HEX } from '../cabinet/theme';
import { itemDetail } from './ShopView';

const PER_PAGE = 8;

type PackMode = 'use' | 'drop' | 'give';

export class PackView extends Phaser.GameObjects.Container {
  private readonly sceneInput: SceneInput;
  private focus = new MenuFocusGroup();
  private mode: PackMode = 'use';
  /** Who a gift goes to. */
  private giveTo: MageClass | null = null;
  private page = 0;
  private message = '';
  private disposed = false;
  private working = false;
  private inspectorTitle!: Phaser.GameObjects.Text;
  private inspectorBody!: Phaser.GameObjects.Text;

  constructor(
    scene: Phaser.Scene,
    private readonly run: ExplorationRun,
    private readonly hooks: { changed(): void; close(): void; actions: ExplorationActions },
  ) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(120);
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
      { key: 'I', run: () => this.hooks.close() },
    ]);
    this.render();
  }

  override destroy(fromScene?: boolean): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sceneInput.destroy();
    super.destroy(fromScene);
  }

  private async apply(intent: ExplorationIntent): Promise<void> {
    if (this.working) return;
    this.working = true;
    const result = await this.hooks.actions.apply(intent);
    this.working = false;
    if (this.disposed) return;
    this.message = result.message;
    playSound(result.ok ? 'ui.confirm' : 'ui.deny');
    if (result.ok) this.hooks.changed();
    this.render();
  }

  /** Redraw from the run as it now stands (another player's change landed). */
  refresh(): void {
    if (!this.disposed && !this.working) this.render();
  }

  private render(): void {
    this.removeAll(true);
    this.focus = new MenuFocusGroup();
    const { scene, run } = this;
    const leader = memberIn(run, this.hooks.actions.member);
    const others = partyOf(run).filter((mage) => mage.mageClass !== leader?.mageClass);
    if (!others.some((mage) => mage.mageClass === this.giveTo)) this.giveTo = others[0]?.mageClass ?? null;
    if (this.mode === 'give' && !this.giveTo) this.mode = 'use';
    addCabinetBackdrop(scene, this);
    this.add(scene.add.text(58, 42, 'PACK', {
      fontFamily: MENU_FONT.display,
      fontSize: '29px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    }));

    // The inspector must exist before the first button takes focus and writes to it.
    addRecess(scene, this, 58, 586, 1164, 82, MENU_COLOR.woodDeep);
    this.inspectorTitle = scene.add.text(76, 596, 'PACK', {
      fontFamily: MENU_FONT.control,
      fontSize: '11px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
    });
    this.inspectorBody = scene.add.text(76, 614, 'Choose worn gear to stow it, or carried gear to equip it.', {
      fontFamily: MENU_FONT.body,
      fontSize: '12px',
      color: MENU_HEX.boneDim,
      fixedWidth: 640,
      wordWrap: { width: 640 },
      maxLines: 3,
    });
    this.add([this.inspectorTitle, this.inspectorBody]);
    if (leader) this.renderLeader(leader);

    const mode = new CabinetChip(scene, 740, 606, {
      width: 106,
      height: 42,
      label: this.mode === 'drop' ? 'Stop' : 'Drop...',
      tone: this.mode === 'drop' ? 'danger' : 'normal',
      onActivate: () => { this.mode = this.mode === 'drop' ? 'use' : 'drop'; this.render(); },
    });
    const give = new CabinetChip(scene, 854, 606, {
      width: 106,
      height: 42,
      label: this.mode === 'give' ? 'Stop' : 'Give...',
      tone: this.mode === 'give' ? 'primary' : 'normal',
      enabled: others.length > 0,
      onActivate: () => { this.mode = this.mode === 'give' ? 'use' : 'give'; this.render(); },
    });
    const close = new CabinetChip(scene, 980, 606, {
      width: 222,
      height: 42,
      label: 'Close Pack',
      tone: 'primary',
      onActivate: () => this.hooks.close(),
    });
    this.add([mode, give, close]);
    this.focus.add(mode);
    this.focus.add(give);
    this.focus.add(close);
    if (this.mode === 'give' && others.length > 1) {
      const target = others.find((mage) => mage.mageClass === this.giveTo) ?? others[0];
      const cycle = new CabinetChip(scene, 740, 560, {
        width: 220,
        height: 30,
        label: `To: ${target.name}`,
        onActivate: () => {
          const at = others.indexOf(target);
          this.giveTo = others[(at + 1) % others.length].mageClass;
          this.render();
        },
      });
      this.add(cycle);
      this.focus.add(cycle);
    }
    if (this.message) this.inspect('Latest', this.message);
  }

  private renderLeader(leader: Mage): void {
    const { scene, run } = this;
    const words = leader.loadout.filter((word) => !isModifierWord(word)).map((word) => WORDS[word].label);
    const modifier = leader.loadout.find(isModifierWord);
    const who = partyOf(run).length > 1 ? `${leader.name}, ${MAGE_CLASS_DEFS[leader.mageClass].label}  /  ` : '';
    this.add(scene.add.text(60, 82, [
      `${who}Level ${run.level}  (${run.xp}/${xpToNext(run.level, partyXpScale(run))} XP)  /  ${moneyLabel(run.gold)}  /  ${leader.carriedWeight().toFixed(1)}/${leader.carryCap()}kg`,
    ].join(''), { fontFamily: MENU_FONT.body, fontSize: '14px', color: MENU_HEX.boneDim }));
    addSectionRule(scene, this, 58, 116, 1164);

    // Left: the mage.
    addRecess(scene, this, 58, 136, 360, 432, MENU_COLOR.woodDeep);
    const sheet = [
      leader.alive ? `Health   ${leader.hp}/${leader.maxHp}` : 'FALLEN   back at the next inn night',
      `Mana     ${leader.mana}/${leader.maxMana}`,
      `Sanity   ${leader.sanity}/${leader.maxSanity}`,
      `Luck     ${leader.luck}/${leader.maxLuck}`,
      '',
      `Strength ${leader.statStrength}`,
      `Dex      ${leader.statDex}`,
      `Int      ${leader.statInt}`,
      '',
      `Words (${words.length}/5)`,
      ...words.map((word) => `  ${word}`),
      modifier ? `Method   ${WORDS[modifier].label}` : '',
    ];
    this.add(scene.add.text(80, 152, sheet.join('\n'), {
      fontFamily: '"Consolas", monospace',
      fontSize: '14px',
      color: MENU_HEX.bone,
      lineSpacing: 4,
    }));

    // Right: everything worn and carried.
    addRecess(scene, this, 438, 136, 784, 432);
    const worn: { id: ItemId; where: string }[] = [
      ...leader.hands.map((id) => ({ id, where: 'In hand' })),
      ...(leader.head ? [{ id: leader.head, where: 'Head' }] : []),
      ...(leader.torso ? [{ id: leader.torso, where: 'Torso' }] : []),
      ...(leader.boots ? [{ id: leader.boots, where: 'Boots' }] : []),
      ...leader.accessories.map((id) => ({ id, where: 'Accessory' })),
    ];
    const carried = [...leader.bag, ...leader.utility];
    const counts = new Map<ItemId, number>();
    for (const id of carried) counts.set(id, (counts.get(id) ?? 0) + 1);
    const entries: { label: string; detail: string; enabled: boolean; run: () => void }[] = [];
    for (const item of worn) {
      const def = getItem(item.id);
      entries.push({
        label: `${item.where}: ${def.name}`,
        detail: itemDetail(def),
        enabled: this.mode === 'use',
        run: () => void this.apply({ op: 'unequip', item: item.id }),
      });
    }
    const target = this.giveTo ? partyOf(run).find((mage) => mage.mageClass === this.giveTo) : undefined;
    for (const [id, count] of counts) {
      const def = getItem(id);
      const equippable = def.slot !== 'utility' && leader.canEquipFromBag(id);
      const action = this.mode === 'drop' ? '  /  drop one'
        : this.mode === 'give' ? `  /  give one to ${target?.name ?? 'nobody'}`
        : equippable ? '  /  equip' : '';
      entries.push({
        label: `${def.name}${count > 1 ? ` x${count}` : ''}${action}`,
        detail: itemDetail(def),
        enabled: this.mode === 'drop' ? !def.permanentlyBinding : this.mode === 'give' ? !!target : equippable,
        run: () => void this.apply(
          this.mode === 'drop' ? { op: 'drop', item: id }
            : this.mode === 'give' && this.giveTo ? { op: 'give', item: id, to: this.giveTo }
            : { op: 'equip', item: id },
        ),
      });
    }
    if (leader.arrows > 0) {
      entries.push({ label: `Arrows x${leader.arrows}`, detail: 'Ammunition for bows.', enabled: false, run: () => undefined });
    }
    const pages = Math.max(1, Math.ceil(entries.length / PER_PAGE));
    this.page = Math.min(this.page, pages - 1);
    entries.slice(this.page * PER_PAGE, (this.page + 1) * PER_PAGE).forEach((entry, index) => {
      const button = new CabinetButton(scene, 452 + (index % 2) * 384, 150 + Math.floor(index / 2) * 92, {
        width: 372,
        height: 82,
        label: entry.label,
        detail: entry.detail.split('\n')[0],
        index: String(index + 1),
        enabled: entry.enabled,
        onActivate: entry.run,
        onFocus: () => this.inspect(entry.label, entry.detail),
      });
      this.add(button);
      this.focus.add(button);
    });
    if (pages > 1) {
      for (const [label, step, x] of [['Previous', -1, 700], ['Next', 1, 900]] as const) {
        const chip = new CabinetChip(scene, x, 530, {
          width: 120,
          height: 30,
          label,
          enabled: step < 0 ? this.page > 0 : this.page < pages - 1,
          onActivate: () => { this.page += step; this.render(); },
        });
        this.add(chip);
        this.focus.add(chip);
      }
    }
  }

  private inspect(title: string, body: string): void {
    this.inspectorTitle.setText(title.toUpperCase());
    this.inspectorBody.setText(body);
  }
}
