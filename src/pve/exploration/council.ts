// What an online party has to agree on together: where to travel and how fast,
// what to do when something happens on the way, when to camp, when to leave a
// place and when to take rooms for the night. Every player has a say; the host
// keeps the one true council and acts once it is settled. Pure: no Phaser, no
// network.

import { TRAVEL_ORDER, type TravelMode } from './travel';
import { asItemIds, type ItemId } from '../../core/Items';

export interface Spot {
  x: number;
  y: number;
}

export type Answer = 'join' | 'refuse';

/** A player's plan: where to, and at what pace. Choosing a pace is agreeing to go. */
export interface TravelVote {
  dest: Spot | null;
  mode: TravelMode | null;
  /** The pace this player is looking at right now, before choosing it. */
  hover: TravelMode | null;
}

export interface PollOption {
  label: string;
  detail: string;
  enabled: boolean;
}

/** Something happened and the party picks what to do: the most votes win, a tie is drawn. */
export interface Poll {
  id: number;
  title: string;
  text: string;
  options: PollOption[];
  votes: (number | null)[];
  /** Set by the host once settled, shown to everyone before the poll closes: the options tied for most votes and the one drawn. */
  result: { choice: number; tied: number[] } | null;
}

/** A short rest someone called: the others join or refuse; once all have, the joiners rest. */
export interface CampCall {
  by: number;
  place: string;
  at: Spot;
  answers: (Answer | null)[];
  /** Set by the host once everyone has answered: the seats resting, until the others have spent this many hours here. */
  resting: number[] | null;
  until: number;
}

/** Someone wants to leave `place`; it happens once everyone does. A null exit is the way back to the map. */
export interface LeaveCall {
  place: string;
  first: number;
  wants: ({ exit: Spot | null } | null)[];
}

/** A night at an inn: everyone or nobody. */
export interface InnCall {
  by: number;
  shop: string;
  answers: (Answer | null)[];
}

export interface TradeCall {
  by: number;
  place: string;
  at: Spot;
  with: number | null;
  offers: ItemId[][];
  ready: boolean[];
}

export interface Council {
  size: number;
  travel: TravelVote[];
  camp: CampCall | null;
  leave: LeaveCall | null;
  inn: InnCall | null;
  trade: TradeCall | null;
  poll: Poll | null;
}

export type CouncilOp =
  | { op: 'route'; dest: Spot | null }
  | { op: 'mode'; mode: TravelMode | null }
  | { op: 'hover'; mode: TravelMode | null }
  | { op: 'camp'; place: string; at: Spot }
  | { op: 'camp-answer'; answer: Answer }
  | { op: 'camp-cancel' }
  | { op: 'leave'; place: string; exit: Spot | null }
  | { op: 'stay' }
  | { op: 'inn'; shop: string }
  | { op: 'inn-answer'; answer: Answer }
  | { op: 'trade'; place: string; at: Spot }
  | { op: 'trade-join' }
  | { op: 'trade-cancel' }
  | { op: 'trade-offer'; items: ItemId[] }
  | { op: 'trade-ready' }
  | { op: 'vote'; poll: number; choice: number };

export interface CouncilChange {
  changed: boolean;
  /** Something everyone should hear about. */
  note?: string;
}

const noVote = (): TravelVote => ({ dest: null, mode: null, hover: null });

export function emptyCouncil(size: number): Council {
  return { size, travel: Array.from({ length: size }, noVote), camp: null, leave: null, inn: null, trade: null, poll: null };
}

/** Host: put a choice to the whole party. */
export function openPoll(council: Council, id: number, title: string, text: string, options: readonly PollOption[]): Poll {
  const poll: Poll = {
    id,
    title: title.slice(0, MAX_TITLE),
    text: text.slice(0, MAX_BODY),
    options: options.slice(0, MAX_OPTIONS).map((option) => ({
      label: option.label.slice(0, MAX_LABEL),
      detail: option.detail.slice(0, MAX_DETAIL),
      enabled: option.enabled,
    })),
    votes: Array.from({ length: council.size }, () => null),
    result: null,
  };
  council.poll = poll;
  return poll;
}

