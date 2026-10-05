// A short rest: an hour or two off your feet, anywhere. A quarter of everything
// comes back, rounded up: health, mana, sanity and every word's charges. Inside
// walls nothing disturbs it; out in the country something may find you first,
// and then the rest is over before it did you any good. Pure and seeded.

import type { MageClass } from '../../core/Classes';
import type { Dice } from '../../core/Dice';
import type { Cell } from '../../world/pathfind';
import { areaHours } from './area';
import { bloodmoonDue, hoursBeforeBloodmoon } from './bloodmoon';
import { isNight, spanLabel } from './clock';
import { withParty } from './economy';
import { rollEncounter, troubleIn, type EncounterKind, type EncounterSpawn } from './encounters';
import type { ExplorationRun } from './run';
import { createWorld, depthAt, nearTown, REGIONS, regionAt, TERRAIN, terrainAt, type RegionId } from './world';

/** Share of every maximum a short rest gives back, rounded up. */
export const SHORT_REST_SHARE = 0.25;
/** Hours a short rest takes, at least and at most (in quarter hours between). */
export const SHORT_REST_HOURS = { min: 1, max: 2 } as const;
/** Chance per short rest in plain country by day of being found, before region and ground. */
const REST_RISK = 0.3;
const REST_RISK_NIGHT = 1.3;
const REST_RISK_MAX = 0.75;

/** Where the party lies down: behind walls, or out in the country on a world tile. */
export type RestSite = { safe: true } | { safe: false; tile: Cell };

/** Chance a short rest at `site` is broken by an ambush. */
export function shortRestRisk(run: ExplorationRun, site: RestSite): number {
  if (site.safe) return 0;
  const { x, y } = site.tile;
  if (nearTown(x, y)) return 0;
  const world = createWorld();
  const terrain = TERRAIN[terrainAt(world, x, y)];
  const ground = Number.isFinite(terrain.time) ? terrain.danger : 1;
  const risk = REST_RISK * REGIONS[regionAt(world, x, y)].danger * ground * (isNight(run.hour) ? REST_RISK_NIGHT : 1);
  return Math.min(REST_RISK_MAX, risk);
}

export interface RestAmbush {
  kind: EncounterKind;
  zone: RegionId;
  depth: number;
  spawns: EncounterSpawn[];
}

export interface ShortRestOutcome {
  /** Hours it took; an ambush or the bloodmoon cuts it short. */
  hours: number;
  ambush: RestAmbush | null;
  /** The bloodmoon rose before the rest was done. */
  bloodmoon?: boolean;
  /** What each member who rested got back. */
  restored: { member: MageClass; name: string; hp: number; mana: number; sanity: number; charges: number }[];
  message: string;
}

/** Hours `members` (null: everyone) can rest before the bloodmoon rises. On foot, whoever is behind the party's clock has the difference in hand. */
function hoursToRise(run: ExplorationRun, members: readonly MageClass[] | null): number {
  const left = hoursBeforeBloodmoon(run, Infinity);
  const area = run.area;
  if (!area || !members?.length || bloodmoonDue(run)) return left;
  const ahead = Math.max(...members.map((member) => area.spent[member] ?? 0));
  return left + Math.max(0, areaHours(area) - ahead);
}

/**
 * Rest `members` (null: everyone standing) at `site`. The fallen stay down: only
 * a night at an inn gets them up. The caller moves the clock on by `hours`.
 */
export function takeShortRest(run: ExplorationRun, members: readonly MageClass[] | null, site: RestSite, dice: Dice): ShortRestOutcome {
  const quarters = (SHORT_REST_HOURS.max - SHORT_REST_HOURS.min) * 4;
  const hours = SHORT_REST_HOURS.min + (dice.die(quarters + 1) - 1) / 4;
  const rise = hoursToRise(run, members);
  const risk = shortRestRisk(run, site);
  if (!site.safe && risk > 0 && dice.float() < risk) {
    const world = createWorld();
    const { x, y } = site.tile;
    const zone = regionAt(world, x, y);
    const depth = Math.min(10, depthAt(world, x, y) + (isNight(run.hour) ? 1 : 0));
    const kind = troubleIn(zone, dice.float() < REGIONS[zone].robbery);
    // Found partway through: half the rest or so, and nothing to show for it.
    const cut = Math.max(0.25, Math.round(hours * (0.3 + 0.4 * dice.float()) * 4) / 4);
    const spawns = kind ? rollEncounter(zone, kind, depth, dice) : [];
    if (kind && cut <= rise) {
      return {
        hours: cut,
        ambush: { kind, zone, depth, spawns },
        restored: [],
        message: kind === 'robbery' ? 'Bandits fall on the camp before anyone has rested.' : 'Something finds the camp before anyone has rested.',
      };
    }
  }
  // The bloodmoon ends it early: only the part rested counts.
  const early = rise < hours;
  const took = early ? rise : hours;
  const restored = took <= 0 ? [] : withParty(run, (_leader, party) => party
    .filter((mage) => mage.alive && (!members || members.includes(mage.mageClass)))
    .map((mage) => ({ member: mage.mageClass, name: mage.name, ...mage.restoreShare((SHORT_REST_SHARE * took) / hours) })));
  const gains = restored.map((entry) => {
    const parts = [
      entry.hp ? `+${entry.hp} HP` : '',
      entry.mana ? `+${entry.mana} mana` : '',
      entry.sanity ? `+${entry.sanity} sanity` : '',
      entry.charges ? `+${entry.charges} charge${entry.charges === 1 ? '' : 's'}` : '',
    ].filter(Boolean);
    return `${restored.length > 1 ? `${entry.name} ` : ''}${parts.length ? parts.join(', ') : 'already rested'}`;
  });
  if (early) {
    return {
      hours: took,
      ambush: null,
      bloodmoon: true,
      restored,
      message: `The bloodmoon rises ${took > 0 ? `${spanLabel(took)} in` : 'before anyone lies down'}.${gains.length ? ` ${gains.join('.  ')}.` : ''}`,
    };
  }
  return {
    hours,
    ambush: null,
    restored,
    message: restored.length ? `Rested. ${gains.join('.  ')}.` : 'Nobody standing can rest.',
  };
}
