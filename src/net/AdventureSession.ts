// =============================================================================
//  ADVENTURE SESSION  —  one online Adventure run shared by 2-3 players
// -----------------------------------------------------------------------------
//  The host owns the run: it applies every change, saves it, and sends the
//  whole run to the guests whenever it changes. Guests show that run, walk their
//  own traveller, and send requests (intents) for anything that changes the
//  run. Fights are the exception: GameScene runs them in lockstep on every
//  peer, and the host's run after the fight overrides whatever a guest ended with.
//
//  All session messages use `x-` kinds, so they travel on the Net's adventure
//  lane and never disturb the lockstep queue. The relay stamps `from` on every
//  message; that stamp, never a field a client wrote, says who sent it.
// =============================================================================

import type Phaser from 'phaser';
import type { MatchConfig } from '../config/MatchConfig';
import type { MageClass } from '../core/Classes';
import { setHexLore } from '../core/hexcraft/lore';
import { asItemIds } from '../core/Items';
import {
  applyIntent,
  parseIntent,
  PARTY_INTENTS,
  type ExplorationActions,
  type ExplorationIntent,
  type IntentResult,
} from '../pve/exploration/intents';
import type { ExplorationRun } from '../pve/exploration/run';
import { applyCouncil, emptyCouncil, parseCouncil, parseCouncilOp, type Council, type CouncilOp } from '../pve/exploration/council';
import { moneyLabel } from '../pve/exploration/economy';
import { parseRun, retireRun, saveRun, setSaveListener, setSaveSlot } from '../pve/exploration/save';
import { parseFightWire, type FightWire } from './fightWire';
import type { Net, NetMessage } from './Net';

export const ADVENTURE_PROTOCOL = 1;

export type AdventureRole = 'host' | 'guest';

/** The host's seat. */
export const HOST_SEAT = 0;

/** The scenes a host can send its guests to, with what they need besides the run. */
export type AdventureSceneKey = 'Exploration' | 'Locale';

type Listener = (message: NetMessage) => void;

const PUBLISH_MS = 250;
/** Intents that spend or earn from the shared purse. */
const PURSE_INTENTS: ReadonlySet<ExplorationIntent['op']> = new Set<ExplorationIntent['op']>(['buy', 'sell', 'sell-all', 'craft']);
const ARRIVAL_TIMEOUT_MS = 12_000;
/** Longest a guest's cinematic may hold back the host's next scene. */
const SHOW_WAIT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;

export interface AdventureSessionOptions {
  net: Net;
  role: AdventureRole;
  localSeat: number;
  /** Players in the room, host included. */
  size: number;
  names: string[];
}

export class AdventureSession {
  private static active: AdventureSession | null = null;

  /** The online Adventure under way, if any. */
  static get current(): AdventureSession | null {
    return AdventureSession.active;
  }

  static begin(options: AdventureSessionOptions): AdventureSession {
    AdventureSession.active?.end('A new session replaced this one.', false);
    const session = new AdventureSession(options);
    AdventureSession.active = session;
    setSaveSlot(session.isHost ? 'online' : 'none');
    // Whatever the host saves, the guests see soon after.
    setSaveListener(session.isHost ? (run) => {
      session.adopt(run);
      session.publish();
    } : null);
    return session;
  }

  readonly net: Net;
  readonly role: AdventureRole;
  readonly localSeat: number;
  readonly size: number;
  readonly names: string[];
  /** Seat -> the party member that player walks as, once classes are claimed. */
  roster: (MageClass | null)[];
  run: ExplorationRun | null = null;
  /** What the party is deciding together; the host's copy is the true one. */
  council: Council;
  private pollCount = 0;
  paused = false;
  ended = false;
  private rev = 0;
  private listeners = new Map<string, Set<Listener>>();
  private latestByKind = new Map<string, NetMessage>();
  private requests = new Map<number, (result: IntentResult) => void>();
  private nextRequest = 1;
  private publishTimer: ReturnType<typeof setTimeout> | null = null;
  private scene: Phaser.Scene | null = null;
  private sceneId = 0;
  private arrived = new Map<number, Set<number>>();
  private arrivalWaiters: { id: number; resolve: () => void }[] = [];
  /** Guest: cinematics on screen that the host's next scene waits for. */
  private shows = new Set<Promise<unknown>>();
  /** Guest: the scene being left while its cinematics finish. */
  private leaving: Phaser.Scene | null = null;

