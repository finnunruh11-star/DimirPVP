// The traveller's pack outside a fight: a paper doll of what is worn, the pack
// itself as a grid of slots sorted by kind, and a card that explains whatever
// is selected with its actions underneath. Nothing is lost without asking:
// dropping and giving ask how many and to whom, and putting out a torch that
// has burned says so first. Nothing here costs an action.

import Phaser from 'phaser';
import { playSound } from '../../audio';
import { RANGE_UNIT } from '../../config/constants';
import { MAGE_CLASS_DEFS } from '../../core/Classes';
import { getItem, isWornSlot, WORN_SLOTS, type ItemId } from '../../core/Items';
import type { PaperKind } from '../../core/hexcraft/runes';
import type { Mage } from '../../core/Mage';
import { packCanStow, packCapacity, packFits, packSlotsUsed, slotsForCount } from '../../core/Pack';
import { isModifierWord, WORDS } from '../../core/Words';
import { SceneInput } from '../../engine/SceneInput';
import { levelsOwed, partyXpScale } from '../../pve/exploration/coop';
import { carriedCount, changesHands, itemWorth, memberIn, moneyLabel, MOONSHARD_WORDS, partyOf } from '../../pve/exploration/economy';
import { fieldSpellMana } from '../../pve/exploration/fieldWords';
import type { ExplorationActions, ExplorationIntent } from '../../pve/exploration/intents';
import type { ExplorationRun } from '../../pve/exploration/run';
import { rackIsFull, xpToNext } from '../../pve/progression';
import { castOddsLabel } from '../../spells/castOdds';
import { ALL_SPELL_SETS, allSpells, rackCoverage } from '../../spells/registry';
import type { Spell } from '../../spells/Spell';
import { CabinetButton, CabinetChip } from '../cabinet/controls';
import { addCabinetBackdrop, addSectionRule, MENU_COLOR, MENU_FONT, MENU_HEX } from '../cabinet/theme';
import { ChoiceMenuView } from '../combat/CombatMenus';
import {
  addEmptyCard,
  addItemCard,
  addKeyHints,
  addMeter,
  addPanel,
  addPaperDoll,
  addPursePlate,
  ConfirmDialog,
  dollAccepts,
  dollEntries,
  DOLL_LABEL,
  DragController,
  drawSocket,
  gridSpot,
  ItemTile,
  SpatialFocus,
  TILE,
  TILE_PITCH,
  type CardLine,
  type DialogKey,
  type DialogOptions,
  type DollSlot,
  type DragPayload,
  type DropTarget,
  type Direction,
} from '../inventory/kit';
import { carriedStacks, FILTERS, kg, matchesFilter, packCells, type ItemFilter } from '../inventory/itemInfo';
import { addJourneyStrip } from './JourneyStrip';
import { HexDrawView } from './HexDrawView';

/** Adventure fights cast from every catalogue (LocaleScene / GameScene). */
const ADVENTURE_SPELLS = ALL_SPELL_SETS;
const COLUMNS = 7;
const ROWS = 5;
const PAGE = COLUMNS * ROWS;
const SPELLS_PER_PAGE = 10;

const DOLL = { x: 58, y: 128, w: 300, h: 444 };
const PACK = { x: 376, y: 128, w: 470, h: 444 };
const CARD = { x: 864, y: 128, w: 358, h: 444 };
const GRID = { x: PACK.x + 14 + Math.floor((PACK.w - 28 - (COLUMNS * TILE_PITCH - 6)) / 2), y: PACK.y + 78 };

interface Selection {
  from: 'worn' | 'pack';
  id: ItemId;
}

interface PackAction {
  label: string;
  enabled: boolean;
  tone?: 'primary' | 'positive' | 'danger' | 'normal';
  run: () => void;
}

export class PackView extends Phaser.GameObjects.Container {
  private readonly sceneInput: SceneInput;
  private focus = new SpatialFocus();
  private filter: ItemFilter = 'all';
  private showSpells = false;
  private page = 0;
  private spellPage = 0;
  private selection: Selection | null = null;
  private message = '';
  private messageOk = true;
  private disposed = false;
  private working = false;
  private renderQueued = false;
  private dialog: ConfirmDialog | null = null;
  /** The Draw Hex table, open over the pack. */
  private table: HexDrawView | null = null;
  private shardChoice: ChoiceMenuView<string> | null = null;
  private actions: { primary?: PackAction; give?: PackAction; drop?: PackAction } = {};
  private spellNote: { title: string; body: string } | null = null;
  private readonly drag: DragController;

