// =============================================================================
//  NET  —  thin WebSocket transport for lockstep online play
// -----------------------------------------------------------------------------
//  The simulation is deterministic (seeded dice, all randomness via gs.rng), so
//  both players run the *same* GameState and only exchange their decisions:
//  turn actions, reactions, perfect-dodge bonus picks and mid-cast targets. This
//  class is just an ordered message pipe — connect, send JSON, await the next.
//
//  Messages flow through a relay server (server/relay.mjs) that pairs the two
//  clients of a room and forwards everything between them. Because both peers
//  execute the identical control flow, each `recv()` always pulls exactly the
//  message the protocol expects next; a single FIFO queue is therefore correct.
//
//  Online Adventure adds a second lane: kinds starting with `x-` are the host's
//  state and the guests' requests between fights. They never enter the FIFO;
//  they go to the adventure handler, and wait in a backlog while none is set
//  (a fight is running, or a scene is starting). Party votes in the Mines ride a
//  third lane of their own (SIDE_LANE): they can come at any time, so the FIFO
//  never sees them.
// =============================================================================

export type NetRole = 'host' | 'guest';

export interface NetMessage {
  k: string;
  [key: string]: unknown;
}

/** Streams where only the newest message per sender matters. */
const LATEST_ONLY = new Set(['x-live', 'x-pos']);
const MAX_BACKLOG = 512;
/**
 * Party votes: any player may send one (or change it) at any moment, so they
 * never enter the lockstep FIFO, where a late one would be read as something else.
 */
const SIDE_LANE = new Set(['mine-vote']);
const MAX_SIDE_BACKLOG = 64;

export function isAdventureMessage(message: NetMessage): boolean {
  return typeof message.k === 'string' && message.k.startsWith('x-');
}

export class Net {
  private ws: WebSocket;
  private queue: NetMessage[] = [];
  private waiters: ((m: NetMessage) => void)[] = [];
  private closed = false;
  private adventure: ((m: NetMessage) => void) | null = null;
  private backlog: NetMessage[] = [];
  private side: ((m: NetMessage) => void) | null = null;
  private sideBacklog: NetMessage[] = [];

  /** Called once when the connection drops (opponent left / network error). */
  onClose?: () => void;
  /** Called when the relay says another player left. */
  onPeerBye?: (message: NetMessage) => void;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (ev) => this.onMessage(ev);
    ws.onclose = () => this.handleClose();
    ws.onerror = () => this.handleClose();
  }

  /** Open a connection to the relay. Resolves once the socket is ready. */
  static connect(url: string, signal?: AbortSignal): Promise<Net> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      const onAbort = (): void => {
        try {
          ws.close();
        } catch {
          /* connection was never opened */
        }
        reject(new Error('Connection cancelled.'));
      };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
      const onOpen = (): void => {
        signal?.removeEventListener('abort', onAbort);
        ws.onerror = null;
        resolve(new Net(ws));
      };
      ws.onopen = onOpen;
      ws.onerror = () => {
        signal?.removeEventListener('abort', onAbort);
        reject(new Error('Could not connect to the relay.'));
      };
    });
  }

  private onMessage(ev: MessageEvent): void {
    let data: NetMessage;
    try {
      data = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as NetMessage;
    } catch {
      return;
    }
    if (!data || typeof data !== 'object') return;
    if (isAdventureMessage(data)) {
      this.toAdventure(data);
      return;
    }
    if (SIDE_LANE.has(data.k)) {
      this.toSide(data);
      return;
    }
    // A departure matters to both lanes: a fight waiting on the queue and the session.
    if (data.k === 'bye') {
      this.onPeerBye?.(data);
      this.toAdventure(data);
    }
    this.toQueue(data);
  }

  private toQueue(data: NetMessage): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(data);
    else this.queue.push(data);
  }

  private toAdventure(data: NetMessage): void {
    if (this.adventure) {
      this.adventure(data);
      return;
    }
    if (LATEST_ONLY.has(data.k)) {
      const stale = this.backlog.findIndex((m) => m.k === data.k && m.from === data.from);
      if (stale >= 0) this.backlog.splice(stale, 1);
    }
    this.backlog.push(data);
    if (this.backlog.length > MAX_BACKLOG) this.backlog.shift();
  }

  /**
   * Route Adventure (`x-`) messages to `handler`, first replaying any that
   * arrived while there was none. Null holds them until the next handler.
   */
  setAdventureHandler(handler: ((m: NetMessage) => void) | null): void {
    this.adventure = handler;
    while (this.adventure === handler && handler && this.backlog.length) {
      handler(this.backlog.shift()!);
    }
  }

  /** Drop lockstep messages nobody will read (a fight that is over). */
  clearQueue(): void {
    this.queue = [];
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    // Unblock anyone awaiting a message so loops can bail out cleanly.
    const pending = this.waiters.splice(0);
    for (const w of pending) w({ k: 'bye' });
    this.toAdventure({ k: 'bye', lost: true });
    this.onClose?.();
  }

  /** Send a JSON message to the peer (no-op once closed). */
  send(msg: NetMessage): void {
    if (this.closed) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      this.handleClose();
    }
  }

  /** Await the next message from the peer (FIFO). */
  recv(): Promise<NetMessage> {
    const next = this.queue.shift();
    if (next !== undefined) return Promise.resolve(next);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /**
   * Route party votes to `handler`, first replaying any that came early. Null
   * holds them for the next vote, which drops those of a vote already over.
   */
  setSideHandler(handler: ((m: NetMessage) => void) | null): void {
    this.side = handler;
    while (this.side === handler && handler && this.sideBacklog.length) {
      handler(this.sideBacklog.shift()!);
    }
  }

  private toSide(data: NetMessage): void {
    if (this.side) {
      this.side(data);
      return;
    }
    this.sideBacklog.push(data);
    if (this.sideBacklog.length > MAX_SIDE_BACKLOG) this.sideBacklog.shift();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const pending = this.waiters.splice(0);
    for (const waiter of pending) waiter({ k: 'bye' });
    try {
      this.ws.close();
    } catch {
      /* already gone */
    }
  }
}
