// =============================================================================
//  DEV RESOURCE EDITOR
// -----------------------------------------------------------------------------
//  Workshop cheat panel: set any entity's vitals, charges, actions and stacks
//  mid-fight. Lifted out of GameScene, which only needs to open and close it.
//
//  It reaches back into the scene through DevResourceHost rather than holding a
//  GameScene, so the live GameState is read per access and never goes stale
//  across a restart.
// =============================================================================

import Phaser from 'phaser';
import type { GameState } from '../../core/GameState';
import type { InputMode } from '../../scenes/GameScene';
import { CabinetChip, MenuFocusGroup } from '../cabinet/controls';
import { addCabinetWindow } from '../cabinet/CabinetWindow';
import { MENU_COLOR, MENU_FONT, MENU_HEX } from '../cabinet/theme';
import {
  ACTIONS_PER_TURN,
  GAME_WIDTH,
  GAME_HEIGHT,
  MAX_WEAPON_REACTIONS,
  MAX_WORD_SPELL_REACTIONS,
  TEXT,
} from '../../config/constants';

export interface DevResourceHost {
  readonly scene: Phaser.Scene;
  readonly gs: GameState;
  mode: InputMode;
  readonly workshopFocus: MenuFocusGroup;
  redraw(): void;
  addWorkshopChip(
    container: Phaser.GameObjects.Container,
    widgets: Phaser.GameObjects.GameObject[],
    x: number,
    y: number,
    label: string,
    onClick: () => void,
    color: string,
    background: string
  ): CabinetChip;
}

export class DevResourceEditor {
  private panel?: Phaser.GameObjects.Container;
  private widgets: Phaser.GameObjects.GameObject[] = [];
  /** Index into gs.mages of the entity being edited. */
  private index = 0;
  /** The mode to restore when the editor closes. */
  private returnMode: InputMode = 'idle';

  constructor(private readonly host: DevResourceHost) {}

  get isOpen(): boolean {
    return !!this.panel?.visible;
  }

  /** Drop the panel so a fresh match does not inherit destroyed widgets. */
  dispose(): void {
    this.panel = undefined;
    this.widgets = [];
  }
  /** Open / close the cheat overlay that edits any entity's live resources. */
  toggle(): void {
    if (this.host.mode === 'dev-resources') {
      this.close();
      return;
    }
    const blocked: InputMode[] = [
      'assign',
      'shop',
      'over',
      'action-menu',
      'inventory',
      'training',
      'eldritch-menu',
      'thunder-menu',
    ];
    if (blocked.includes(this.host.mode)) return;
    if (!this.panel) {
      const panel = this.host.scene.add.container(0, 0).setDepth(97).setVisible(false);
      addCabinetWindow(this.host.scene, panel, {
        width: 1000,
        height: 660,
        title: 'RESOURCE EDITOR',
        subtitle: 'Cheat: set any entity\u2019s vitals, charges, actions and stacks',
        accent: MENU_COLOR.amethyst,
      });
      this.panel = panel;
    }
    // Never restore a transient mode (aiming / busy): the game loop owns those.
    this.returnMode = this.host.mode === 'reaction' ? 'reaction' : 'idle';
    this.host.mode = 'dev-resources';
    this.panel.setVisible(true);
    this.refresh();
    this.host.redraw();
  }

  close(): void {
    this.panel?.setVisible(false);
    if (this.host.mode === 'dev-resources') this.host.mode = this.returnMode;
    this.host.redraw();
  }

  button(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
    color: string = MENU_HEX.bone,
    bg: string = '#1a1d18',
  ): CabinetChip {
    return this.host.addWorkshopChip(this.panel!, this.widgets, x, y, label, onClick, color, bg);
  }

  label(x: number, y: number, text: string, color?: string): Phaser.GameObjects.Text {
    const t = this.host.scene.add.text(x, y, text, {
      fontFamily: MENU_FONT.body,
      fontSize: '14px',
      color: color ?? MENU_HEX.bone,
    });
    this.panel!.add(t);
    this.widgets.push(t);
    return t;
  }

