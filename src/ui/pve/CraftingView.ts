// The crafting bench. An Objects mage picks a template, a material for every part
// and a focus piece for every socket, the size (a short sword is a dagger, a long
// wand a staff) and how much mana to pour in, and sees the thing take shape. Then
// two d20 roll for it on the felt: the score they make sets its power, and the
// power draws its effects from what its materials can lend.

import Phaser from 'phaser';
import { playSound } from '../../audio';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config/constants';
import type { MageClass } from '../../core/Classes';
import { designProblem, effectPool, materialsValue, rollChance, rollNeeded } from '../../core/crafting/craft';
import {
  CRAFT_TEMPLATE_IDS,
  CRAFT_TEMPLATES,
  craftEffect,
  MAX_CRAFT_MANA,
  POWER_LEVELS,
  type CraftForm,
  type CraftMaterial,
  type CraftSize,
  type CraftSlot,
  type CraftTemplateId,
} from '../../core/crafting/data';
import { craftMaterial, craftWord, type CraftDesign } from '../../core/crafting/item';
import { getItem, RARITY_COLOR, type ItemId } from '../../core/Items';
import type { Mage } from '../../core/Mage';
import { SceneInput } from '../../engine/SceneInput';
import { craftersIn, memberIn, partyOf } from '../../pve/exploration/economy';
import type { ExplorationActions } from '../../pve/exploration/intents';
import type { ExplorationRun } from '../../pve/exploration/run';
import type { ShopDef } from '../../pve/exploration/shops';
import { CRAFT_ART_H, CRAFT_ART_W, paintCraft } from '../../visuals/craftArt';
import { cssColor, mixColor } from '../../visuals/daylight';
import { ensureGlowTextures, GLOW } from '../../visuals/glowTextures';
import { itemIconTexture } from '../../visuals/itemIconTextures';
import { craftTint, itemRarityColor } from '../../visuals/itemIcons';
import { bufferTexture, specKey } from '../../world/localeRender';
import { CabinetChip, MenuFocusGroup } from '../cabinet/controls';
import { isReducedMotion } from '../cabinet/motion';
import { addCabinetBackdrop, addRecess, addSectionRule, MENU_COLOR, MENU_FONT, MENU_HEX } from '../cabinet/theme';
import { drawD20 } from './d20';

export interface CraftingHooks {
  actions: ExplorationActions;
  /** A craft landed: save the run and refresh what shows it. */
  changed(): void;
  close(): void;
}

interface StockEntry {
  id: ItemId;
  count: number;
  material: CraftMaterial;
}

const ART_SCALE = 4;
const TUMBLE_MS = 1100;
const GOLD = 0xf3dc8a;

/** What each form is before any effect, in a line. */
const FORM_NOTE: Record<CraftForm, string> = {
  dagger: 'Dex weapon, pierce. Holds 1 focus piece.',
  sword: 'Strength weapon, slashing. Holds 2 focus pieces.',
  greatsword: 'Two-handed Strength weapon, +1cm reach. Holds 3 focus pieces.',
  wand: 'A wand: its own bolt, a main action that costs mana. Holds 2.',
  staff: 'A staff: spells are cast through it. Holds 3 focus pieces.',
  shortbow: 'Dex bow, range 12cm. Holds 1 focus piece.',
  longbow: 'Two-handed Dex bow, range 20cm. Holds 2 focus pieces.',
  jerkin: 'Light armour, +1 armour. Holds 1 focus piece.',
  mail: '+2 armour, -5% move. Holds 2 focus pieces.',
  plate: '+3 armour, -15% move. Holds 2 focus pieces.',
};

const pips = (rank: number): string => '\u25CF'.repeat(rank);

export class CraftingView extends Phaser.GameObjects.Container {
  private readonly sceneInput: SceneInput;
  private readonly reduced = isReducedMotion();
  private readonly textureKeys: string[] = [];
  private focus = new MenuFocusGroup();
  private stageFocus: MenuFocusGroup | null = null;
  private template: CraftTemplateId = 'sword';
  private form: CraftForm = 'sword';
  private parts: (ItemId | null)[] = [];
  private sockets: (ItemId | null)[] = [];
  private mana = 0;
  private crafter: MageClass | null;
  private message = '';
  private working = false;
  private stage: Phaser.GameObjects.Container | null = null;
  private disposed = false;

