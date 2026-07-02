// =============================================================================
//  NET  —  thin WebSocket transport for lockstep online play
// -----------------------------------------------------------------------------
//  The simulation is deterministic (seeded dice, all randomness via gs.rng), so
//  both players run the *same* GameState and only exchange their decisions:
//  turn actions, reaction choices and mid-cast sub-targets. This class is just
//  an ordered message pipe — connect, send JSON, await the next JSON message.
//
//  Messages flow through a relay server (server/relay.mjs) that pairs the two
//  clients of a room and forwards everything between them. Because both peers
//  execute the identical control flow, each `recv()` always pulls exactly the
//  message the protocol expects next; a single FIFO queue is therefore correct.
// =============================================================================

export type NetRole = 'host' | 'guest';

export interface NetMessage {
  k: string;
  [key: string]: unknown;
}

export class Net {
  private ws: WebSocket;
  private queue: NetMessage[] = [];
  private waiters: ((m: NetMessage) => void)[] = [];
  private closed = false;

  /** Called once when the connection drops (opponent left / network error). */
  onClose?: () => void;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (ev) => this.onMessage(ev);
    ws.onclose = () => this.handleClose();
    ws.onerror = () => this.handleClose();
  }

  /** Open a connection to the relay. Resolves once the socket is ready. */
  static connect(url: string): Promise<Net> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      const onOpen = (): void => {
        ws.onerror = null;
        resolve(new Net(ws));
      };
      ws.onopen = onOpen;
      ws.onerror = () => reject(new Error('Could not connect to the relay.'));
    });
  }

  private onMessage(ev: MessageEvent): void {
    let data: NetMessage;
    try {
      data = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as NetMessage;
    } catch {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) waiter(data);
    else this.queue.push(data);
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    // Unblock anyone awaiting a message so loops can bail out cleanly.
    const pending = this.waiters.splice(0);
    for (const w of pending) w({ k: 'bye' });
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

  get isClosed(): boolean {
    return this.closed;
  }

  close(): void {
    this.closed = true;
    try {
      this.ws.close();
    } catch {
      /* already gone */
    }
  }
}
