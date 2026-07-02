import Phaser from 'phaser';
import { COLORS, GAME_HEIGHT, GAME_WIDTH, LOADOUT_SIZE, TEXT } from '../config/constants';
import { WORDS, WORD_ORDER, type WordId } from '../core/Words';
import { Net, type NetRole, type NetMessage } from '../net/Net';

export type MatchMode = 'hotseat' | 'ai' | 'online';

export interface MatchConfig {
  mode: MatchMode;
  loadouts: [WordId[], WordId[]];
  /** Online play: the live connection to the opponent (lockstep relay). */
  net?: Net;
  /** Online play: which team this client controls (1 = host, 2 = guest). */
  localTeam?: 1 | 2;
  /** Online play: shared RNG seed so both peers simulate identically. */
  seed?: number;
}

/**
 * Best-guess relay address. When the game is served by the relay itself (the
 * single-tunnel setup) the WebSocket lives at /ws on the same origin; during
 * local `npm run dev` it falls back to the relay's default localhost port.
 */
function defaultRelayUrl(): string {
  const loc = typeof window !== 'undefined' ? window.location : null;
  const host = loc?.hostname ?? '';
  const isLocal = host === '' || host === 'localhost' || host === '127.0.0.1';
  if (!loc || isLocal) return 'ws://localhost:8787/ws';
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${loc.host}/ws`;
}

/** Loadout / mode selection before the duel begins. */
export class MenuScene extends Phaser.Scene {
  private mode: MatchMode = 'ai';
  private stage: 1 | 2 = 1;
  private selected: WordId[] = [];
  private loadout1: WordId[] = [];
  private typed = '';
  private nadActive = false;
  private katActive = false;

  private wordCells: { rect: Phaser.GameObjects.Rectangle; word: WordId; label: Phaser.GameObjects.Text }[] = [];
  private titleText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private modeAiBtn!: Phaser.GameObjects.Text;
  private modeHsBtn!: Phaser.GameObjects.Text;
  private modeOnlineBtn!: Phaser.GameObjects.Text;
  private startBtn!: Phaser.GameObjects.Text;
  private hostBtn!: Phaser.GameObjects.Text;
  private joinBtn!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  /** True while an online lobby handshake is in progress (locks the UI). */
  private connecting = false;

  constructor() {
    super('Menu');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.bg);

    this.add
      .text(GAME_WIDTH / 2, 50, 'PVP DIMIR — Mage Duel', {
        fontSize: '40px',
        color: TEXT.body,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.titleText = this.add
      .text(GAME_WIDTH / 2, 110, '', { fontSize: '24px', color: TEXT.warn })
      .setOrigin(0.5);

    this.hintText = this.add
      .text(GAME_WIDTH / 2, 145, '', { fontSize: '16px', color: TEXT.dim })
      .setOrigin(0.5);

    // Word grid (4 x 2).
    const cols = 4;
    const cw = 230;
    const ch = 110;
    const startX = GAME_WIDTH / 2 - (cols * cw) / 2 + cw / 2;
    const startY = 240;
    WORD_ORDER.forEach((word, i) => {
      const x = startX + (i % cols) * cw;
      const y = startY + Math.floor(i / cols) * (ch + 20);
      const rect = this.add
        .rectangle(x, y, cw - 20, ch, 0x1a1a2a)
        .setStrokeStyle(2, WORDS[word].color)
        .setInteractive({ useHandCursor: true });
      const label = this.add
        .text(x, y, this.cellText(word), {
          fontSize: '16px',
          color: TEXT.body,
          align: 'center',
          wordWrap: { width: cw - 40 },
        })
        .setOrigin(0.5);
      rect.on('pointerdown', () => this.toggleWord(word));
      this.wordCells.push({ rect, word, label });
    });

    // Mode buttons.
    this.modeAiBtn = this.makeButton(GAME_WIDTH / 2 - 220, 560, 'Vs AI', () => this.setMode('ai'));
    this.modeHsBtn = this.makeButton(GAME_WIDTH / 2, 560, 'Hotseat (2P)', () => this.setMode('hotseat'));
    this.modeOnlineBtn = this.makeButton(GAME_WIDTH / 2 + 220, 560, 'Online', () => this.setMode('online'));

    this.startBtn = this.makeButton(GAME_WIDTH / 2, 640, 'Confirm', () => this.confirm());
    this.hostBtn = this.makeButton(GAME_WIDTH / 2 - 120, 640, 'Host Game', () => this.startOnline('host'));
    this.joinBtn = this.makeButton(GAME_WIDTH / 2 + 120, 640, 'Join Game', () => this.startOnline('guest'));

    this.statusText = this.add
      .text(GAME_WIDTH / 2, 695, '', { fontSize: '16px', color: TEXT.warn })
      .setOrigin(0.5);

    // Hidden easter egg: typing "NAD" loads a secret premade loadout.
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => this.onKey(e));

    this.refresh();
  }

  /** Accumulate typed letters and unlock a secret loadout when spelled. */
  private onKey(e: KeyboardEvent): void {
    const key = (e.key ?? '').toUpperCase();
    if (key.length === 1 && key >= 'A' && key <= 'Z') {
      this.typed = (this.typed + key).slice(-3);
      if (this.typed === 'NAD') this.applyNadLoadout();
      else if (this.typed === 'KAT') this.applyKatLoadout();
    }
  }

  private applyNadLoadout(): void {
    this.selected = ['mind', 'shatter', 'twist', 'reality'];
    this.nadActive = true;
    this.katActive = false;
    this.refresh();
  }

  private applyKatLoadout(): void {
    this.selected = ['corrode', 'curse', 'shadow', 'drain'];
    this.katActive = true;
    this.nadActive = false;
    this.refresh();
  }

  private cellText(word: WordId): string {
    const d = WORDS[word];
    const tag = d.grantsReaction ? '\n(reaction)' : '';
    return `${d.label}${tag}\n${d.blurb}`;
  }

  private makeButton(x: number, y: number, label: string, onClick: () => void): Phaser.GameObjects.Text {
    const t = this.add
      .text(x, y, label, {
        fontSize: '20px',
        color: TEXT.body,
        backgroundColor: '#23233a',
        padding: { x: 18, y: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    t.on('pointerdown', onClick);
    return t;
  }

  private setMode(mode: MatchMode): void {
    if (this.connecting) return;
    this.mode = mode;
    this.refresh();
  }

  private toggleWord(word: WordId): void {
    this.nadActive = false;
    this.katActive = false;
    const idx = this.selected.indexOf(word);
    if (idx >= 0) {
      this.selected.splice(idx, 1);
    } else if (this.selected.length < LOADOUT_SIZE) {
      this.selected.push(word);
    }
    this.refresh();
  }

  private refresh(): void {
    const who = this.stage === 1 ? 'Player 1' : 'Player 2';
    this.titleText.setText(`${who}: choose ${LOADOUT_SIZE} words  (${this.selected.length}/${LOADOUT_SIZE})`);
    if (this.nadActive) {
      this.hintText.setText('✨ NAD unlocked: Mind · Shatter · Twist · Reality');
    } else if (this.katActive) {
      this.hintText.setText('✨ KAT unlocked: Corrode · Curse · Shadow · Drain');
    } else if (this.mode === 'online') {
      this.hintText.setText('Online: pick your words, then Host or Join with a shared room code.');
    } else {
      this.hintText.setText('Click words to select. Bind / Veil / Mind grant a reaction.');
    }

    for (const cell of this.wordCells) {
      const on = this.selected.includes(cell.word);
      cell.rect.setFillStyle(on ? 0x2c2c4a : 0x1a1a2a);
      cell.rect.setStrokeStyle(on ? 4 : 2, on ? COLORS.selected : WORDS[cell.word].color);
    }

    const aiOn = this.mode === 'ai';
    const hsOn = this.mode === 'hotseat';
    const onlineOn = this.mode === 'online';
    this.modeAiBtn.setStyle({ backgroundColor: aiOn ? '#3a3a66' : '#23233a' });
    this.modeHsBtn.setStyle({ backgroundColor: hsOn ? '#3a3a66' : '#23233a' });
    this.modeOnlineBtn.setStyle({ backgroundColor: onlineOn ? '#3a3a66' : '#23233a' });
    // Mode is only chosen on stage 1.
    this.modeAiBtn.setVisible(this.stage === 1);
    this.modeHsBtn.setVisible(this.stage === 1);
    this.modeOnlineBtn.setVisible(this.stage === 1);

    const ready = this.selected.length === LOADOUT_SIZE;
    // Online shows Host/Join buttons; the other modes show a single Confirm.
    this.startBtn.setVisible(!onlineOn || this.stage === 2);
    this.startBtn.setAlpha(ready ? 1 : 0.4);
    this.startBtn.setText(this.stage === 1 && this.mode === 'hotseat' ? 'Next' : 'Start Duel');
    this.hostBtn.setVisible(onlineOn && this.stage === 1);
    this.joinBtn.setVisible(onlineOn && this.stage === 1);
    const lobbyEnabled = ready && !this.connecting;
    this.hostBtn.setAlpha(lobbyEnabled ? 1 : 0.4);
    this.joinBtn.setAlpha(lobbyEnabled ? 1 : 0.4);
  }

  private confirm(): void {
    if (this.selected.length !== LOADOUT_SIZE) return;

    if (this.stage === 1) {
      this.loadout1 = [...this.selected];
      if (this.mode === 'hotseat') {
        this.stage = 2;
        this.selected = [];
        this.refresh();
        return;
      }
      // Vs AI: give the AI a random-ish loadout that includes a reaction word.
      this.start(this.loadout1, this.randomAILoadout());
      return;
    }

    // Stage 2 (hotseat player 2).
    this.start(this.loadout1, [...this.selected]);
  }

  private randomAILoadout(): WordId[] {
    const pool = [...WORD_ORDER];
    Phaser.Utils.Array.Shuffle(pool);
    const picks = pool.slice(0, LOADOUT_SIZE);
    if (!picks.some((w) => WORDS[w].grantsReaction)) {
      picks[0] = 'mind';
    }
    return picks;
  }

  private start(l1: WordId[], l2: WordId[]): void {
    const config: MatchConfig = { mode: this.mode, loadouts: [l1, l2] };
    this.scene.start('Game', config);
  }

  // ===========================================================================
  //  ONLINE LOBBY  (lockstep relay handshake)
  // ===========================================================================

  /** Begin an online match as host (team 1) or guest (team 2). */
  private async startOnline(role: NetRole): Promise<void> {
    if (this.connecting) return;
    if (this.selected.length !== LOADOUT_SIZE) {
      this.statusText.setText('Pick your full loadout first.');
      return;
    }

    const room = this.askRoomCode(role);
    if (room == null) return;
    const url = this.askRelayUrl();
    if (url == null) return;

    const myLoadout = [...this.selected];
    this.connecting = true;
    this.refresh();

    let net: Net;
    try {
      this.setStatus('Connecting to relay…');
      net = await Net.connect(url);
    } catch {
      this.setStatus('Could not reach the relay. Check the URL and that it is running.');
      this.connecting = false;
      this.refresh();
      return;
    }

    try {
      net.send({ k: 'join', room, role });
      this.setStatus('Waiting for the other player…');
      await this.waitFor(net, 'ready');

      let config: MatchConfig;
      if (role === 'host') {
        this.setStatus('Connected — waiting for opponent’s loadout…');
        const hello = await this.waitFor(net, 'hello');
        const guestLoadout = this.sanitizeLoadout(hello.loadout);
        const seed = (Math.floor(Math.random() * 0x7fffffff) + 1) | 0;
        net.send({ k: 'start', seed, loadouts: [myLoadout, guestLoadout] });
        config = { mode: 'online', loadouts: [myLoadout, guestLoadout], net, localTeam: 1, seed };
      } else {
        net.send({ k: 'hello', loadout: myLoadout });
        this.setStatus('Connected — waiting for host to start…');
        const startMsg = await this.waitFor(net, 'start');
        const loadouts = this.sanitizeLoadoutPair(startMsg.loadouts);
        const seed = Number(startMsg.seed) | 0;
        config = { mode: 'online', loadouts, net, localTeam: 2, seed };
      }

      this.connecting = false;
      this.scene.start('Game', config);
    } catch (err) {
      net.close();
      this.setStatus(err instanceof Error ? err.message : 'Connection lost.');
      this.connecting = false;
      this.refresh();
    }
  }

  /** Pull messages until one of `kind` arrives; throws on disconnect / full room. */
  private async waitFor(net: Net, kind: string): Promise<NetMessage> {
    for (;;) {
      const msg = await net.recv();
      if (msg.k === kind) return msg;
      if (msg.k === 'full') throw new Error('That room is already full.');
      if (msg.k === 'bye') throw new Error('The other player disconnected.');
      // Ignore anything unexpected and keep waiting.
    }
  }

  private askRoomCode(role: NetRole): string | null {
    const suggestion = role === 'host' ? String(1000 + Math.floor(Math.random() * 9000)) : '';
    const label =
      role === 'host'
        ? 'Room code (share this with your friend):'
        : 'Room code (get it from the host):';
    const code = window.prompt(label, suggestion);
    if (code == null) return null;
    const trimmed = code.trim();
    if (!trimmed) {
      this.setStatus('A room code is required.');
      return null;
    }
    return trimmed;
  }

  private askRelayUrl(): string | null {
    const url = window.prompt('Relay URL (ws:// or wss://):', defaultRelayUrl());
    if (url == null) return null;
    const trimmed = url.trim();
    if (!/^wss?:\/\//.test(trimmed)) {
      this.setStatus('Relay URL must start with ws:// or wss://');
      return null;
    }
    return trimmed;
  }

  private setStatus(text: string): void {
    this.statusText.setText(text);
  }

  /** Coerce an untrusted loadout from the network into a safe WordId[]. */
  private sanitizeLoadout(value: unknown): WordId[] {
    const arr = Array.isArray(value) ? value : [];
    const out = arr.filter((w): w is WordId => typeof w === 'string' && w in WORDS).slice(0, LOADOUT_SIZE);
    if (out.length === 0) out.push('pierce');
    return out;
  }

  private sanitizeLoadoutPair(value: unknown): [WordId[], WordId[]] {
    const arr = Array.isArray(value) ? value : [];
    return [this.sanitizeLoadout(arr[0]), this.sanitizeLoadout(arr[1])];
  }
}
