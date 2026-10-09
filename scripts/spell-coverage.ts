// Every 1-3 word combination an Expedition mage can hold that casts nothing, for some class or with a modifier.
// Run: npx tsx scripts/spell-coverage.ts [extra words...]
import '../src/spells/sampleSpells';
import '../src/spells/classSpells';
import { MAGE_CLASSES } from '../src/core/Classes';
import { WORD_COLOR } from '../src/core/Colors';
import { WORD_ORDER, isClassSpell, type WordId } from '../src/core/Words';
import { getSpell, setActiveSpellSets, ADVENTURE_SPELL_SETS } from '../src/spells/registry';

setActiveSpellSets(ADVENTURE_SPELL_SETS);
// The creation/level pool, the moonshards, Lightning and the god words, plus any words named on the command line.
const words: WordId[] = [...WORD_ORDER, 'fire', 'lightning', 'death', 'desecrate', 'reality', 'stop', ...(process.argv.slice(2) as WordId[])];
// God words take only their own colour and colourless words; red, black and blue never meet.
const legal = (combo: WordId[]): boolean => {
  const colors = new Set(combo.map((w) => WORD_COLOR[w]));
  const godBlack = combo.some((w) => w === 'death' || w === 'desecrate');
  const godBlue = combo.some((w) => w === 'reality' || w === 'stop');
  if (godBlack && (colors.has('blue') || colors.has('red'))) return false;
  if (godBlue && (colors.has('black') || colors.has('red'))) return false;
  if (colors.has('red') && colors.has('black') && colors.has('blue')) return false;
  return true;
};
const combos: WordId[][] = [];
words.forEach((a, i) => {
  combos.push([a]);
  words.slice(i + 1).forEach((b, j) => {
    combos.push([a, b]);
    for (const c of words.slice(i + j + 2)) combos.push([a, b, c]);
  });
});
const missing: string[] = [];
for (const combo of combos.filter(legal)) {
  const lacking: string[] = MAGE_CLASSES.filter((cls) => !getSpell(combo, cls));
  // A modifier always casts the ordinary spell.
  if (!getSpell(combo, null)) lacking.push('ordinary');
  if (lacking.length) missing.push(`${combo.join(' ')}${isClassSpell(combo) ? ' (class)' : ''} -> ${lacking.join(',')}`);
}
console.log(missing.join('\n'));
console.log(`${missing.length} missing`);