export function clearTravel(council: Council): void {
  council.travel = Array.from({ length: council.size }, noVote);
}

const sameSpot = (a: Spot | null, b: Spot | null): boolean => !!a && !!b && a.x === b.x && a.y === b.y;

const count = <T>(list: readonly T[], test: (entry: T) => boolean): number => list.filter(test).length;

/** Apply `op` from the player in `seat`. `name` gives a seat's name for the notes. */
export function applyCouncil(council: Council, seat: number, op: CouncilOp, name: (seat: number) => string): CouncilChange {
  if (!Number.isInteger(seat) || seat < 0 || seat >= council.size) return { changed: false };
  const who = name(seat);
  const vote = council.travel[seat];
  switch (op.op) {
    case 'route':
      if (sameSpot(vote.dest, op.dest) || (!vote.dest && !op.dest)) return { changed: false };
      council.travel[seat] = { ...noVote(), dest: op.dest ? { ...op.dest } : null };
      return { changed: true };
    case 'mode':
      if (!vote.dest || vote.mode === op.mode) return { changed: false };
      vote.mode = op.mode;
      return { changed: true };
    case 'hover':
      if (vote.hover === op.mode) return { changed: false };
      vote.hover = op.mode;
      return { changed: true };
    case 'vote': {
      const poll = council.poll;
      const option = poll?.options[op.choice];
      if (!poll || poll.id !== op.poll || poll.result || !option?.enabled || poll.votes[seat] === op.choice) return { changed: false };
      poll.votes[seat] = op.choice;
      return { changed: true };
    }
    case 'camp': {
      if (council.camp) return { changed: false };
      const answers: (Answer | null)[] = Array.from({ length: council.size }, () => null);
      answers[seat] = 'join';
      council.camp = { by: seat, place: op.place, at: { ...op.at }, answers, resting: null, until: 0 };
      return { changed: true, note: `${who} starts a short rest. Join, or keep going.` };
    }
    case 'camp-answer': {
      const camp = council.camp;
      if (!camp || camp.resting || camp.by === seat || camp.answers[seat] === op.answer) return { changed: false };
      camp.answers[seat] = op.answer;
      return { changed: true, note: op.answer === 'join' ? `${who} joins ${name(camp.by)}'s rest.` : `${who} keeps going.` };
    }
    case 'camp-cancel': {
      const camp = council.camp;
      if (!camp || camp.resting || camp.by !== seat) return { changed: false };
      council.camp = null;
      return { changed: true, note: `${who} cancels the rest.` };
    }
    case 'leave': {
      let call = council.leave;
      if (!call || call.place !== op.place) {
        call = { place: op.place, first: seat, wants: Array.from({ length: council.size }, () => null) };
        council.leave = call;
      }
      const wish = call.wants[seat];
      if (wish && (sameSpot(wish.exit, op.exit) || (!wish.exit && !op.exit))) return { changed: false };
      call.wants[seat] = { exit: op.exit ? { ...op.exit } : null };
      const ready = count(call.wants, (entry) => !!entry);
      return { changed: true, note: `${who} wants to move on (${ready}/${council.size}).` };
    }
    case 'stay': {
      const call = council.leave;
      if (!call?.wants[seat]) return { changed: false };
      call.wants[seat] = null;
      if (call.wants.every((entry) => !entry)) council.leave = null;
      else if (call.first === seat) call.first = call.wants.findIndex((entry) => !!entry);
      return { changed: true, note: `${who} wants to stay.` };
    }
    case 'inn': {
      if (council.inn) return { changed: false };
      const answers: (Answer | null)[] = Array.from({ length: council.size }, () => null);
      answers[seat] = 'join';
      council.inn = { by: seat, shop: op.shop, answers };
      return { changed: true, note: `${who} wants to rest at the inn. Everyone must talk to the innkeeper to join.` };
    }
    case 'inn-answer': {
      const inn = council.inn;
      if (!inn || inn.answers[seat] === op.answer) return { changed: false };
      if (op.answer === 'refuse') {
        council.inn = null;
        return { changed: true, note: `${who} declined. Nobody rests.` };
      }
      inn.answers[seat] = 'join';
      const joined = count(inn.answers, (answer) => answer === 'join');
      return { changed: true, note: `${who} joined the inn rest (${joined}/${council.size}).` };
    }
    case 'trade':
      if (council.trade || council.size < 2) return { changed: false };
      council.trade = { by: seat, place: op.place, at: { ...op.at }, with: null, offers: Array.from({ length: council.size }, () => []), ready: Array.from({ length: council.size }, () => false) };
      return { changed: true, note: `${who} opened a trade.` };
    case 'trade-join': {
      const trade = council.trade;
      if (!trade || trade.by === seat || trade.with != null) return { changed: false };
      trade.with = seat;
      return { changed: true, note: `${who} joins ${name(trade.by)}'s trade.` };
    }
    case 'trade-cancel': {
      const trade = council.trade;
      if (!trade || (trade.by !== seat && trade.with !== seat)) return { changed: false };
      council.trade = null;
      return { changed: true, note: `${who} closes the trade.` };
    }
    case 'trade-offer': {
      const trade = council.trade;
      if (!trade || (trade.by !== seat && trade.with !== seat) || (trade.ready[trade.by] && trade.ready[trade.with ?? trade.by])) return { changed: false };
      if (JSON.stringify(trade.offers[seat]) === JSON.stringify(op.items)) return { changed: false };
      trade.offers[seat] = [...op.items];
      trade.ready.fill(false);
      return { changed: true, note: `${who} changes their offer. Both must accept again.` };
    }
    case 'trade-ready': {
      const trade = council.trade;
      if (!trade || trade.with == null || (trade.by !== seat && trade.with !== seat) || trade.ready[seat]) return { changed: false };
      trade.ready[seat] = true;
      return { changed: true, note: `${who} confirms the trade.` };
    }
  }
}