  refresh(): void {
    if (!this.panel) return;
    this.host.workshopFocus.clear();
    for (const w of this.widgets) w.destroy();
    this.widgets = [];
    const entities = this.host.gs.mages;
    if (entities.length === 0) return;
    this.index = Phaser.Math.Clamp(this.index, 0, entities.length - 1);
    const t = entities[this.index];

    const left = GAME_WIDTH / 2 - 475;
    const right = GAME_WIDTH / 2 + 15;
    const top = GAME_HEIGHT / 2 - 262;

    // Entity picker: every mage, summon and creature currently on the field.
    this.label(left, top, 'Entity:');
    let px = left + 62;
    let py = top - 4;
    entities.forEach((m, i) => {
      const on = i === this.index;
      const label = `${m.name}${m.isSummon ? ' *' : ''}${m.alive ? '' : ' †'}`;
      if (px > GAME_WIDTH / 2 + 360) {
        px = left + 62;
        py += 28;
      }
      const b = this.button(
        px,
        py,
        label,
        () => {
          this.index = i;
          this.refresh();
        },
        on ? MENU_HEX.verdigris : MENU_HEX.bone,
        on ? '#3a281b' : '#1a1d18',
      );
      px += b.width + 8;
    });

    const rows = { left: py + 48, right: py + 48 };
    const row = (
      col: 'left' | 'right',
      label: string,
      value: string,
      steps: [number, string][],
      apply: (delta: number) => void,
    ): void => {
      const x = col === 'left' ? left : right;
      const y = rows[col];
      this.label(x, y, `${label}: ${value}`);
      let bx = x + 250;
      for (const [delta, text] of steps) {
        const b = this.button(bx, y - 4, text, () => {
          apply(delta);
          this.refresh();
          this.host.redraw();
        });
        bx += b.width + 6;
      }
      rows[col] += 32;
    };

    const BIG = 999999;
    const pool = (
      label: string,
      cur: number,
      max: number,
      set: (value: number) => void,
      floor = 0,
    ): void => {
      row(
        'left',
        label,
        `${cur} / ${max}`,
        [
          [-5, '-5'],
          [-1, '-1'],
          [1, '+1'],
          [5, '+5'],
          [BIG, 'Max'],
        ],
        (d) => set(Phaser.Math.Clamp(cur + d, floor, max)),
      );
    };

    pool('HP', t.hp, t.maxHp, (v) => (t.hp = v), t.unkillable ? 1 : 0);
    pool('Mana', t.mana, t.maxMana, (v) => (t.mana = v));
    pool('Sanity', t.sanity, t.maxSanity, (v) => (t.sanity = v));
    pool('Luck', t.luck, t.maxLuck, (v) => (t.luck = v));
    pool('Color charges', t.colorCharges, t.maxColorCharges, (v) => (t.colorCharges = v));
    const wordTotal = t.loadout.reduce((sum, w) => sum + (t.charges[w] ?? 0), 0);
    const wordMax = t.loadout.reduce((sum, w) => sum + t.maxWordCharges(w), 0);
    row(
      'left',
      'Word charges (all)',
      `${wordTotal} / ${wordMax}`,
      [
        [-1, '-1'],
        [1, '+1'],
        [BIG, 'Max'],
      ],
      (d) => {
        for (const w of t.loadout) {
          const max = t.maxWordCharges(w);
          t.charges[w] = Phaser.Math.Clamp((t.charges[w] ?? 0) + d, 0, max);
        }
      },
    );

    const action = (label: string, key: 'move' | 'main' | 'bonus'): void => {
      row(
        'right',
        label,
        `${t.actions[key]}`,
        [
          [-1, '-1'],
          [1, '+1'],
          [ACTIONS_PER_TURN[key] - t.actions[key], 'Reset'],
        ],
        (d) => (t.actions[key] = Math.max(0, t.actions[key] + d)),
      );
    };
    action('Move actions', 'move');
    action('Main actions', 'main');
    action('Bonus actions', 'bonus');

    const stack = (label: string, get: () => number, set: (value: number) => void): void => {
      row(
        'right',
        label,
        `${get()}`,
        [
          [-5, '-5'],
          [-1, '-1'],
          [1, '+1'],
          [5, '+5'],
          [-BIG, 'Clear'],
        ],
        (d) => set(Math.max(0, get() + d)),
      );
    };
    const toggle = (col: 'left' | 'right', label: string, get: () => boolean, set: (value: boolean) => void): void => {
      const x = col === 'left' ? left : right;
      const y = rows[col];
      const on = get();
      this.label(x, y, `${label}: ${on ? 'yes' : 'no'}`);
      this.button(
        x + 250,
        y - 4,
        on ? 'Turn off' : 'Turn on',
        () => {
          set(!on);
          this.refresh();
          this.host.redraw();
        },
        on ? MENU_HEX.verdigris : MENU_HEX.bone,
        on ? '#20342b' : '#1a1d18',
      );
      rows[col] += 32;
    };

    stack('Thunder stacks', () => t.thunderStacks, (v) => (t.thunderStacks = v));
    stack('Greed stacks', () => t.greedStacks, (v) => (t.greedStacks = v));
    stack('Momentum stacks', () => t.momentumStacks, (v) => (t.momentumStacks = v));
    stack('Anchor stacks', () => t.anchorStacks, (v) => (t.anchorStacks = v));

    // Reactions: the shared once-per-cycle reaction plus each capped budget.
    row(
      'left',
      'Dodges left',
      `${t.dodgesRemaining} / ${t.maxDodges()}`,
      [
        [-1, '-1'],
        [1, '+1'],
        [BIG, 'Max'],
      ],
      (d) => (t.dodgesRemaining = Phaser.Math.Clamp(t.dodgesRemaining + d, 0, t.maxDodges())),
    );
    row(
      'left',
      'Word-spell reactions used',
      `${t.wordSpellReactionsUsed} / ${MAX_WORD_SPELL_REACTIONS}`,
      [
        [-1, '-1'],
        [1, '+1'],
        [-BIG, 'Clear'],
      ],
      (d) =>
        (t.wordSpellReactionsUsed = Phaser.Math.Clamp(
          t.wordSpellReactionsUsed + d,
          0,
          MAX_WORD_SPELL_REACTIONS,
        )),
    );
    row(
      'left',
      'Weapon reactions used',
      `${t.weaponReactionsUsed} / ${MAX_WEAPON_REACTIONS}`,
      [
        [-1, '-1'],
        [1, '+1'],
        [-BIG, 'Clear'],
      ],
      (d) =>
        (t.weaponReactionsUsed = Phaser.Math.Clamp(t.weaponReactionsUsed + d, 0, MAX_WEAPON_REACTIONS)),
    );
    toggle('right', 'Reaction available', () => t.reactionAvailable, (v) => (t.reactionAvailable = v));
    toggle('right', 'Reacted this cycle', () => t.reactedThisCycle, (v) => (t.reactedThisCycle = v));

    const bottom = Math.max(rows.left, rows.right) + 10;
    this.button(
      left,
      bottom,
      'Refill everything',
      () => {
        t.hp = t.maxHp;
        t.mana = t.maxMana;
        t.sanity = t.maxSanity;
        t.luck = t.maxLuck;
        t.colorCharges = t.maxColorCharges;
        t.actions = { ...ACTIONS_PER_TURN };
        for (const w of t.loadout) t.charges[w] = t.maxWordCharges(w);
        t.resetDodges();
        t.wordSpellReactionsUsed = 0;
        t.weaponReactionsUsed = 0;
        t.reactedThisCycle = false;
        t.reactionAvailable = t.canEverReact;
        this.refresh();
        this.host.redraw();
      },
      MENU_HEX.verdigris,
      '#20342b',
    );
    this.button(
      left + 160,
      bottom,
      'Clear statuses',
      () => {
        t.statuses = [];
        this.refresh();
        this.host.redraw();
      },
      '#ffd27a',
      '#4a3a1a',
    );
    this.button(
      left + 300,
      bottom,
      'Close [F6]',
      () => this.close(),
      '#ff9a9a',
      '#4a1a1a',
    );
    this.label(left, bottom + 40, '* summon   † dead', TEXT.dim);
  }

}
