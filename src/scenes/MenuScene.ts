import Phaser from 'phaser';
import { COLORS, GAME_HEIGHT, GAME_WIDTH, LOADOUT_SIZE, TEXT } from '../config/constants';
import { WORDS, WORD_ORDER, type WordId } from '../core/Words';
import { MAGE_CLASSES, MAGE_CLASS_DEFS, DEFAULT_MAGE_CLASS, toMageClass, type MageClass } from '../core/Classes';
import { Net, type NetRole, type NetMessage } from '../net/Net';

export type MatchMode = 'hotseat' | 'ai' | 'online' | 'training' | 'swamprun';

/** Which toggleable item catalogues the draft draws from. */
export interface ItemSetSelection {
  original: boolean;
  finns: boolean;
  dlc: boolean;
}

/** One combatant's seat in a match (used for N-player teamfights / battle royale). */
export interface SeatConfig {
  name: string;
  /** Team number; seats sharing a team fight together. FFA = every seat its own team. */
  team: number;
  isAI: boolean;
  loadout: WordId[];
  /** Chosen class (Objects / Life / Hexcraft). Defaults applied downstream. */
  mageClass?: MageClass;
}

export interface MatchConfig {
  mode: MatchMode;
  loadouts: [WordId[], WordId[]];
  /**
   * Classes for the classic two-mage layout (parallel to {@link loadouts}).
   * N-player matches carry the class per seat in {@link seats} instead.
   */
  classes?: [MageClass, MageClass];
  /**
   * Optional explicit seat list for N-player matches (up to 4). When present it
   * fully describes every combatant and their team; when absent the classic
   * two-mage layout is derived from `loadouts` + `mode`.
   */
  seats?: SeatConfig[];
  /** Item sets enabled for the draft (defaults to original only). */
  itemSets?: ItemSetSelection;
  /** Online play: the live connection to the opponent (lockstep relay). */
  net?: Net;
  /** Online play: which team this client controls (1 = host, 2 = guest). */
  localTeam?: number;
  /** Online play: which seat index this client controls (0-based). */
  localSeat?: number;
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
  private selected: WordId[] = [];
  /** Local N-player match setup. */
  private seatCount = 2;
  private teamMode: 'teams' | 'ffa' = 'teams';
  /** How many seats are filled by AI. Humans take the first (seatCount - aiCount) seats. */
  private aiCount = 1;
  /** Team number per seat (teams mode). Lets you build mixed player+AI teams. */
  private seatTeams: number[] = [];
  /** Index into humanSeats() of the seat currently drafting (local play). */
  private draftIndex = 0;
  /** Collected loadouts per seat while drafting a local match. */
  private draftLoadouts: WordId[][] = [];
  private typed = '';
  private nadActive = false;
  private katActive = false;
  private genActive = false;
  /** Enabled item sets for the draft (host decides in online play). */
  private itemSets: ItemSetSelection = { original: true, finns: false, dlc: false };
  /** The class the seat currently drafting has chosen. */
  private selectedClass: MageClass = DEFAULT_MAGE_CLASS;
  /** Collected class per seat while drafting a local match (parallel to loadouts). */
  private draftClasses: MageClass[] = [];

  private wordCells: { rect: Phaser.GameObjects.Rectangle; word: WordId; label: Phaser.GameObjects.Text }[] = [];
  private titleText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private classTitle!: Phaser.GameObjects.Text;
  private classBtns: { btn: Phaser.GameObjects.Text; cls: MageClass }[] = [];
  private modeAiBtn!: Phaser.GameObjects.Text;
  private modeHsBtn!: Phaser.GameObjects.Text;
  private modeOnlineBtn!: Phaser.GameObjects.Text;
  private modeTrainingBtn!: Phaser.GameObjects.Text;
  private modeSwamprunBtn!: Phaser.GameObjects.Text;
  private setOriginalBtn!: Phaser.GameObjects.Text;
  private setFinnsBtn!: Phaser.GameObjects.Text;
  private setDlcBtn!: Phaser.GameObjects.Text;
  private playersBtn!: Phaser.GameObjects.Text;
  private formatBtn!: Phaser.GameObjects.Text;
  private aiFillBtn!: Phaser.GameObjects.Text;
  /** One team-toggle button per seat (teams mode with 3+ combatants). */
  private seatBtns: Phaser.GameObjects.Text[] = [];
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