export type TravelState =
  | { t: 'open' }
  | { t: 'split' }
  | { t: 'go'; dest: Spot; mode: TravelMode };

/**
 * Where the party goes: once everyone has chosen the same destination and the
 * same pace. 'split' when everyone has chosen, but not the same.
 */
export function travelOutcome(council: Council): TravelState {
  const votes = council.travel;
  if (!votes.every((vote) => vote.dest && vote.mode)) return { t: 'open' };
  const first = votes[0];
  return votes.every((vote) => sameSpot(vote.dest, first.dest) && vote.mode === first.mode)
    ? { t: 'go', dest: { ...first.dest! }, mode: first.mode! }
    : { t: 'split' };
}

/**
 * Once everyone has voted: the option with the most votes, a tie drawn among
 * the tied options (`roll(n)` gives 0..n-1). `tied` lists every option that had
 * the most votes (just the one, unless it was a tie).
 */
export function pollOutcome(council: Council, roll: (n: number) => number): { choice: number; tied: number[] } | null {
  const poll = council.poll;
  if (!poll || poll.votes.some((vote) => vote == null)) return null;
  const tally = poll.options.map((_, index) => count(poll.votes, (vote) => vote === index));
  const best = Math.max(...tally);
  const tied = tally.flatMap((votes, index) => (votes === best ? [index] : []));
  const pick = tied.length === 1 ? tied[0] : tied[Math.min(tied.length - 1, Math.max(0, roll(tied.length)))];
  return { choice: pick, tied };
}

/** Once everyone has answered a camp: the seats that rest. */
export function campOutcome(council: Council): number[] | null {
  const camp = council.camp;
  if (!camp || camp.resting || camp.answers.some((answer) => !answer)) return null;
  return camp.answers.flatMap((answer, seat) => (answer === 'join' ? [seat] : []));
}

/** Once everyone wants to leave: the way the first of them chose. */
export function leaveOutcome(council: Council): { place: string; exit: Spot | null } | null {
  const call = council.leave;
  if (!call || call.wants.some((wish) => !wish)) return null;
  return { place: call.place, exit: call.wants[call.first]?.exit ?? null };
}