  constructor(
    scene: Phaser.Scene,
    private readonly run: ExplorationRun,
    private readonly shop: ShopDef,
    private readonly hooks: CraftingHooks,
  ) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(125);
    ensureGlowTextures(scene);
    this.crafter = craftersIn(run, hooks.actions.member)[0]?.mageClass ?? null;
    this.pickTemplate('sword', false);
    this.sceneInput = new SceneInput(scene);
    this.sceneInput.bindKeys([
      { key: 'LEFT', capture: true, run: () => this.activeFocus().move(-1) },
      { key: 'UP', capture: true, run: () => this.activeFocus().move(-1) },
      { key: 'RIGHT', capture: true, run: () => this.activeFocus().move(1) },
      { key: 'DOWN', capture: true, run: () => this.activeFocus().move(1) },
      { key: 'TAB', capture: true, run: (event) => this.activeFocus().move(event.shiftKey ? -1 : 1) },
      { key: 'SPACE', capture: true, run: () => this.activeFocus().activate() },
      { key: 'ENTER', capture: true, run: () => this.activeFocus().activate() },
      { key: 'ESC', capture: true, run: () => this.escape() },
      { key: 'Q', run: () => this.cycleTemplate(-1) },
      { key: 'E', run: () => this.cycleTemplate(1) },
    ]);
    this.render();
  }

  override destroy(fromScene?: boolean): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sceneInput.destroy();
    super.destroy(fromScene);
    for (const key of this.textureKeys) if (this.scene?.textures.exists(key)) this.scene.textures.remove(key);
  }

  /** The run changed under the bench (another player): show what is carried now. */
  refresh(): void {
    if (this.disposed || this.working || this.stage) return;
    this.settle();
    this.render();
  }

  // ---------------------------------------------------------------------------
  //  THE DESIGN
  // ---------------------------------------------------------------------------

  private activeFocus(): MenuFocusGroup {
    return this.stageFocus ?? this.focus;
  }

  private escape(): void {
    if (this.working) return;
    if (this.stage) this.backToBench();
    else this.hooks.close();
  }

  private crafterMage(): Mage | undefined {
    return this.crafter ? memberIn(this.run, this.crafter) : undefined;
  }

  private size(): CraftSize {
    const sizes = CRAFT_TEMPLATES[this.template].sizes;
    return sizes.find((size) => size.form === this.form) ?? sizes[0];
  }

  /** Every workable material of `slot` the party carries, the most valuable first. */
  private stock(slot: CraftSlot): StockEntry[] {
    const mage = this.crafterMage();
    if (!mage) return [];
    const counts = new Map<ItemId, number>();
    for (const member of partyOf(this.run)) {
      for (const id of [...member.bag, ...member.utility, ...member.pouch]) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const entries: StockEntry[] = [];
    for (const [id, count] of counts) {
      const material = craftMaterial(id);
      if (material?.slot === slot) entries.push({ id, count, material });
    }
    return entries.sort((a, b) => b.material.value - a.material.value || getItem(a.id).name.localeCompare(getItem(b.id).name));
  }

  /** How many of `id` are left for `place` (parts first, then sockets) once the other places have theirs. */
  private free(id: ItemId, place: number, count: number): number {
    return count - [...this.parts, ...this.sockets].filter((entry, index) => index !== place && entry === id).length;
  }

  private manaCap(): number {
    return Math.max(0, Math.min(MAX_CRAFT_MANA, this.crafterMage()?.mana ?? 0));
  }

  private pickTemplate(id: CraftTemplateId, render = true): void {
    const template = CRAFT_TEMPLATES[id];
    this.template = id;
    this.form = template.sizes[Math.min(1, template.sizes.length - 1)].form;
    this.parts = template.parts.map(() => null);
    this.sockets = [];
    this.settle();
    if (render) {
      playSound('ui.click');
      this.render();
    }
  }

  private cycleTemplate(step: number): void {
    if (this.stage || this.working) return;
    const at = CRAFT_TEMPLATE_IDS.indexOf(this.template);
    this.pickTemplate(CRAFT_TEMPLATE_IDS[(at + step + CRAFT_TEMPLATE_IDS.length) % CRAFT_TEMPLATE_IDS.length]);
  }

  private pickForm(form: CraftForm): void {
    this.form = form;
    this.settle();
    playSound('ui.click');
    this.render();
  }

  /** Fill empty parts from the pack, give up what is no longer carried, fit the sockets to the size. */
  private settle(): void {
    this.sockets = Array.from({ length: this.size().sockets }, (_, index) => this.sockets[index] ?? null);
    const materials = this.stock('material');
    const focus = this.stock('focus');
    const count = (list: StockEntry[], id: ItemId): number => list.find((entry) => entry.id === id)?.count ?? 0;
    this.parts.forEach((kept, index) => {
      this.parts[index] = null;
      if (kept && this.free(kept, index, count(materials, kept)) >= 1) {
        this.parts[index] = kept;
        return;
      }
      this.parts[index] = materials.find((entry) => this.free(entry.id, index, entry.count) >= 1)?.id ?? null;
    });
    this.sockets.forEach((kept, slot) => {
      const place = this.parts.length + slot;
      this.sockets[slot] = null;
      if (kept && this.free(kept, place, count(focus, kept)) >= 1) this.sockets[slot] = kept;
    });
    this.mana = Math.min(this.mana, this.manaCap());
  }

  private cyclePart(index: number, step: number): void {
    const options = this.stock('material').filter((entry) => this.free(entry.id, index, entry.count) >= 1).map((entry) => entry.id);
    if (options.length === 0) return;
    const at = options.indexOf(this.parts[index] as ItemId);
    this.parts[index] = options[(at + step + options.length) % options.length];
    playSound('ui.click');
    this.render();
  }

  private cycleSocket(slot: number, step: number): void {
    const place = this.parts.length + slot;
    const options: (ItemId | null)[] = [
      null,
      ...this.stock('focus').filter((entry) => this.free(entry.id, place, entry.count) >= 1).map((entry) => entry.id),
    ];
    const at = Math.max(0, options.indexOf(this.sockets[slot]));
    this.sockets[slot] = options[(at + step + options.length) % options.length];
    playSound('ui.click');
    this.render();
  }

  private stepMana(step: number): void {
    const next = Phaser.Math.Clamp(this.mana + step, 0, this.manaCap());
    if (next === this.mana) return;
    this.mana = next;
    playSound('ui.click');
    this.render();
  }

  private cycleCrafter(): void {
    const crafters = craftersIn(this.run, this.hooks.actions.member).map((mage) => mage.mageClass);
    if (crafters.length < 2) return;
    this.crafter = crafters[(crafters.indexOf(this.crafter as MageClass) + 1) % crafters.length];
    this.parts = this.parts.map(() => null);
    this.sockets = this.sockets.map(() => null);
    this.settle();
    playSound('ui.click');
    this.render();
  }

  private design(): CraftDesign | null {
    if (this.parts.some((part) => !part)) return null;
    return {
      template: this.template,
      form: this.form,
      parts: this.parts as ItemId[],
      sockets: this.sockets.filter((id): id is ItemId => !!id),
      mana: this.mana,
    };
  }

  // ---------------------------------------------------------------------------
  //  DRAWING THE BENCH
  // ---------------------------------------------------------------------------

  private text(x: number, y: number, value: string, size: number, color: string, options: Phaser.Types.GameObjects.Text.TextStyle = {}): Phaser.GameObjects.Text {
    const text = this.scene.add.text(x, y, value, { fontFamily: MENU_FONT.control, fontSize: `${size}px`, color, ...options });
    this.add(text);
    return text;
  }

  private chip(x: number, y: number, width: number, height: number, label: string, onActivate: () => void, options: { tone?: 'normal' | 'primary' | 'danger'; enabled?: boolean; selected?: boolean } = {}): CabinetChip {
    const chip = new CabinetChip(this.scene, x, y, { width, height, label, onActivate, ...options });
    this.add(chip);
    this.focus.add(chip);
    return chip;
  }

  /** The texture of the design as it stands, painted once per look. */
  private artTexture(): string {
    const spec = { template: this.template, form: this.form, parts: this.parts, sockets: this.sockets };
    const key = `craft-art:${specKey(spec)}`;
    if (this.scene.textures.exists(key)) return key;
    this.textureKeys.push(key);
    return bufferTexture(this.scene, key, paintCraft(spec));
  }

  private render(): void {
    this.removeAll(true);
    this.focus = new MenuFocusGroup();
    const { scene } = this;
    this.add(scene.add.zone(0, 0, GAME_WIDTH, GAME_HEIGHT).setOrigin(0).setInteractive());
    addCabinetBackdrop(scene, this);
    const mage = this.crafterMage();
    const template = CRAFT_TEMPLATES[this.template];
    const size = this.size();
    this.text(58, 38, 'CRAFTING BENCH', 28, MENU_HEX.bone, { fontFamily: MENU_FONT.display, fontStyle: 'bold' });
    this.text(60, 80, mage
      ? `${this.shop.name}  /  ${mage.name}, Objects  /  Mana ${mage.mana}/${mage.maxMana}`
      : `${this.shop.name}  /  Only an Objects mage on their feet can craft.`, 14, MENU_HEX.boneDim, { fontFamily: MENU_FONT.body });
    addSectionRule(scene, this, 58, 108, 1164);

    CRAFT_TEMPLATE_IDS.forEach((id, index) => {
      this.chip(58 + index * 160, 122, 150, 36, CRAFT_TEMPLATES[id].label, () => this.pickTemplate(id), { tone: id === this.template ? 'primary' : 'normal' });
    });
    if (craftersIn(this.run, this.hooks.actions.member).length > 1 && mage) {
      this.chip(1002, 122, 220, 36, `Crafter: ${mage.name}`, () => this.cycleCrafter());
    }

    this.renderPreview(size);
    this.renderParts(template.parts, size);
    this.renderOutlook();

    this.text(76, 600, this.message || 'Q / E: template   Esc: close', 12, this.message ? MENU_HEX.bone : MENU_HEX.boneDim, {
      fontFamily: MENU_FONT.body,
      fixedWidth: 660,
      wordWrap: { width: 660 },
      maxLines: 3,
    });
    this.chip(770, 618, 200, 42, 'Close', () => this.hooks.close());
    const design = this.design();
    const problem = !mage ? 'Nobody here can craft.' : !design ? 'Every part needs a material.' : designProblem(design);
    this.chip(990, 618, 212, 42, 'Craft', () => void this.craft(), { tone: 'primary', enabled: !problem && !this.working });
  }

  private renderPreview(size: CraftSize): void {
    const { scene } = this;
    addRecess(scene, this, 58, 170, 560, 300, MENU_COLOR.woodDeep);
    const glowTint = this.sockets.find((id) => !!id);
    const glow = scene.add.image(338, 282, GLOW.soft)
      .setTint(glowTint ? craftTint(glowTint) : MENU_COLOR.brass)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(CRAFT_ART_W * ART_SCALE * 0.9, CRAFT_ART_H * ART_SCALE * 1.4)
      .setAlpha(glowTint ? 0.22 : 0.1);
    const art = scene.add.image(338, 282, this.artTexture()).setScale(ART_SCALE);
    this.add([glow, art]);
    const main = this.parts[CRAFT_TEMPLATES[this.template].namePart];
    this.text(338, 188, `${main ? `${craftWord(main)} ` : ''}${size.label}`.toUpperCase(), 13, MENU_HEX.brassLight, { fontStyle: 'bold' }).setOrigin(0.5, 0);
    const sizes = CRAFT_TEMPLATES[this.template].sizes;
    const width = 150;
    const left = 338 - (sizes.length * (width + 10) - 10) / 2;
    sizes.forEach((option, index) => {
      this.chip(left + index * (width + 10), 386, width, 34, option.label, () => this.pickForm(option.form), {
        tone: option.form === this.form ? 'primary' : 'normal',
      });
    });
    this.text(338, 432, FORM_NOTE[size.form], 12, MENU_HEX.boneDim, { fontFamily: MENU_FONT.body, align: 'center', wordWrap: { width: 520 } }).setOrigin(0.5, 0);
  }

  private renderParts(partNames: readonly string[], size: CraftSize): void {
    const { scene } = this;
    addRecess(scene, this, 636, 170, 586, 300);
    const materials = this.stock('material');
    const focus = this.stock('focus');
    const row = (y: number, label: string, id: ItemId | null, list: StockEntry[], place: number, empty: string, cycle: (step: number) => void, canCycle: boolean): void => {
      this.text(652, y + 9, label, 11, MENU_HEX.brassLight, { fontStyle: 'bold' });
      this.chip(744, y, 34, 32, '<', () => cycle(-1), { enabled: canCycle });
      const entry = id ? list.find((stock) => stock.id === id) : undefined;
      const swatch = scene.add.rectangle(796, y + 16, 14, 14, id ? craftTint(id) : MENU_COLOR.disabled).setStrokeStyle(1, MENU_COLOR.ink);
      this.add(swatch);
      const name = entry ? getItem(entry.id).name : empty;
      const detail = entry ? `  ${entry.material.value} pts  /  ${this.free(entry.id, place, entry.count)} left` : '';
      this.text(810, y + 8, `${name}${detail}`, 13, entry ? MENU_HEX.bone : MENU_HEX.boneDim, { fixedWidth: 360 });
      this.chip(1176, y, 34, 32, '>', () => cycle(1), { enabled: canCycle });
    };
    this.text(652, 180, 'PARTS', 11, MENU_HEX.brassLight, { fontStyle: 'bold' });
    partNames.forEach((label, index) => {
      row(204 + index * 40, label.toUpperCase(), this.parts[index], materials, index, 'No part material carried', (step) => this.cyclePart(index, step), materials.length > 0);
    });
    const socketTop = 214 + partNames.length * 40;
    this.text(652, socketTop - 6, `SOCKETS  ${this.sockets.filter(Boolean).length}/${size.sockets}`, 11, MENU_HEX.brassLight, { fontStyle: 'bold' });
    this.sockets.forEach((id, slot) => {
      row(socketTop + 16 + slot * 38, `FOCUS ${slot + 1}`, id, focus, this.parts.length + slot, focus.length ? 'Empty' : 'No focus piece carried', (step) => this.cycleSocket(slot, step), focus.length > 0);
    });
    const manaY = 428;
    this.text(652, manaY + 9, 'MANA', 11, MENU_HEX.brassLight, { fontStyle: 'bold' });
    this.chip(744, manaY, 34, 32, '-', () => this.stepMana(-1), { enabled: this.mana > 0 });
    this.text(812, manaY + 4, String(this.mana), 20, MENU_HEX.bone, { fontFamily: MENU_FONT.display, fontStyle: 'bold' }).setOrigin(0.5, 0);
    this.chip(846, manaY, 34, 32, '+', () => this.stepMana(1), { enabled: this.mana < this.manaCap() });
    this.text(892, manaY + 9, `of ${this.manaCap()}  /  each mana is +1 score`, 12, MENU_HEX.boneDim, { fontFamily: MENU_FONT.body });
  }

  /** What the design could become: its score so far, what each roll would reach, and what it could draw. */
  private renderOutlook(): void {
    const { scene } = this;
    addRecess(scene, this, 58, 486, 1164, 98);
    const chosen = { parts: this.parts.filter((id): id is ItemId => !!id), sockets: this.sockets.filter((id): id is ItemId => !!id) };
    const materials = materialsValue(chosen);
    const base = materials + this.mana;
    this.text(76, 496, `SCORE   ${materials} materials  +  ${this.mana} mana  +  best of 2d20  =  ${base} + roll`, 12, MENU_HEX.bone, { fontStyle: 'bold' });
    const ladder = POWER_LEVELS.slice(1).map((level) => {
      const need = rollNeeded(base, level);
      if (need == null) return `${level.name} out of reach`;
      const roll = need <= 1 ? 'any roll' : need === 22 ? 'a 20' : need === 26 ? 'a pair' : `${need}+`;
      return `${level.name} ${roll} (${Math.round(rollChance(need) * 100)}%)`;
    });
    this.text(76, 518, ladder.join('   /   '), 12, MENU_HEX.boneDim);
    const pool = effectPool({ template: this.template, form: this.form, ...chosen })
      .map((entry) => craftEffect(entry.id))
      .sort((a, b) => b.rank - a.rank || a.label.localeCompare(b.label));
    const can = pool.length
      ? pool.map((effect) => `${effect.label} ${pips(effect.rank)}`).join('   ')
      : 'No effects yet.';
    this.text(76, 540, `CAN DRAW   ${can}`, 12, pool.length ? MENU_HEX.bone : MENU_HEX.boneDim, {
      fontFamily: MENU_FONT.body,
      fixedWidth: 1128,
      wordWrap: { width: 1128 },
      maxLines: 2,
    });
  }

  // ---------------------------------------------------------------------------
  //  THE ROLL
  // ---------------------------------------------------------------------------

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (ms <= 0 || this.disposed) {
        resolve();
        return;
      }
      this.scene.time.delayedCall(ms, () => resolve());
    });
  }

  private backToBench(): void {
    this.stage?.destroy();
    this.stage = null;
    this.stageFocus = null;
    this.settle();
    this.render();
  }

  private async craft(): Promise<void> {
    const design = this.design();
    const mage = this.crafterMage();
    if (!design || !mage || this.working || this.stage) return;
    const problem = designProblem(design);
    if (problem) {
      this.message = problem;
      playSound('ui.deny');
      this.render();
      return;
    }
    this.working = true;
    const { scene } = this;
    const reduced = this.reduced;
    const W = 760;
    const H = 640;
    const left = (GAME_WIDTH - W) / 2;
    const top = (GAME_HEIGHT - H) / 2;
    const cx = GAME_WIDTH / 2;
    const stage = scene.add.container(0, 0);
    this.add(stage);
    this.stage = stage;
    this.stageFocus = new MenuFocusGroup();

    const dim = scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, MENU_COLOR.pitch, 0.82).setOrigin(0).setInteractive();
    const frame = scene.add.graphics();
    frame.fillStyle(MENU_COLOR.pitch, 0.9).fillRect(left + 6, top + 7, W, H);
    frame.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(left, top, W, H);
    frame.fillStyle(MENU_COLOR.charcoal, 1).fillRect(left + 9, top + 9, W - 18, H - 18);
    frame.fillStyle(MENU_COLOR.felt, 1).fillRect(left + 22, top + 80, W - 44, 156);
    frame.lineStyle(1, MENU_COLOR.feltLight, 0.4);
    for (let y = top + 92; y < top + 236; y += 16) frame.lineBetween(left + 30, y, left + W - 30, y);
    frame.lineStyle(2, MENU_COLOR.brassDark, 1).strokeRect(left + 9.5, top + 9.5, W - 19, H - 19);
    frame.lineStyle(1, MENU_COLOR.brass, 0.55).strokeRect(left + 0.5, top + 0.5, W - 1, H - 1);
    frame.lineStyle(1, MENU_COLOR.brassDark, 0.9).strokeRect(left + 22.5, top + 80.5, W - 45, 155);
    const main = design.parts[CRAFT_TEMPLATES[design.template].namePart];
    const label = (value: string, x: number, y: number, size: number, color: string, display = false): Phaser.GameObjects.Text => {
      const text = scene.add.text(x, y, value, {
        fontFamily: display ? MENU_FONT.display : MENU_FONT.control,
        fontSize: `${size}px`,
        fontStyle: 'bold',
        color,
      }).setOrigin(0.5);
      stage.add(text);
      return text;
    };
    stage.add([dim, frame]);
    label(`CRAFTING  \u00B7  ${mage.name.toUpperCase()}  \u00B7  ${design.mana} MANA`, cx, top + 28, 12, MENU_HEX.brassLight).setLetterSpacing(3);
    label(`${craftWord(main)} ${this.size().label}`.toUpperCase(), cx, top + 56, 26, MENU_HEX.bone, true);

    // Two bone d20 tumbling over the felt.
    const dice = [-92, 92].map((dx) => {
      const glow = scene.add.image(cx + dx, top + 158, GLOW.soft).setTint(MENU_COLOR.brassLight).setBlendMode(Phaser.BlendModes.ADD).setScale(1.4).setAlpha(0.16);
      const rays = scene.add.image(cx + dx, top + 158, GLOW.rays).setBlendMode(Phaser.BlendModes.ADD).setScale(0.5).setAlpha(0);
      const die = scene.add.container(cx + dx, top + 158);
      const body = scene.add.graphics();
      const face = scene.add.text(0, 6, '20', { fontFamily: MENU_FONT.display, fontSize: '32px', fontStyle: 'bold', color: MENU_HEX.ink }).setOrigin(0.5);
      die.add([body, face]);
      drawD20(body, MENU_COLOR.bone, 48);
      stage.add([glow, rays, die]);
      return { glow, rays, die, body, face };
    });
    const rule = label('Best of 2d20', cx, top + 256, 14, MENU_HEX.boneDim);

    stage.setAlpha(0);
    scene.tweens.add({ targets: stage, alpha: 1, duration: reduced ? 90 : 180 });
    playSound('dice.roll');
    const tumble = scene.time.addEvent({
      delay: 70,
      loop: true,
      callback: () => dice.forEach((d) => d.face.setText(String(1 + Math.floor(Math.random() * 20)))),
    });
    if (!reduced) {
      dice.forEach((d, index) => {
        scene.tweens.add({ targets: d.die, angle: { from: index ? 26 : -26, to: index ? -26 : 26 }, duration: 140 + index * 30, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
        scene.tweens.add({ targets: d.die, scale: { from: 0.86, to: 1.08 }, duration: 110 + index * 20, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      });
    }
    const started = scene.time.now;
    const result = await this.hooks.actions.apply({ op: 'craft', shop: this.shop.id, design, crafter: this.crafter ?? undefined });
    if (this.disposed) return;
    const left_ = TUMBLE_MS - (scene.time.now - started);
    if (left_ > 0) await this.wait(reduced ? Math.min(left_, 200) : left_);
    if (this.disposed) return;
    tumble.remove(false);
    for (const d of dice) {
      scene.tweens.killTweensOf(d.die);
      d.die.setAngle(0).setScale(1);
    }

    const made = result.ok && result.item ? getItem(result.item) : undefined;
    const info = made?.crafted;
    if (!result.item || !made || !info) {
      for (const d of dice) {
        d.face.setText('?');
        drawD20(d.body, MENU_COLOR.boneDim, 48);
      }
      rule.setText(result.message || 'Crafting failed.').setColor(MENU_HEX.bone);
      playSound('ui.deny');
      this.working = false;
      this.stageButtons(top + H - 58, [{ label: 'Back', primary: true, run: () => this.backToBench() }]);
      return;
    }
    this.hooks.changed();

    // The dice settle: the one that counts shines, a pair or a 20 shines gold.
    const [a, b] = info.dice;
    const pair = a === b;
    const twenty = !pair && Math.max(a, b) === 20;
    const counts = [pair || a >= b, pair || b > a];
    dice.forEach((d, index) => {
      const value = index ? b : a;
      d.face.setText(String(value));
      const lit = counts[index];
      drawD20(d.body, lit ? (pair || twenty ? GOLD : mixColor(MENU_COLOR.bone, MENU_COLOR.brassLight, 0.35)) : MENU_COLOR.boneDim, 48);
      d.die.setAlpha(lit ? 1 : 0.7);
      if (!reduced) {
        d.die.setScale(lit ? 1.3 : 1.1);
        scene.tweens.add({ targets: d.die, scale: 1, duration: 360, ease: 'Back.Out' });
      }
      if (lit) scene.tweens.add({ targets: d.glow, alpha: 0.5, scale: 2, duration: 240, yoyo: true, hold: 220, ease: 'Sine.Out' });
      if (lit && (pair || twenty) && !reduced) {
        d.rays.setTint(0xffe7a0);
        scene.tweens.add({ targets: d.rays, alpha: 0.7, scale: 0.85, angle: 40, duration: 900, yoyo: true, ease: 'Sine.InOut' });
      }
    });
    playSound(pair || twenty ? 'dice.crit' : 'ui.confirm');
    rule.setText(pair
      ? `Pair of ${a}s: 26`
      : twenty ? 'Natural 20: 22' : `${a} and ${b}: ${Math.max(a, b)}`)
      .setColor(pair || twenty ? cssColor(GOLD) : MENU_HEX.bone);
    await this.wait(reduced ? 60 : 420);
    if (this.disposed) return;

    // The tally: materials, mana and dice make the score.
    const materials = info.score - info.mana - info.roll;
    const columns: [string, number][] = [['MATERIALS', materials], ['MANA', info.mana], ['DICE', info.roll], ['SCORE', info.score]];
    const signs = ['+', '+', '='];
    for (const [index, [name, value]] of columns.entries()) {
      const x = cx - 255 + index * 170;
      const number = label('0', x, top + 292, index === 3 ? 34 : 28, index === 3 ? MENU_HEX.brassLight : MENU_HEX.bone, true);
      label(name, x, top + 324, 11, MENU_HEX.boneDim).setLetterSpacing(2);
      if (index < 3) label(signs[index], x + 85, top + 292, 22, MENU_HEX.boneDim, true);
      if (reduced) {
        number.setText(String(value));
      } else {
        const counter = { n: 0 };
        scene.tweens.add({
          targets: counter,
          n: value,
          duration: index === 3 ? 520 : 260,
          ease: 'Cubic.Out',
          onUpdate: () => number.setText(String(Math.round(counter.n))),
          onComplete: () => number.setText(String(value)),
        });
        number.setScale(1.3);
        scene.tweens.add({ targets: number, scale: 1, duration: 260, ease: 'Back.Out' });
        playSound('ui.hover');
      }
      await this.wait(reduced ? 0 : index === 3 ? 560 : 220);
      if (this.disposed) return;
    }

    // The power it reached.
    const color = itemRarityColor(made.id);
    const stamp = label(info.level.name.toUpperCase(), cx, top + 366, 24, MENU_HEX.ink, true)
      .setBackgroundColor(RARITY_COLOR[info.level.rarity])
      .setPadding(18, 6, 18, 6);
    label(
      `Power ${info.level.level}  \u00B7  ${info.level.budget} rank${info.level.budget === 1 ? '' : 's'} of effects, at most ${info.level.maxEffects}`,
      cx, top + 398, 12, MENU_HEX.boneDim,
    );
    if (!reduced) {
      stamp.setScale(1.6).setAlpha(0);
      scene.tweens.add({ targets: stamp, scale: 1, alpha: 1, duration: 260, ease: 'Back.Out' });
    }
    playSound(info.level.level >= 4 ? 'dice.crit' : 'ui.confirm');
    await this.wait(reduced ? 0 : 320);
    if (this.disposed) return;

    // What it drew.
    const ctx = { mode: info.mode, form: info.form, element: info.element, level: info.level.level };
    if (info.effects.length === 0) label('No effects.', cx, top + 432, 14, MENU_HEX.boneDim);
    for (const [index, id] of info.effects.entries()) {
      const effect = craftEffect(id);
      const line = scene.add.text(left + 60, top + 424 + index * 19, `${pips(effect.rank)}  ${effect.label}  \u2014  ${effect.describe(ctx)}`, {
        fontFamily: MENU_FONT.body,
        fontSize: '14px',
        color: MENU_HEX.bone,
        fixedWidth: W - 120,
      });
      stage.add(line);
      if (!reduced) {
        line.setAlpha(0).setX(left + 80);
        scene.tweens.add({ targets: line, alpha: 1, x: left + 60, duration: 220, ease: 'Cubic.Out' });
        playSound('ui.hover');
      }
      await this.wait(reduced ? 0 : 200);
      if (this.disposed) return;
    }

    // The item itself.
    const icon = scene.add.image(left + 74, top + 540, itemIconTexture(scene, made.id)).setScale(3);
    const rim = scene.add.rectangle(left + 74, top + 540, 54, 54).setStrokeStyle(2, color);
    const name = scene.add.text(left + 112, top + 528, made.name, {
      fontFamily: MENU_FONT.display,
      fontSize: '20px',
      fontStyle: 'bold',
      color: cssColor(color),
    });
    const where = scene.add.text(left + 112, top + 554, `Into ${mage.name}'s bag.`, {
      fontFamily: MENU_FONT.body,
      fontSize: '12px',
      color: MENU_HEX.boneDim,
    });
    stage.add([rim, icon, name, where]);
    this.working = false;
    this.stageButtons(top + H - 58, [
      { label: 'Craft another', primary: true, run: () => this.backToBench() },
      { label: 'Close', primary: false, run: () => this.hooks.close() },
    ]);
  }

  private stageButtons(y: number, buttons: { label: string; primary: boolean; run: () => void }[]): void {
    const stage = this.stage;
    if (!stage) return;
    const width = 240;
    const left = GAME_WIDTH / 2 - (buttons.length * (width + 16) - 16) / 2;
    buttons.forEach((button, index) => {
      const chip = new CabinetChip(this.scene, left + index * (width + 16), y, {
        width,
        height: 42,
        label: button.label,
        tone: button.primary ? 'primary' : 'normal',
        onActivate: button.run,
      });
      stage.add(chip);
      this.stageFocus?.add(chip);
    });
  }
}