    // Class selector (right column) — each drafting seat picks its own class.
    // Shown on every draft screen (unlike the first-screen-only setup controls).
    const classX = GAME_WIDTH / 2 + 545;
    this.classTitle = this.add
      .text(classX, 205, 'Class', { fontSize: '18px', color: TEXT.warn, fontStyle: 'bold' })
      .setOrigin(0.5);
    MAGE_CLASSES.forEach((cls, i) => {
      const btn = this.makeButton(classX, 250 + i * 58, MAGE_CLASS_DEFS[cls].label, () => this.setClass(cls));
      btn.setFontSize(17).setPadding(14, 8);
      this.classBtns.push({ btn, cls });
    });

    // Mode buttons.
    this.modeAiBtn = this.makeButton(GAME_WIDTH / 2 - 440, 560, 'Vs AI', () => this.setMode('ai'));
    this.modeHsBtn = this.makeButton(GAME_WIDTH / 2 - 220, 560, 'Hotseat (2P)', () => this.setMode('hotseat'));
    this.modeOnlineBtn = this.makeButton(GAME_WIDTH / 2, 560, 'Online', () => this.setMode('online'));
    this.modeTrainingBtn = this.makeButton(GAME_WIDTH / 2 + 220, 560, 'Training', () => this.setMode('training'));
    this.modeSwamprunBtn = this.makeButton(GAME_WIDTH / 2 + 440, 560, 'Swamprun', () => this.setMode('swamprun'));

    // Item-set toggles (host decides in online play).
    this.setOriginalBtn = this.makeButton(GAME_WIDTH / 2 - 300, 500, '', () => this.toggleSet('original'));
    this.setFinnsBtn = this.makeButton(GAME_WIDTH / 2, 500, '', () => this.toggleSet('finns'));
    this.setDlcBtn = this.makeButton(GAME_WIDTH / 2 + 300, 500, '', () => this.toggleSet('dlc'));

    // Local N-player setup: number of combatants, team layout, and AI fill.
    this.playersBtn = this.makeButton(GAME_WIDTH / 2 - 280, 445, '', () => this.cyclePlayers());
    this.formatBtn = this.makeButton(GAME_WIDTH / 2, 445, '', () => this.toggleFormat());
    this.aiFillBtn = this.makeButton(GAME_WIDTH / 2 + 280, 445, '', () => this.cycleAiFill());