  private constructor(options: AdventureSessionOptions) {
    this.net = options.net;
    this.role = options.role;
    this.localSeat = options.localSeat;
    this.size = Math.max(2, options.size);
    this.names = options.names;
    this.roster = Array.from({ length: this.size }, () => null);
    this.council = emptyCouncil(this.size);
  }

  get isHost(): boolean {
    return this.role === 'host';
  }

  /** The party member this player walks as; null until classes are claimed. */
  get member(): MageClass | null {
    return this.roster[this.localSeat] ?? null;
  }

  seatOf(member: MageClass): number {
    return this.roster.indexOf(member);
  }

  /** Which seat plays each party member, for a fight. */
  memberSeats(): Partial<Record<MageClass, number>> {
    const seats: Partial<Record<MageClass, number>> = {};
    this.roster.forEach((member, seat) => {
      if (member) seats[member] = seat;
    });
    return seats;
  }

  nameOf(seat: number): string {
    return this.names[seat] ?? `Player ${seat + 1}`;
  }

  // ---------------------------------------------------------------------------
  //  WIRING
  // ---------------------------------------------------------------------------

  /** `scene` is now the one on screen: it gets the session's messages and follows the host's scene changes. */
  bind(scene: Phaser.Scene): void {
    this.scene = scene;
    this.net.setAdventureHandler((message) => this.receive(message));
  }

  unbind(scene: Phaser.Scene): void {
    if (this.scene !== scene) return;
    this.scene = null;
    this.net.setAdventureHandler(null);
  }

  /** Hold every session message while a fight runs in lockstep. */
  hold(): void {
    this.scene = null;
    this.net.setAdventureHandler(null);
  }

