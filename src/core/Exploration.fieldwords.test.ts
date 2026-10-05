import { MAGE_CLASSES, type MageClass } from '../core/Classes';
import type { WordId } from '../core/Words';
import { isStraightAttack } from '../pve/exploration/fieldWords';
import { getColorAbilitiesFor } from '../spells/colorAbilities';
import { allSpells, getSpell, setActiveSpellSets } from '../spells/registry';
import '../spells/sampleSpells';
import '../spells/classSpells';

setActiveSpellSets({ original: true, finns: true, dlc: true });

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function straight(words: WordId[], mageClass: MageClass | null = 'objects'): Promise<boolean> {
  const spell = getSpell(words, mageClass);
  assert(spell, `${words.join(' ')} is a spell for ${mageClass}`);
  return isStraightAttack(spell, mageClass);
}

const tests: [name: string, run: () => Promise<void>][] = [
  ['lets plain attacks open a fight from the field', async () => {
    const attacks: WordId[][] = [
      ['pierce'], ['shatter'], ['corrode'], ['curse'], ['drain'], ['death'], ['fire'], ['lightning'],
      ['mind', 'shatter'], ['shatter', 'pierce'], ['curse', 'fire'],
    ];
    for (const words of attacks) assert(await straight(words), `${words.join(' ')} is a straight attack`);
  }],

  ['refuses whatever is not just a straight attack', async () => {
    const others: WordId[][] = [
      ['shadow'], ['veil'], ['mind'], ['bind'], ['heal'],
      ['pierce', 'fire'], ['veil', 'pierce'], ['mind', 'pierce'], ['lightning', 'veil', 'pierce'],
    ];
    for (const words of others) assert(!(await straight(words)), `${words.join(' ')} is not a straight attack`);
  }],

  ['judges each class by its own spell', async () => {
    assert(await straight(['mind', 'corrode'], 'objects'), 'the ordinary Mind Corrode bites');
    assert(!(await straight(['mind', 'corrode'], 'life')), 'the Life Mind Corrode calls a leech up instead');
    const spell = getSpell(['pierce'], 'objects')!;
    assert(isStraightAttack(spell, 'objects') === isStraightAttack(spell, 'objects'), 'the verdict is worked out once');
  }],

  ['gives a classless traveller only the ordinary spells', async () => {
    const ordinary = allSpells(null);
    assert(ordinary.length > 0, 'the classless still cast');
    const ids = new Set(ordinary.map((spell) => spell.id));
    for (const mageClass of MAGE_CLASSES) {
      const variants = allSpells(mageClass).filter((spell) => !ids.has(spell.id));
      assert(variants.length > 0, `${mageClass} has class spells the classless lack`);
      for (const spell of variants) {
        assert(getSpell(spell.words, null)?.id !== spell.id, `${spell.id} is not cast by the classless`);
      }
    }
    assert(getColorAbilitiesFor('red', null).length === 1, 'one colour ability without a class');
  }],
];

for (const [name, run] of tests) {
  await run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration field words: ${tests.length} checks passed.`);