/** Once everyone has joined the night: the inn. */
export function innOutcome(council: Council): string | null {
  const inn = council.inn;
  return inn && inn.answers.every((answer) => answer === 'join') ? inn.shop : null;
}

// -----------------------------------------------------------------------------
//  THE WIRE
// -----------------------------------------------------------------------------

const MAX_TEXT = 64;
const MAX_TITLE = 80;
const MAX_BODY = 480;
const MAX_LABEL = 80;
const MAX_DETAIL = 200;
const MAX_OPTIONS = 8;
/** Items one side of a trade may put up, counting every arrow and every ore. */
export const MAX_TRADE_ITEMS = 240;
const text = (value: unknown, max = MAX_TEXT): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;

const spot = (value: unknown): Spot | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const x = raw.x;
  const y = raw.y;
  return Number.isInteger(x) && Number.isInteger(y) && (x as number) >= 0 && (y as number) >= 0 && (x as number) < 100_000 && (y as number) < 100_000
    ? { x: x as number, y: y as number }
    : null;
};

const mode = (value: unknown): TravelMode | null => (TRAVEL_ORDER.includes(value as TravelMode) ? value as TravelMode : null);
const answer = (value: unknown): Answer | null => (value === 'join' || value === 'refuse' ? value : null);

/** Read a request that came over the wire. Anything malformed is null. */
export function parseCouncilOp(value: unknown): CouncilOp | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  switch (raw.op) {
    case 'route':
      return raw.dest == null ? { op: 'route', dest: null } : (spot(raw.dest) ? { op: 'route', dest: spot(raw.dest) } : null);
    case 'mode':
    case 'hover':
      return raw.mode == null ? { op: raw.op, mode: null } : (mode(raw.mode) ? { op: raw.op, mode: mode(raw.mode) } : null);
    case 'vote':
      return Number.isInteger(raw.poll) && Number.isInteger(raw.choice) && (raw.choice as number) >= 0 && (raw.choice as number) < MAX_OPTIONS
        ? { op: 'vote', poll: raw.poll as number, choice: raw.choice as number }
        : null;
    case 'camp': {
      const place = text(raw.place);
      const at = spot(raw.at);
      return place && at ? { op: 'camp', place, at } : null;
    }
    case 'camp-answer':
    case 'inn-answer': {
      const said = answer(raw.answer);
      return said ? { op: raw.op, answer: said } : null;
    }
    case 'camp-cancel':
    case 'stay':
    case 'trade-join':
    case 'trade-cancel':
    case 'trade-ready':
      return { op: raw.op };
    case 'trade': {
      const place = text(raw.place);
      const at = spot(raw.at);
      return place && at ? { op: 'trade', place, at } : null;
    }
    case 'trade-offer': {
      if (!Array.isArray(raw.items) || raw.items.length > MAX_TRADE_ITEMS) return null;
      const items = asItemIds(raw.items);
      return items.length === raw.items.length ? { op: 'trade-offer', items } : null;
    }
    case 'leave': {
      const place = text(raw.place);
      if (!place) return null;
      if (raw.exit == null) return { op: 'leave', place, exit: null };
      const exit = spot(raw.exit);
      return exit ? { op: 'leave', place, exit } : null;
    }
    case 'inn': {
      const shop = text(raw.shop);
      return shop ? { op: 'inn', shop } : null;
    }
    default:
      return null;
  }
}

const seatList = (value: unknown, size: number): number[] | null =>
  Array.isArray(value) && value.length <= size && value.every((seat) => Number.isInteger(seat) && seat >= 0 && seat < size)
    ? value as number[]
    : null;

const answers = (value: unknown, size: number): (Answer | null)[] | null =>
  Array.isArray(value) && value.length === size ? value.map(answer) : null;

const seat = (value: unknown, size: number): number | null =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) < size ? value as number : null;

