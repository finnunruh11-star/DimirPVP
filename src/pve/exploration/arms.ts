// The first thing in Kerusai: pick a weapon. The Lodge keeps one of each starter
// weapon on a pedestal, and nobody leaves town without one. With no more
// travellers than pedestals each weapon goes to one traveller; a bigger party
// shares them. Pure: no Phaser.

import { MAGE_CLASSES, type MageClass } from '../../core/Classes';
import { getItem, type ItemId } from '../../core/Items';
import { memberOf } from './coop';
import { ARMS_PENDING, STARTER_WEAPONS } from './creation';
import { grantToMage, memberIn, withParty, type ShopResult } from './economy';
import type { ExplorationRun } from './run';

/** The Kerusai Lodge, whose pedestals arm a new party. */
export const ARMS_LODGE = 'kerusai-guild';
const BOW_ARROWS = 3;
const PICK = /^arms:([a-z]+):([A-Za-z]+)$/;

export const armsPending = (run: ExplorationRun): boolean => run.flags.includes(ARMS_PENDING);

const isStarter = (id: string): id is ItemId => STARTER_WEAPONS.some((weapon) => weapon.id === id);

/** Which starter weapon each traveller took. */
export function starterPicks(run: ExplorationRun): Partial<Record<MageClass, ItemId>> {
  const picks: Partial<Record<MageClass, ItemId>> = {};
  for (const flag of run.flags) {
    const match = PICK.exec(flag);
    if (!match || !MAGE_CLASSES.includes(match[1] as MageClass) || !isStarter(match[2])) continue;
    picks[match[1] as MageClass] = match[2];
  }
  return picks;
}

/** More travellers than pedestals: any weapon may be taken by several of them. */
export const weaponsShared = (run: ExplorationRun): boolean => run.party.entities.length > STARTER_WEAPONS.length;

/** Why `member` cannot take `weapon` right now, or null when it may. */
export function starterRefusal(run: ExplorationRun, member: MageClass, weapon: string): string | null {
  if (!armsPending(run)) return 'Everyone has a weapon.';
  if (!isStarter(weapon)) return 'Not a starter weapon.';
  const picks = starterPicks(run);
  if (picks[member]) return 'One each. We are generous, not stupid.';
  if (!weaponsShared(run) && Object.values(picks).includes(weapon)) return 'Already taken.';
  return null;
}

/** `member` (null: the leader) takes `weapon` off its pedestal. Once everyone has one, the town lets them go. */
export function takeStarterWeapon(run: ExplorationRun, member: MageClass | null, weapon: string): ShopResult {
  const who = member ?? memberIn(run)?.mageClass;
  if (!who) return { ok: false, message: 'Nobody to arm.' };
  const refusal = starterRefusal(run, who, weapon);
  if (refusal) return { ok: false, message: refusal };
  const id = weapon as ItemId;
  withParty(run, (_leader, party) => {
    const mage = memberOf(party, who);
    if (!mage) return;
    grantToMage(mage, id);
    if (id === 'huntingBow') mage.arrows += BOW_ARROWS;
  });
  run.flags.push(`arms:${who}:${id}`);
  const picks = starterPicks(run);
  if (run.party.entities.every((entity) => picks[entity.mageClass])) {
    run.flags = run.flags.filter((flag) => flag !== ARMS_PENDING && !flag.startsWith(LODGE));
  }
  return { ok: true, message: `You take the ${getItem(id).name}.` };
}

const LODGE = 'arms-in:';

/** `member` (null: the leader) has come into the Lodge; the pedestals wait until everyone has. */
export function enterLodge(run: ExplorationRun, member: MageClass | null): ShopResult {
  const who = member ?? memberIn(run)?.mageClass;
  if (!who || !armsPending(run)) return { ok: false, message: 'Nothing to wait for.' };
  if (!run.flags.includes(`${LODGE}${who}`)) run.flags.push(`${LODGE}${who}`);
  return { ok: true, message: '' };
}

/** Travellers who have not yet come into the Lodge, in party order. */
export function lodgeWaiting(run: ExplorationRun): MageClass[] {
  if (!armsPending(run)) return [];
  return run.party.entities.map((entity) => entity.mageClass).filter((member) => !run.flags.includes(`${LODGE}${member}`));
}

const GATE_LINES = [
  'Get a weapon at the Guild first.',
  '"Unarmed? Out there? Guild first. Then go and die properly."',
  'The guard sighs. "Last one went out with a spoon. We found the spoon. Guild first."',
];

/** What stops the party at the gate of `placeId` (the `attempt`th try), or null when it may leave. */
export function gateRefusal(run: ExplorationRun, placeId: string, town: string, attempt = 0): string | null {
  if (placeId !== town || !armsPending(run)) return null;
  return GATE_LINES[attempt % GATE_LINES.length];
}

/** The journal's lines while someone still has no weapon; empty once everyone is armed. */
export function armsLines(run: ExplorationRun): string[] {
  if (!armsPending(run)) return [];
  return ['GET A WEAPON', 'Kerusai Guild: walk to the door and press E.'];
}
