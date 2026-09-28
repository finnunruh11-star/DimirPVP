// Setting out online. Travellers are claimed one seat at a time, host first:
// a class each for a new party, or one of the saved travellers for a resumed
// run. A new party then picks its words, modifier and weapon all at once, and
// the host checks every pick against the run's seeded offers before applying.

import { MAGE_CLASS_DEFS, MAGE_CLASSES, type MageClass } from '../core/Classes';
import { applyCreation, validCreationPick, type CreationPick } from '../pve/exploration/creation';
import { isMageClass } from '../pve/exploration/levels';
import { partyOf } from '../pve/exploration/economy';
import type { ExplorationRun } from '../pve/exploration/run';
import { chooseKit, type Chooser } from '../ui/pve/CreationFlow';
import { AdventureSession, HOST_SEAT } from './AdventureSession';
import type { NetMessage } from './Net';

type Prompt = (text: string | null) => void;

interface ClaimOption {
  id: MageClass;
  label: string;
  detail: string;
}

/** What can be claimed: any class for a new party, else the travellers the run already has. */
function claimOptions(run: ExplorationRun): ClaimOption[] {
  if (run.creating) {
    return MAGE_CLASSES.map((mageClass) => ({ id: mageClass, label: MAGE_CLASS_DEFS[mageClass].label, detail: MAGE_CLASS_DEFS[mageClass].blurb }));
  }
  return partyOf(run).map((mage) => ({
    id: mage.mageClass,
    label: `${mage.name}, ${MAGE_CLASS_DEFS[mage.mageClass].label}`,
    detail: mage.alive ? `HP ${mage.hp}/${mage.maxHp}, mana ${mage.mana}/${mage.maxMana}` : 'Fallen: back after a night at an inn.',
  }));
}

function readClaims(message: NetMessage, size: number): (MageClass | null)[] {
  const raw = Array.isArray(message.claims) ? message.claims : [];
  return Array.from({ length: size }, (_, seat) => (isMageClass(raw[seat]) ? raw[seat] as MageClass : null));
}

/** Everyone gets a traveller, in seat order. Sets the session's roster. */
export async function claimTravellers(session: AdventureSession, run: ExplorationRun, choose: Chooser, prompt: Prompt): Promise<void> {
  const options = claimOptions(run);
  const title = run.creating ? 'CHOOSE A CLASS' : 'CHOOSE YOUR TRAVELLER';
  const ask = (taken: readonly (MageClass | null)[]): Promise<MageClass> =>
    choose<MageClass>(title, run.creating ? 'Each class travels once in a party.' : 'Each traveller is played by one of you.',
      options.map((option) => ({
        ...option,
        detail: taken.includes(option.id) ? 'Already taken.' : option.detail,
        enabled: !taken.includes(option.id),
      })));
  if (session.isHost) {
    const claims: (MageClass | null)[] = Array.from({ length: session.size }, () => null);
    for (let seat = 0; seat < session.size; seat++) {
      session.send({ k: 'x-claims', claims, turn: seat });
      if (seat === HOST_SEAT) {
        prompt(null);
        claims[seat] = await ask(claims);
        continue;
      }
      prompt(`Waiting for ${session.nameOf(seat)} to choose...`);
      claims[seat] = await new Promise<MageClass>((resolve) => {
        const off = session.on('x-claim', (message) => {
          const value = message.value;
          if (message.from !== seat || !isMageClass(value) || claims.includes(value)) return;
          if (!options.some((option) => option.id === value)) return;
          off();
          resolve(value);
        });
      });
    }
    prompt(null);
    session.roster = claims;
    session.send({ k: 'x-claims', claims, turn: -1 });
    return;
  }
  await new Promise<void>((resolve) => {
    let asking = false;
    const handle = (message: NetMessage): void => {
      const claims = readClaims(message, session.size);
      const turn = typeof message.turn === 'number' ? message.turn : -1;
      if (turn < 0) {
        off();
        prompt(null);
        session.roster = claims;
        resolve();
        return;
      }
      if (turn !== session.localSeat) {
        prompt(`Waiting for ${session.nameOf(turn)} to choose...`);
        return;
      }
      if (asking) return;
      asking = true;
      prompt(null);
      void ask(claims).then((value) => {
        asking = false;
        session.send({ k: 'x-claim', value });
        prompt('Waiting for the others...');
      });
    };
    const off = session.on('x-claims', handle);
    const current = session.latest('x-claims');
    if (current) handle(current);
  });
}

/** A new party: everyone picks words, a modifier and a weapon at once; the host applies them together. */
export async function chooseKits(session: AdventureSession, run: ExplorationRun, choose: Chooser, prompt: Prompt): Promise<void> {
  const member = session.member;
  if (!member) return;
  if (session.isHost) {
    const picks: (CreationPick | null)[] = Array.from({ length: session.size }, () => null);
    let settle: () => void = () => undefined;
    const allIn = new Promise<void>((resolve) => { settle = resolve; });
    const check = (): void => {
      if (picks.every((pick) => pick)) settle();
    };
    const off = session.on('x-kit', (message) => {
      const seat = typeof message.from === 'number' ? message.from : -1;
      const mageClass = session.roster[seat];
      const raw = (message.pick && typeof message.pick === 'object' ? message.pick : {}) as Partial<CreationPick>;
      const pick = mageClass ? { mageClass, words: raw.words ?? [], modifier: raw.modifier, weapon: raw.weapon } as CreationPick : null;
      const ok = !!pick && seat > HOST_SEAT && !picks[seat] && validCreationPick(run, pick);
      session.send({ k: 'x-kit-ack', to: seat, ok });
      if (ok) {
        picks[seat] = pick;
        check();
      }
    });
    picks[HOST_SEAT] = { mageClass: member, ...(await chooseKit(choose, run, member)) };
    check();
    if (!picks.every((pick) => pick)) prompt('Waiting for the others to pick their words...');
    await allIn;
    off();
    prompt(null);
    if (applyCreation(run, picks as CreationPick[])) session.changed();
    session.publishNow();
    return;
  }
  for (;;) {
    const pick = await chooseKit(choose, run, member);
    prompt('Waiting for the others to pick their words...');
    const ok = await new Promise<boolean>((resolve) => {
      const off = session.on('x-kit-ack', (message) => {
        if (message.to !== session.localSeat) return;
        off();
        resolve(message.ok === true);
      });
      session.send({ k: 'x-kit', pick });
    });
    if (ok) break;
    prompt('The host could not use that pick. Choose again.');
  }
  if (run.creating) {
    await new Promise<void>((resolve) => {
      const off = session.on('x-run', () => {
        if (run.creating) return;
        off();
        resolve();
      });
    });
  }
  prompt(null);
}
