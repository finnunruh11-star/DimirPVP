// Level-ups earned outside a fight (bounties, road events). Same rewards and
// prompts as the arena: train a stat on odd levels, learn a word on even ones,
// both on every fifth, then settle the colour identity when counts tie.

import type Phaser from 'phaser';
import { WORD_COLOR, type ColorName } from '../../core/Colors';
import type { Dice } from '../../core/Dice';
import type { Mage } from '../../core/Mage';
import { STAT_DEFS, type StatKey } from '../../core/Stats';
import { isModifierWord, WORD_ORDER, WORDS, type WordId } from '../../core/Words';
import { runDice } from '../../pve/exploration/economy';
import { capturePartySnapshot, restoreParty } from '../../pve/exploration/party';
import type { ExplorationRun } from '../../pve/exploration/run';
import { levelReward, rackIsFull } from '../../pve/progression';
import { ChoiceMenuView, MultiSelectView } from '../combat/CombatMenus';

/** Walk the leader through every level still owed. Returns true when anything changed. */
export async function resolvePendingLevels(scene: Phaser.Scene, run: ExplorationRun): Promise<boolean> {
  if (run.pendingLevels <= 0) return false;
  const party = restoreParty(run.party);
  const leader = party[0];
  if (!leader) {
    run.pendingLevels = 0;
    return true;
  }
  while (run.pendingLevels > 0) {
    const level = run.level - run.pendingLevels + 1;
    run.pendingLevels -= 1;
    const reward = levelReward(level);
    if (reward.stats > 0) await promptStats(scene, leader, level, reward.stats);
    if (reward.word) await promptWord(scene, leader, level, runDice(run, `level-word:${level}`));
    await promptColorIdentity(scene, leader);
  }
  run.party = capturePartySnapshot(party);
  return true;
}

function promptStats(scene: Phaser.Scene, player: Mage, level: number, maxStats: number): Promise<void> {
  const subtitle = maxStats === 1 ? 'Raise one stat by 1' : `Raise up to ${maxStats} different stats by 1`;
  return new Promise((resolve) => {
    const panel = new MultiSelectView<StatKey>(scene, `LEVEL ${level} / TRAINING`, subtitle,
      STAT_DEFS.map((definition) => ({ id: definition.key, label: definition.name, detail: definition.blurb })),
      maxStats, (selected) => {
        for (const stat of selected) player.gainStat(stat, 1);
        panel.destroy();
        resolve();
      });
  });
}

function wordOffers(player: Mage, dice: Dice): WordId[] {
  const pool = WORD_ORDER.filter((word) => !player.loadout.includes(word));
  const offers: WordId[] = [];
  while (pool.length > 0 && offers.length < 3) {
    const word = dice.pick(pool);
    offers.push(word);
    pool.splice(pool.indexOf(word), 1);
  }
  return offers;
}

function promptWord(scene: Phaser.Scene, player: Mage, level: number, dice: Dice): Promise<void> {
  const offers = wordOffers(player, dice);
  if (offers.length === 0) return Promise.resolve();
  const full = rackIsFull(player.loadout);
  return new Promise((resolve) => {
    const panel = new ChoiceMenuView<WordId>(scene, `LEVEL ${level} / NEW WORD`,
      full ? 'Choose a word, then replace one of your five.' : 'Choose one of three words.',
      offers.map((word) => ({ id: word, label: WORDS[word].label, detail: WORDS[word].blurb })),
      async (word) => {
        panel.destroy();
        if (full) await promptReplacement(scene, player, word);
        else player.setLoadout([...player.loadout, word]);
        resolve();
      });
  });
}

function promptReplacement(scene: Phaser.Scene, player: Mage, gained: WordId): Promise<void> {
  return new Promise((resolve) => {
    const choices = player.loadout.flatMap((word, index) => isModifierWord(word) ? [] : [{
      id: String(index),
      label: WORDS[word].label,
      detail: `Replace ${WORDS[word].label} with ${WORDS[gained].label}.`,
    }]);
    const panel = new ChoiceMenuView(scene, `LEARN ${WORDS[gained].label.toUpperCase()}`,
      'Choose a known word to replace.', choices, (indexText) => {
        const next = [...player.loadout];
        next[Number(indexText) | 0] = gained;
        player.setLoadout(next);
        panel.destroy();
        resolve();
      });
  });
}

async function promptColorIdentity(scene: Phaser.Scene, player: Mage): Promise<void> {
  const counts: Record<ColorName, number> = { black: 0, blue: 0, white: 0, red: 0 };
  for (const word of player.loadout) {
    const color = WORD_COLOR[word];
    if (color !== 'none') counts[color] += 1;
  }
  const present = (Object.keys(counts) as ColorName[]).filter((color) => counts[color] > 0);
  if (present.length < 2) {
    player.setLoadout(player.loadout, null, null);
    return;
  }
  const top = Math.max(...present.map((color) => counts[color]));
  const firsts = present.filter((color) => counts[color] === top);
  const primary = firsts.length > 1 ? await chooseColor(scene, 'CHOOSE PRIMARY COLOR', firsts) : firsts[0];
  const remaining = present.filter((color) => color !== primary);
  const second = Math.max(...remaining.map((color) => counts[color]));
  const seconds = remaining.filter((color) => counts[color] === second);
  const secondary = seconds.length > 1 ? await chooseColor(scene, 'CHOOSE SECONDARY COLOR', seconds) : seconds[0];
  player.setLoadout(player.loadout, primary, secondary);
}

function chooseColor(scene: Phaser.Scene, title: string, colors: ColorName[]): Promise<ColorName> {
  return new Promise((resolve) => {
    const panel = new ChoiceMenuView<ColorName>(scene, title, 'Equal word counts let you decide the order.',
      colors.map((color) => ({
        id: color,
        label: color.toUpperCase(),
        detail: `${color.toUpperCase()} becomes the stronger color identity.`,
      })), (color) => {
        panel.destroy();
        resolve(color);
      });
  });
}
