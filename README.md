# PVP Dimir — Tactical Mage Combat

A turn-based tactical spell-combat game built with **Phaser 3 + TypeScript + Vite**.
Mages build a loadout of up to **5 words** and combine **1–3 of them** into spells.
Actions resolve on an **MTG-style reaction stack** in competitive matches and
cooperative PvE runs.

## Run it

Double-click **`start.bat`** (Windows) or **`start.sh`** (macOS / Linux). It checks
for Node.js, installs everything, starts the server, and opens a browser tab.
Leave the window open while you play; closing it stops the server.

The same thing from a terminal:

```bash
npm start        # install, then serve http://localhost:5173
```

Already installed and just want the individual steps:

```bash
npm install
npm run dev      # serves http://localhost:5173
npm test         # runs the menu/config/network checks
npm run build    # type-check + production bundle into dist/
```

Append `?ui=gallery` to the local URL to open the cabinet UI gallery with
representative menu, preparation, combat, inventory, PvE, Workshop, pause, and
end-state surfaces without starting a match.

For online, LAN, Creative Swamprun, and Campaign hosting instructions, see
[MULTIPLAYER.md](MULTIPLAYER.md).

## How to play

1. **Menu**: choose **Versus**, **Adventures**, or **Workshop**, then follow the
  connected setup screens. Only relevant decisions are shown: roster and teams,
  preparation, content packs, each human mage build, then a final review.
  Adventures contains **Swamprun**, **Expedition**, **Mine Run**, and **Raid**;
  Workshop contains **Training Lab**, **Scenario Lab**, and **Memory**.
2. **Your turn** gives you **1 move, 1 main, 2 bonus** actions (and **1 reaction** per
   round if your loadout has Bind / Veil / Mind).
3. **Keys**:
  - `1`–`5` — toggle the loadout words into your current selection (max 3).
   - `Enter` — cast the selected combination (if a spell exists for it).
  - `Tab` or right-click — open the complete context-aware action menu.
  - `I` — open equipment, supplies, and status effects.
   - `M` — move (click within the range circle).
   - `A` — melee attack (click an enemy in range).
   - `E` — end your turn.
  - `Esc` — cancel the current aim; with no active aim, open Pause.
4. The **measured range instrument** shows the reach of your current selection. Targeted spells need
   a valid target clicked.
5. **The stack**: every action becomes a token at the top of the screen (hover to
   inspect). Before anything resolves, the opponent may **react** if eligible. Items
   resolve last-in-first-out and **fizzle** if their target is gone, dead or unseen on
   resolution.

## Interface

The frontend uses one Phaser-native cabinet system across setup and play: dark
timber frames, brass fittings, bone word plates, felt recesses, shared focus
states, and bounded paged catalogues. Pointer/touch, arrows, `Tab`/
`Shift+Tab`, `Enter`/`Space`, and `Esc` are supported throughout connected
menus and windows. Pause contains the persistent Full/Reduced motion setting
and combat-speed control.

## PvE runs

- **Swamprun** is endless co-op survival against escalating swamp creatures and
  milestone bosses.
- **Expedition** is currently a solo/local campaign with depth choices,
  retreating, XP, personal gold, a town, and recruitable companions.
- **Raid** begins by selecting a Lich, Reaper, or Deathknight (Spear), then uses
  Quick, Rolled stats + gear, or Creative preparation for one boss fight.
  The fight opens with a preparation phase: three rooted 1 HP practice effigies
  that never fight back and always reform, plus three free action-menu restores
  for health and mind, mana, and word charges. The restores cost no action at
  all, not even a bonus action, and can be used as often as needed. Use the
  phase to equip your gear and build up kill-powered and stacking items, then
  summon the boss from the action menu.
  Everything you built carries straight into the fight. Defeating the selected
  target wins. Raids support 1-4 local hotseat players, AI allies, and seeded
  online co-op.
- **Mine Run** is a seeded maze of tunnels, junctions, and hidden rooms. Choose
  among one to four paths at each junction or room exit; rooms have a slight
  chance to gain one extra path, still capped at four. Navigation uses the
  complete discovered map: traveled tunnels remain visible, unexplored paths
  appear as dashed branches, the party's location is highlighted, and connected
  routes are selected directly on the map. The map's **Inventory** button or `I`
  opens a read-only view of the local explorer's gear, supplies, and statuses.
  A room's contents stay concealed at its threshold, although waiting enemies can
  be heard; enter to reveal it or turn around through the tunnel just used. Once
  entered, empty, opened-treasure, and cleared-combat rooms can be crossed without
  another prompt. Ore and supply rooms remain interactive when revisited.

Mine rooms may be empty or hold enemies, treasure, ore, or a supply shop.
Hostile rooms start a fresh optional combat and return the party to exploration
when cleared. Eight percent of generated passages contain a predetermined trap,
which is spent after its first crossing from either direction. A party member
normally has a 10% chance to evade it; active light has a 20% chance to reveal it
first and raise that chance to 65%. The party starts with one shared pickaxe at
2 durability. Shared gold buys new 10-durability pickaxes for 3g; ore veins use
cumulative d20 mining progress, can collapse after repeated failed strikes, and
wear a pickaxe on a natural 1 or 2. Supply rooms also carry the complete
Swamprun shop stock.

Mine creatures have intrinsic combat rules in addition to ordinary equipment:
Rocklings launch toward a target but deal damage and break apart only if they
make physical body contact. Sentinels reveal Tank, Healer, or DPS roles;
Golems must wake after being targeted; Cavern Bats are airborne; Earth Elementals
stockpile stones; Dragonborn use breath attacks; and Pftlhb collapse on genuine
torch, lantern, light, or fire exposure. Fire-aligned creatures resist heat and
light but are weak to shadow. Scaled creatures resist slashing and are weak to
pierce.

Mine visuals mirror those rules directly. Earth Elementals orbit one visible
pebble per stored stone, successful Rockling impacts play a compact shatter,
and armed players and enemies carry a wooden pixel-art sprite matching their
weapon family. Map rooms use a concealed-door icon until entry, then reveal a
distinct icon and illustrated vignette for quiet, hostile, treasure, ore, and
supply rooms. The current room's vignette remains visible beside the map even
when that room needs no interaction prompt.

All PvE runs support local parties and seeded online co-op. See
[MULTIPLAYER.md](MULTIPLAYER.md) for relay setup.

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
  effects/FxPresets.ts  Named action and animation timing presets.
  pve/
    swamprun.ts         Swamp roster, wave composition, and loot.
    minerun.ts          Mine roster, scaling, affinities, equipment, and loot.
    mineMaze.ts         Seeded maze, rooms, traps, ore, and pickaxe rules.
    mineActions.ts      Stack-based Mine creature actions.
    mineAI.ts           Deterministic Mine action selection.
  spells/
    Spell.ts            Spell type.
    registry.ts         registerSpell / getSpell (keyed by word combo).
    sampleSpells.ts     Example spells — copy these to make your own.
  ai/SimpleAI.ts        The optional AI opponent.
  scenes/               MenuScene (loadout) + GameScene (gameplay/UI).
  ui/cabinet/           Shared materials, controls, windows, and motion setting.
  ui/combat/            Action/choice menus, inventory, pause, and end cards.
  ui/prep/              Rolled, draft, and Creative preparation workspaces.
  ui/pve/               Swamprun, Mine, and Expedition cabinet workspaces.
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
