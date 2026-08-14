import Phaser from 'phaser';
import { ITEM_DEFS, RARITY_COLOR, type ItemId } from '../core/Items';
import { STAT_DEFS, type StatKey } from '../core/Stats';
import { SceneInput } from '../engine/SceneInput';
import { CabinetButton, CabinetChip, MenuFocusGroup, WordPlate } from '../ui/cabinet/controls';
import { addCabinetWindow } from '../ui/cabinet/CabinetWindow';
import { isReducedMotion, toggleMotionPreference } from '../ui/cabinet/motion';
import {
  MENU_COLOR,
  MENU_FONT,
  MENU_HEX,
  addCabinetBackdrop,
  addRecess,
  addSectionRule,
} from '../ui/cabinet/theme';
import {
  ActionMenuView,
  ChoiceMenuView,
  MultiSelectView,
  PagedChoiceMenuView,
} from '../ui/combat/CombatMenus';
import { EndCardView } from '../ui/combat/EndCardView';
import { InventoryView } from '../ui/combat/InventoryView';
import { PauseView } from '../ui/combat/PauseView';
import { CreativePrepView } from '../ui/prep/CreativePrepView';
import { ItemDraftView } from '../ui/prep/ItemDraftView';
import { StatAssignmentView } from '../ui/prep/StatAssignmentView';
import { ExpeditionTownView } from '../ui/pve/ExpeditionTownView';
import { MinePromptView } from '../ui/pve/MinePromptView';
import { SwampShopView } from '../ui/pve/SwampShopView';

interface GalleryEntry {
  label: string;
  detail: string;
  open: () => Phaser.GameObjects.Container;
}

export class GalleryScene extends Phaser.Scene {
  private active: Phaser.GameObjects.Container | null = null;
  private readonly focus = new MenuFocusGroup();

  constructor() {
    super('Gallery');
  }

