// =============================================================================
//  GUIDED TUTORIAL SCRIPT
// -----------------------------------------------------------------------------
//  One scripted fight that teaches the whole game: controls, combining words
//  into spells and aiming them, the inventory and its debuff list, reading the
//  stack during a reaction window, and driving a summon.
//
//  This module is pure content. The overlay that draws it lives in
//  `src/ui/combat/TutorialView.ts`; the world changes each `stage` asks for are
//  performed by `GameScene.applyTutorialStage`.
// =============================================================================

import type { WordId } from '../core/Words';

/** The build the tutorial hands the player: five words plus the Subtle modifier. */
export const TUTORIAL_LOADOUT: readonly WordId[] = [
  'shatter',
  'curse',
  'shadow',
  'pierce',
  'heal',
  'subtle',
];

/** The combination the spell chapter asks the player to compose. */
export const TUTORIAL_SPELL_WORDS: readonly WordId[] = ['shatter', 'curse'];

/** A piece of UI the current step points an arrow at. */
export type TutorialFocus =
  | 'none'
  | 'actions'
  | 'toggles'
  | 'menu'
  | 'vitals'
  | 'words'
  | 'readout'
  | 'log'
  | 'hint'
  | 'stack'
  | 'player'
  | 'enemy'
  | 'summon';

/** A world change the scene performs as a step opens. */
export type TutorialStage =
  | 'refresh-actions'
  | 'arm-enemy'
  | 'calm-enemy'
  | 'afflict-player'
  | 'give-summon'
  | 'finish';

/** What the player has to do before the step is considered done. */
export type TutorialTrigger =
  | { on: 'confirm' }
  | { on: 'command'; cmd: 'move' | 'melee' | 'spell' | 'command' | 'uncommand' | 'end' }
  | { on: 'combo' }
  | { on: 'panel'; panel: 'action-menu' | 'inventory' | 'inventory-closed' }
  | { on: 'inventory-tab' }
  | { on: 'reaction' }
  | { on: 'reaction-done' };

export interface TutorialStep {
  id: string;
  chapter: string;
  title: string;
  body: string;
  /** The one-line instruction, shown apart from the explanation. */
  task?: string;
  focus?: TutorialFocus;
  /** World changes applied, in order, as the step opens. */
  stages?: readonly TutorialStage[];
  trigger: TutorialTrigger;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  // ---- I. Basics ------------------------------------------------------------
  {
    id: 'welcome',
    chapter: 'I · Basics',
    title: 'Tutorial',
    body: 'A fight against a training dummy that cannot die. It only attacks when the tutorial says so.',
    task: 'Press Continue.',
    trigger: { on: 'confirm' },
  },
  {
    id: 'actions',
    chapter: 'I · Basics',
    title: 'Your turn',
    body: 'Each turn you get one MAIN action, one BONUS action and one MOVE. These pips show what is left.',
    focus: 'actions',
    trigger: { on: 'confirm' },
  },
  {
    id: 'vitals',
    chapter: 'I · Basics',
    title: 'Health, mana, sanity',
    body: 'Shown in the bottom-left panel, with your colour charges below. If health or sanity reaches zero, you are out.',
    focus: 'vitals',
    trigger: { on: 'confirm' },
  },
  {
    id: 'palette',
    chapter: 'I · Basics',
    title: 'Action menu',
    body: 'TAB (or right-click) lists every action, its key, and why it is unavailable.',
    task: 'Press TAB. ESC closes it.',
    focus: 'hint',
    trigger: { on: 'panel', panel: 'action-menu' },
  },
  {
    id: 'move',
    chapter: 'I · Basics',
    title: 'Move',
    body: 'M shows how far you can move. Click inside the ring to move; ESC cancels.',
    task: 'Press M, then click a spot beside the dummy.',
    focus: 'player',
    trigger: { on: 'command', cmd: 'move' },
  },
  {
    id: 'end-turn',
    chapter: 'I · Basics',
    title: 'End your turn',
    body: 'Each action can be used once per turn. E ends your turn; they refill when your next turn starts.',
    task: 'Press E. The dummy skips its turn.',
    focus: 'actions',
    trigger: { on: 'command', cmd: 'end' },
  },
  {
    id: 'attack',
    chapter: 'I · Basics',
    title: 'Attack',
    body: 'A is your basic attack. With a Silver Shortsword you must stand next to the target.',
    task: 'Press A and click the dummy. Move closer first if needed.',
    stages: ['refresh-actions'],
    focus: 'enemy',
    trigger: { on: 'command', cmd: 'melee' },
  },
  {
    id: 'hover',
    chapter: 'I · Basics',
    title: 'Hover for info',
    body: 'Hover any unit or area on the field to see what it does.',
    focus: 'enemy',
    trigger: { on: 'confirm' },
  },