    // Per-seat team pickers (teams mode with 3+ combatants) — build mixed sides
    // such as player + AI vs player + AI. Compact so the row fits under the modes.
    for (let s = 0; s < 4; s++) {
      const btn = this.makeButton(0, 600, '', () => this.cycleSeatTeam(s));
      btn.setFontSize(15).setPadding(12, 6);
      btn.setVisible(false);
      this.seatBtns.push(btn);
    }
    this.syncSeatTeams();

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
      else if (this.typed === 'GEN') this.applyGenLoadout();
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
    this.genActive = false;
    this.refresh();
  }

  private applyGenLoadout(): void {
    this.selected = ['order', 'curse', 'drain', 'slash'];
    this.genActive = true;
    this.nadActive = false;
    this.katActive = false;
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
    // Sensible default AI fill per mode: "vs AI" fills every seat but yours.
    if (mode === 'ai') this.aiCount = this.seatCount - 1;
    else this.aiCount = 0; // hotseat / online / training / swamprun start all-human
    // Swamprun allows a solo run; every other mode needs at least two seats.
    if (mode !== 'swamprun' && this.seatCount < 2) this.seatCount = 2;
    this.clampAiCount();
    this.resetDraft();
    this.refresh();
  }

  /** Toggle an item set on/off; never allow every set to be disabled. */
  private toggleSet(set: keyof ItemSetSelection): void {
    if (this.connecting) return;
    const next = { ...this.itemSets, [set]: !this.itemSets[set] };
    if (!next.original && !next.finns && !next.dlc) return;
    this.itemSets = next;
    this.refresh();
  }

  /** Cycle the local combatant count. Swamprun allows 1; others start at 2. */
  private cyclePlayers(): void {
    if (this.connecting) return;
    const min = this.mode === 'swamprun' ? 1 : 2;
    this.seatCount = this.seatCount >= 4 ? min : this.seatCount + 1;
    // Keep "vs AI" meaning 1 human vs the rest as the table resizes.
    if (this.mode === 'ai') this.aiCount = this.seatCount - 1;
    this.clampAiCount();
    this.syncSeatTeams();
    this.resetDraft();
    this.refresh();
  }

  /** Cycle how many seats the AI fills: 0 → 1 → … → (seatCount-1) → 0. */
  private cycleAiFill(): void {
    if (this.connecting) return;
    this.aiCount = this.aiCount >= this.seatCount - 1 ? 0 : this.aiCount + 1;
    this.resetDraft();
    this.refresh();
  }

  private clampAiCount(): void {
    this.aiCount = Math.max(0, Math.min(this.seatCount - 1, this.aiCount));
  }

  /** Number of human-controlled seats. Humans take seats 0..humanCount-1. */
  private humanCount(): number {
    return Math.max(1, this.seatCount - this.aiCount);
  }

  /** Flip between balanced teams and free-for-all. */
  private toggleFormat(): void {
    if (this.connecting) return;
    this.teamMode = this.teamMode === 'teams' ? 'ffa' : 'teams';
    this.syncSeatTeams();
    this.refresh();
  }

  /** Reset every seat to the balanced positional team split. */
  private syncSeatTeams(): void {
    const half = Math.ceil(this.seatCount / 2);
    this.seatTeams = Array.from({ length: this.seatCount }, (_, s) => (s < half ? 1 : 2));
  }

  /** Flip a seat between team 1 and 2, never leaving a team empty. */
  private cycleSeatTeam(seat: number): void {
    if (this.connecting) return;
    if (seat < 0 || seat >= this.seatCount) return;
    const next = this.seatTeams[seat] === 1 ? 2 : 1;
    const prev = this.seatTeams[seat];
    this.seatTeams[seat] = next;
    // Reject a flip that would wipe out a whole side of a teams match.
    const t1 = this.seatTeams.slice(0, this.seatCount).filter((t) => t === 1).length;
    if (t1 === 0 || t1 === this.seatCount) {
      this.seatTeams[seat] = prev;
      return;
    }
    this.refresh();
  }

  /** Seats controlled by a local human player, in draft order. */
  private humanSeats(): number[] {
    if (this.mode === 'online' || this.mode === 'training') return [0];
    return Array.from({ length: this.humanCount() }, (_, i) => i);
  }

  /** Team number for a seat under the current layout. */
  private teamOf(seat: number): number {
    if (this.mode === 'swamprun') return 1; // co-op: the whole party is team 1
    if (this.teamMode === 'ffa') return seat + 1;
    const half = Math.ceil(this.seatCount / 2);
    return this.seatTeams[seat] ?? (seat < half ? 1 : 2);
  }

  private seatName(seat: number, human: boolean): string {
    if (human) return `Player ${seat + 1}`;
    return this.seatCount > 2 ? `AI ${seat + 1}` : 'AI';
  }

  /** Human-readable label for the current match format. */
  private formatLabel(): string {
    if (this.teamMode === 'ffa') return this.seatCount <= 2 ? 'Duel' : 'Free-for-all';
    if (this.seatCount === 2) return '1v1';
    let t1 = 0;
    for (let s = 0; s < this.seatCount; s++) if (this.teamOf(s) === 1) t1++;
    const t2 = this.seatCount - t1;
    return `${Math.max(t1, t2)}v${Math.min(t1, t2)}`;
  }

  /** Clear any in-progress local draft (when the setup changes). */
  private resetDraft(): void {
    this.draftIndex = 0;
    this.draftLoadouts = [];
    this.draftClasses = [];
    this.selected = [];
    this.selectedClass = DEFAULT_MAGE_CLASS;
    this.nadActive = false;
    this.katActive = false;
    this.genActive = false;
  }

  /** Pick the class for the seat currently drafting. */
  private setClass(cls: MageClass): void {
    if (this.connecting) return;
    this.selectedClass = cls;
    this.refresh();
  }

  /** A random class for an AI-filled seat (host broadcasts these to peers). */
  private randomClass(): MageClass {
    return MAGE_CLASSES[Math.floor(Math.random() * MAGE_CLASSES.length)];
  }

  private toggleWord(word: WordId): void {
    this.nadActive = false;
    this.katActive = false;
    this.genActive = false;
    const idx = this.selected.indexOf(word);
    if (idx >= 0) {
      this.selected.splice(idx, 1);
    } else if (this.selected.length < LOADOUT_SIZE) {
      this.selected.push(word);
    }
    this.refresh();
  }

  private refresh(): void {
    const firstScreen = this.draftIndex === 0;
    const humans = this.humanSeats();
    const draftingSeat = humans[this.draftIndex] ?? 0;
    const who = `Player ${draftingSeat + 1}`;
    this.titleText.setText(`${who}: choose ${LOADOUT_SIZE} words  (${this.selected.length}/${LOADOUT_SIZE})`);
    if (this.nadActive) {
      this.hintText.setText('✨ NAD unlocked: Mind · Shatter · Twist · Reality');
    } else if (this.katActive) {
      this.hintText.setText('✨ KAT unlocked: Corrode · Curse · Shadow · Drain');
    } else if (this.genActive) {
      this.hintText.setText('✨ GEN unlocked: Order · Curse · Drain · Slash');
    } else if (this.mode === 'online') {
      const humans = this.humanCount();
      const fill = this.aiCount > 0 ? ` + ${this.aiCount} AI` : '';
      this.hintText.setText(
        `Online ${this.formatLabel()} (${humans} human${humans > 1 ? 's' : ''}${fill}) — host sets Players/Format/AI; then Host or Join with a shared room code.`
      );
    } else if (this.mode === 'training') {
      this.hintText.setText('Training: solo sandbox — spawn dummies, grant items, tweak HP/mana/stacks, reset the field.');
    } else if (this.mode === 'swamprun') {
      this.hintText.setText('Swamprun: co-op survival — endless waves of swamp horrors. Start Swamprun to play solo/with AI, or Host/Join for online co-op (set Players to 2+ humans).');
    } else if (this.seatCount > 2) {
      this.hintText.setText(`${this.formatLabel()} — each player drafts their own words in turn.`);
    } else {
      this.hintText.setText('Click words to select. Bind / Veil / Mind grant a reaction.');
    }

    for (const cell of this.wordCells) {
      const on = this.selected.includes(cell.word);
      cell.rect.setFillStyle(on ? 0x2c2c4a : 0x1a1a2a);
      cell.rect.setStrokeStyle(on ? 4 : 2, on ? COLORS.selected : WORDS[cell.word].color);
    }

    // Class selector: highlight the drafting seat's chosen class.
    for (const { btn, cls } of this.classBtns) {
      const on = this.selectedClass === cls;
      btn.setStyle({ backgroundColor: on ? '#3a3a66' : '#23233a' });
      btn.setColor(on ? '#ffffff' : TEXT.dim);
    }
    this.classTitle.setText(`Class: ${MAGE_CLASS_DEFS[this.selectedClass].label}`);

    const aiOn = this.mode === 'ai';
    const hsOn = this.mode === 'hotseat';
    const onlineOn = this.mode === 'online';
    const trainingOn = this.mode === 'training';
    const swamprunOn = this.mode === 'swamprun';
    this.modeAiBtn.setStyle({ backgroundColor: aiOn ? '#3a3a66' : '#23233a' });
    this.modeHsBtn.setStyle({ backgroundColor: hsOn ? '#3a3a66' : '#23233a' });
    this.modeOnlineBtn.setStyle({ backgroundColor: onlineOn ? '#3a3a66' : '#23233a' });
    this.modeTrainingBtn.setStyle({ backgroundColor: trainingOn ? '#3a3a66' : '#23233a' });
    this.modeSwamprunBtn.setStyle({ backgroundColor: swamprunOn ? '#3a3a66' : '#23233a' });
    // Mode is only chosen on the first draft screen.
    this.modeAiBtn.setVisible(firstScreen);
    this.modeHsBtn.setVisible(firstScreen);
    this.modeOnlineBtn.setVisible(firstScreen);
    this.modeTrainingBtn.setVisible(firstScreen);
    this.modeSwamprunBtn.setVisible(firstScreen);

    // Item-set toggles (first screen only; the guest inherits the host's choice).
    const setBtns: [Phaser.GameObjects.Text, keyof ItemSetSelection, string][] = [
      [this.setOriginalBtn, 'original', 'Original Dimir'],
      [this.setFinnsBtn, 'finns', "Finn's Additions"],
      [this.setDlcBtn, 'dlc', 'Dimir Faithful DLC'],
    ];
    const showSets = firstScreen;
    for (const [btn, key, label] of setBtns) {
      const on = this.itemSets[key];
      btn.setText(`${label}: ${on ? 'ON' : 'off'}`);
      btn.setStyle({ backgroundColor: on ? '#2f5d3a' : '#23233a' });
      btn.setVisible(showSets);
    }

    // Player-count / format controls: local teamfights & online room setup.
    // Swamprun is co-op survival, so it shows Players + AI but no team format.
    const showSetup = firstScreen && this.mode !== 'training';
    this.playersBtn.setText(`Players: ${this.seatCount}`);
    this.playersBtn.setVisible(showSetup);
    this.formatBtn.setText(`Format: ${this.formatLabel()}`);
    this.formatBtn.setVisible(showSetup && this.mode !== 'swamprun');
    this.aiFillBtn.setText(`AI: ${this.aiCount}`);
    this.aiFillBtn.setVisible(showSetup);

    // Per-seat team pickers: only for teams mode with 3+ combatants, where the
    // split is actually a choice (e.g. player + AI vs player + AI).
    const showSeatTeams =
      showSetup && this.mode !== 'swamprun' && this.teamMode === 'teams' && this.seatCount >= 3;
    const spacing = 210;
    for (let s = 0; s < this.seatBtns.length; s++) {
      const btn = this.seatBtns[s];
      if (showSeatTeams && s < this.seatCount) {
        const human = s < this.humanCount();
        const who = human ? `P${s + 1}` : `AI${s + 1}`;
        btn.setText(`${who} → Team ${this.teamOf(s)}`);
        btn.setX(GAME_WIDTH / 2 + (s - (this.seatCount - 1) / 2) * spacing);
        btn.setStyle({ backgroundColor: this.teamOf(s) === 1 ? '#3a2a55' : '#22405a' });
        btn.setVisible(true);
      } else {
        btn.setVisible(false);
      }
    }

    const ready = this.selected.length === LOADOUT_SIZE;
    const moreSeats = this.draftIndex < humans.length - 1;
    // Online shows Host/Join buttons; swamprun offers BOTH a local start and
    // online co-op, so its lobby buttons appear alongside Start Swamprun.
    this.startBtn.setVisible(!onlineOn);
    this.startBtn.setAlpha(ready ? 1 : 0.4);
    this.startBtn.setText(
      moreSeats ? 'Next' : this.mode === 'training' ? 'Start Training' : this.mode === 'swamprun' ? 'Start Swamprun' : 'Start Duel'
    );
    const showLobby = (onlineOn || swamprunOn) && firstScreen;
    this.hostBtn.setVisible(showLobby);
    this.joinBtn.setVisible(showLobby);
    const lobbyEnabled = ready && !this.connecting;
    this.hostBtn.setAlpha(lobbyEnabled ? 1 : 0.4);
    this.joinBtn.setAlpha(lobbyEnabled ? 1 : 0.4);
  }

  private confirm(): void {
    if (this.selected.length !== LOADOUT_SIZE) return;
    if (this.mode === 'online') return; // online starts via Host / Join
    if (this.mode === 'training') {
      // Solo sandbox: a single loadout against a training dummy.
      this.start(this.selected, this.randomAILoadout());
      return;
    }

    // Hotseat / vs-AI / swamprun: draft each human seat in sequence, then launch.
    const humans = this.humanSeats();
    const seat = humans[this.draftIndex];
    this.draftLoadouts[seat] = [...this.selected];
    this.draftClasses[seat] = this.selectedClass;
    if (this.draftIndex < humans.length - 1) {
      this.draftIndex++;
      this.selected = [];
      this.selectedClass = DEFAULT_MAGE_CLASS;
      this.nadActive = false;
      this.katActive = false;
      this.genActive = false;
      this.refresh();
      return;
    }
    this.startSeats();
  }

  /** Assemble the seat list for a local match and hand off to the duel. */
  private startSeats(): void {
    const humanSet = new Set(this.humanSeats());
    const seats: SeatConfig[] = [];
    for (let s = 0; s < this.seatCount; s++) {
      const human = humanSet.has(s);
      const loadout =
        human && this.draftLoadouts[s]?.length ? this.draftLoadouts[s] : this.randomAILoadout();
      const mageClass = human ? (this.draftClasses[s] ?? DEFAULT_MAGE_CLASS) : this.randomClass();
      seats.push({ name: this.seatName(s, human), team: this.teamOf(s), isAI: !human, loadout, mageClass });
    }
    const config: MatchConfig = {
      mode: this.mode,
      loadouts: [seats[0].loadout, seats[1]?.loadout ?? seats[0].loadout],
      classes: [seats[0].mageClass ?? DEFAULT_MAGE_CLASS, seats[1]?.mageClass ?? DEFAULT_MAGE_CLASS],
      seats,
      itemSets: { ...this.itemSets },
    };
    this.scene.start('Game', config);
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
    const config: MatchConfig = {
      mode: this.mode,
      loadouts: [l1, l2],
      classes: [this.selectedClass, this.randomClass()],
      itemSets: { ...this.itemSets },
    };
    this.scene.start('Game', config);
  }

  // ===========================================================================
  //  ONLINE LOBBY  (lockstep relay handshake)
  // ===========================================================================

  /** Begin an online match. Seat 0 (the first to join) hosts the handshake. */
  private async startOnline(role: NetRole): Promise<void> {
    if (this.connecting) return;
    if (this.selected.length !== LOADOUT_SIZE) {
      this.statusText.setText('Pick your full loadout first.');
      return;
    }
    if (role === 'host' && this.humanCount() < 2) {
      this.statusText.setText(
        this.mode === 'swamprun'
          ? 'Online co-op needs at least 2 human seats — raise Players.'
          : 'Online needs at least 2 human seats — lower the AI count.'
      );
      return;
    }

    const room = this.askRoomCode(role);
    if (room == null) return;
    const url = this.askRelayUrl();
    if (url == null) return;

    const myLoadout = [...this.selected];
    const myClass = this.selectedClass;
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
      // Relay capacity is the *human* seat count; the host appends any AI seats
      // locally so no network slot is reserved for them.
      const humanSize = role === 'host' ? this.humanCount() : 0;
      net.send({ k: 'join', room, size: humanSize });

      // The relay assigns our seat (join order) and reports how many humans.
      const seatMsg = await this.waitFor(net, 'seat');
      const mySeat = Number(seatMsg.seat) | 0;
      const roomHumans = Math.max(2, Math.min(4, Number(seatMsg.size) || 2));
      this.setStatus(`Seat ${mySeat + 1} of ${roomHumans} — waiting for players…`);
      await this.waitFor(net, 'ready');

      // Every human announces their loadout; seat 0 assembles the match.
      net.send({ k: 'hello', seat: mySeat, loadout: myLoadout, class: myClass });

      let config: MatchConfig;
      if (mySeat === 0) {
        // Host: gather human loadouts (seats 0..roomHumans-1), then append AI.
        const loadouts = new Map<number, WordId[]>();
        const classes = new Map<number, MageClass>();
        loadouts.set(0, myLoadout);
        classes.set(0, myClass);
        while (loadouts.size < roomHumans) {
          const hello = await this.waitFor(net, 'hello');
          const seat = Number(hello.seat) | 0;
          if (seat >= 0 && seat < roomHumans) {
            loadouts.set(seat, this.sanitizeLoadout(hello.loadout));
            classes.set(seat, toMageClass(hello.class));
          }
        }
        // Humans take seats 0..roomHumans-1; the rest of the table is AI.
        const totalSeats = Math.max(roomHumans, Math.min(4, this.seatCount));
        const seats: SeatConfig[] = [];
        for (let s = 0; s < totalSeats; s++) {
          const human = s < roomHumans;
          seats.push({
            name: this.seatName(s, human),
            team: this.teamOf(s),
            isAI: !human,
            loadout: human ? (loadouts.get(s) ?? this.randomAILoadout()) : this.randomAILoadout(),
            mageClass: human ? (classes.get(s) ?? DEFAULT_MAGE_CLASS) : this.randomClass(),
          });
        }
        const seed = (Math.floor(Math.random() * 0x7fffffff) + 1) | 0;
        net.send({ k: 'start', mode: this.mode, seed, seats, itemSets: this.itemSets });
        config = {
          mode: this.mode,
          loadouts: [seats[0].loadout, seats[1]?.loadout ?? []],
          seats,
          net,
          localTeam: seats[0].team,
          localSeat: 0,
          seed,
          itemSets: { ...this.itemSets },
        };
      } else {
        // Guest: wait for the host's assembled match definition.
        this.setStatus('Connected — waiting for host to start…');
        const startMsg = await this.waitFor(net, 'start');
        const totalSeats = Array.isArray(startMsg.seats)
          ? Math.max(2, Math.min(4, startMsg.seats.length))
          : roomHumans;
        const seats = this.sanitizeSeats(startMsg.seats, totalSeats);
        const seed = Number(startMsg.seed) | 0;
        const itemSets = this.sanitizeItemSets(startMsg.itemSets);
        // The host tells us which mode we're joining (PvP duel or co-op swamprun).
        const startMode: MatchMode = startMsg.mode === 'swamprun' ? 'swamprun' : 'online';
        config = {
          mode: startMode,
          loadouts: [seats[0].loadout, seats[1]?.loadout ?? []],
          seats,
          net,
          localTeam: seats[mySeat]?.team ?? 2,
          localSeat: mySeat,
          seed,
          itemSets,
        };
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

  /** Coerce an untrusted seat layout from the host into a safe SeatConfig[]. */
  private sanitizeSeats(value: unknown, size: number): SeatConfig[] {
    const arr = Array.isArray(value) ? value : [];
    const out: SeatConfig[] = [];
    for (let s = 0; s < size; s++) {
      const v = (arr[s] ?? {}) as Partial<SeatConfig>;
      out.push({
        name: typeof v.name === 'string' ? v.name : `Player ${s + 1}`,
        team: typeof v.team === 'number' && Number.isFinite(v.team) ? v.team : s + 1,
        isAI: v.isAI === true,
        loadout: this.sanitizeLoadout(v.loadout),
        mageClass: toMageClass(v.mageClass),
      });
    }
    return out;
  }

  /** Coerce a networked item-set selection into a safe, non-empty selection. */
  private sanitizeItemSets(value: unknown): ItemSetSelection {
    const v = (value ?? {}) as Partial<Record<keyof ItemSetSelection, unknown>>;
    const sets: ItemSetSelection = {
      original: !!v.original,
      finns: !!v.finns,
      dlc: !!v.dlc,
    };
    if (!sets.original && !sets.finns && !sets.dlc) sets.original = true;
    return sets;
  }
}
