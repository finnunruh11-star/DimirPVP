import Phaser from 'phaser';
import { COLORS, GAME_HEIGHT, GAME_WIDTH, LOADOUT_SIZE, TEXT } from '../config/constants';
import { WORDS, WORD_ORDER, type WordId } from '../core/Words';

export type MatchMode = 'hotseat' | 'ai';

export interface MatchConfig {
  mode: MatchMode;
  loadouts: [WordId[], WordId[]];
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
  private startBtn!: Phaser.GameObjects.Text;

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
    this.modeAiBtn = this.makeButton(GAME_WIDTH / 2 - 150, 560, 'Vs AI', () => this.setMode('ai'));
    this.modeHsBtn = this.makeButton(GAME_WIDTH / 2 + 150, 560, 'Hotseat (2P)', () => this.setMode('hotseat'));

    this.startBtn = this.makeButton(GAME_WIDTH / 2, 640, 'Confirm', () => this.confirm());

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
    } else {
      this.hintText.setText('Click words to select. Bind / Veil / Mind grant a reaction.');
    }

    for (const cell of this.wordCells) {
      const on = this.selected.includes(cell.word);
      cell.rect.setFillStyle(on ? 0x2c2c4a : 0x1a1a2a);
      cell.rect.setStrokeStyle(on ? 4 : 2, on ? COLORS.selected : WORDS[cell.word].color);
    }

    const aiOn = this.mode === 'ai';
    this.modeAiBtn.setStyle({ backgroundColor: aiOn ? '#3a3a66' : '#23233a' });
    this.modeHsBtn.setStyle({ backgroundColor: !aiOn ? '#3a3a66' : '#23233a' });
    // Mode is only chosen on stage 1.
    this.modeAiBtn.setVisible(this.stage === 1);
    this.modeHsBtn.setVisible(this.stage === 1);

    const ready = this.selected.length === LOADOUT_SIZE;
    this.startBtn.setAlpha(ready ? 1 : 0.4);
    this.startBtn.setText(this.stage === 1 && this.mode === 'hotseat' ? 'Next' : 'Start Duel');
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
}
