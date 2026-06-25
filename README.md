# PVP Dimir — Mage Duel

A turn-based duel between two mages built with **Phaser 3 + TypeScript + Vite**.
Each mage picks **4 of 8 words** and combines **1–3 of them** into spells. Actions
resolve on an **MTG-style reaction stack**.

## Run it

```bash
npm install
npm run dev      # opens http://localhost:5173
npm run build    # type-check + production bundle into dist/
```

## How to play

1. **Menu**: pick 4 words, choose **Vs AI** or **Hotseat (2P)**, confirm. In hotseat
   each player picks their own 4 words.
2. **Your turn** gives you **1 move, 1 main, 2 bonus** actions (and **1 reaction** per
   round if your loadout has Bind / Veil / Mind).
3. **Keys**:
   - `1`–`4` — toggle the loadout words into your current selection (max 3).
   - `Enter` — cast the selected combination (if a spell exists for it).
   - `M` — move (click within the range circle).
   - `A` — melee attack (click an enemy in range).
   - `E` — end your turn.
   - `Esc` — cancel the current aim.
4. The **range circle** shows the reach of your current selection. Targeted spells need
   a valid target clicked.
5. **The stack**: every action becomes a token at the top of the screen (hover to
   inspect). Before anything resolves, the opponent may **react** if eligible. Items
   resolve last-in-first-out and **fizzle** if their target is gone, dead or unseen on
   resolution.

## Project layout

```
src/
  config/constants.ts   Tunables: ranges, action economy, vitals, colours.
  core/
    Words.ts            The 8 words (add new words here).
    Mage.ts             Mage state: vitals, charges, statuses, action pool.
    Damage.ts           Damage classes/types + the dmg() helper.
    Status.ts           Invisibility / stun / dot / debuff status model.
    Dice.ts             Dice roller ("2d6+1", chance, pick).
    GameState.ts        Mages, turns, the stack, targeting rules.
    Stack.ts            StackItem shape.
    utils.ts            Vec2 maths.
  effects/effects.ts    >>> SPELL EFFECT INFRASTRUCTURE (build spells from these).
  spells/
    Spell.ts            Spell type.
    registry.ts         registerSpell / getSpell (keyed by word combo).
    sampleSpells.ts     Example spells — copy these to make your own.
  ai/SimpleAI.ts        The optional AI opponent.
  scenes/               MenuScene (loadout) + GameScene (gameplay/UI).
```

## Extending it (the important bit)

### Add a new word
Add an entry to `WORDS` and `WORD_ORDER` in `src/core/Words.ts`. Set
`grantsReaction: true` to make it a reaction word. Everything else (menu, AI, charges)
picks it up automatically.

### Author a new spell
A spell maps a **combination of words** to an effect. Register it in
`src/spells/sampleSpells.ts` (or any file imported from `main.ts`):

```ts
registerSpell({
  name: 'My Spell',
  words: ['shadow', 'pierce'], // 1–3 words; the combo is the key
  actionType: 'main',          // 'main' | 'bonus'
  range: 300,                  // pixels; 0 = self only
  targeting: 'enemy',          // 'none' | 'self' | 'enemy' | 'ally' | 'point'
  reaction: true,              // optional: castable outside your turn
  counters: true,              // optional: counters the item it responds to
  description: 'Shown in the stack tooltip.',
  cast(ctx) {
    if (!ctx.target) return;
    const amount = rollDice(ctx, '1d8+2');
    dealDamage(ctx, ctx.target, dmg(amount, 'shadow', 'physical'));
  },
});
```

Word combinations with no registered spell simply can't be cast, so add as many or as
few as you like.

### Effect building blocks (`src/effects/effects.ts`)
Compose these inside `cast(ctx)`:

| Function | What it does |
| --- | --- |
| `rollDice(ctx, spec)` | Roll `"2d6+1"`, `"d20"`, … (logged), returns the total. |
| `dealDamage(ctx, target, dmg(...))` | Damage; honours invisibility + damage mods. |
| `heal(ctx, target, amount, 'hp' \| 'sanity')` | Restore health or sanity. |
| `applyInvisibility(ctx, target, { duration, mode, missChance, extend })` | `mode: 'full' \| 'partial'`. |
| `applyStun(ctx, target, { duration, type, extend })` | `type: 'main' \| 'movement' \| 'full'`. |
| `dash(ctx, mover, { toPoint? , direction?, distance })` | Forced/voluntary movement. |
| `applyDot(ctx, target, { name, duration, damage, extend })` | Damage over time. |
| `applyDebuff(ctx, target, { name, duration, mods, extend })` | Stat mods (`moveRange`, `damageDealt`, `damageTaken`). |
| `cleanse(ctx, target)` | Remove debuffs/dots/stuns. |

`ctx` gives you `caster`, `target`, `targetPoint`, `rng` and `log`. Add brand-new
effect kinds by exporting another function here.

### Tune the game
Edit `src/config/constants.ts` (ranges, action economy, starting HP/sanity, colours).
