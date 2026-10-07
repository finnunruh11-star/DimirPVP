import { MINIONS } from '../effects/classKit';
import { ENEMY_DEFS } from '../pve/swamprun';
import { MINE_ENEMY_DEFS } from '../pve/minerun';
import { Canvas } from './bosses/raster';
import { BOSS_ANIMS, renderAnim } from './bosses/rig';
import { creatureArt } from './creatures';
import { PLACEHOLDER_LOOKS, SUMMON_LOOKS, placeholderSpriteFor } from './creatureLooks';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const authored = new Set(['zombie', 'acidZombie', 'skeleton', 'wisp', 'defender', 'reaper']);
for (const kind of [...Object.keys(MINE_ENEMY_DEFS), ...Object.keys(ENEMY_DEFS)]) {
  assert(authored.has(kind) || placeholderSpriteFor(kind), `Missing enemy art: ${kind}`);
}
for (const kind of Object.keys(MINIONS)) assert(SUMMON_LOOKS[kind], `Missing summon art: ${kind}`);
for (const kind of ['ghost', 'sentry', 'binder', 'archer', 'neural-leech', 'thought-leech', 'remnant', 'sand-cadett', 'standardbearer', 'desertblight', 'orzhov-sandpriest', 'silencing-spike']) {
  assert(placeholderSpriteFor(kind), `Missing class summon art: ${kind}`);
}
assert(placeholderSpriteFor(undefined) === null, 'Players keep their original art');
assert(placeholderSpriteFor('unknown') === null, 'Unknown kinds retain a safe fallback');
assert(new Set([3, 4, 5, 6].map(heads => placeholderSpriteFor('hydra', heads))).size === 4, 'Hydra head counts have distinct sheets');

for (const [key, look] of Object.entries(PLACEHOLDER_LOOKS)) {
  const art = creatureArt(look);
  const idle = renderAnim(art, 'idle');
  for (const anim of BOSS_ANIMS) {
    const frames = renderAnim(art, anim);
    const hashes = frames.map(frame => frame.px.data.join(','));
    if (anim !== 'death') {
      assert(frames.every(frame => frame.px.data.some(color => color >= 0)), `${key} ${anim}: blank frame`);
    }
    if (look.body !== 'egg') assert(new Set(hashes).size > 1, `${key} ${anim}: static animation`);
    for (const frame of frames) {
      for (let edge = 0; edge < art.w; edge++) {
        assert(frame.px.get(edge, 0) < 0 && frame.px.get(edge, art.h - 1) < 0, `${key} ${anim}: vertical clipping`);
        assert(frame.px.get(0, edge) < 0 && frame.px.get(art.w - 1, edge) < 0, `${key} ${anim}: horizontal clipping`);
      }
    }
    if (anim === 'idle' || anim === 'walk') {
      const start = new Canvas(art.w, art.h);
      const end = new Canvas(art.w, art.h);
      art.draw(start, { anim, t: 0, f: 0, n: frames.length });
      art.draw(end, { anim, t: 1, f: frames.length, n: frames.length });
      assert(start.px.data.every((color, index) => color === end.px.data[index]), `${key} ${anim}: loop seam`);
    }
    if (anim === 'attack' || anim === 'hurt') {
      assert(frames[frames.length - 1].px.data.every((color, index) => color === idle[0].px.data[index]), `${key} ${anim}: recovery does not meet idle`);
    }
    if (anim === 'death') assert(frames[frames.length - 1].px.data.every(color => color < 0), `${key}: death does not finish`);
  }
}
console.log(`Creature visuals: roster coverage and ${Object.keys(PLACEHOLDER_LOOKS).length} cached looks passed animation checks.`);