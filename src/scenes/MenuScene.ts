import Phaser from 'phaser';
import { COLORS, GAME_HEIGHT, GAME_WIDTH, LOADOUT_SIZE, TEXT } from '../config/constants';
import {
  isPveRunMode,
  isScenarioMode,
  usesSwampPrep,
  type ItemSetSelection,
  type MatchConfig,
  type MatchMode,
  type SeatConfig,
  type SwampPrepMode,
} from '../config/MatchConfig';
import type { Scenario } from '../core/Scenario';
import { WORDS, WORD_ORDER, MODIFIER_WORDS, isModifierWord, type WordId } from '../core/Words';
import { MAGE_CLASSES, MAGE_CLASS_DEFS, DEFAULT_MAGE_CLASS, toMageClass, type MageClass } from '../core/Classes';
import { SceneInput } from '../engine/SceneInput';
import { Net, type NetRole, type NetMessage } from '../net/Net';
import { ENEMY_DEFS, RAID_BOSS_KINDS, type RaidBossKind } from '../pve/swamprun';
import { pickScenarioFile } from '../ui/scenarioFile';
import { UI, UI_FONT, UI_HEX, bindTextControl } from '../ui/theme';
import { MenuExperience } from '../ui/menu/MenuExperience';
import { MenuModel } from '../ui/menu/MenuModel';
import { preloadMenuArt } from '../ui/menu/art';
import magePreviewUrl from '../Sprites/Idle/Idle1.png';

const NAD_LOADOUT: WordId[] = ['mind', 'shatter', 'twist', 'reality'];

