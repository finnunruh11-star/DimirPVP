// Level-ups earned outside a fight (bounties, searches, levels a fallen member
// missed). Same rewards and prompts as the arena: pick one stat on even levels,
// learn a word on even levels and every fifth, then settle the colour order
// when counts tie. The prompts only collect a choice; the run takes it through
// the actions, so a guest's choice is checked by the host.

import type Phaser from 'phaser';
import type { ColorName } from '../../core/Colors';
import type { Mage } from '../../core/Mage';
import { STAT_DEFS, type StatKey } from '../../core/Stats';
import { levelsOwed, levelTaken } from '../../pve/exploration/coop';
import { memberIn, partyOf } from '../../pve/exploration/economy';
import type { ExplorationActions } from '../../pve/exploration/intents';
import { colorTies, godWordChoices, learnedLoadout, levelWordOffers, type LevelChoice } from '../../pve/exploration/levels';
import type { ExplorationRun } from '../../pve/exploration/run';
import { levelReward } from '../../pve/progression';
import { ChoiceMenuView } from '../combat/CombatMenus';
import { playLevelWordChoice } from './Awakening';

/** Walk the acting member (or, in solo, everyone) through every level still owed. True when anything changed. */
export async function resolvePendingLevels(scene: Phaser.Scene, run: ExplorationRun, actions: ExplorationActions): Promise<boolean> {
  const members = actions.member ? [actions.member] : partyOf(run).map((mage) => mage.mageClass);
  let changed = false;
  for (const member of members) {
    while (levelsOwed(run, member) > 0) {
      const mage = memberIn(run, member);
      if (!mage) break;
      const choice = await promptLevel(scene, run, mage, levelTaken(run, member) + 1);
      const result = await actions.apply({ op: 'level', choice });
      if (!result.ok) break;
      changed = true;
    }
  }
  return changed;
}

/** Ask for one level's rewards; nothing is kept until the choice is applied. */
async function promptLevel(scene: Phaser.Scene, run: ExplorationRun, mage: Mage, level: number): Promise<LevelChoice> {
  const reward = levelReward(level);
  const choice: LevelChoice = { level, stats: [] };
  if (reward.stats > 0) choice.stats = [await promptStat(scene, level, reward.statGain)];
  let loadout = [...mage.loadout];
  if (reward.word) {
    const offers = levelWordOffers(run, mage.mageClass, level, loadout);
    if (offers.length) {
      const picked = await playLevelWordChoice(scene, level, offers, loadout, godWordChoices(loadout));
      choice.replace = picked.replace;
      if (picked.ascend) {
        choice.ascend = picked.ascend;
        loadout[picked.replace] = picked.ascend;
      } else {
        choice.word = picked.word;
        loadout = learnedLoadout(loadout, picked.word, picked.replace) ?? loadout;
      }
    }
  }
  const ties = colorTies(loadout);
  if (ties.primary.length > 1) choice.primary = await chooseColor(scene, 'CHOOSE PRIMARY COLOR', ties.primary);
  const primary = choice.primary ?? ties.primary[0];
  const seconds = primary ? ties.secondary(primary) : [];
  if (seconds.length > 1) choice.secondary = await chooseColor(scene, 'CHOOSE SECONDARY COLOR', seconds);
  return choice;
}

function promptStat(scene: Phaser.Scene, level: number, gain: number): Promise<StatKey> {
  return new Promise((resolve) => {
    const panel = new ChoiceMenuView<StatKey>(scene, `LEVEL ${level} / TRAINING`, `Raise one stat by ${gain}.`,
      STAT_DEFS.map((definition) => ({ id: definition.key, label: definition.name, detail: definition.blurb })),
      (stat) => {
        panel.destroy();
        resolve(stat);
      });
  });
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