  constructor(
    scene: Phaser.Scene,
    private readonly run: ExplorationRun,
    private readonly hooks: { changed(): void; close(): void; actions: ExplorationActions },
    private readonly pendingFind?: ItemId,
  ) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(120);
    this.drag = new DragController(scene, this.depth + 5, (payload, target) => this.dropped(payload, target));
    this.sceneInput = new SceneInput(scene);
    const free = (): boolean => !this.table && !this.shardChoice && !this.disposed;
    const routed = (key: DialogKey, fallback: (event: KeyboardEvent) => void) => (event: KeyboardEvent): void => {
      if (!free()) return;
      if (this.dialog) this.dialog.key(key, event.shiftKey);
      else fallback(event);
    };
    const plain = (run: () => void) => (): void => {
      if (free() && !this.dialog) run();
    };
    const arrow = (direction: Direction) => (): void => this.focus.move(direction);
    this.sceneInput.bindKeys([
      { key: 'LEFT', capture: true, run: routed('LEFT', arrow('left')) },
      { key: 'RIGHT', capture: true, run: routed('RIGHT', arrow('right')) },
      { key: 'UP', capture: true, run: routed('UP', arrow('up')) },
      { key: 'DOWN', capture: true, run: routed('DOWN', arrow('down')) },
      { key: 'TAB', capture: true, run: routed('TAB', (event) => this.focus.cycle(event.shiftKey ? -1 : 1)) },
      { key: 'SPACE', capture: true, run: routed('SPACE', () => this.focus.activate()) },
      { key: 'ENTER', capture: true, run: routed('ENTER', () => this.focus.activate()) },
      { key: 'ESC', capture: true, run: routed('ESC', () => this.hooks.close()) },
      { key: 'I', run: plain(() => this.hooks.close()) },
      { key: 'Q', run: plain(() => this.cycleFilter(-1)) },
      { key: 'E', run: plain(() => this.cycleFilter(1)) },
      { key: 'S', run: plain(() => this.toggleSpells()) },
      { key: 'F', run: plain(() => this.runAction('primary')) },
      { key: 'G', run: plain(() => this.runAction('give')) },
      { key: 'X', run: plain(() => this.runAction('drop')) },
    ]);
    if (pendingFind) {
      this.message = `Make room for ${getItem(pendingFind).name} (${getItem(pendingFind).weight} kg): drop or hand over something, then close the pack.`;
      this.messageOk = false;
    }
    this.render();
  }

  override destroy(fromScene?: boolean): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dialog?.destroy();
    this.dialog = null;
    this.table?.destroy();
    this.table = null;
    this.shardChoice?.destroy();
    this.shardChoice = null;
    this.drag.destroy();
    this.sceneInput.destroy();
    super.destroy(fromScene);
  }

  /** Redraw from the run as it now stands (another player's change landed). */
  refresh(): void {
    if (this.disposed) return;
    if (this.table) this.table.refresh();
    else if (!this.working && !this.dialog) this.render();
  }

  private get member() {
    return this.hooks.actions.member;
  }

  private async apply(intent: ExplorationIntent, after?: (ok: boolean) => void): Promise<boolean> {
    if (this.working) return false;
    this.working = true;
    const result = await this.hooks.actions.apply(intent);
    this.working = false;
    if (this.disposed) return false;
    this.message = result.message;
    this.messageOk = result.ok;
    playSound(result.ok ? 'ui.confirm' : 'ui.deny');
    if (result.ok) this.hooks.changed();
    after?.(result.ok);
    this.render();
    return result.ok;
  }

  /** Say why something cannot be done, in the footer. */
  private refuse(message: string): void {
    this.message = message;
    this.messageOk = false;
    playSound('ui.deny');
    this.render();
  }

  /** An item let go over a doll slot (equip it there) or over the pack (stow it). */
  private dropped(payload: DragPayload, target: DropTarget): void {
    const leader = memberIn(this.run, this.member);
    if (!leader || this.working || this.dialog) return;
    if (target.key === 'pack') {
      const { action, note } = this.unequipAction(leader, payload.id);
      if (action.enabled) action.run();
      else this.refuse(note ?? 'That cannot come off now.');
      return;
    }
    this.equipInto(leader, payload.id, target.key.slice('doll:'.length) as DollSlot);
  }

  /** Put a carried item on in `slot`, first taking off whatever is in the way. */
  private equipInto(leader: Mage, id: ItemId, slot: DollSlot): void {
    const def = getItem(id);
    const equip = (): Promise<boolean> => this.apply({ op: 'equip', item: id }, (ok) => {
      if (ok) this.selection = { from: 'worn', id };
    });
    if (leader.canEquipFromBag(id)) {
      void equip();
      return;
    }
    if (leader.tooHeavyToWear(id)) {
      this.refuse('Wearing that would put you over your carry limit. Lighten the load first.');
      return;
    }
    const occupant = dollEntries(leader).find((entry) => entry.slot === slot)?.id ?? null;
    const outgoing = def.slot === 'hand' && def.twoHanded ? [...new Set(leader.hands)]
      : occupant ? [occupant] : [];
    if (!outgoing.length) {
      this.refuse(`Your ${def.slot} is bound and cannot be swapped.`);
      return;
    }
    const bound = outgoing.find((other) => getItem(other).permanentlyBinding || leader.sabotagedItems.has(other));
    if (bound) {
      this.refuse(`${getItem(bound).name} is bound to you and cannot come off.`);
      return;
    }
    const swap = async (): Promise<void> => {
      for (const other of outgoing) if (!(await this.apply({ op: 'unequip', item: other }))) return;
      await equip();
    };
    const torch = outgoing.find((other) => leader.torchSpentOnStow(other));
    if (!torch) {
      void swap();
      return;
    }
    this.openDialog({
      title: 'Swap out the torch?',
      body: `Making room puts out the ${getItem(torch).name}. It has burned through a fight, so it is spent and gone.`,
      icon: torch,
      choices: [{ label: 'Put It Out & Swap', tone: 'danger', run: () => void swap() }],
      cancelLabel: 'Keep It Lit',
      onClose: () => this.render(),
    });
  }

  private renderSoon(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    this.scene.time.delayedCall(0, () => {
      this.renderQueued = false;
      if (!this.disposed && !this.dialog) this.render();
    });
  }

  private select(selection: Selection | null, soon = false): void {
    const same = this.selection?.from === selection?.from && this.selection?.id === selection?.id;
    if (same) return;
    this.selection = selection;
    if (soon) this.renderSoon();
    else this.render();
  }

  private cycleFilter(step: number): void {
    if (this.showSpells) return;
    const at = FILTERS.findIndex((entry) => entry.id === this.filter);
    this.setFilter(FILTERS[(at + step + FILTERS.length) % FILTERS.length].id);
  }

  private setFilter(filter: ItemFilter): void {
    if (filter === this.filter) return;
    playSound('ui.click');
    this.filter = filter;
    this.page = 0;
    this.render();
  }

  private toggleSpells(): void {
    this.showSpells = !this.showSpells;
    this.spellNote = null;
    playSound('ui.click');
    this.render();
  }

  private runAction(which: 'primary' | 'give' | 'drop'): void {
    const action = this.actions[which];
    if (!action || this.showSpells || this.working) return;
    if (!action.enabled) {
      playSound('ui.deny');
      return;
    }
    playSound('ui.click');
    action.run();
  }

  // ---------------------------------------------------------------------------
  //  LAYOUT
  // ---------------------------------------------------------------------------

  private render(): void {
    if (this.disposed) return;
    const keep = this.focus.currentKey;
    this.removeAll(true);
    this.focus = new SpatialFocus();
    this.drag.clearTargets();
    this.actions = {};
    const { scene, run } = this;
    const leader = memberIn(run, this.member);
    addCabinetBackdrop(scene, this);
    this.add(scene.add.text(58, 34, 'PACK', {
      fontFamily: MENU_FONT.display, fontSize: '30px', fontStyle: 'bold', color: MENU_HEX.bone,
    }).setLetterSpacing(3));
    if (leader) {
      const who = `${leader.name}${leader.spellClass ? `  /  ${MAGE_CLASS_DEFS[leader.spellClass].label}` : ''}`;
      this.add(scene.add.text(178, 46, who, {
        fontFamily: MENU_FONT.control, fontSize: '15px', color: MENU_HEX.boneDim,
      }));
      this.renderHeader(leader);
      if (this.selection && !this.selectionValid(leader, this.selection)) this.selection = null;
      this.renderDoll(leader);
      if (this.showSpells) this.renderSpells(leader);
      else {
        this.renderPack(leader);
        this.renderCard(leader);
      }
    }
    addJourneyStrip(scene, this, 1222, 34, {
      day: run.day,
      hour: run.hour,
      level: run.level,
      xp: run.xp,
      next: xpToNext(run.level, partyXpScale(run)),
      pending: leader ? levelsOwed(run, leader.mageClass) : 0,
    });
    addSectionRule(scene, this, 58, 116, 1164);
    this.renderFooter();
    this.focus.restore(keep ?? (this.showSpells ? 'spell:0' : 'cell:0'));
  }

  private selectionValid(leader: Mage, selection: Selection): boolean {
    return selection.from === 'worn'
      ? leader.equippedItems().includes(selection.id)
      : carriedCount(leader, selection.id) > 0;
  }

  private renderHeader(leader: Mage): void {
    const { scene } = this;
    const purse = addPursePlate(scene, this, 58, 76, moneyLabel(this.run.gold));
    const cap = leader.carryCap();
    const weight = leader.carriedWeight();
    const left = 58 + purse + 18;
    const finite = Number.isFinite(cap);
    const heavy = leader.overloaded() ? 'OVERLOADED' : leader.carryEncumbranceMultiplier() < 1 ? 'HEAVY' : '';
    addMeter(scene, this, left, 76, 220, heavy ? `LOAD  /  ${heavy}` : 'LOAD',
      `${kg(weight)} / ${finite ? kg(cap) : '\u221E'} kg`, finite ? weight / Math.max(1, cap) : 0, 0xb08d4a, { warn: !!heavy });
    const used = packSlotsUsed(leader);
    const room = packCapacity(leader);
    addMeter(scene, this, left + 238, 76, 170, 'SLOTS',
      `${used} / ${Number.isFinite(room) ? room : '\u221E'}`, Number.isFinite(room) ? used / Math.max(1, room) : 0.1, 0x4d7c70, { warn: used > room });
  }

  // ---- Worn -----------------------------------------------------------------

  private renderDoll(leader: Mage): void {
    const { scene } = this;
    const bound = leader.hands.length + leader.accessories.length + WORN_SLOTS.filter((slot) => !!leader.worn(slot)).length;
    addPanel(scene, this, DOLL.x, DOLL.y, DOLL.w, DOLL.h, 'Equipped', { caption: `${bound} worn  /  drag to equip` });
    const cx = DOLL.x + DOLL.w / 2;
    addPaperDoll(scene, this, cx, DOLL.y + 36, dollEntries(leader), (entry, x, y) => {
      const id = entry.id;
      const selected = !!id && !entry.ghost && this.selection?.from === 'worn' && this.selection.id === id;
      const movable = !!id && !entry.ghost && !getItem(id).permanentlyBinding;
      const tile = new ItemTile(scene, x, y, {
        id,
        ghost: entry.ghost,
        tag: id && !entry.ghost && getItem(id).permanentlyBinding ? 'BOUND' : id && getItem(id).twoHanded ? '2H' : undefined,
        tagColor: id && getItem(id).permanentlyBinding ? 0xc9503f : undefined,
        selected,
        drag: movable ? { controller: this.drag, payload: { id: id!, from: `doll:${entry.slot}` } } : undefined,
        onActivate: () => this.select(id && !entry.ghost ? { from: 'worn', id } : null),
        onFocus: () => {
          if (this.focus.viaKeys) this.select(id && !entry.ghost ? { from: 'worn', id } : null, true);
        },
      });
      this.focus.add(tile, `doll:${entry.slot}`, x, y, TILE, TILE);
      this.drag.addTarget({
        key: `doll:${entry.slot}`, x, y, w: TILE, h: TILE,
        accepts: (payload) => payload.from === 'pack' && dollAccepts(entry.slot, payload.id),
      });
      return tile;
    });

    // Vitals and the three stats under the doll.
    const x = DOLL.x + 16;
    const w = DOLL.w - 32;
    let y = DOLL.y + 286;
    if (!leader.alive) {
      this.add(scene.add.text(DOLL.x + DOLL.w / 2, y + 8, 'FALLEN\nBack on their feet after a night at an inn.', {
        fontFamily: MENU_FONT.control, fontSize: '13px', fontStyle: 'bold', color: '#e0806e', align: 'center',
      }).setOrigin(0.5, 0));
      y += 60;
    } else {
      addMeter(scene, this, x, y, w, 'HEALTH', `${leader.hp} / ${leader.maxHp}`, leader.hp / Math.max(1, leader.maxHp), 0xb8453c);
      addMeter(scene, this, x, y + 32, w, 'MANA', `${leader.mana} / ${leader.maxMana}`, leader.mana / Math.max(1, leader.maxMana), 0x4a7fd0);
      addMeter(scene, this, x, y + 64, w, 'SANITY', `${leader.sanity} / ${leader.maxSanity}`, leader.sanity / Math.max(1, leader.maxSanity), 0x8a5fb8);
      y += 100;
    }
    const g = scene.add.graphics();
    this.add(g);
    const stats: [string, number][] = [['STR', leader.statStrength], ['DEX', leader.statDex], ['INT', leader.statInt]];
    const boxW = Math.floor((w - 16) / 3);
    stats.forEach(([label, value], index) => {
      const bx = x + index * (boxW + 8);
      g.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(bx, y, boxW, 46);
      g.lineStyle(1, MENU_COLOR.brassDark, 1).strokeRect(bx + 0.5, y + 0.5, boxW - 1, 45);
      g.fillStyle(MENU_COLOR.brass, 1).fillRect(bx, y, boxW, 2);
      this.add([
        scene.add.text(bx + boxW / 2, y + 6, label, {
          fontFamily: MENU_FONT.control, fontSize: '10px', fontStyle: 'bold', color: MENU_HEX.brass,
        }).setOrigin(0.5, 0).setLetterSpacing(2),
        scene.add.text(bx + boxW / 2, y + 19, String(value), {
          fontFamily: MENU_FONT.display, fontSize: '20px', fontStyle: 'bold', color: MENU_HEX.bone,
        }).setOrigin(0.5, 0),
      ]);
    });
  }

  // ---- Pack grid ------------------------------------------------------------

  private renderPack(leader: Mage): void {
    const { scene } = this;
    const used = packSlotsUsed(leader);
    const room = packCapacity(leader);
    const finding = this.pendingFind ? `MAKE ROOM: ${getItem(this.pendingFind).name.toUpperCase()}` : '';
    addPanel(scene, this, PACK.x, PACK.y, PACK.w, PACK.h, 'Carried', {
      caption: finding || `${used} of ${Number.isFinite(room) ? room : '\u221E'} slots`,
      captionColor: finding ? '#e6b55a' : undefined,
    });

    const chipW = Math.floor((PACK.w - 28 - (FILTERS.length - 1) * 6) / FILTERS.length);
    const stacks = carriedStacks(leader);
    FILTERS.forEach((entry, index) => {
      const x = PACK.x + 14 + index * (chipW + 6);
      const count = stacks.filter((stack) => matchesFilter(stack.id, entry.id)).length;
      const chip = new CabinetChip(scene, x, PACK.y + 38, {
        width: chipW,
        height: 28,
        label: entry.id === 'all' ? entry.label : `${entry.label}${count ? ` ${count}` : ''}`,
        selected: this.filter === entry.id,
        tone: this.filter === entry.id ? 'positive' : 'normal',
        onActivate: () => this.setFilter(entry.id),
      });
      this.add(chip);
      this.focus.add(chip, `filter:${entry.id}`, x, PACK.y + 38, chipW, 28);
    });

    const cells = packCells(stacks.filter((stack) => matchesFilter(stack.id, this.filter)));
    const pages = Math.max(1, Math.ceil(cells.length / PAGE));
    this.page = Math.min(this.page, pages - 1);
    const shown = cells.slice(this.page * PAGE, (this.page + 1) * PAGE);
    const sockets = scene.add.graphics();
    this.add(sockets);
    // Empty sockets show how much room is left; beyond the pack's size there is only felt.
    const freeCells = cells.filter((cell) => cell.free).length;
    const capacity = this.filter === 'all'
      ? Number.isFinite(room) ? freeCells + room : Infinity
      : shown.length;
    for (let index = 0; index < PAGE; index++) {
      const absolute = this.page * PAGE + index;
      if (absolute >= capacity && index >= shown.length) break;
      const at = gridSpot(GRID.x, GRID.y, COLUMNS, index);
      drawSocket(sockets, at.x, at.y);
    }
    const selected = this.selection?.from === 'pack' ? this.selection.id : null;
    shown.forEach((cell, index) => {
      const at = gridSpot(GRID.x, GRID.y, COLUMNS, index);
      const def = getItem(cell.id);
      const tile = new ItemTile(scene, at.x, at.y, {
        id: cell.id,
        count: cell.count,
        tag: def.keyItem ? 'KEY' : def.pack ? 'BAG' : leader.pouch.includes(cell.id) && index === shown.findIndex((other) => other.id === cell.id) ? 'POUCH' : undefined,
        tagColor: def.keyItem ? 0xd2bd7f : def.pack ? 0x6e9e91 : 0xa98b50,
        selected: selected === cell.id,
        drag: def.slot !== 'utility' ? { controller: this.drag, payload: { id: cell.id, from: 'pack' } } : undefined,
        onActivate: () => this.select({ from: 'pack', id: cell.id }),
        onFocus: () => {
          if (this.focus.viaKeys) this.select({ from: 'pack', id: cell.id }, true);
        },
      });
      this.add(tile);
      this.focus.add(tile, `cell:${index}`, at.x, at.y, TILE, TILE);
    });
    this.drag.addTarget({
      key: 'pack', x: PACK.x, y: PACK.y, w: PACK.w, h: PACK.h,
      accepts: (payload) => payload.from.startsWith('doll:'),
    });
    if (cells.length === 0) {
      this.add(scene.add.text(PACK.x + PACK.w / 2, GRID.y + 140, this.filter === 'all' ? 'The pack is empty.' : 'Nothing of this kind.', {
        fontFamily: MENU_FONT.body, fontSize: '15px', color: MENU_HEX.boneDim,
      }).setOrigin(0.5));
    }
    const pagerY = PACK.y + PACK.h - 40;
    if (pages > 1) {
      for (const [label, step, x] of [['<  Prev', -1, PACK.x + 14], ['Next  >', 1, PACK.x + PACK.w - 104]] as const) {
        const chip = new CabinetChip(scene, x, pagerY, {
          width: 90,
          height: 28,
          label,
          enabled: step < 0 ? this.page > 0 : this.page < pages - 1,
          onActivate: () => { this.page += step; this.render(); },
        });
        this.add(chip);
        this.focus.add(chip, `page:${step}`, x, pagerY, 90, 28);
      }
    }
    this.add(scene.add.text(PACK.x + PACK.w / 2, pagerY + 7, pages > 1 ? `PAGE ${this.page + 1} / ${pages}` : 'SORTED BY KIND, THEN RARITY', {
      fontFamily: MENU_FONT.control, fontSize: '10px', fontStyle: 'bold', color: MENU_HEX.brass,
    }).setOrigin(0.5, 0).setLetterSpacing(2));
  }

  // ---- Card and actions -------------------------------------------------------

  private renderCard(leader: Mage): void {
    const { scene } = this;
    addPanel(scene, this, CARD.x, CARD.y, CARD.w, CARD.h, 'Details', { fill: MENU_COLOR.woodDeep });
    const selection = this.selection;
    const x = CARD.x + 16;
    const w = CARD.w - 32;
    if (!selection) {
      addEmptyCard(scene, this, CARD.x, CARD.y + 28, CARD.w, CARD.h - 28, 'Nothing selected',
        'Choose something worn or carried to see what it does and what can be done with it.');
      return;
    }
    const def = getItem(selection.id);
    const lines: CardLine[] = [];
    let note: string | undefined;
    let noteColor: string | undefined;
    let eyebrow: string;
    if (selection.from === 'worn') {
      const slot = this.wornSlot(leader, selection.id);
      eyebrow = `Equipped  /  ${slot ? DOLL_LABEL[slot] : 'worn'}`;
      lines.push({ label: 'Weight', value: `${kg(def.weight)} kg` });
      lines.push({ label: 'Worth', value: moneyLabel(itemWorth(def)) });
      const unequip = this.unequipAction(leader, selection.id);
      this.actions.primary = unequip.action;
      note = unequip.note;
      noteColor = unequip.noteColor;
    } else {
      const count = carriedCount(leader, selection.id);
      const pouched = leader.pouch.filter((id) => id === selection.id).length;
      eyebrow = pouched ? `In your pack  /  ${pouched} in the pouch` : 'In your pack';
      const slots = slotsForCount(selection.id, count);
      lines.push({ label: 'Carried', value: `${count}` });
      lines.push({ label: 'Weight', value: count > 1 ? `${kg(def.weight)} kg each  /  ${kg(def.weight * count)} kg` : `${kg(def.weight)} kg` });
      lines.push({ label: 'Pack room', value: slots ? `${slots} slot${slots === 1 ? '' : 's'}` : 'Takes no slot' });
      lines.push({ label: 'Worth', value: count > 1 ? `${moneyLabel(itemWorth(def))} each` : moneyLabel(itemWorth(def)) });
      const found = this.packActions(leader, selection.id, count);
      this.actions = found.actions;
      note = found.note;
      noteColor = found.noteColor;
    }
    addItemCard(scene, this, x, CARD.y + 42, w, CARD.y + CARD.h - 112, { id: selection.id, eyebrow, lines, note, noteColor });

    // The buttons: the main act across the width, giving and dropping beneath.
    const { primary, give, drop } = this.actions;
    const top = CARD.y + CARD.h - 100;
    if (primary) {
      const chip = new CabinetChip(scene, x, top, {
        width: w,
        height: 40,
        label: `${primary.label}   [F]`,
        tone: primary.enabled ? primary.tone ?? 'primary' : 'normal',
        enabled: primary.enabled,
        onActivate: () => this.runAction('primary'),
      });
      this.add(chip);
      this.focus.add(chip, 'act:primary', x, top, w, 40);
    }
    const half = Math.floor((w - 10) / 2);
    const row: [PackAction | undefined, string, string, number][] = [[give, 'give', 'G', x], [drop, 'drop', 'X', x + half + 10]];
    for (const [action, key, hotkey, bx] of row) {
      if (!action) continue;
      const chip = new CabinetChip(scene, bx, top + 50, {
        width: half,
        height: 36,
        label: `${action.label}   [${hotkey}]`,
        tone: action.tone,
        enabled: action.enabled,
        onActivate: () => this.runAction(key as 'give' | 'drop'),
      });
      this.add(chip);
      this.focus.add(chip, `act:${key}`, bx, top + 50, half, 36);
    }
  }

  private wornSlot(leader: Mage, id: ItemId): DollSlot | null {
    return dollEntries(leader).find((entry) => entry.id === id && !entry.ghost)?.slot ?? null;
  }

  private unequipAction(leader: Mage, id: ItemId): { action: PackAction; note?: string; noteColor?: string } {
    const def = getItem(id);
    if (def.permanentlyBinding || leader.sabotagedItems.has(id)) {
      return {
        action: { label: 'Unequip', enabled: false, run: () => undefined },
        note: `${def.name} is bound to you. It cannot be taken off.`,
        noteColor: '#e6866f',
      };
    }
    if (leader.torchSpentOnStow(id)) {
      const total = def.torchCombats ?? 0;
      return {
        action: { label: 'Put Out...', enabled: true, tone: 'danger', run: () => this.askPutOut(id) },
        note: `Lit and burning: ${leader.torchCombatsLeft} of ${total} fights left. Putting it out spends it.`,
        noteColor: '#e6b55a',
      };
    }
    if (!packCanStow(leader, id)) {
      return {
        action: { label: 'Unequip', enabled: false, run: () => undefined },
        note: 'No room in the pack to stow it. Make room first.',
        noteColor: '#e6866f',
      };
    }
    const fresh = def.torchCombats != null;
    return {
      action: {
        label: 'Unequip',
        enabled: true,
        tone: 'primary',
        run: () => void this.apply({ op: 'unequip', item: id }, (ok) => {
          if (ok) this.selection = { from: 'pack', id };
        }),
      },
      note: fresh ? 'Not yet burned through a fight: it goes back into the pack whole.' : undefined,
      noteColor: fresh ? MENU_HEX.verdigris : undefined,
    };
  }

  private packActions(leader: Mage, id: ItemId, count: number): {
    actions: { primary?: PackAction; give?: PackAction; drop?: PackAction };
    note?: string;
    noteColor?: string;
  } {
    const def = getItem(id);
    const actions: { primary?: PackAction; give?: PackAction; drop?: PackAction } = {};
    let note: string | undefined;
    let noteColor: string | undefined;
    const word = MOONSHARD_WORDS[id];
    if (word) {
      const known = leader.loadout.includes(word);
      actions.primary = {
        label: known ? `Knows ${WORDS[word].label}` : `Learn ${WORDS[word].label}`,
        enabled: leader.alive && !known,
        tone: 'positive',
        run: () => this.learnShard(leader, id),
      };
    } else if (def.paper) {
      const scribe = leader.alive && leader.spellClass === 'hexcraft';
      actions.primary = { label: 'Draw a Hex', enabled: scribe, tone: 'positive', run: () => this.openTable(def.paper!) };
      if (!scribe) note = 'Only a Hexcraft mage on their feet can draw on it.';
    } else if (def.slot !== 'utility') {
      const can = leader.canEquipFromBag(id);
      const worn = isWornSlot(def.slot) ? leader.worn(def.slot) : null;
      actions.primary = {
        label: worn && can ? `Equip  (swap ${getItem(worn).name})` : 'Equip',
        enabled: can,
        tone: 'primary',
        run: () => void this.apply({ op: 'equip', item: id }, (ok) => {
          if (ok) this.selection = { from: 'worn', id };
        }),
      };
      if (!can) {
        noteColor = '#e6866f';
        note = leader.tooHeavyToWear(id) ? 'Wearing that would put you over your carry limit. Lighten the load first.'
          : def.slot === 'hand' ? (def.twoHanded ? 'It takes both hands. Empty them first.' : 'Both hands are full. Unequip one first.')
          : def.slot === 'accessory' ? 'Both accessory slots are taken. Take one off first.'
          : `Your ${def.slot} is bound and cannot be swapped.`;
      } else if (def.torchCombats != null) {
        note = 'Equipping lights it. A torch that has burned through a fight is spent when put away.';
        noteColor = '#e6b55a';
      }
    } else if (def.potion || def.throwable) {
      note = 'Used in a fight, as a bonus action.';
      noteColor = MENU_HEX.verdigris;
    } else if (def.ammo) {
      const bow = leader.hands.some((held) => getItem(held).weapon?.usesArrows);
      note = bow ? 'Fired by the bow in your hands.' : 'Needs a bow in hand to be of use.';
      noteColor = MENU_HEX.verdigris;
    } else if (def.keyItem) {
      note = 'A key item. It stays with the party.';
      noteColor = MENU_HEX.verdigris;
    }

    const others = partyOf(this.run).filter((mage) => mage.mageClass !== leader.mageClass);
    if (others.length) {
      actions.give = {
        label: 'Give...',
        enabled: changesHands(def) && !def.keyItem,
        run: () => this.askGive(leader, id, count),
      };
    }
    const bagInUse = !!def.pack && !packFits(leader, [], [id]);
    const pouchInUse = id === 'consumablePouch' && leader.pouch.length > 0 && count <= 1;
    actions.drop = {
      label: 'Drop...',
      enabled: !def.keyItem && !def.permanentlyBinding && !bagInUse && !pouchInUse,
      tone: 'danger',
      run: () => this.askDrop(id, count),
    };
    if (bagInUse && !note) {
      note = 'This bag holds what you carry. Empty it before letting it go.';
      noteColor = '#e6b55a';
    }
    if (pouchInUse && !note) {
      note = 'Empty the pouch before letting it go.';
      noteColor = '#e6b55a';
    }
    return { actions, note, noteColor };
  }

  // ---- Dialogs -------------------------------------------------------------

  private openDialog(options: DialogOptions): void {
    if (this.dialog) return;
    this.dialog = new ConfirmDialog(this.scene, this.depth + 5, {
      ...options,
      onClose: () => {
        this.dialog = null;
        options.onClose();
      },
    });
  }

  private askDrop(id: ItemId, count: number): void {
    const def = getItem(id);
    const worth = itemWorth(def);
    this.openDialog({
      title: count > 1 ? `Drop ${def.name}?` : `Drop the ${def.name}?`,
      body: `Whatever is dropped stays behind for good.${worth >= 2 ? ` It is worth about ${moneyLabel(worth)} ${count > 1 ? 'each ' : ''}at a shop.` : ''}`,
      icon: id,
      quantity: count > 1 ? {
        max: count,
        start: 1,
        describe: (n) => `Drop ${n}${def.weight > 0 ? `  /  ${kg(def.weight * n)} kg lighter` : ''}${n === count ? '  /  all of them' : ''}`,
      } : undefined,
      choices: [{ label: 'Drop', tone: 'danger', run: (n) => void this.apply({ op: 'drop', item: id, count: n }) }],
      onClose: () => this.render(),
    });
  }

  private askGive(leader: Mage, id: ItemId, count: number): void {
    const def = getItem(id);
    const others = partyOf(this.run).filter((mage) => mage.mageClass !== leader.mageClass);
    this.openDialog({
      title: `Give ${def.name}`,
      body: 'Hand it to a companion. It goes into their pack, or straight into an empty hand or slot.',
      icon: id,
      quantity: count > 1 ? { max: count, start: count, describe: (n) => `Hand over ${n}${def.weight > 0 ? `  /  ${kg(def.weight * n)} kg` : ''}` } : undefined,
      choices: others.map((mage) => {
        const room = mage.canCarry(def.weight) && packFits(mage, [id]);
        return {
          label: room ? `To ${mage.name}` : `${mage.name} (full)`,
          tone: 'primary' as const,
          enabled: room,
          run: (n: number) => void this.apply({ op: 'give', item: id, to: mage.mageClass, count: n }),
        };
      }),
      onClose: () => this.render(),
    });
  }

  private askPutOut(id: ItemId): void {
    const leader = memberIn(this.run, this.member);
    const total = getItem(id).torchCombats ?? 0;
    this.openDialog({
      title: 'Put out the torch?',
      body: `It has already burned through a fight. Once put out it is spent and gone, with ${leader?.torchCombatsLeft ?? 0} of its ${total} fights of light unused.`,
      icon: id,
      choices: [{ label: 'Put It Out', tone: 'danger', run: () => void this.apply({ op: 'unequip', item: id }) }],
      cancelLabel: 'Keep It Lit',
      onClose: () => this.render(),
    });
  }

  /** Lay a sheet on the table and draw a hex on it. */
  private openTable(paper: PaperKind): void {
    if (this.table || this.working) return;
    playSound('ui.open');
    this.setVisible(false);
    const table: HexDrawView = new HexDrawView(this.scene, this.run, paper, {
      actions: this.hooks.actions,
      changed: () => this.hooks.changed(),
      close: () => {
        if (this.table !== table) return;
        table.destroy();
        this.table = null;
        if (this.disposed) return;
        playSound('ui.close');
        this.setVisible(true);
        this.render();
      },
    });
    this.table = table;
  }

  private learnShard(leader: Mage, item: ItemId): void {
    const word = MOONSHARD_WORDS[item];
    if (!word || this.working || this.shardChoice) return;
    if (!rackIsFull(leader.loadout)) {
      void this.apply({ op: 'learn-shard', item });
      return;
    }
    this.setVisible(false);
    const close = (): void => {
      this.shardChoice?.destroy();
      this.shardChoice = null;
      if (!this.disposed) this.setVisible(true);
    };
    this.shardChoice = new ChoiceMenuView(this.scene, `LEARN ${WORDS[word].label.toUpperCase()}`, 'REPLACE A WORD',
      leader.loadout.flatMap((known, index) => isModifierWord(known) ? [] : [{
        id: String(index), label: WORDS[known].label, detail: WORDS[known].blurb,
      }]), (index) => {
        close();
        void this.apply({ op: 'learn-shard', item, replace: Number(index) });
      }, close);
    this.shardChoice.setDepth(this.depth + 1);
  }

  // ---- Spells -----------------------------------------------------------------

  private renderSpells(leader: Mage): void {
    const { scene } = this;
    const words = leader.loadout.filter((word) => !isModifierWord(word)).map((word) => WORDS[word].label);
    const modifier = leader.loadout.find(isModifierWord);
    const x = PACK.x;
    const w = CARD.x + CARD.w - PACK.x;
    addPanel(scene, this, x, PACK.y, w, PACK.h, 'Spell rack', {
      caption: `Words: ${words.join(', ') || 'none'}${modifier ? `  /  Method: ${WORDS[modifier].label}` : ''}`,
    });
    const entries = this.spellEntries(leader);
    const pages = Math.max(1, Math.ceil(entries.length / SPELLS_PER_PAGE));
    this.spellPage = Math.min(this.spellPage, pages - 1);
    const colW = Math.floor((w - 40) / 2);
    entries.slice(this.spellPage * SPELLS_PER_PAGE, (this.spellPage + 1) * SPELLS_PER_PAGE).forEach((entry, index) => {
      const bx = x + 14 + (index % 2) * (colW + 12);
      const by = PACK.y + 42 + Math.floor(index / 2) * 70;
      const button = new CabinetButton(scene, bx, by, {
        width: colW,
        height: 62,
        label: entry.label,
        detail: entry.detail.split('\n')[0],
        index: String(index + 1),
        enabled: entry.enabled,
        onActivate: () => {
          this.spellNote = { title: entry.label, body: entry.detail.replace('\n', '. ') };
          this.render();
        },
        onFocus: () => this.inspect(entry.label, entry.detail.replace('\n', '. ')),
      });
      this.add(button);
      this.focus.add(button, `spell:${index}`, bx, by, colW, 62);
    });
    if (pages > 1) {
      const pagerY = PACK.y + PACK.h - 40;
      for (const [label, step, px] of [['<  Prev', -1, x + 14], ['Next  >', 1, x + w - 104]] as const) {
        const chip = new CabinetChip(scene, px, pagerY, {
          width: 90,
          height: 28,
          label,
          enabled: step < 0 ? this.spellPage > 0 : this.spellPage < pages - 1,
          onActivate: () => { this.spellPage += step; this.render(); },
        });
        this.add(chip);
        this.focus.add(chip, `spage:${step}`, px, pagerY, 90, 28);
      }
      this.add(scene.add.text(x + w / 2, pagerY + 7, `PAGE ${this.spellPage + 1} / ${pages}`, {
        fontFamily: MENU_FONT.control, fontSize: '10px', fontStyle: 'bold', color: MENU_HEX.brass,
      }).setOrigin(0.5, 0).setLetterSpacing(2));
    }
  }

  /** Each spell the rack casts, with its cost and odds; then the combinations that cast nothing. */
  private spellEntries(leader: Mage): { label: string; detail: string; enabled: boolean }[] {
    const rack = new Set(leader.loadout.filter((word) => !isModifierWord(word)));
    const spells = allSpells(leader.spellClass, ADVENTURE_SPELLS)
      .filter((spell) => spell.words.every((word) => rack.has(word)))
      .sort((a, b) => a.words.length - b.words.length || a.name.localeCompare(b.name));
    const entries = spells.map((spell) => ({
      label: spell.name,
      detail: `${this.spellFacts(leader, spell)}\n${spell.description}`,
      enabled: true,
    }));
    for (const blank of rackCoverage([...rack], leader.spellClass, ADVENTURE_SPELLS).blanks) {
      entries.push({ label: blank.map((word) => WORDS[word].label).join(' '), detail: 'No spell for these words.', enabled: false });
    }
    return entries;
  }

  private spellFacts(leader: Mage, spell: Spell): string {
    const reach = spell.targeting === 'self' ? 'self'
      : Number.isFinite(spell.range) ? `range ${Math.round(spell.range / RANGE_UNIT)}` : 'any range';
    return [spell.actionType, reach, `${fieldSpellMana(leader, spell.words)} mana`, castOddsLabel(spell, leader)].join('  /  ');
  }

  // ---- Footer -----------------------------------------------------------------

  private footerTitle?: Phaser.GameObjects.Text;
  private footerBody?: Phaser.GameObjects.Text;

  private inspect(title: string, body: string): void {
    this.footerTitle?.setText(title.toUpperCase()).setColor(MENU_HEX.brassLight);
    this.footerBody?.setText(body).setColor(MENU_HEX.boneDim);
  }

  private renderFooter(): void {
    const { scene } = this;
    const g = scene.add.graphics();
    g.fillStyle(MENU_COLOR.pitch, 1).fillRect(53, 583, 1174, 90);
    g.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(58, 588, 1164, 80);
    g.lineStyle(1, MENU_COLOR.brassDark, 0.72).strokeRect(58.5, 588.5, 1163, 79);
    this.add(g);
    const spellNote = this.showSpells ? this.spellNote : null;
    const title = spellNote?.title ?? (this.message ? (this.messageOk ? 'DONE' : 'NOTE') : this.showSpells ? 'SPELL RACK' : 'PACK');
    const body = spellNote?.body ?? (this.message || (this.showSpells
      ? 'Every spell your words can cast, with its cost and odds.'
      : 'Select something to see it. Dropping and giving always ask first.'));
    this.footerTitle = scene.add.text(76, 596, title.toUpperCase(), {
      fontFamily: MENU_FONT.control, fontSize: '11px', fontStyle: 'bold',
      color: this.message && !spellNote ? (this.messageOk ? MENU_HEX.verdigris : '#e6b55a') : MENU_HEX.brassLight,
    }).setLetterSpacing(2);
    this.footerBody = scene.add.text(76, 613, body, {
      fontFamily: MENU_FONT.body, fontSize: '13px', color: this.message && !spellNote ? MENU_HEX.bone : MENU_HEX.boneDim,
      fixedWidth: 840, wordWrap: { width: 840 }, maxLines: 2,
    });
    this.add([this.footerTitle, this.footerBody]);
    addKeyHints(scene, this, 76, 648, this.showSpells
      ? [['Arrows', 'Move'], ['S', 'Gear'], ['Esc', 'Close']]
      : [['Arrows', 'Move'], ['Q / E', 'Filter'], ['F', 'Use / Equip'], ['G', 'Give'], ['X', 'Drop'], ['S', 'Spells'], ['Esc', 'Close']]);
    const spells = new CabinetChip(scene, 940, 604, {
      width: 130,
      height: 46,
      label: this.showSpells ? 'Gear   [S]' : 'Spells   [S]',
      selected: this.showSpells,
      onActivate: () => this.toggleSpells(),
    });
    const close = new CabinetChip(scene, 1082, 604, {
      width: 124,
      height: 46,
      label: 'Close',
      tone: 'primary',
      onActivate: () => this.hooks.close(),
    });
    this.add([spells, close]);
    this.focus.add(spells, 'spells', 940, 604, 130, 46);
    this.focus.add(close, 'close', 1082, 604, 124, 46);
  }
}