  on(kind: string, listener: Listener): () => void {
    let set = this.listeners.get(kind);
    if (!set) {
      set = new Set();
      this.listeners.set(kind, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  }

  send(message: NetMessage): void {
    if (!this.ended) this.net.send(message);
  }

  /** The last message of `kind` that reached the listeners, for a listener that arrives late. */
  latest(kind: string): NetMessage | undefined {
    return this.latestByKind.get(kind);
  }

  private emit(message: NetMessage): void {
    this.latestByKind.set(message.k, message);
    for (const listener of [...(this.listeners.get(message.k) ?? [])]) listener(message);
  }

  private receive(message: NetMessage): void {
    if (this.ended) return;
    if (message.k === 'bye') {
      const seat = typeof message.seat === 'number' ? message.seat : null;
      this.end(message.lost ? 'The connection to the relay was lost.' : `${seat == null ? 'A player' : this.nameOf(seat)} left the session.`);
      return;
    }
    const from = typeof message.from === 'number' ? message.from : -1;
    const fromHost = from === HOST_SEAT;
    switch (message.k) {
      case 'x-run':
        if (!this.isHost && fromHost) this.adoptSnapshot(message);
        return;
      case 'x-intent':
        if (this.isHost && from > HOST_SEAT && from < this.size) this.serveIntent(from, message);
        return;
      case 'x-result':
        if (!this.isHost && fromHost && message.to === this.localSeat) this.settleRequest(message);
        return;
      case 'x-scene':
        if (!this.isHost && fromHost) this.followScene(message);
        return;
      case 'x-fight':
        if (!this.isHost && fromHost) this.followFight(message);
        return;
      case 'x-arrived':
        if (this.isHost && typeof message.id === 'number') this.markArrived(from, message.id);
        return;
      case 'x-say': {
        const op = parseCouncilOp(message.op);
        if (this.isHost && op && from > HOST_SEAT && from < this.size) this.hear(from, op);
        return;
      }
      case 'x-council': {
        const council = !this.isHost && fromHost ? parseCouncil(message.council, this.size) : null;
        if (!council) return;
        this.council = council;
        this.emit({ k: 'x-council' });
        return;
      }
      case 'x-news':
        if (!this.isHost && fromHost && message.except !== this.localSeat && typeof message.text === 'string') {
          this.emit({ k: 'x-news', text: message.text.slice(0, 240) });
        }
        return;
      case 'x-pause':
        if (!this.isHost && fromHost) this.paused = message.on === true;
        break;
      case 'x-end':
        if (!this.isHost && fromHost) {
          this.end(typeof message.reason === 'string' ? message.reason.slice(0, 160) : 'The host ended the session.', false);
          return;
        }
        break;
    }
    // Everything else: guests only listen to the host; the host listens to guests.
    if (this.isHost ? from > HOST_SEAT && from < this.size : fromHost) this.emit(message);
  }

  // ---------------------------------------------------------------------------
  //  THE RUN
  // ---------------------------------------------------------------------------

  /** Host: this is the run the party plays. */
  adopt(run: ExplorationRun): void {
    this.run = run;
  }

  /** Host: send the run soon (several changes in a row go out as one). */
  publish(): void {
    if (!this.isHost || this.publishTimer) return;
    this.publishTimer = setTimeout(() => this.publishNow(), PUBLISH_MS);
  }

  /** Host: send the run now. */
  publishNow(): void {
    if (this.publishTimer) clearTimeout(this.publishTimer);
    this.publishTimer = null;
    if (!this.isHost || !this.run || this.ended) return;
    this.rev += 1;
    this.send({ k: 'x-run', rev: this.rev, run: this.run });
  }

  private adoptSnapshot(message: NetMessage): void {
    const rev = typeof message.rev === 'number' ? message.rev : 0;
    if (rev <= this.rev) return;
    // A snapshot is hostile input like any save file.
    const parsed = parseRun(JSON.stringify(message.run ?? null));
    if (!parsed) return;
    this.rev = rev;
    if (this.run) Object.assign(this.run, parsed);
    else this.run = parsed;
    setHexLore(parsed.hexLore.runes);
    this.emit({ k: 'x-run' });
  }

  // ---------------------------------------------------------------------------
  //  THE COUNCIL
  // ---------------------------------------------------------------------------

  /** Have a say: the host settles it at once, a guest asks the host. */
  say(op: CouncilOp): void {
    if (this.isHost) this.hear(this.localSeat, op);
    else this.send({ k: 'x-say', op });
  }

  private hear(seat: number, op: CouncilOp): void {
    const change = applyCouncil(this.council, seat, op, (s) => this.nameOf(s));
    if (!change.changed) return;
    if (change.note) this.news(change.note);
    this.publishCouncil();
  }

  /** Host: the council as it now stands, to every guest and to this client's own listeners. */
  publishCouncil(): void {
    if (!this.isHost || this.ended) return;
    this.send({ k: 'x-council', council: this.council });
    this.emit({ k: 'x-council' });
  }

  /** Host: start over with nothing to decide (a new scene, a fight). */
  resetCouncil(): void {
    this.council = emptyCouncil(this.size);
    this.publishCouncil();
  }

  /** Host: a fresh id for a choice put to the party. */
  nextPollId(): number {
    this.pollCount += 1;
    return this.pollCount;
  }

  /** Host: tell every player, this one included, except the one in `except`. */
  news(text: string, except = -1): void {
    if (!this.isHost) return;
    this.send({ k: 'x-news', text, except });
    if (except !== this.localSeat) this.emit({ k: 'x-news', text });
  }

  /** Host: the purse is shared, so everyone hears what it was spent on. */
  private tellPurchase(seat: number, intent: ExplorationIntent, result: IntentResult): void {
    if (!result.ok || !this.run || !PURSE_INTENTS.has(intent.op)) return;
    const purse = intent.op === 'craft' ? '' : ` Purse: ${moneyLabel(this.run.gold)}.`;
    this.news(`${this.nameOf(seat)}: ${result.message}${purse}`, seat);
  }

  // ---------------------------------------------------------------------------
  //  REQUESTS
  // ---------------------------------------------------------------------------

  /** How this player's windows change the run: directly on the host, by request on a guest. */
  actions(): ExplorationActions {
    const member = this.member;
    if (this.isHost) {
      return {
        member,
        leads: true,
        apply: (intent) => {
          const result = this.run ? applyIntent(this.run, member, intent) : { ok: false, message: 'No run.' };
          if (result.ok) this.changed();
          this.tellPurchase(this.localSeat, intent, result);
          return Promise.resolve(result);
        },
      };
    }
    return { member, leads: false, apply: (intent) => this.request(intent) };
  }

  /** Host: the run changed; keep the save and the guests up to date. */
  changed(): void {
    if (!this.isHost || !this.run) return;
    saveRun(this.run);
    this.publish();
    this.emit({ k: 'x-changed' });
  }

  private request(intent: ExplorationIntent): Promise<IntentResult> {
    if (this.ended) return Promise.resolve({ ok: false, message: 'The session has ended.' });
    const id = this.nextRequest++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        resolve({ ok: false, message: 'The host did not answer.' });
      }, REQUEST_TIMEOUT_MS);
      this.requests.set(id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      this.send({ k: 'x-intent', id, intent });
    });
  }

  private settleRequest(message: NetMessage): void {
    const id = typeof message.id === 'number' ? message.id : -1;
    const settle = this.requests.get(id);
    if (!settle) return;
    this.requests.delete(id);
    settle({
      ok: message.ok === true,
      message: typeof message.message === 'string' ? message.message.slice(0, 240) : '',
      levels: typeof message.levels === 'number' ? message.levels : undefined,
      item: asItemIds([message.item])[0],
    });
  }

  private serveIntent(from: number, message: NetMessage): void {
    const id = typeof message.id === 'number' ? message.id : -1;
    const intent = parseIntent(message.intent);
    const member = this.roster[from];
    const reply = (result: IntentResult): void => {
      this.send({ k: 'x-result', to: from, id, ok: result.ok, message: result.message, levels: result.levels, item: result.item });
    };
    if (!intent || !member || !this.run) return reply({ ok: false, message: 'That cannot be done.' });
    if (PARTY_INTENTS.has(intent.op)) return reply({ ok: false, message: 'Only the host can do that for the party.' });
    const result = applyIntent(this.run, member, intent);
    // The new run goes out before the answer, so the guest's window redraws from it.
    if (result.ok) {
      saveRun(this.run);
      this.publishNow();
      this.emit({ k: 'x-changed' });
    }
    this.tellPurchase(from, intent, result);
    reply(result);
  }

  // ---------------------------------------------------------------------------
  //  SCENES
  // ---------------------------------------------------------------------------

  /** Host: take the guests to `scene`. Returns the id their arrival reports carry. */
  go(scene: AdventureSceneKey, data: Record<string, unknown>): number {
    this.sceneId += 1;
    this.resetCouncil();
    this.publishNow();
    this.send({ k: 'x-scene', id: this.sceneId, scene, data });
    return this.sceneId;
  }

  /** Host: resolves once every guest has reported in from scene `id` (or after a while). */
  arrivals(id: number): Promise<void> {
    if ((this.arrived.get(id)?.size ?? 0) >= this.size - 1) return Promise.resolve();
    return new Promise((resolve) => {
      const waiter = { id, resolve };
      this.arrivalWaiters.push(waiter);
      setTimeout(() => this.releaseArrivals(id, true), ARRIVAL_TIMEOUT_MS);
    });
  }

  /** Guest: this client's copy of the host's latest scene is up. */
  reportArrival(): void {
    if (!this.isHost) this.send({ k: 'x-arrived', id: this.sceneId });
  }

  private markArrived(seat: number, id: number): void {
    if (seat <= HOST_SEAT || seat >= this.size) return;
    let seats = this.arrived.get(id);
    if (!seats) {
      seats = new Set();
      this.arrived.set(id, seats);
    }
    seats.add(seat);
    if (seats.size >= this.size - 1) this.releaseArrivals(id, false);
  }

  private releaseArrivals(id: number, timedOut: boolean): void {
    if (timedOut && (this.arrived.get(id)?.size ?? 0) >= this.size - 1) return;
    const ready = this.arrivalWaiters.filter((waiter) => waiter.id === id);
    this.arrivalWaiters = this.arrivalWaiters.filter((waiter) => waiter.id !== id);
    for (const waiter of ready) waiter.resolve();
  }

  /** Host: take the guests into a fight. The run goes first, then the fight; then nothing until it is over. */
  startFight(fight: FightWire, seed: number): void {
    this.resetCouncil();
    this.publishNow();
    this.send({ k: 'x-fight', fight, seed });
    this.hold();
  }

  /** Guest: `show` is playing on screen; the host's next scene waits for it to end (a while at most). */
  showing(show: Promise<unknown>): void {
    if (this.isHost || this.ended) return;
    this.shows.add(show);
    const done = (): void => {
      this.shows.delete(show);
    };
    show.then(done, done);
    // One whose scene went away without it finishing must not hold later scenes back.
    setTimeout(done, SHOW_WAIT_MS);
  }

  /** Guest: leave `from` once what it is showing has played out, unless the session ends first. */
  private leaveAfterShows(from: Phaser.Scene, go: () => void): void {
    this.leaving = from;
    const deadline = Date.now() + SHOW_WAIT_MS;
    void (async () => {
      while (this.shows.size && !this.ended && Date.now() < deadline) {
        await Promise.race([
          Promise.allSettled([...this.shows]),
          new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline - Date.now()))),
        ]);
      }
      if (this.leaving === from) this.leaving = null;
      if (this.ended) return;
      // Whatever still plays belongs to the scene being left, and stops with it.
      this.shows.clear();
      go();
    })();
  }

  private followFight(message: NetMessage): void {
    const fight = parseFightWire(message.fight);
    const host = this.scene;
    if (!fight || !this.run || !host) return;
    this.hold();
    this.paused = false;
    const config: MatchConfig = {
      mode: 'exploration',
      loadouts: [[], []],
      exploration: { ...fight, run: this.run },
      net: this.net,
      localSeat: this.localSeat,
      seed: Number(message.seed) | 0,
    };
    this.leaveAfterShows(host, () => {
      host.scene.stop('LocaleHud');
      host.scene.start('Game', config);
    });
  }

  private followScene(message: NetMessage): void {
    const scene = message.scene === 'Exploration' || message.scene === 'Locale' ? message.scene : null;
    const data = message.data && typeof message.data === 'object' ? message.data as Record<string, unknown> : {};
    if (!scene || !this.run) return;
    this.sceneId = typeof message.id === 'number' ? message.id : this.sceneId;
    const host = this.scene;
    if (!host) return;
    // Later messages wait for the new scene rather than reaching the one going away.
    this.hold();
    this.paused = false;
    this.leaveAfterShows(host, () => {
      host.scene.stop('LocaleHud');
      host.scene.start(scene, sceneEntry(scene, data, this.run!));
    });
  }

  // ---------------------------------------------------------------------------
  //  THE END
  // ---------------------------------------------------------------------------

  /** Close the session and send everyone who is still here back to the menu. */
  end(reason: string, tellGuests = true): void {
    if (this.ended) return;
    if (tellGuests && this.isHost) this.net.send({ k: 'x-end', reason });
    this.ended = true;
    if (this.publishTimer) clearTimeout(this.publishTimer);
    for (const settle of this.requests.values()) settle({ ok: false, message: 'The session has ended.' });
    this.requests.clear();
    for (const waiter of this.arrivalWaiters) waiter.resolve();
    this.arrivalWaiters = [];
    this.net.setAdventureHandler(null);
    this.net.close();
    if (AdventureSession.active === this) AdventureSession.active = null;
    // Whatever still holds this run may not write it into the solo slot.
    if (this.run) retireRun(this.run);
    setSaveSlot('solo');
    setSaveListener(null);
    const scene = this.scene ?? this.leaving;
    this.scene = null;
    this.leaving = null;
    this.shows.clear();
    this.emit({ k: 'x-ended', reason });
    if (scene) {
      scene.scene.stop('LocaleHud');
      scene.scene.start('Menu', { notice: reason });
    }
  }
}

const cell = (value: unknown): { x: number; y: number } | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const at = value as Record<string, unknown>;
  return typeof at.x === 'number' && typeof at.y === 'number' && Number.isFinite(at.x) && Number.isFinite(at.y)
    ? { x: Math.floor(at.x), y: Math.floor(at.y) }
    : undefined;
};

const words = (value: unknown, max = 240): string | undefined =>
  typeof value === 'string' ? value.slice(0, max) : undefined;

/** Build a guest's scene entry from what the host sent, trusting nothing but the shape. */
function sceneEntry(scene: AdventureSceneKey, data: Record<string, unknown>, run: ExplorationRun): Record<string, unknown> {
  if (scene === 'Locale') {
    return {
      run,
      locale: words(data.locale, 64) ?? '',
      at: cell(data.at),
      notice: words(data.notice),
      grace: typeof data.grace === 'number' ? Math.max(0, Math.min(10_000, data.grace)) : undefined,
    };
  }
  return { run, notice: words(data.notice), follow: 'map' };
}
