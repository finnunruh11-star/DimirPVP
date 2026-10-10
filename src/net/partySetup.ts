// Setting out online. A new party's travellers have no class, so each seat just
// gets the traveller made for it; a resumed run's travellers are claimed one
// seat at a time, host first. A new party then names its words (the awakening)
// all at once, and the host checks every pick against the run's seeded offers
// before applying.

import { MAGE_CLASS_DEFS, type MageClass } from '../core/Classes';
import { applyCreation, validCreationPick, type CreationPick } from '../pve/exploration/creation';
import { isMageClass } from '../pve/exploration/levels';
import { partyOf } from '../pve/exploration/economy';
import type { ExplorationRun } from '../pve/exploration/run';
import { awaken, type Awakener, type Chooser } from '../ui/pve/CreationFlow';
import { AdventureSession, HOST_SEAT } from './AdventureSession';
import type { NetMessage } from './Net';

type Prompt = (text: string | null) => void;

interface ClaimOption {
  id: MageClass;
  label: string;
  detail: string;
}

/** The travellers the run already has, for a resumed run. */
function claimOptions(run: ExplorationRun): ClaimOption[] {
  return partyOf(run).map((mage) => ({
    id: mage.mageClass,
    label: mage.spellClass ? `${mage.name}, ${MAGE_CLASS_DEFS[mage.spellClass].label}` : mage.name,
    detail: mage.alive ? `HP ${mage.hp}/${mage.maxHp}, mana ${mage.mana}/${mage.maxMana}` : 'Down: revived by a night at an inn.',
  }));
}

function readClaims(message: NetMessage, size: number): (MageClass | null)[] {
  const raw = Array.isArray(message.claims) ? message.claims : [];
  return Array.from({ length: size }, (_, seat) => (isMageClass(raw[seat]) ? raw[seat] as MageClass : null));
}

/** Everyone gets a traveller, in seat order. Sets the session's roster. */
export async function claimTravellers(session: AdventureSession, run: ExplorationRun, choose: Chooser, prompt: Prompt): Promise<void> {
  const options = claimOptions(run);
  const ask = (taken: readonly (MageClass | null)[]): Promise<MageClass> =>
    choose<MageClass>('CHOOSE YOUR CHARACTER', 'Each player picks one.',
      options.map((option) => ({
        ...option,
        detail: taken.includes(option.id) ? 'Already taken.' : option.detail,
        enabled: !taken.includes(option.id),
      })));
  if (session.isHost && run.creating) {
    // Nobody has a class to pick: seat n walks as the traveller made for seat n.
    const claims = Array.from({ length: session.size }, (_, seat) => run.party.entities[seat]?.mageClass ?? null);
    session.roster = claims;
    session.send({ k: 'x-claims', claims, turn: -1 });
    return;
  }
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

/** A new party: everyone names words and a modifier at once; the host applies them together. */
export async function awakenParty(session: AdventureSession, run: ExplorationRun, awakener: Awakener, reducedMotion: boolean, prompt: Prompt): Promise<void> {
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
      const pick = { calling: raw.calling, words: Array.isArray(raw.words) ? raw.words.slice(0, 4) : [], modifier: raw.modifier, stat: raw.stat } as CreationPick;
      const ok = !!mageClass && seat > HOST_SEAT && !picks[seat] && validCreationPick(run, mageClass, pick);
      session.send({ k: 'x-kit-ack', to: seat, ok });
      if (ok) {
        picks[seat] = pick;
        check();
      }
    });
    picks[HOST_SEAT] = await awaken(awakener, run, member, reducedMotion);
    check();
    if (!picks.every((pick) => pick)) prompt('Waiting for the others to finish talking to themselves...');
    await allIn;
    off();
    prompt(null);
    // applyCreation takes the picks in party order.
    const ordered = run.party.entities.map((entity) => picks[session.roster.indexOf(entity.mageClass)]);
    if (ordered.every((pick): pick is CreationPick => !!pick) && applyCreation(run, ordered)) session.changed();
    session.publishNow();
    return;
  }
  for (;;) {
    const pick = await awaken(awakener, run, member, reducedMotion);
    prompt('Waiting for the others to finish talking to themselves...');
    const ok = await new Promise<boolean>((resolve) => {
      const off = session.on('x-kit-ack', (message) => {
        if (message.to !== session.localSeat) return;
        off();
        resolve(message.ok === true);
      });
      session.send({ k: 'x-kit', pick });
    });
    if (ok) break;
    prompt('The host rejected that pick. Choose again.');
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