  // ---- II. Spells -----------------------------------------------------------
  {
    id: 'combine',
    chapter: 'II · Spells',
    title: 'Words make spells',
    body: 'Your build is five words plus one modifier. A spell is up to three words; each cast uses one charge of every word in it.',
    task: 'Click SHATTER and CURSE, or press their numbers.',
    focus: 'words',
    trigger: { on: 'combo' },
  },
  {
    id: 'readout',
    chapter: 'II · Spells',
    title: 'Spell info',
    body: 'The text under the words shows the spell, its mana cost and range; blank means no spell yet. SUBTLE is a modifier outside the three-word limit: slightly weaker, but on a high roll nobody can react to it.',
    focus: 'readout',
    trigger: { on: 'confirm' },
  },
  {
    id: 'cast',
    chapter: 'II · Spells',
    title: 'Cast and aim',
    body: 'ENTER casts the selected spell; then click a target inside the range ring. A difficulty die is rolled first.',
    task: 'Press ENTER and click the dummy.',
    stages: ['refresh-actions'],
    focus: 'enemy',
    trigger: { on: 'command', cmd: 'spell' },
  },

  // ---- III. The stack -------------------------------------------------------
  {
    id: 'stack-intro',
    chapter: 'III · The stack',
    title: 'The stack',
    body: 'Every action goes onto the STACK above the field before it resolves. The rightmost token resolves first: last in, first out.',
    trigger: { on: 'confirm' },
  },
  {
    id: 'stack-wake',
    chapter: 'III · The stack',
    title: 'Reactions',
    body: 'The dummy will attack now; neither of you can die. When it acts, the stack waits for your reaction.',
    task: 'Press E and wait for the dummy to act.',
    stages: ['arm-enemy'],
    focus: 'hint',
    trigger: { on: 'reaction' },
  },
  {
    id: 'stack-read',
    chapter: 'III · The stack',
    title: 'Read the token',
    body: 'The dummy\u2019s action is on the stack. Hover it to see who cast it, its target and its effect.',
    task: 'Hover the token, then press Continue.',
    focus: 'stack',
    trigger: { on: 'confirm' },
  },
  {
    id: 'stack-react',
    chapter: 'III · The stack',
    title: 'React',
    body: 'Anything you add now resolves before the action it answers. TAB lists every reaction, its key, and why it is unavailable.',
    task: 'React, or press SPACE to pass.',
    focus: 'hint',
    trigger: { on: 'reaction-done' },
  },

  // ---- IV. Inventory & debuffs ---------------------------------------------
  {
    id: 'inv-open',
    chapter: 'IV · Inventory',
    title: 'Inventory',
    body: 'You now have a debuff and a Health Potion in your bag. Opening the inventory is free.',
    task: 'Press I, then open the STATUS EFFECTS tab.',
    stages: ['calm-enemy', 'afflict-player'],
    focus: 'vitals',
    trigger: { on: 'inventory-tab' },
  },
  {
    id: 'inv-read',
    chapter: 'IV · Inventory',
    title: 'Status effects',
    body: 'Each entry shows what the effect does and how many turns are left. Hover an enemy to see theirs.',
    task: 'Close the inventory with ESC.',
    trigger: { on: 'panel', panel: 'inventory-closed' },
  },

  // ---- V. Summons -----------------------------------------------------------
  {
    id: 'summon-intro',
    chapter: 'V · Summons',
    title: 'Summons',
    body: 'Some spells create summons. You now have a ghost; most summons can be controlled, some act on their own.',
    stages: ['give-summon'],
    focus: 'summon',
    trigger: { on: 'confirm' },
  },
  {
    id: 'summon-command',
    chapter: 'V · Summons',
    title: 'Command',
    body: 'COMMAND (U) costs a bonus action and controls the summon nearest your cursor. Press U over another summon to switch.',
    task: 'Hover the ghost and press U.',
    stages: ['refresh-actions'],
    focus: 'summon',
    trigger: { on: 'command', cmd: 'command' },
  },
  {
    id: 'summon-drive',
    chapter: 'V · Summons',
    title: 'Control the summon',
    body: 'Normal controls now move the ghost (it holds one item). It gets one move and one main action, then control returns to you.',
    task: 'Move the ghost and attack, or press E to stop early.',
    focus: 'summon',
    trigger: { on: 'command', cmd: 'uncommand' },
  },
  {
    id: 'done',
    chapter: 'V · Summons',
    title: 'Done',
    body: 'That covers the basics.',
    task: 'Press Continue to return to the menu.',
    stages: ['finish'],
    trigger: { on: 'confirm' },
  },
];