/** Read the host's council. Anything malformed in a part drops that part. */
export function parseCouncil(value: unknown, size: number): Council | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const council = emptyCouncil(size);
  if (Array.isArray(raw.travel) && raw.travel.length === size) {
    council.travel = raw.travel.map((entry) => {
      const vote = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
      const dest = spot(vote.dest);
      return { dest, mode: dest ? mode(vote.mode) : null, hover: mode(vote.hover) };
    });
  }
  const poll = raw.poll && typeof raw.poll === 'object' ? raw.poll as Record<string, unknown> : null;
  if (poll && Number.isInteger(poll.id) && Array.isArray(poll.options) && poll.options.length > 0 && poll.options.length <= MAX_OPTIONS
    && Array.isArray(poll.votes) && poll.votes.length === size) {
    const options = poll.options.map((entry) => {
      const option = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
      const label = text(option.label, MAX_LABEL);
      return label ? { label, detail: typeof option.detail === 'string' ? option.detail.slice(0, MAX_DETAIL) : '', enabled: option.enabled !== false } : null;
    });
    const title = text(poll.title, MAX_TITLE);
    const result = poll.result && typeof poll.result === 'object' ? poll.result as Record<string, unknown> : null;
    const index = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) < options.length;
    if (title && options.every((option) => !!option)) {
      council.poll = {
        id: poll.id as number,
        title,
        text: typeof poll.text === 'string' ? poll.text.slice(0, MAX_BODY) : '',
        options: options as PollOption[],
        votes: poll.votes.map((vote) => (index(vote) ? vote : null)),
        result: result && index(result.choice) && Array.isArray(result.tied) && result.tied.length <= MAX_OPTIONS && result.tied.every(index)
          ? { choice: result.choice, tied: result.tied as number[] }
          : null,
      };
    }
  }
  const camp = raw.camp && typeof raw.camp === 'object' ? raw.camp as Record<string, unknown> : null;
  if (camp) {
    const by = seat(camp.by, size);
    const place = text(camp.place);
    const at = spot(camp.at);
    const said = answers(camp.answers, size);
    const resting = camp.resting == null ? null : seatList(camp.resting, size);
    const until = typeof camp.until === 'number' && Number.isFinite(camp.until) ? Math.max(0, Math.min(10_000, camp.until)) : 0;
    if (by != null && place && at && said) council.camp = { by, place, at, answers: said, resting, until };
  }
  const leave = raw.leave && typeof raw.leave === 'object' ? raw.leave as Record<string, unknown> : null;
  if (leave) {
    const place = text(leave.place);
    const first = seat(leave.first, size);
    const wants = Array.isArray(leave.wants) && leave.wants.length === size
      ? leave.wants.map((wish) => (wish && typeof wish === 'object' ? { exit: spot((wish as Record<string, unknown>).exit) } : null))
      : null;
    if (place && first != null && wants) council.leave = { place, first, wants };
  }
  const inn = raw.inn && typeof raw.inn === 'object' ? raw.inn as Record<string, unknown> : null;
  if (inn) {
    const by = seat(inn.by, size);
    const shop = text(inn.shop);
    const said = answers(inn.answers, size);
    if (by != null && shop && said) council.inn = { by, shop, answers: said };
  }
  const trade = raw.trade && typeof raw.trade === 'object' ? raw.trade as Record<string, unknown> : null;
  if (trade) {
    const by = seat(trade.by, size);
    const place = text(trade.place);
    const at = spot(trade.at);
    const partner = trade.with == null ? null : seat(trade.with, size);
    const offers = Array.isArray(trade.offers) && trade.offers.length === size ? trade.offers.map((list) => {
      if (!Array.isArray(list) || list.length > MAX_TRADE_ITEMS) return null;
      const items = asItemIds(list);
      return items.length === list.length ? items : null;
    }) : null;
    const ready = Array.isArray(trade.ready) && trade.ready.length === size && trade.ready.every((entry) => typeof entry === 'boolean') ? trade.ready as boolean[] : null;
    if (by != null && place && at && (trade.with == null || partner != null) && partner !== by && offers?.every((list) => list != null) && ready) {
      council.trade = { by, place, at, with: partner, offers: offers as ItemId[][], ready };
    }
  }
  return council;
}
