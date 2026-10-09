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
    title: 'Welcome to the arena',
    body: 'This is a full fight against a training dummy that cannot die and will not fight back — until it is asked to. Follow the prompts and you will have used every system the game has by the end.',
    task: 'Press Continue whenever you are ready to move on.',
    trigger: { on: 'confirm' },
  },
  {
    id: 'actions',
    chapter: 'I · Basics',
    title: 'What a turn gives you',
    body: 'Combat is turn-based. Each of your turns hands you one MAIN action, one BONUS action and one MOVE. The pips up here empty as you spend them, and refill when your next turn starts.',
    focus: 'actions',
    trigger: { on: 'confirm' },
  },
  {
    id: 'vitals',
    chapter: 'I · Basics',
    title: 'Your vitals',
    body: 'Health, mana and sanity sit in the left dock, with your colour charges beneath them. Sanity is a second health bar: run either to zero and you are out.',
    focus: 'vitals',
    trigger: { on: 'confirm' },
  },
  {
    id: 'palette',
    chapter: 'I · Basics',
    title: 'The action palette',
    body: 'You never have to remember a hotkey. TAB (or a right-click anywhere) lists every action you can take right now, its key, and reasons why it isnt available.',
    task: 'Press TAB and have a look. ESC closes it again.',
    focus: 'hint',
    trigger: { on: 'panel', panel: 'action-menu' },
  },
  {
    id: 'move',
    chapter: 'I · Basics',
    title: 'Move',
    body: 'Press M and a ring appears around you showing how far you may walk this turn. Click anywhere inside it to move. ESC cancels the action but doesn\'t use it.',
    task: 'Press M, then click a spot beside the dummy.',
    focus: 'player',
    trigger: { on: 'command', cmd: 'move' },
  },
  {
    id: 'end-turn',
    chapter: 'I · Basics',
    title: 'End your turn',
    body: 'That spent your move. Each action is once per turn, so when you have nothing left to do — or nothing left to do it with — E ends the turn and hands play to the other side. Your move, main and bonus all come back when your next turn starts.',
    task: 'Press E. The dummy is AFK, so your turn comes straight back.',
    focus: 'actions',
    trigger: { on: 'command', cmd: 'end' },
  },
  {
    id: 'attack',
    chapter: 'I · Basics',
    title: 'Attack',
    body: 'A is your basic attack; you are holding a Silver Shortsword, so you have to be beside your target. Valid targets are bracketed while you aim, and illegal ones are crossed out in red.',
    task: 'Press A and click the dummy. Move again first if it is out of reach.',
    stages: ['refresh-actions'],
    focus: 'enemy',
    trigger: { on: 'command', cmd: 'melee' },
  },
  {
    id: 'hover',
    chapter: 'I · Basics',
    title: 'Everything explains itself',
    body: 'Hovering is the other half of the interface. Point at any enitity for more information about it, and at an afflicted area to see what a field effect does.',
    focus: 'enemy',
    trigger: { on: 'confirm' },
  },

  // ---- II. Spells -----------------------------------------------------------
  {
    id: 'combine',
    chapter: 'II · Spells',
    title: 'You have words, not spells',
    body: 'These six words are your build: five words plus one modifier word. A spell is any combination of them with up to three words, in any order. Each word has charges, and a cast spends one from every word it used.',
    task: 'Click SHATTER and CURSE, or press their numbers.',
    focus: 'words',
    trigger: { on: 'combo' },
  },
  {
    id: 'readout',
    chapter: 'II · Spells',
    title: 'Read what it does!',
    body: 'The readout under the words explains the spell, its mana cost and its range. If it stays blank, that combination is not a spell yet (My bad im lazy) -> try to swap a word. The SUBTLE word is a modifier: it sits outside the three-word limit, weakens the spell slightly, and on a high roll makes the cast silent so nobody may answer it.',
    focus: 'readout',
    trigger: { on: 'confirm' },
  },
  {
    id: 'cast',
    chapter: 'II · Spells',
    title: 'Cast and aim',
    body: 'ENTER casts the composed spell. The cursor then becomes a targeter: enemy spells want a legal body, point spells want a spot on the ground, and the ring drawn on the field is exactly what you can reach. A difficulty die is rolled first, and you see it land before the effect happens.',
    task: 'With both words still selected, press ENTER and click the dummy.',
    stages: ['refresh-actions'],
    focus: 'enemy',
    trigger: { on: 'command', cmd: 'spell' },
  },

  // ---- III. The stack -------------------------------------------------------
  {
    id: 'stack-intro',
    chapter: 'III · The stack',
    title: 'Nothing resolves instantly',
    body: 'Every move, strike and cast is placed on the STACK above the field first, and resolves afterwards. Tokens are laid left to right in the order they were added, so the RIGHTMOST one is the top and goes off FIRST. Last in, first out. Yours have all gone off the instant you declared them, because the dummy had no answer to give.',
    trigger: { on: 'confirm' },
  },
  {
    id: 'stack-wake',
    chapter: 'III · The stack',
    title: 'Let it hit back',
    body: 'The dummy is about to start swinging (it still cannot be killed, and neither can you). When it declares an action you are offered a REACTION WINDOW, and the stack HOLDS there until you answer — which is your chance to actually look at it.',
    task: 'Press E to end your turn, then wait for the dummy to act.',
    stages: ['arm-enemy'],
    focus: 'hint',
    trigger: { on: 'reaction' },
  },
  {
    id: 'stack-read',
    chapter: 'III · The stack',
    title: 'Read the token',
    body: 'There it is: the dummy\u2019s action, waiting on the stack while the game waits on you. Its ring is the caster\u2019s team colour and the icon says what kind of action it is. Hover it to read who declared it, what it is aimed at and what it will do — its targeting is drawn onto the field while you hover.',
    task: 'Hover the token, then press Continue.',
    focus: 'stack',
    trigger: { on: 'confirm' },
  },
  {
    id: 'stack-react',
    chapter: 'III · The stack',
    title: 'Answer it',
    body: 'Anything you add now goes ON TOP, so it resolves BEFORE the thing it answers — that is how a counter beats the spell it was cast against. You may cast a reaction spell, BLOCK (B), SHIELD BASH (N), DODGE (D), strike back with your weapon (A), stifle with a Needle (K), or PASS (SPACE). TAB lists them all, greying out the ones that do not apply and saying why. Block and Shieldbash need a shield equipped, dodge needs a high dex stat to use, spells can only be used when you are blue, weapon reactions can only be used when you are white, and PASS always works.',
    task: 'Answer it however you like — SPACE simply passes.',
    focus: 'hint',
    trigger: { on: 'reaction-done' },
  },

  // ---- IV. Inventory & debuffs ---------------------------------------------
  {
    id: 'inv-open',
    chapter: 'IV · Inventory',
    title: 'Something is wrong with you',
    body: 'That exchange left an affliction on you, and a Health Potion has been slipped into your bag. Both live in the inventory, and opening it costs nothing. The figure on the left is what you wear and hold; the grid is your bag, where selecting a potion offers Consume and a throwable offers Throw; the STATUS EFFECTS tab is the full list of what is riding on you.',
    task: 'Press I, then open the STATUS EFFECTS tab.',
    stages: ['calm-enemy', 'afflict-player'],
    focus: 'vitals',
    trigger: { on: 'inventory-tab' },
  },
  {
    id: 'inv-read',
    chapter: 'IV · Inventory',
    title: 'Read the affliction',
    body: 'Each debuff says its name, the turns remaining (or Permanent) and the effect: what it ticks for, which actions a stun takes away, the stack counts at which fire spreads. Hovering an enemy on the field shows you the same list for them.',
    task: 'Read the entry, then close the inventory with ESC.',
    trigger: { on: 'panel', panel: 'inventory-closed' },
  },

  // ---- V. Summons -----------------------------------------------------------
  {
    id: 'summon-intro',
    chapter: 'V · Summons',
    title: 'A body of your own',
    body: 'Some spells leave a summon on the field that belongs to you. A ghost has been conjured beside you to show this, and the dummy has gone still again. Most summons will be controllable, and some will act on their own.',
    stages: ['give-summon'],
    focus: 'summon',
    trigger: { on: 'confirm' },
  },
  {
    id: 'summon-command',
    chapter: 'V · Summons',
    title: 'Take the reins',
    body: 'COMMAND costs a bonus action and hands you the summon nearest your cursor. If you own several, hover the one you want and press U again to switch.',
    task: 'Hover the ghost and press U.',
    stages: ['refresh-actions'],
    focus: 'summon',
    trigger: { on: 'command', cmd: 'command' },
  },
  {
    id: 'summon-drive',
    chapter: 'V · Summons',
    title: 'Drive it',
    body: 'The ghost is now the acting body and every normal control drives it: M to move, A to attack, I for its inventory (a summon can only have one item). It has a full turn of its own — one move AND one main action — and control snaps back to you the moment it has spent both.',
    task: 'Move the ghost and attack the dummy, or press E to hand control back early.',
    focus: 'summon',
    trigger: { on: 'command', cmd: 'uncommand' },
  },
  {
    id: 'done',
    chapter: 'V · Summons',
    title: 'That is the whole game',
    body: 'Now you know the basics of how to Dimir. You can discover more mechanics that the game has to offer as you play. ',
    task: 'Press Continue to return to the menu.',
    stages: ['finish'],
    trigger: { on: 'confirm' },
  },
];