  create(): void {
    const root = this.add.container(0, 0);
    addCabinetBackdrop(this, root);
    const title = this.add.text(58, 42, 'CABINET UI GALLERY', {
      fontFamily: MENU_FONT.display,
      fontSize: '30px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    });
    const subtitle = this.add.text(60, 82, 'Representative production states. Select a surface to inspect.', {
      fontFamily: MENU_FONT.body,
      fontSize: '14px',
      color: MENU_HEX.boneDim,
    });
    root.add([title, subtitle]);
    addSectionRule(this, root, 58, 112, 1164);
    addRecess(this, root, 48, 132, 1184, 536, MENU_COLOR.charcoal);

    const entries = this.entries();
    entries.forEach((entry, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const button = new CabinetButton(this, 66 + column * 398, 150 + row * 100, {
        width: 366,
        height: 84,
        label: entry.label,
        detail: entry.detail,
        index: String(index + 1),
        onActivate: () => this.open(entry.open),
      });
      root.add(button);
      this.focus.add(button);
    });

    const input = new SceneInput(this);
    input.bindKeys([
      { key: 'UP', capture: true, run: () => { if (!this.active) this.focus.move(-1); } },
      { key: 'DOWN', capture: true, run: () => { if (!this.active) this.focus.move(1); } },
      { key: 'LEFT', capture: true, run: () => { if (!this.active) this.focus.move(-1); } },
      { key: 'RIGHT', capture: true, run: () => { if (!this.active) this.focus.move(1); } },
      { key: 'TAB', capture: true, run: (event) => { if (!this.active) this.focus.move(event.shiftKey ? -1 : 1); } },
      { key: 'SPACE', capture: true, run: () => { if (!this.active) this.focus.activate(); } },
      { key: 'ENTER', capture: true, run: () => { if (!this.active) this.focus.activate(); } },
      { key: 'ESC', capture: true, run: () => this.closeActive() },
    ]);
    this.game.canvas.setAttribute('aria-label', 'Dimir cabinet UI gallery');
  }

  private open(factory: () => Phaser.GameObjects.Container): void {
    this.closeActive();
    this.active = factory();
    this.game.canvas.setAttribute('aria-label', 'Dimir cabinet UI gallery window');
  }

  private closeActive(): void {
    this.active?.destroy();
    this.active = null;
    this.game.canvas.setAttribute('aria-label', 'Dimir cabinet UI gallery');
  }

  private entries(): GalleryEntry[] {
    const itemIds = ITEM_DEFS.filter((item) => !item.enemyOnly).slice(0, 8).map((item) => item.id);
    const firstItem = itemIds[0] as ItemId;
    const secondItem = (itemIds[1] ?? firstItem) as ItemId;
    const thirdItem = (itemIds[2] ?? firstItem) as ItemId;
    const stats = Object.fromEntries(STAT_DEFS.map((stat) => [stat.key, 4])) as Record<StatKey, number>;
    const close = (): void => this.closeActive();

    return [
      {
        label: 'CORE KIT',
        detail: 'Window, recess, command, chip, and word plate states.',
        open: () => this.coreKit(),
      },
      {
        label: 'ACTION MENU',
        detail: 'Grouped available and disabled combat commands.',
        open: () => new ActionMenuView(this, {
          title: 'ACTIONS',
          sections: [
            {
              title: 'POSITION',
              entries: [
                { id: 'move', label: 'Move', hotkey: 'M', desc: 'Reposition within measured range.', enabled: true, run: close },
                { id: 'leap', label: 'Leap', hotkey: 'L', desc: 'No leap charge remains.', enabled: false, reason: 'No leap charge remains.', run: close },
              ],
            },
            {
              title: 'OFFENCE',
              entries: [
                { id: 'attack', label: 'Basic Attack', hotkey: 'A', desc: 'Strike a legal enemy target.', enabled: true, run: close },
                { id: 'end', label: 'End Turn', hotkey: 'E', desc: 'Pass control to the next combatant.', enabled: true, run: close },
              ],
            },
          ],
          selectedIndex: 0,
          onSelect: () => undefined,
          onActivate: () => close(),
          onDismiss: () => close(),
        }),
      },
      {
        label: 'CHOICE MENU',
        detail: 'Compact mutually exclusive command window.',
        open: () => new ChoiceMenuView(
          this,
          'ELDRITCH MANTLE',
          'Choose one immediate expression.',
          [
            { id: 'attack', label: 'Attack', detail: 'Strike a chosen foe.' },
            { id: 'defend', label: 'Defend', detail: 'Raise a temporary ward.' },
            { id: 'restore', label: 'Restore', detail: 'Recover a spent resource.' },
          ] as const,
          close,
          close,
        ),
      },
      {
        label: 'PAGED CHOICE',
        detail: 'Large option set with bounded two-column paging.',
        open: () => new PagedChoiceMenuView(
          this,
          'DODGE FOLLOW-UP',
          'Every option remains reachable without overflowing the canvas.',
          Array.from({ length: 13 }, (_, index) => ({
            id: `choice-${index}`,
            label: `Follow-up ${index + 1}`,
            detail: index % 2 ? 'Bonus spell / 4 mana / two words.' : 'Immediate counterplay command.',
          })),
          close,
          close,
        ),
      },
      {
        label: 'MULTI SELECT',
        detail: 'Bounded selection with explicit maximum and confirmation.',
        open: () => new MultiSelectView(
          this,
          'EXPEDITION WORDS',
          'Choose up to two rewards.',
          [
            { id: 'shadow', label: 'Shadow', detail: 'Black word.' },
            { id: 'bind', label: 'Bind', detail: 'Blue reaction word.' },
            { id: 'fire', label: 'Fire', detail: 'Red word.' },
            { id: 'order', label: 'Order', detail: 'White word.' },
          ] as const,
          2,
          close,
        ),
      },
      {
        label: 'INVENTORY',
        detail: 'Equipment, supplies, statuses, inspector, and actions.',
        open: () => new InventoryView(this, {
          mageName: 'Vale',
          carry: 'Carry 8/16 kg',
          readOnly: false,
          equipment: [
            { id: firstItem, name: 'Cabinet Blade', location: 'Held', detail: 'Representative equipped item.', actions: [{ kind: 'unequip', label: 'Unequip' }, { kind: 'drop-hand', label: 'Drop', tone: 'danger' }] },
          ],
          supplies: [
            { id: secondItem, name: 'Restorative Flask', location: 'Utility', detail: 'Representative carried supply.', actions: [{ kind: 'consume', label: 'Use', tone: 'positive' }] },
          ],
          statuses: [{ name: 'Veiled', duration: '2 turns', detail: 'Representative timed status effect.' }],
        }, { perform: () => undefined, close }),
      },
      {
        label: 'END CARD',
        detail: 'Mode-aware result presentation and explicit next action.',
        open: () => new EndCardView(this, {
          eyebrow: 'MATCH COMPLETE',
          title: 'VICTORY',
          detail: 'Team 1 controls the arena after seven rounds.',
          actionLabel: 'RETURN TO GALLERY',
          tone: 'victory',
          onActivate: close,
        }),
      },
      {
        label: 'PAUSE',
        detail: 'Resume, motion, speed, and cabinet navigation.',
        open: () => {
          let speed = 1;
          let view: PauseView;
          view = new PauseView(this, {
            motionReduced: isReducedMotion(),
            combatSpeed: speed,
            resume: close,
            toggleMotion: () => {
              toggleMotionPreference();
              view.refresh(isReducedMotion(), speed);
            },
            toggleSpeed: () => {
              speed = speed === 1 ? 4 : 1;
              view.refresh(isReducedMotion(), speed);
            },
            returnToMenu: close,
          });
          return view;
        },
      },
      {
        label: 'STAT ASSIGNMENT',
        detail: 'Bone dice, quick builds, and attribute sockets.',
        open: () => new StatAssignmentView(this, {
          title: 'Vale / Assign Attributes',
          dice: ['d20', '2d6', '1d10', '1d8', '2d4', '1d6'].map((spec, index) => ({ spec, value: 12 - index })),
          placement: [0, 1, 2, 3, 4, 5],
          selectedDie: null,
          locked: false,
        }, { selectDie: () => undefined, selectSlot: () => undefined, applyBuild: () => undefined, confirm: close }),
      },
      {
        label: 'ITEM DRAFT',
        detail: 'Rarity catalogue cards, cart, and waiting states.',
        open: () => new ItemDraftView(this, {
          title: 'Vale / Draft 2 of 3',
          subtitle: 'Choose one item from this rarity set.',
          options: [firstItem, secondItem, thirdItem],
          picks: [firstItem],
          locked: false,
        }, { pick: close }),
      },
      {
        label: 'CREATIVE PREP',
        detail: 'Direct stats, complete catalogue, presets, and confirmation.',
        open: () => new CreativePrepView(this, {
          mageName: 'Vale',
          confirmLabel: 'Confirm Build',
          stats,
          items: [firstItem, firstItem, secondItem],
          page: 0,
          presets: [null, null, null],
        }, {
          adjustStat: () => undefined,
          addItem: () => undefined,
          setPage: () => undefined,
          undoItem: () => undefined,
          clearItems: () => undefined,
          loadPreset: () => undefined,
          savePreset: () => undefined,
          clearPreset: () => undefined,
          confirm: close,
        }),
      },
      {
        label: 'SWAMP SHOP',
        detail: 'Offers, shared gold, carry state, rest, and management.',
        open: () => new SwampShopView(this, {
          title: 'VALE / WAVE 6 SHOP',
          subtitle: 'Carry 12/16 kg',
          message: '',
          mode: 'offers',
          gold: 14,
          overCapacity: false,
          offers: itemIds.slice(0, 7).map((id, index) => {
            const item = ITEM_DEFS.find((definition) => definition.id === id)!;
            return { title: item.name, price: index + 1, detail: `${item.rarity} / ${item.weight}kg. ${item.blurb}`, accent: Phaser.Display.Color.HexStringToColor(RARITY_COLOR[item.rarity]).color, enabled: index < 5 };
          }),
          manageItems: [],
          restLabel: 'Rest (6g)',
          restEnabled: true,
        }, {
          buyOffer: close,
          confirmBuy: close,
          cancelSubstate: close,
          chooseStat: close,
          openManage: close,
          sell: close,
          discard: close,
          rest: close,
          leave: close,
        }),
      },
      {
        label: 'MINE PROMPT',
        detail: 'Room decision, waiting state, and stable action choices.',
        open: () => new MinePromptView(this, {
          title: 'ORE CHAMBER',
          subtitle: 'A brass-veined wall blocks the passage.',
          body: 'The party can mine the deposit, inspect its tools, or return through the previous tunnel.',
          choices: [
            { id: 'mine', label: 'Mine Deposit', enabled: true },
            { id: 'inventory', label: 'Inspect Inventory', enabled: true },
            { id: 'leave', label: 'Leave Chamber', enabled: true },
          ],
        }, close),
      },
      {
        label: 'EXPEDITION TOWN',
        detail: 'Merchant tabs, item cards, services, and departure.',
        open: () => new ExpeditionTownView(this, {
          buyerName: 'Vale',
          gold: 18,
          hostPhase: false,
          activeTab: 'potions',
          tabs: [
            { id: 'potions', label: 'Potions' },
            { id: 'armor', label: 'Armor' },
            { id: 'weapons', label: 'Weapons' },
            { id: 'guild', label: 'Rest' },
            { id: 'donate', label: 'Donate' },
          ],
          message: '',
          items: itemIds.slice(0, 6).map((id, index) => {
            const item = ITEM_DEFS.find((definition) => definition.id === id)!;
            return { id, name: item.name, price: index + 2, detail: `${item.rarity} / ${item.weight}kg. ${item.blurb}`, accent: Phaser.Display.Color.HexStringToColor(RARITY_COLOR[item.rarity]).color, enabled: true };
          }),
          page: 0,
          pages: 2,
          restEnabled: true,
          recruits: [],
          donations: [],
        }, {
          selectTab: () => undefined,
          buy: close,
          previousPage: () => undefined,
          nextPage: () => undefined,
          rest: close,
          recruit: close,
          donate: close,
          finish: close,
        }),
      },
    ];
  }

  private coreKit(): Phaser.GameObjects.Container {
    const panel = this.add.container(0, 0).setDepth(100);
    addCabinetWindow(this, panel, {
      width: 980,
      height: 570,
      title: 'CORE CABINET KIT',
      subtitle: 'Shared production primitives and state treatments.',
      accent: MENU_COLOR.brass,
      dismiss: () => this.closeActive(),
    });
    addRecess(this, panel, 190, 214, 900, 214);
    const primary = new CabinetButton(this, 218, 238, {
      width: 400,
      height: 76,
      label: 'PRIMARY COMMAND',
      detail: 'Raised bone face with brass fittings.',
      index: '1',
      primary: true,
      onActivate: () => undefined,
    });
    const selected = new CabinetButton(this, 662, 238, {
      width: 400,
      height: 76,
      label: 'SELECTED COMMAND',
      detail: 'Latched state with verdigris witness mark.',
      index: '2',
      selected: true,
      onActivate: () => undefined,
    });
    const chip = new CabinetChip(this, 218, 346, {
      width: 180,
      height: 38,
      label: 'STANDARD CHIP',
      onActivate: () => undefined,
    });
    const positive = new CabinetChip(this, 418, 346, {
      width: 180,
      height: 38,
      label: 'POSITIVE',
      tone: 'positive',
      selected: true,
      onActivate: () => undefined,
    });
    const danger = new CabinetChip(this, 618, 346, {
      width: 180,
      height: 38,
      label: 'DANGER',
      tone: 'danger',
      onActivate: () => undefined,
    });
    const disabled = new CabinetChip(this, 818, 346, {
      width: 180,
      height: 38,
      label: 'DISABLED',
      enabled: false,
      onActivate: () => undefined,
    });
    const word = new WordPlate(this, 218, 454, {
      width: 250,
      height: 72,
      label: 'SHADOW',
      accent: MENU_COLOR.amethyst,
      selectedOrder: 1,
      onActivate: () => undefined,
    });
    word.setCopy('SHADOW', '3 CHARGES', MENU_COLOR.amethyst);
    const modifier = new WordPlate(this, 490, 454, {
      width: 250,
      height: 72,
      label: 'SUBTLE',
      accent: MENU_COLOR.amethyst,
      onActivate: () => undefined,
    });
    modifier.setCopy('SUBTLE', 'MODIFIER', MENU_COLOR.amethyst);
    const close = new CabinetChip(this, 790, 474, {
      width: 210,
      height: 44,
      label: 'CLOSE GALLERY VIEW',
      tone: 'primary',
      onActivate: () => this.closeActive(),
    });
    panel.add([primary, selected, chip, positive, danger, disabled, word, modifier, close]);
    return panel;
  }
}