/** Seven-slot layout for the PVE / lab submenu row (narrower than the top row). */
const SUB_W = 172;
const SUB_X = [94, 276, 458, 640, 822, 1004, 1186];
const EASTER_WORD_ORDER: WordId[] = [
  'twist',
  'reality',
  'drain',
  'death',
  'order',
  'slash',
  'fire',
  'lightning',
];

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
  private pveMenuOpen = false;
  private raidMenuOpen = false;
  private raidBoss: RaidBossKind = 'deathknightSpear';
  private onlineRole: NetRole = 'host';
  private swampRole: 'local' | NetRole = 'local';
  private swampPrepMode: SwampPrepMode = 'custom';
  private selected: WordId[] = [];
  /** The one modifier word this build carries; it costs no loadout slot. */
  private selectedModifier: WordId = MODIFIER_WORDS[0];
  /** Collected modifier per seat while drafting a local match. */
  private draftModifiers: WordId[] = [];
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
  private sniffActive = false;
  private unlockedWords = new Set<WordId>();
  /** Enabled item sets for the draft (host decides in online play). */
  private itemSets: ItemSetSelection = { original: true, finns: false, dlc: false };
  /** The class the seat currently drafting has chosen. */
  private selectedClass: MageClass = DEFAULT_MAGE_CLASS;
  /** Collected class per seat while drafting a local match (parallel to loadouts). */
  private draftClasses: MageClass[] = [];
  private wordCursor = 0;

  private wordCells: { rect: Phaser.GameObjects.Rectangle; word: WordId; label: Phaser.GameObjects.Text }[] = [];
  private modeSectionText!: Phaser.GameObjects.Text;
  private rulesSectionText!: Phaser.GameObjects.Text;
  private rulesSummaryText!: Phaser.GameObjects.Text;
  private titleText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private classTitle!: Phaser.GameObjects.Text;
  private classBtns: { btn: Phaser.GameObjects.Text; cls: MageClass }[] = [];
  private modifierBtn!: Phaser.GameObjects.Text;
  private modeAiBtn!: Phaser.GameObjects.Text;
  private modeHsBtn!: Phaser.GameObjects.Text;
  private modeOnlineBtn!: Phaser.GameObjects.Text;
  private modeTrainingBtn!: Phaser.GameObjects.Text;
  private modePveBtn!: Phaser.GameObjects.Text;
  private modeBackBtn!: Phaser.GameObjects.Text;
  private modeSwamprunBtn!: Phaser.GameObjects.Text;
  private modeExpeditionBtn!: Phaser.GameObjects.Text;
  private modeMinerunBtn!: Phaser.GameObjects.Text;
  private modeRaidBtn!: Phaser.GameObjects.Text;
  private modeScenarioBtn!: Phaser.GameObjects.Text;
  private modeMemoryBtn!: Phaser.GameObjects.Text;
  private raidBossBtns: { btn: Phaser.GameObjects.Text; kind: RaidBossKind }[] = [];
  private setOriginalBtn!: Phaser.GameObjects.Text;
  private setFinnsBtn!: Phaser.GameObjects.Text;
  private setDlcBtn!: Phaser.GameObjects.Text;
  private playersBtn!: Phaser.GameObjects.Text;
  private formatBtn!: Phaser.GameObjects.Text;
  private aiFillBtn!: Phaser.GameObjects.Text;
  private swampPrepBtn!: Phaser.GameObjects.Text;
  /** One team-toggle button per seat (teams mode with 3+ combatants). */
  private seatBtns: Phaser.GameObjects.Text[] = [];
  private startBtn!: Phaser.GameObjects.Text;
  private localBtn!: Phaser.GameObjects.Text;
  private hostBtn!: Phaser.GameObjects.Text;
  private joinBtn!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private summaryText!: Phaser.GameObjects.Text;
  private frontBackBtn!: Phaser.GameObjects.Text;
  /** True while an online lobby handshake is in progress (locks the UI). */
  private connecting = false;
  private menuModel = new MenuModel();
  private frontMenu?: MenuExperience;
  private legacyObjects: Phaser.GameObjects.GameObject[] = [];
  private legacyMenuVisible = false;

  constructor() {
    super('Menu');
  }

  preload(): void {
    this.load.image('menu-mage-preview', magePreviewUrl);
    preloadMenuArt(this);
  }

  create(): void {
    this.frontMenu?.destroy();
    this.frontMenu = undefined;
    this.menuModel = new MenuModel();
    this.legacyObjects = [];
    this.legacyMenuVisible = false;
    // Phaser reuses this scene instance, so returning from a duel re-runs
    // create(). Drop the previous run's (already destroyed) widgets and draft
    // state first, or refresh() will touch dead game objects and throw.
    this.wordCells = [];
    this.classBtns = [];
    this.raidBossBtns = [];
    this.seatBtns = [];
    this.selected = [];
    this.selectedClass = DEFAULT_MAGE_CLASS;
    this.selectedModifier = MODIFIER_WORDS[0];
    this.draftIndex = 0;
    this.draftLoadouts = [];
    this.draftClasses = [];
    this.draftModifiers = [];
    this.unlockedWords = new Set();
    this.wordCursor = 0;
    this.typed = '';
    this.nadActive = false;
    this.katActive = false;
    this.genActive = false;
    this.sniffActive = false;
    this.connecting = false;
    this.pveMenuOpen = false;
    this.raidMenuOpen = false;

    this.cameras.main.setBackgroundColor(COLORS.bg);

    const backdrop = this.add.graphics();
    backdrop.fillStyle(0x080b12, 1).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    backdrop.fillStyle(0x111827, 0.92).fillRect(0, 0, GAME_WIDTH, 82);
    backdrop.fillStyle(0x0d121c, 1).fillRect(0, 82, GAME_WIDTH, 386);
    backdrop.fillStyle(0x090d15, 1).fillRect(0, 468, GAME_WIDTH, GAME_HEIGHT - 468);
    backdrop.lineStyle(1, 0x293449, 0.75).lineBetween(0, 82, GAME_WIDTH, 82);
    backdrop.lineStyle(1, 0x293449, 0.75).lineBetween(0, 468, GAME_WIDTH, 468);
    for (let x = -180; x < GAME_WIDTH + 180; x += 180) {
      backdrop.lineStyle(1, 0x1e293b, 0.35).lineBetween(x, 82, x + 240, 448);
    }
    backdrop.fillStyle(0xd9a441, 1).fillRect(30, 25, 5, 34);

    this.add
      .text(50, 22, 'DIMIR // ARENA', {
        fontFamily: UI_FONT,
        fontSize: '30px',
        color: '#f8fafc',
        fontStyle: 'bold',
      })
      .setOrigin(0, 0);

    this.add.text(50, 54, 'TACTICAL MAGE COMBAT', {
      fontFamily: UI_FONT,
      fontSize: '11px',
      color: '#d9a441',
    });

    this.modeSectionText = this.add.text(36, 96, '1 // CHOOSE BATTLE', {
      fontFamily: UI_FONT,
      fontSize: '11px',
      color: '#d9a441',
      fontStyle: 'bold',
    });

    this.titleText = this.add
      .text(36, 162, '', {
        fontFamily: UI_FONT,
        fontSize: '21px',
        color: '#f8fafc',
        fontStyle: 'bold',
      })
      .setOrigin(0, 0);

    this.hintText = this.add
      .text(36, 192, '', {
        fontSize: '13px',
        color: TEXT.dim,
        wordWrap: { width: 800 },
        lineSpacing: 2,
      })
      .setOrigin(0, 0);

    this.add.text(36, 225, 'SPELL WORDS', {
      fontFamily: UI_FONT,
      fontSize: '12px',
      color: '#d9a441',
      fontStyle: 'bold',
    });
    this.add.text(882, 162, 'MAGE DISCIPLINE', {
      fontFamily: UI_FONT,
      fontSize: '12px',
      color: '#d9a441',
      fontStyle: 'bold',
    });
    this.add
      .rectangle(1060, 326, 330, 270, 0x111a27, 0.5)
      .setStrokeStyle(1, 0x293a51, 0.9);
    this.add.ellipse(1208, 444, 76, 20, 0x48b8d0, 0.12).setStrokeStyle(1, 0x48b8d0, 0.3);
    this.add.image(1208, 435, 'menu-mage-preview').setScale(2.8).setOrigin(0.5, 1);

    // Word grid. Secret cells stay hidden until their easter egg is entered.
    const cols = 4;
    const cw = 205;
    const ch = 92;
    const startX = 36 + cw / 2;
    const startY = 282;
    [...WORD_ORDER, ...EASTER_WORD_ORDER].forEach((word, i) => {
      const x = startX + (i % cols) * cw;
      const y = startY + Math.floor(i / cols) * (ch + 16);
      const rect = this.add
        .rectangle(x, y, cw - 12, ch, 0x141b28)
        .setStrokeStyle(1, WORDS[word].color, 0.75)
        .setInteractive({ useHandCursor: true });
      const label = this.add
        .text(x, y, this.cellText(word), {
          fontFamily: UI_FONT,
          fontSize: '14px',
          color: TEXT.body,
          align: 'center',
          wordWrap: { width: cw - 28 },
          lineSpacing: 2,
        })
        .setOrigin(0.5);
      rect.on('pointerover', () => {
        const visible = this.wordCells.filter((cell) => cell.rect.visible);
        this.wordCursor = Math.max(0, visible.findIndex((cell) => cell.word === word));
        rect.setFillStyle(0x202b3d);
      });
      rect.on('pointerout', () => this.refresh());
      rect.on('pointerdown', () => this.toggleWord(word));
      this.wordCells.push({ rect, word, label });
    });

    // Class selector (right column) — each drafting seat picks its own class.
    // Shown on every draft screen (unlike the first-screen-only setup controls).
    const classX = 1060;
    this.classTitle = this.add
      .text(classX, 204, 'Class', {
        fontFamily: UI_FONT,
        fontSize: '19px',
        color: TEXT.body,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    MAGE_CLASSES.forEach((cls, i) => {
      const btn = this.makeButton(classX, 255 + i * 58, MAGE_CLASS_DEFS[cls].label, () => this.setClass(cls), 300);
      btn.setFontSize(17).setPadding(14, 10);
      this.classBtns.push({ btn, cls });
    });

    // One modifier word per build, cycled here; it never uses a loadout slot.
    this.modifierBtn = this.makeButton(985, 412, '', () => this.cycleModifier(), 190);
    this.modifierBtn.setFontSize(14).setPadding(10, 7);

    this.add
      .rectangle(1100, 558, 300, 158, UI.panel, 0.96)
      .setStrokeStyle(1, UI.border, 0.95);
    this.add.rectangle(963, 496, 4, 22, UI.cyan, 1);
    this.add.text(977, 494, 'MATCH BRIEF', {
      fontFamily: UI_FONT,
      fontSize: '12px',
      color: UI_HEX.cyan,
      fontStyle: 'bold',
    });
    this.summaryText = this.add.text(963, 524, '', {
      fontFamily: UI_FONT,
      fontSize: '13px',
      color: TEXT.body,
      lineSpacing: 4,
      wordWrap: { width: 268 },
    });

    // Mode buttons.
    this.modeAiBtn = this.makeButton(128, 126, 'VS AI', () => this.setMode('ai'), 220);
    this.modeHsBtn = this.makeButton(384, 126, 'HOTSEAT', () => this.setMode('hotseat'), 220);
    this.modeOnlineBtn = this.makeButton(640, 126, 'ONLINE', () => this.setMode('online'), 220);
    this.modeTrainingBtn = this.makeButton(896, 126, 'TRAINING', () => this.setMode('training'), 220);
    this.modePveBtn = this.makeButton(1152, 126, 'PVE', () => this.openPveMenu(), 220);
    this.modeBackBtn = this.makeButton(SUB_X[0], 126, 'BACK', () => {
      if (this.raidMenuOpen) this.closeRaidMenu();
      else this.closePveMenu();
    }, SUB_W);
    this.modeSwamprunBtn = this.makeButton(SUB_X[1], 126, 'SWAMPRUN', () => this.setMode('swamprun'), SUB_W);
    this.modeExpeditionBtn = this.makeButton(SUB_X[2], 126, 'EXPEDITION', () => this.setMode('expedition'), SUB_W);
    this.modeMinerunBtn = this.makeButton(SUB_X[3], 126, 'MINE RUN', () => this.setMode('minerun'), SUB_W);
    this.modeRaidBtn = this.makeButton(SUB_X[4], 126, 'RAID', () => this.openRaidMenu(), SUB_W);
    this.modeScenarioBtn = this.makeButton(SUB_X[5], 126, 'SCENARIO', () => this.setMode('scenario'), SUB_W);
    this.modeMemoryBtn = this.makeButton(SUB_X[6], 126, 'MEMORY', () => this.setMode('memory'), SUB_W);
    RAID_BOSS_KINDS.forEach((kind, index) => {
      const btn = this.makeButton(512 + index * 256, 126, ENEMY_DEFS[kind].name.toUpperCase(), () => {
        this.selectRaidBoss(kind);
      }, 220);
      this.raidBossBtns.push({ btn, kind });
    });

    this.rulesSectionText = this.add.text(36, 480, '', {
      fontFamily: UI_FONT,
      fontSize: '11px',
      color: '#d9a441',
      fontStyle: 'bold',
    });
    this.rulesSummaryText = this.add.text(36, 548, '', {
      fontSize: '14px',
      color: TEXT.dim,
      wordWrap: { width: 850 },
      lineSpacing: 3,
    });

    // Item-set toggles (host decides in online play).
    this.setOriginalBtn = this.makeButton(198, 607, '', () => this.toggleSet('original'), 290);
    this.setFinnsBtn = this.makeButton(498, 607, '', () => this.toggleSet('finns'), 290);
    this.setDlcBtn = this.makeButton(798, 607, '', () => this.toggleSet('dlc'), 290);

    // Local N-player setup: number of combatants, team layout, and AI fill.
    this.playersBtn = this.makeButton(176, 563, '', () => this.cyclePlayers(), 245);
    this.formatBtn = this.makeButton(431, 563, '', () => this.toggleFormat(), 245);
    this.aiFillBtn = this.makeButton(686, 563, '', () => this.cycleAiFill(), 245);
    this.swampPrepBtn = this.makeButton(431, 563, '', () => {
      this.swampPrepMode = this.swampPrepMode === 'quick'
        ? 'custom'
        : this.swampPrepMode === 'custom'
          ? 'creative'
          : 'quick';
      this.refresh();
    }, 245);

    // Per-seat team pickers (teams mode with 3+ combatants) — build mixed sides
    // such as player + AI vs player + AI. Compact so the row fits under the modes.
    for (let s = 0; s < 4; s++) {
      const btn = this.makeButton(0, 646, '', () => this.cycleSeatTeam(s), 180);
      btn.setFontSize(15).setPadding(12, 6);
      btn.setVisible(false);
      this.seatBtns.push(btn);
    }
    this.syncSeatTeams();

    this.localBtn = this.makeButton(176, 519, 'LOCAL RUN', () => this.setSessionRole('local'), 245);
    this.hostBtn = this.makeButton(431, 519, 'HOST MATCH', () => this.setSessionRole('host'), 245);
    this.joinBtn = this.makeButton(686, 519, 'JOIN MATCH', () => this.setSessionRole('guest'), 245);
    this.startBtn = this.makeButton(1128, 665, 'Confirm', () => this.primaryAction(), 260, true);
    this.frontBackBtn = this.makeButton(1172, 42, 'MAIN MENU', () => this.openFrontMenu(), 150);
    this.frontBackBtn.setFontSize(12).setPadding(8, 6);

    this.statusText = this.add
      .text(36, 696, '', { fontSize: '13px', color: TEXT.warn })
      .setOrigin(0, 0.5);

    // Hidden easter eggs plus keyboard equivalents for the primary menu flow.
    const controls = new SceneInput(this);
    controls.bindAnyKey((event) => {
      if (this.legacyMenuVisible) this.onKey(event);
    });
    controls.bindKeys([
      { key: 'ENTER', run: () => {
        if (this.legacyMenuVisible) this.primaryAction();
      } },
      { key: 'LEFT', capture: true, run: () => {
        if (this.legacyMenuVisible) this.moveWordCursor(-1);
      } },
      { key: 'RIGHT', capture: true, run: () => {
        if (this.legacyMenuVisible) this.moveWordCursor(1);
      } },
      { key: 'UP', capture: true, run: () => {
        if (this.legacyMenuVisible) this.moveWordCursor(-4);
      } },
      { key: 'DOWN', capture: true, run: () => {
        if (this.legacyMenuVisible) this.moveWordCursor(4);
      } },
      { key: 'SPACE', capture: true, run: () => {
        if (this.legacyMenuVisible) this.toggleCursorWord();
      } },
      {
        key: 'ESC',
        run: () => {
          if (!this.legacyMenuVisible) return;
          if (this.raidMenuOpen) this.closeRaidMenu();
          else if (this.pveMenuOpen) this.closePveMenu();
          else this.openFrontMenu();
        },
      },
    ]);

    this.refresh();
    this.legacyObjects = [...this.children.list];
    this.setLegacyObjectsVisible(false);
    this.frontMenu = new MenuExperience(
      this,
      this.menuModel,
      (mode) => this.openLegacyMenu(mode),
      () => this.launchConfiguredMenu()
    );
  }

  private openLegacyMenu(mode: MatchMode): void {
    this.frontMenu?.destroy();
    this.frontMenu = undefined;
    this.legacyMenuVisible = true;
    this.setLegacyObjectsVisible(true);

    this.mode = mode;
    this.pveMenuOpen = false;
    this.raidMenuOpen = false;
    this.onlineRole = this.menuModel.role === 'guest' ? 'guest' : 'host';
    this.swampRole = this.menuModel.role;
    this.swampPrepMode = this.menuModel.prepMode;
    this.seatCount = this.menuModel.seatCount;
    this.aiCount = this.menuModel.aiCount;
    this.teamMode = this.menuModel.teamFormat;
    this.seatTeams = [...this.menuModel.seatTeams];
    this.raidBoss = this.menuModel.raidBoss;
    this.itemSets = { ...this.menuModel.itemSets };
    const draft = this.menuModel.draftFor(0);
    this.selected = [...draft.words];
    this.selectedClass = draft.mageClass;
    this.selectedModifier = draft.modifier;
    this.draftIndex = 0;
    this.draftLoadouts = [];
    this.draftClasses = [];
    this.draftModifiers = [];
    this.refresh();
  }

  private launchConfiguredMenu(): void {
    const role = this.menuModel.role;
    if (role === 'local') {
      try {
        const config = this.menuModel.toLocalMatchConfig();
        this.frontMenu?.destroy();
        this.frontMenu = undefined;
        this.scene.start('Game', config);
      } catch (error) {
        this.setStatus(error instanceof Error ? error.message : 'The match setup is incomplete.');
      }
      return;
    }

    this.mode = this.menuModel.mode;
    this.swampRole = role;
    this.swampPrepMode = this.menuModel.prepMode;
    this.seatCount = this.menuModel.seatCount;
    this.aiCount = this.menuModel.aiCount;
    this.seatTeams = [...this.menuModel.seatTeams];
    this.itemSets = { ...this.menuModel.itemSets };
    const draft = this.menuModel.draftFor(0);
    this.selected = [...draft.words];
    this.selectedClass = draft.mageClass;
    this.selectedModifier = draft.modifier;
    void this.startOnline(role);
  }

  private openFrontMenu(): void {
    if (!this.legacyMenuVisible || this.connecting) return;
    this.legacyMenuVisible = false;
    this.setLegacyObjectsVisible(false);
    this.frontMenu = new MenuExperience(
      this,
      this.menuModel,
      (mode) => this.openLegacyMenu(mode),
      () => this.launchConfiguredMenu()
    );
  }

  private setLegacyObjectsVisible(visible: boolean): void {
    for (const object of this.legacyObjects) {
      if ('setVisible' in object) {
        (object as Phaser.GameObjects.GameObject & { setVisible(value: boolean): unknown }).setVisible(visible);
      }
    }
  }

  /** Accumulate typed letters and unlock a secret loadout when spelled. */
  private onKey(e: KeyboardEvent): void {
    const key = (e.key ?? '').toUpperCase();
    if (key.length === 1 && key >= 'A' && key <= 'Z') {
      this.typed = (this.typed + key).slice(-5);
      if (this.typed.endsWith('NAD')) this.applyNadLoadout();
      else if (this.typed.endsWith('KAT')) this.applyKatLoadout();
      else if (this.typed.endsWith('GEN')) this.applyGenLoadout();
      else if (this.typed === 'SNIFF') this.applySniffLoadout();
    }
  }

  private applyNadLoadout(): void {
    this.unlockWords(NAD_LOADOUT);
    this.selected = [...NAD_LOADOUT];
    this.nadActive = true;
    this.katActive = false;
    this.sniffActive = false;
    this.refresh();
  }

  private applyKatLoadout(): void {
    const loadout: WordId[] = ['corrode', 'curse', 'shadow', 'drain', 'death'];
    this.unlockWords(loadout);
    this.selected = loadout;
    this.katActive = true;
    this.nadActive = false;
    this.genActive = false;
    this.sniffActive = false;
    this.refresh();
  }

  private applyGenLoadout(): void {
    const loadout: WordId[] = ['order', 'curse', 'drain', 'slash'];
    this.unlockWords(loadout);
    this.selected = loadout;
    this.genActive = true;
    this.nadActive = false;
    this.katActive = false;
    this.sniffActive = false;
    this.refresh();
  }

  private applySniffLoadout(): void {
    const loadout: WordId[] = ['pierce', 'mind', 'veil', 'fire', 'lightning'];
    this.unlockWords(loadout);
    this.selected = loadout;
    this.sniffActive = true;
    this.nadActive = false;
    this.katActive = false;
    this.genActive = false;
    this.refresh();
  }

  private unlockWords(words: readonly WordId[]): void {
    for (const word of words) {
      if (!WORD_ORDER.includes(word)) this.unlockedWords.add(word);
    }
  }

  private cellText(word: WordId): string {
    const d = WORDS[word];
    const tag = d.grantsReaction ? '\n(reaction)' : '';
    return `${d.label}${tag}\n${d.blurb}`;
  }

  private makeButton(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
    width = 190,
    primary = false
  ): Phaser.GameObjects.Text {
    const button = this.add
      .text(x, y, label, {
        fontFamily: UI_FONT,
        fontSize: '15px',
        color: primary ? '#0a0e16' : TEXT.body,
        backgroundColor: primary ? UI_HEX.gold : UI_HEX.panelRaised,
        fontStyle: 'bold',
        align: 'center',
        fixedWidth: width,
        padding: { x: 12, y: 9 },
      })
      .setOrigin(0.5);
    bindTextControl(button, onClick, {
      hoverShadow: primary ? '#f2c76e' : UI_HEX.cyan,
    });
    return button;
  }

  private setMode(mode: MatchMode): void {
    if (this.connecting) return;
    this.mode = mode;
    this.pveMenuOpen = false;
    this.raidMenuOpen = false;
    // Sensible default AI fill per mode: "vs AI" fills every seat but yours.
    if (mode === 'expedition') {
      this.seatCount = 1;
      this.aiCount = 0;
    } else if (mode === 'ai') {
      this.aiCount = this.seatCount - 1;
    } else {
      this.aiCount = 0;
    }
    if (!isPveRunMode(mode) && !isScenarioMode(mode) && this.seatCount < 2) this.seatCount = 2;
    this.clampAiCount();
    this.keepCurrentDraftValid();
    this.refresh();
  }

  private openPveMenu(): void {
    if (this.connecting) return;
    this.pveMenuOpen = true;
    this.raidMenuOpen = false;
    this.refresh();
  }

  private closePveMenu(): void {
    if (this.connecting) return;
    this.pveMenuOpen = false;
    this.refresh();
  }

  private openRaidMenu(): void {
    if (this.connecting) return;
    this.pveMenuOpen = false;
    this.raidMenuOpen = true;
    this.refresh();
  }

  private closeRaidMenu(): void {
    if (this.connecting) return;
    this.raidMenuOpen = false;
    this.pveMenuOpen = true;
    this.refresh();
  }

  private selectRaidBoss(kind: RaidBossKind): void {
    this.raidBoss = kind;
    this.setMode('raid');
  }

  private setSessionRole(role: 'local' | NetRole): void {
    if (this.connecting) return;
    if (this.mode === 'online' && role !== 'local') this.onlineRole = role;
    if (isPveRunMode(this.mode)) this.swampRole = role;
    this.statusText.setText('');
    this.refresh();
  }

  private primaryAction(): void {
    if (this.mode === 'memory') {
      void this.startFromMemory();
      return;
    }
    if (!this.loadoutReady()) {
      const missing = this.loadoutLimit() - this.selected.length;
      this.setStatus(`Choose ${missing} more spell word${missing === 1 ? '' : 's'}.`);
      return;
    }
    if (this.mode === 'online') {
      void this.startOnline(this.onlineRole);
      return;
    }
    if (isPveRunMode(this.mode) && this.swampRole !== 'local') {
      void this.startOnline(this.swampRole);
      return;
    }
    this.confirm();
  }

  /** Memory mode: pick a saved scenario file and jump straight into that fight. */
  private async startFromMemory(): Promise<void> {
    if (this.connecting) return;
    this.setStatus('Choose a saved scenario file…');
    let scenario: Scenario | null;
    try {
      scenario = await pickScenarioFile();
    } catch (err) {
      this.setStatus(err instanceof Error ? err.message : 'That scenario could not be loaded.');
      return;
    }
    if (!scenario) {
      this.setStatus('');
      return;
    }
    const config: MatchConfig = {
      mode: 'memory',
      loadouts: [scenario.entities[0]?.loadout ?? [], scenario.entities[1]?.loadout ?? []],
      itemSets: { ...this.itemSets },
      scenario,
    };
    this.scene.start('Game', config);
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
    const min = isPveRunMode(this.mode) || isScenarioMode(this.mode) ? 1 : 2;
    this.seatCount = this.seatCount >= 4 ? min : this.seatCount + 1;
    // Keep "vs AI" meaning 1 human vs the rest as the table resizes.
    if (this.mode === 'ai') this.aiCount = this.seatCount - 1;
    this.clampAiCount();
    this.syncSeatTeams();
    this.keepCurrentDraftValid();
    this.refresh();
  }

  /** Cycle how many seats the AI fills: 0 → 1 → … → (seatCount-1) → 0. */
  private cycleAiFill(): void {
    if (this.connecting) return;
    this.aiCount = this.aiCount >= this.seatCount - 1 ? 0 : this.aiCount + 1;
    this.keepCurrentDraftValid();
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
    if (isPveRunMode(this.mode)) return 1;
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

  /** Cycle the build's single modifier word: Subtle -> Delay -> Channel. */
  private cycleModifier(): void {
    if (this.connecting) return;
    const next = (MODIFIER_WORDS.indexOf(this.selectedModifier) + 1) % MODIFIER_WORDS.length;
    this.selectedModifier = MODIFIER_WORDS[next];
    this.refresh();
  }

  /** A build's full word list: its chosen words plus its one modifier. */
  private loadoutWithModifier(words: readonly WordId[], modifier: WordId): WordId[] {
    return [...words.filter((word) => !isModifierWord(word)), modifier];
  }

  /** Preserve the current mage while adapting to a stricter mode loadout cap. */
  private keepCurrentDraftValid(): void {
    const limit = this.loadoutLimit();
    if (this.selected.length <= limit) return;
    this.selected = this.selected.slice(0, limit);
    this.nadActive = false;
    this.katActive = false;
    this.genActive = false;
    this.sniffActive = false;
    this.setStatus(`Kept your first ${limit} words for this mode.`);
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
    const wasNad = this.isNadSelection();
    this.katActive = false;
    this.genActive = false;
    this.sniffActive = false;
    const idx = this.selected.indexOf(word);
    if (idx >= 0) {
      this.selected.splice(idx, 1);
    } else if (this.selected.length < this.loadoutLimit()) {
      this.selected.push(word);
    }
    this.nadActive = wasNad && this.isNadSelection();
    this.refresh();
  }

  private moveWordCursor(delta: number): void {
    const visible = this.wordCells.filter((cell) => cell.rect.visible);
    if (visible.length === 0) return;
    this.wordCursor = (this.wordCursor + delta + visible.length) % visible.length;
    this.refresh();
  }

  private toggleCursorWord(): void {
    const visible = this.wordCells.filter((cell) => cell.rect.visible);
    const cell = visible[this.wordCursor];
    if (cell) this.toggleWord(cell.word);
  }

  private isNadSelection(): boolean {
    return (
      (this.selected.length === NAD_LOADOUT.length || this.selected.length === LOADOUT_SIZE) &&
      NAD_LOADOUT.every((word) => this.selected.includes(word))
    );
  }

  private loadoutReady(): boolean {
    return this.selected.length === this.loadoutLimit() || (this.mode !== 'expedition' && this.isNadSelection());
  }

  private loadoutLimit(): number {
    return this.mode === 'expedition' ? 3 : LOADOUT_SIZE;
  }

  private refresh(): void {
    const firstScreen = this.draftIndex === 0;
    const humans = this.humanSeats();
    const draftingSeat = humans[this.draftIndex] ?? 0;
    const who = `Player ${draftingSeat + 1}`;
    this.titleText.setText(
      this.raidMenuOpen
        ? '2 // SELECT RAID TARGET'
        : `2 // BUILD ${who.toUpperCase()}  •  ${this.selected.length}/${this.loadoutLimit()} WORDS`
    );
    if (this.raidMenuOpen) {
      this.hintText.setText('Choose the single boss your party will prepare for and defeat.');
    } else if (this.nadActive || this.isNadSelection()) {
      this.hintText.setText('✨ NAD unlocked: Mind · Shatter · Twist · Reality · optional fifth word');
    } else if (this.katActive) {
      this.hintText.setText('✨ KAT unlocked: Corrode · Curse · Shadow · Drain · Death');
    } else if (this.genActive) {
      this.hintText.setText('✨ GEN unlocked: Order · Curse · Drain · Slash');
    } else if (this.sniffActive) {
      this.hintText.setText('✨ SNIFF unlocked: Pierce · Mind · Veil · Fire · Lightning');
    } else if (this.mode === 'online') {
      this.hintText.setText(
        this.onlineRole === 'host'
          ? 'Choose your mage, set the match rules below, then create a room for the other players.'
          : 'Choose only your mage. The host supplies player count, format, AI fill, and content packs.'
      );
    } else if (this.mode === 'training') {
      this.hintText.setText('Training: solo sandbox — spawn dummies, grant items, tweak HP/mana/stacks, reset the field.');
    } else if (this.mode === 'swamprun') {
      this.hintText.setText('Swamprun: co-op survival — endless waves of swamp horrors. Start Swamprun to play solo/with AI, or Host/Join for online co-op (set Players to 2+ humans).');
    } else if (this.mode === 'expedition') {
      this.hintText.setText('Expedition: delve without rests or shops, choose when to retreat, then spend your silver and recruit in town.');
    } else if (this.mode === 'minerun') {
      this.hintText.setText('Mine Run: chart a seeded maze, click routes on the discovered map, and choose which hostile rooms to enter.');
    } else if (this.mode === 'raid') {
      this.hintText.setText(`Raid: prepare up to four allies for one fight against ${ENEMY_DEFS[this.raidBoss].name}. Defeat the target to win.`);
    } else if (this.mode === 'scenario') {
      this.hintText.setText('Scenario Lab: build a fight from scratch — press [P] in combat to add players and creatures, drag them into place, kit them out, then save it to a file.');
    } else if (this.mode === 'memory') {
      this.hintText.setText('Memory: load a saved scenario file and drop straight into that exact fight. No drafting needed.');
    } else if (this.seatCount > 2) {
      this.hintText.setText(`${this.formatLabel()} — each player drafts their own words in turn.`);
    } else {
      this.hintText.setText('Click words to select. Bind / Veil / Mind grant a reaction.');
    }

    const visibleCells = this.wordCells.filter(
      (cell) => WORD_ORDER.includes(cell.word) || this.unlockedWords.has(cell.word)
    );
    const compact = visibleCells.length > WORD_ORDER.length;
    this.wordCursor = Math.min(this.wordCursor, Math.max(0, visibleCells.length - 1));
    const cellHeight = compact ? 58 : 92;
    const rowGap = compact ? 8 : 16;
    const startY = compact ? 252 : 282;
    for (const cell of this.wordCells) {
      const visible = visibleCells.includes(cell);
      cell.rect.setVisible(visible);
      cell.label.setVisible(visible);
      if (!visible) {
        cell.rect.disableInteractive();
        continue;
      }
      const index = visibleCells.indexOf(cell);
      const x = 36 + 205 / 2 + (index % 4) * 205;
      const y = startY + Math.floor(index / 4) * (cellHeight + rowGap);
      cell.rect.setPosition(x, y).setSize(193, cellHeight).setInteractive({ useHandCursor: true });
      cell.label
        .setPosition(x, y)
        .setFontSize(compact ? 11 : 14)
        .setWordWrapWidth(177);
      const slot = this.selected.indexOf(cell.word);
      const on = slot >= 0;
      const focused = index === this.wordCursor;
      cell.rect.setFillStyle(on ? 0x26374a : 0x141b28);
      cell.rect.setStrokeStyle(
        on ? 3 : focused ? 2 : 1,
        on ? COLORS.selected : focused ? UI.cyan : WORDS[cell.word].color,
        on || focused ? 1 : 0.75
      );
      cell.label.setColor(on ? '#ffffff' : TEXT.body);
      cell.label.setText(`${on ? `SLOT ${slot + 1}  •  ` : ''}${this.cellText(cell.word)}`);
    }

    // Class selector: highlight the drafting seat's chosen class.
    for (const { btn, cls } of this.classBtns) {
      const on = this.selectedClass === cls;
      btn.setStyle({ backgroundColor: on ? '#285b67' : '#182131' });
      btn.setColor(on ? '#ffffff' : TEXT.dim);
    }
    this.classTitle.setText(`Class: ${MAGE_CLASS_DEFS[this.selectedClass].label}`);
    this.modifierBtn.setText(`Modifier: ${WORDS[this.selectedModifier].label}`);
    this.modifierBtn.setStyle({ backgroundColor: '#285b67' });
    this.modifierBtn.setColor('#ffffff');

    const aiOn = this.mode === 'ai';
    const hsOn = this.mode === 'hotseat';
    const onlineOn = this.mode === 'online';
    const trainingOn = this.mode === 'training';
    const swamprunOn = this.mode === 'swamprun';
    const expeditionOn = this.mode === 'expedition';
    const minerunOn = this.mode === 'minerun';
    const raidOn = this.mode === 'raid';
    const scenarioOn = this.mode === 'scenario';
    const memoryOn = this.mode === 'memory';
    const pveOn = swamprunOn || expeditionOn || minerunOn || raidOn || scenarioOn || memoryOn;
    // The lab modes are offline-only, so they get no host / join lobby row.
    const netPveOn = swamprunOn || expeditionOn || minerunOn || raidOn;
    this.modeAiBtn.setStyle({ backgroundColor: aiOn ? '#285b67' : '#182131' });
    this.modeHsBtn.setStyle({ backgroundColor: hsOn ? '#285b67' : '#182131' });
    this.modeOnlineBtn.setStyle({ backgroundColor: onlineOn ? '#285b67' : '#182131' });
    this.modeTrainingBtn.setStyle({ backgroundColor: trainingOn ? '#285b67' : '#182131' });
    this.modePveBtn.setStyle({ backgroundColor: pveOn ? '#285b67' : '#182131' });
    this.modeSwamprunBtn.setStyle({ backgroundColor: swamprunOn ? '#285b67' : '#182131' });
    this.modeExpeditionBtn.setStyle({ backgroundColor: expeditionOn ? '#285b67' : '#182131' });
    this.modeMinerunBtn.setStyle({ backgroundColor: minerunOn ? '#285b67' : '#182131' });
    this.modeRaidBtn.setStyle({ backgroundColor: raidOn ? '#285b67' : '#182131' });
    this.modeScenarioBtn.setStyle({ backgroundColor: scenarioOn ? '#285b67' : '#182131' });
    this.modeMemoryBtn.setStyle({ backgroundColor: memoryOn ? '#285b67' : '#182131' });
    // Mode is only chosen on the first draft screen.
    const showTopModes = firstScreen && !this.pveMenuOpen && !this.raidMenuOpen;
    const showPveModes = firstScreen && this.pveMenuOpen;
    const showRaidBosses = firstScreen && this.raidMenuOpen;
    this.modeAiBtn.setVisible(showTopModes);
    this.modeHsBtn.setVisible(showTopModes);
    this.modeOnlineBtn.setVisible(showTopModes);
    this.modeTrainingBtn.setVisible(showTopModes);
    this.modePveBtn.setVisible(showTopModes);
    this.modeBackBtn.setVisible(showPveModes || showRaidBosses);
    this.modeSwamprunBtn.setVisible(showPveModes);
    this.modeExpeditionBtn.setVisible(showPveModes);
    this.modeMinerunBtn.setVisible(showPveModes);
    this.modeRaidBtn.setVisible(showPveModes);
    this.modeScenarioBtn.setVisible(showPveModes);
    this.modeMemoryBtn.setVisible(showPveModes);
    for (const { btn } of this.raidBossBtns) btn.setVisible(showRaidBosses);

    const networkRole = onlineOn ? this.onlineRole : netPveOn ? this.swampRole : 'local';
    const rulesOwner = networkRole !== 'guest';
    const showRole = firstScreen && (onlineOn || netPveOn) && !this.pveMenuOpen;
    this.localBtn.setVisible(showRole && netPveOn);
    this.hostBtn.setVisible(showRole);
    this.joinBtn.setVisible(showRole);
    if (onlineOn) {
      this.hostBtn.setX(304);
      this.joinBtn.setX(559);
    } else {
      this.hostBtn.setX(431);
      this.joinBtn.setX(686);
    }
    this.localBtn.setStyle({ backgroundColor: networkRole === 'local' ? '#285b67' : '#182131' });
    this.hostBtn.setStyle({ backgroundColor: networkRole === 'host' ? '#285b67' : '#182131' });
    this.joinBtn.setStyle({ backgroundColor: networkRole === 'guest' ? '#285b67' : '#182131' });

    this.rulesSectionText.setVisible(firstScreen);
    this.rulesSectionText.setText(
      showRole ? `3 // SESSION  •  ${rulesOwner ? 'RULES' : 'HOST RULES'}` : '3 // MATCH RULES'
    );
    this.rulesSummaryText.setVisible(firstScreen && !rulesOwner);
    this.rulesSummaryText.setText(
      'No rule setup needed. Choose your words and class, then join with the room code from your host.'
    );

    // Item-set toggles (first screen only; guests inherit the host's choice).
    const setBtns: [Phaser.GameObjects.Text, keyof ItemSetSelection, string][] = [
      [this.setOriginalBtn, 'original', 'Original Dimir'],
      [this.setFinnsBtn, 'finns', "Finn's Additions"],
      [this.setDlcBtn, 'dlc', 'Dimir Faithful DLC'],
    ];
    const showSets = firstScreen && rulesOwner;
    for (const [btn, key, label] of setBtns) {
      const on = this.itemSets[key];
      btn.setText(`${on ? '✓' : '○'}  ${label}`);
      btn.setStyle({ backgroundColor: on ? '#24543f' : '#182131' });
      btn.setVisible(showSets);
    }

    // Player-count / format controls: local teamfights & online room setup.
    // Swamprun is co-op survival, so it shows Players + AI but no team format.
    const showSetup = firstScreen && this.mode !== 'training' && this.mode !== 'memory' && rulesOwner;
    this.playersBtn.setText(`Players: ${this.seatCount}`);
    this.playersBtn.setVisible(showSetup);
    this.formatBtn.setText(`Format: ${this.formatLabel()}`);
    this.formatBtn.setVisible(showSetup && !isPveRunMode(this.mode));
    this.aiFillBtn.setText(`AI: ${this.aiCount}`);
    this.aiFillBtn.setVisible(showSetup && this.mode !== 'expedition');
    const prepLabel: Record<SwampPrepMode, string> = {
      quick: 'Prep: Quick start',
      custom: 'Prep: Rolled stats + gear',
      creative: 'Prep: Creative',
    };
    this.swampPrepBtn.setText(prepLabel[this.swampPrepMode]);
    this.swampPrepBtn.setStyle({ backgroundColor: this.swampPrepMode === 'quick' ? '#182131' : '#24543f' });
    this.swampPrepBtn.setVisible(showSetup && usesSwampPrep(this.mode));

    // Per-seat team pickers: only for teams mode with 3+ combatants, where the
    // split is actually a choice (e.g. player + AI vs player + AI).
    const showSeatTeams =
      showSetup && !isPveRunMode(this.mode) && this.teamMode === 'teams' && this.seatCount >= 3;
    const spacing = 190;
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

    const ready = this.loadoutReady();
    const moreSeats = this.draftIndex < humans.length - 1;
    this.startBtn.setVisible(true);
    this.startBtn.setAlpha(ready || memoryOn ? 1 : 0.4);
    this.startBtn.setText(
      moreSeats
        ? 'NEXT MAGE'
        : onlineOn
          ? this.onlineRole === 'host' ? 'CREATE ONLINE ROOM' : 'JOIN ONLINE ROOM'
          : swamprunOn
            ? this.swampRole === 'local' ? 'START SWAMPRUN' : this.swampRole === 'host' ? 'HOST CO-OP ROOM' : 'JOIN CO-OP ROOM'
            : expeditionOn
              ? this.swampRole === 'local' ? 'START EXPEDITION' : this.swampRole === 'host' ? 'HOST CAMPAIGN' : 'JOIN CAMPAIGN'
              : minerunOn
                ? this.swampRole === 'local' ? 'START MINE RUN' : this.swampRole === 'host' ? 'HOST CO-OP ROOM' : 'JOIN CO-OP ROOM'
              : raidOn
                ? this.swampRole === 'local' ? 'START RAID' : this.swampRole === 'host' ? 'HOST RAID ROOM' : 'JOIN RAID ROOM'
            : scenarioOn
              ? 'OPEN SCENARIO LAB'
              : memoryOn
                ? 'LOAD MEMORY FILE'
            : this.mode === 'training' ? 'START TRAINING' : 'START DUEL'
    );
    this.startBtn.setColor(ready || memoryOn ? '#0a0e16' : '#4d4431');

    const modeLabels: Record<MatchMode, string> = {
      hotseat: 'Hotseat',
      ai: 'Versus AI',
      online: 'Online arena',
      training: 'Training lab',
      swamprun: 'Swamprun',
      expedition: 'Expedition',
      minerun: 'Mine Run',
      raid: `Raid: ${ENEMY_DEFS[this.raidBoss].name}`,
      scenario: 'Scenario Lab',
      memory: 'Memory',
    };
    const roleLabel = networkRole === 'guest' ? 'Join' : networkRole === 'host' ? 'Host' : 'Local';
    const partyLabel = this.mode === 'training'
      ? 'Solo sandbox'
      : isPveRunMode(this.mode)
        ? `${this.seatCount} ${this.seatCount === 1 ? 'explorer' : 'explorers'} · ${this.aiCount} AI`
        : `${this.formatLabel()} · ${this.seatCount} seats · ${this.aiCount} AI`;
    const setLabel = [
      this.itemSets.original ? 'Original' : '',
      this.itemSets.finns ? 'Finn' : '',
      this.itemSets.dlc ? 'DLC' : '',
    ].filter(Boolean).join(' + ');
    this.summaryText
      .setColor(ready ? TEXT.body : TEXT.dim)
      .setText([
        `${modeLabels[this.mode]} · ${roleLabel}`,
        partyLabel,
        `${MAGE_CLASS_DEFS[this.selectedClass].label} · Mage ${this.draftIndex + 1}/${humans.length}`,
        `Loadout ${this.selected.length}/${this.loadoutLimit()} · ${ready ? 'READY' : 'INCOMPLETE'}`,
        `Modifier · ${WORDS[this.selectedModifier].label}`,
        `Packs · ${setLabel}`,
      ]);
  }

  private confirm(): void {
    if (!this.loadoutReady()) return;
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
    this.draftModifiers[seat] = this.selectedModifier;
    if (this.draftIndex < humans.length - 1) {
      this.draftIndex++;
      this.selected = [];
      this.selectedClass = DEFAULT_MAGE_CLASS;
      this.selectedModifier = MODIFIER_WORDS[0];
      this.nadActive = false;
      this.katActive = false;
      this.genActive = false;
      this.sniffActive = false;
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
        human && this.draftLoadouts[s]?.length
          ? this.loadoutWithModifier(this.draftLoadouts[s], this.draftModifiers[s] ?? MODIFIER_WORDS[0])
          : this.randomAILoadout();
      const mageClass = human ? (this.draftClasses[s] ?? DEFAULT_MAGE_CLASS) : this.randomClass();
      seats.push({ name: this.seatName(s, human), team: this.teamOf(s), isAI: !human, loadout, mageClass });
    }
    const config: MatchConfig = {
      mode: this.mode,
      loadouts: [seats[0].loadout, seats[1]?.loadout ?? seats[0].loadout],
      swampPrepMode: usesSwampPrep(this.mode) ? this.swampPrepMode : undefined,
      raidBoss: this.mode === 'raid' ? this.raidBoss : undefined,
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
    picks.push(MODIFIER_WORDS[Math.floor(Math.random() * MODIFIER_WORDS.length)]);
    return picks;
  }

  private start(l1: WordId[], l2: WordId[]): void {
    const config: MatchConfig = {
      mode: this.mode,
      loadouts: [this.loadoutWithModifier(l1, this.selectedModifier), l2],
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
    if (!this.loadoutReady()) {
      this.statusText.setText('Pick your full loadout first.');
      return;
    }
    if (role === 'host' && this.humanCount() < 2) {
      this.statusText.setText(
        isPveRunMode(this.mode)
          ? 'Online co-op needs at least 2 human seats — raise Players.'
          : 'Online needs at least 2 human seats — lower the AI count.'
      );
      return;
    }

    const room = this.askRoomCode(role);
    if (room == null) return;
    const url = this.askRelayUrl();
    if (url == null) return;

    const myLoadout = this.loadoutWithModifier(this.selected, this.selectedModifier);
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
        net.send({
          k: 'start',
          mode: this.mode,
          seed,
          seats,
          itemSets: this.itemSets,
          swampPrepMode: usesSwampPrep(this.mode) ? this.swampPrepMode : undefined,
          raidBoss: this.mode === 'raid' ? this.raidBoss : undefined,
        });
        config = {
          mode: this.mode,
          loadouts: [seats[0].loadout, seats[1]?.loadout ?? []],
          swampPrepMode: usesSwampPrep(this.mode) ? this.swampPrepMode : undefined,
          raidBoss: this.mode === 'raid' ? this.raidBoss : undefined,
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
        const startMode: MatchMode = startMsg.mode === 'swamprun' || startMsg.mode === 'expedition' || startMsg.mode === 'minerun' || startMsg.mode === 'raid'
          ? startMsg.mode
          : 'online';
        config = {
          mode: startMode,
          loadouts: [seats[0].loadout, seats[1]?.loadout ?? []],
          swampPrepMode: usesSwampPrep(startMode)
            ? startMsg.swampPrepMode === 'quick' || startMsg.swampPrepMode === 'creative'
              ? startMsg.swampPrepMode
              : 'custom'
            : undefined,
          raidBoss: startMode === 'raid' ? this.sanitizeRaidBoss(startMsg.raidBoss) : undefined,
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
    if (!this.legacyMenuVisible) this.frontMenu?.setStatus(text);
  }

  /** Coerce an untrusted loadout from the network into a safe WordId[]. */
  private sanitizeLoadout(value: unknown): WordId[] {
    const arr = Array.isArray(value) ? value : [];
    const words = arr.filter((w): w is WordId => typeof w === 'string' && w in WORDS);
    const out = words.filter((w) => !isModifierWord(w)).slice(0, LOADOUT_SIZE);
    if (out.length === 0) out.push('pierce');
    // A build may carry exactly one modifier, and it costs no loadout slot.
    out.push(words.find(isModifierWord) ?? MODIFIER_WORDS[0]);
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

  private sanitizeRaidBoss(value: unknown): RaidBossKind {
    return RAID_BOSS_KINDS.includes(value as RaidBossKind)
      ? value as RaidBossKind
      : 'deathknightSpear';
  }
}
