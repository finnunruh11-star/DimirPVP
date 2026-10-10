// The heads-up layer over a walkable place: vitals, gold and bounties pinned to
// the screen, the "talk" prompt, and every modal window (shops, pack, level-ups,
// menus). A scene of its own so the world camera can scroll underneath it.

import Phaser from 'phaser';
import { playSound } from '../audio';
import { GAME_HEIGHT, GAME_WIDTH } from '../config/constants';
import { MAGE_CLASS_DEFS, type MageClass } from '../core/Classes';
import { SceneInput } from '../engine/SceneInput';
import { bountyProgress } from '../pve/exploration/bounties';
import { dayNews } from '../pve/exploration/calendar';
import { levelsOwed } from '../pve/exploration/coop';
import { memberIn, money, partyOf } from '../pve/exploration/economy';
import { type ItemId } from '../core/Items';
import { AdventureSession } from '../net/AdventureSession';
import type { ExplorationActions } from '../pve/exploration/intents';
import { armsLines } from '../pve/exploration/arms';
import type { ExplorationRun } from '../pve/exploration/run';
import { saveRun } from '../pve/exploration/save';
import { shopById } from '../pve/exploration/shops';
import { CabinetChip, MenuFocusGroup } from '../ui/cabinet/controls';
import { MENU_COLOR, MENU_FONT, MENU_HEX, MENU_MOTION } from '../ui/cabinet/theme';
import { isReducedMotion } from '../ui/cabinet/motion';
import { prefersTouchLayout } from '../config/device';
import { siteGoals } from '../pve/exploration/site';
import { drawPlate, EasedBar, KeyLegend, PromptPlate, ToastRail } from '../ui/pve/HudParts';
import { bloodmoonDue, bloodmoonOmen } from '../pve/exploration/bloodmoon';
import { playBloodmoonRise } from '../ui/combat/BossIntro';
import { ChoiceMenuView } from '../ui/combat/CombatMenus';
import { playDayCard, type DayCard } from '../ui/pve/DawnCard';
import { resolvePendingLevels } from '../ui/pve/LevelUpFlow';
import { PackView } from '../ui/pve/PackView';
import { playRestCinematic } from '../ui/pve/RestCinematic';
import type { RestNap } from '../pve/exploration/nap';
import { SearchView, type SearchViewHooks, type SearchViewModel, type SearchViewResult } from '../ui/pve/SearchView';
import { ShopView, type InnHooks } from '../ui/pve/ShopView';
import { TradeView } from '../ui/pve/TradeView';
import { SightingCard, type SightingCardModel } from '../ui/pve/SightingCard';
import { TimeWheel } from '../ui/pve/TimeWheel';
import { TextEntry } from '../ui/cabinet/TextEntry';
import { ArmoryHall, type ArmoryHooks } from '../ui/pve/ArmoryHall';
import { VoteBoard, type VoteBoardHooks, type VoteBoardModel } from '../ui/pve/VoteBoard';
import { playAwakening, type AwakeningModel } from '../ui/pve/Awakening';
import type { CreationPick } from '../pve/exploration/creation';

export interface HudOwner {
  onHudReady(hud: LocaleHudScene): void;
  /** Touch controls: a button was pressed, read like its key. */
  tap?(button: string): void;
  /** Touch controls: the act button is held down. */
  setTouchHold?(on: boolean): void;
}

export interface WorldPanelAction {
  id: string;
  label: string;
  enabled: boolean;
  tone?: 'primary' | 'normal' | 'danger';
}

/** The overworld's standing panel: where you are, where you are headed, what you can do. */
export interface WorldPanel {
  title: string;
  titleColor?: string;
  lines: string[];
  actions: WorldPanelAction[];
  onAction: (id: string) => void;
  /** The pointer or the keys rest on an action (online, the others see what you are looking at). */
  onHover?: (id: string) => void;
}

const DIGITS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];

/** On the bloodmoon's day, the hours at which its countdown comes back on screen. */
const FINAL_HOURS: readonly number[] = [12, 18, 22];
/** How long the clock, or mana and sanity, stay up after they last changed, ms. */
const CLOCK_MS = 4500;
const MINOR_MS = 4000;
/** The full key legend shows by itself once a session; after that it waits for H. */
let legendSeen = false;
/** The last day a HUD showed, so a day that turned during a fight or between scenes still gets its card. */
let lastDay: { seed: number; day: number } | null = null;
/** The travel menu folded away so the map shows; kept between scenes. */
let worldHidden = false;

export class LocaleHudScene extends Phaser.Scene {
  private frame?: Phaser.GameObjects.Graphics;
  private title?: Phaser.GameObjects.Text;
  private line?: Phaser.GameObjects.Text;
  private bars?: Phaser.GameObjects.Graphics;
  private barText?: Phaser.GameObjects.Text;
  private partyText?: Phaser.GameObjects.Text;
  private bountyText?: Phaser.GameObjects.Text;
  private journalBack?: Phaser.GameObjects.Graphics;
  private partyBack?: Phaser.GameObjects.Graphics;
  private partyRows: Phaser.GameObjects.Text[] = [];
  private councilBack?: Phaser.GameObjects.Graphics;
  private councilText?: Phaser.GameObjects.Text;
  private vitals: EasedBar[] = [];
  /** Mana and sanity: out of sight until they change. */
  private minorBars: EasedBar[] = [];
  private minorG?: Phaser.GameObjects.Graphics;
  private minorLabels: Phaser.GameObjects.Text[] = [];
  private minorKey = '';
  private minorTimer?: Phaser.Time.TimerEvent;
  private clockKey = -1;
  private clockTimer?: Phaser.Time.TimerEvent;
  private hint = '';
  private legendOpen = false;
  private prompt?: PromptPlate;
  private toasts?: ToastRail;
  private legend?: KeyLegend;
  private wordBar?: Phaser.GameObjects.Text;
  private modal = 0;
  private worldPanel?: Phaser.GameObjects.Container;
  private worldFocus = new MenuFocusGroup();
  private worldModel: WorldPanel | null = null;
  private wheel?: TimeWheel;
  /** The day the HUD last showed; a later one gets its card. */
  private shownDay = 0;
  /** A day that turned while a window was open, announced once it closes. */
  private pendingCard: DayCard | null = null;
  private cardPlaying: Promise<void> | null = null;
  /** The party member this player controls; null means the leader. */
  private member: MageClass | null = null;
  /** The shop or pack window on screen, redrawn when the run changes under it. */
  private window: ShopView | PackView | null = null;
  private windowClose: (() => void) | null = null;
  /** Online: the travel plans beside the map, in place of the world panel. */
  private worldBoard: VoteBoard | null = null;
  private boardHooks: VoteBoardHooks | null = null;
  private boardModel: VoteBoardModel | null = null;
  /** Folds the travel menu away or brings it back. */
  private worldToggle?: CabinetChip;
  private worldToggleKey = '';
  /** Online: something the whole party is voting on, over everything. */
  private pollBoard: VoteBoard | null = null;
  private pollHooks: VoteBoardHooks | null = null;
  /** The Lodge's armoury, while it is open. */
  private armory: ArmoryHall | null = null;
  /** The clock as last seen, so a warning fires once as its hour is passed. */
  private omenSeen: { day: number; hour: number } | null = null;
  private readonly cheatEntry = new TextEntry();
  private cheatClose: (() => void) | null = null;
  private currentRun?: ExplorationRun;
  private currentPlace = '';
  private currentExtra = '';
  private owner: HudOwner | null = null;
  /** On foot: the button straight back to the travel map. */
  private mapExit?: CabinetChip;

  constructor() {
    super('LocaleHud');
  }

  get modalOpen(): boolean {
    return this.modal > 0;
  }

  create(data: { owner: HudOwner }): void {
    this.modal = 0;
    this.worldPanel = undefined;
    this.worldModel = null;
    this.worldFocus = new MenuFocusGroup();
    this.shownDay = 0;
    this.pendingCard = null;
    this.cardPlaying = null;
    this.window = null;
    this.windowClose = null;
    this.worldBoard = null;
    this.boardHooks = null;
    this.boardModel = null;
    this.worldToggle = undefined;
    this.worldToggleKey = '';
    this.pollBoard = null;
    this.pollHooks = null;
    this.armory = null;
    this.omenSeen = null;
    this.cheatClose = null;
    this.currentRun = undefined;
    this.owner = data.owner;
    this.mapExit = undefined;
    this.cheatEntry.finish(false);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cheatEntry.destroy());
    const panelKey = (run: () => void) => (): void => {
      if ((this.worldPanel || this.worldBoard) && !this.modalOpen) run();
    };
    new SceneInput(this).bindKeys([
      { key: 'UP', capture: true, run: panelKey(() => this.worldFocus.move(-1)) },
      { key: 'DOWN', capture: true, run: panelKey(() => this.worldFocus.move(1)) },
      { key: 'ENTER', capture: true, run: panelKey(() => this.worldFocus.activate()) },
      { key: 'SPACE', capture: true, run: panelKey(() => this.worldFocus.activate()) },
      ...DIGITS.map((key, index) => ({ key, run: panelKey(() => this.worldAction(index)) })),
      {
        key: 'TAB',
        capture: true,
        run: () => {
          if ((this.worldModel || this.boardModel) && !this.modalOpen) this.toggleWorldMenu();
        },
      },
      { key: 'F2', run: () => this.toggleCheatConsole() },
      { key: 'H', run: () => this.toggleLegend() },
    ]);
    this.minorKey = '';
    this.clockKey = -1;
    this.frame = this.add.graphics();
    drawPlate(this.frame, 12, 10, 310, 100);
    this.title = this.add.text(26, 18, '', { fontFamily: MENU_FONT.display, fontSize: '18px', fontStyle: 'bold', color: MENU_HEX.brassLight });
    this.line = this.add.text(26, 42, '', { fontFamily: MENU_FONT.control, fontSize: '12px', color: MENU_HEX.boneDim, fixedWidth: 282 });
    this.bars = this.add.graphics();
    this.vitals = [new EasedBar(26, 64, 196, 12, 0xb8453c)];
    this.barText = this.add.text(232, 61, '', { fontFamily: MENU_FONT.control, fontSize: '13px', fontStyle: 'bold', color: MENU_HEX.bone });
    this.minorBars = [new EasedBar(26, 96, 132, 6, 0x4a7fd0), new EasedBar(168, 96, 132, 6, 0x8a5fb8)];
    this.minorG = this.add.graphics().setAlpha(0);
    this.minorLabels = [
      this.add.text(26, 82, '', { fontFamily: MENU_FONT.control, fontSize: '10px', fontStyle: 'bold', color: '#8fb4f0' }).setAlpha(0),
      this.add.text(168, 82, '', { fontFamily: MENU_FONT.control, fontSize: '10px', fontStyle: 'bold', color: '#c3a0e8' }).setAlpha(0),
    ];
    this.partyBack = this.add.graphics();
    this.partyRows = [];
    this.journalBack = this.add.graphics();
    this.bountyText = this.add.text(GAME_WIDTH - 28, 24, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '13px',
      color: MENU_HEX.bone,
      align: 'right',
      lineSpacing: 2,
      wordWrap: { width: 460 },
    }).setOrigin(1, 0);
    this.legend = new KeyLegend(this, 24, GAME_HEIGHT - 30);
    this.hint = 'WASD / arrows or click: walk     E: talk     I: bag     Esc: menu     F2: cheats';
    this.legendOpen = !legendSeen;
    this.applyLegend();
    if (!legendSeen) {
      legendSeen = true;
      this.time.delayedCall(12_000, () => {
        this.legendOpen = false;
        this.applyLegend();
      });
    }
    this.wordBar = this.add.text(16, GAME_HEIGHT - 46, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '13px',
      color: MENU_HEX.bone,
      backgroundColor: '#17110d',
      padding: { x: 10, y: 5 },
    }).setOrigin(0, 1).setVisible(false);
    this.prompt = new PromptPlate(this, GAME_WIDTH / 2, GAME_HEIGHT - 92);
    this.toasts = new ToastRail(this, GAME_WIDTH / 2, 160);
    const touch = prefersTouchLayout() && !!data.owner.tap;
    this.legend.setVisible(!touch);
    if (touch) this.buildDock(data.owner);
    // The clock keeps to the lower left corner and only shows while time goes by.
    this.wheel = new TimeWheel(this, 16 + 91, GAME_HEIGHT - 240);
    this.wheel.setShown(false, true);
    this.councilBack = this.add.graphics().setDepth(11);
    this.councilText = this.add.text(26, 0, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '13px',
      color: MENU_HEX.bone,
      lineSpacing: 3,
      wordWrap: { width: 344 },
    }).setDepth(11).setVisible(false);
    data.owner.onHudReady(this);
  }

  /** What the party is deciding together, under the party rows; empty hides it. */
  setCouncil(lines: readonly string[]): void {
    const text = this.councilText;
    const back = this.councilBack;
    if (!text || !back) return;
    const body = lines.join('\n');
    if (text.visible && text.text === body) return;
    back.clear();
    text.setText(body).setVisible(lines.length > 0);
    if (!lines.length) return;
    const others = this.partyRows.length;
    const top = others ? 142 + others * 24 : 122;
    text.setY(top + 10);
    drawPlate(back, 12, top, 372, Math.ceil(text.height) + 20);
  }

  update(_time: number, delta: number): void {
    this.wheel?.update(delta);
    // Under an open window the map button neither shows nor takes clicks.
    this.mapExit?.setVisible(!this.modalOpen);
    let moved = false;
    for (const bar of [...this.vitals, ...this.minorBars]) moved = bar.step(delta) || moved;
    if (moved) this.drawVitals();
  }

  private drawVitals(): void {
    const g = this.bars;
    if (!g) return;
    g.clear();
    for (const bar of this.vitals) bar.draw(g);
    const minor = this.minorG?.clear();
    if (minor) for (const bar of this.minorBars) bar.draw(minor);
  }

  /** H: the whole key legend, or just the hint that it is there. */
  private toggleLegend(): void {
    this.legendOpen = !this.legendOpen;
    this.applyLegend();
  }

  private applyLegend(): void {
    this.legend?.set(this.legendOpen ? `${this.hint}     H: hide keys` : 'H: keys');
  }

  /** Mana and sanity rise into view when they change, and fade once they settle. */
  private flashMinor(): void {
    const parts = [this.minorG, ...this.minorLabels].filter((part): part is Phaser.GameObjects.Graphics | Phaser.GameObjects.Text => !!part);
    this.tweens.killTweensOf(parts);
    this.tweens.add({ targets: parts, alpha: 1, duration: 180 });
    this.minorTimer?.remove();
    this.minorTimer = this.time.delayedCall(MINOR_MS, () => this.tweens.add({ targets: parts, alpha: 0, duration: 700 }));
  }

  /** The clock comes up while time passes, and goes again once it has stood still a while. */
  private showClock(): void {
    this.wheel?.setShown(true);
    this.clockTimer?.remove();
    this.clockTimer = this.time.delayedCall(CLOCK_MS, () => {
      // On the bloodmoon's day the clock stays up to the end.
      if (!this.currentRun || !bloodmoonOmen(this.currentRun.day).tonight) this.wheel?.setShown(false);
    });
  }

  /** Touch: big act button (held for finds that take a moment) and the other keys beside it. */
  private buildDock(owner: HudOwner): void {
    const size = 92;
    const right = GAME_WIDTH - 20;
    const bottom = GAME_HEIGHT - 20;
    const button = (x: number, y: number, w: number, h: number, label: string, id: string): void => {
      const g = this.add.graphics();
      const draw = (down: boolean): void => {
        g.clear();
        g.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(x, y + 3, w, h - 3);
        g.fillStyle(down ? MENU_COLOR.wood : MENU_COLOR.woodRaised, 1).fillRect(x, y + (down ? 3 : 0), w, h - 3);
        g.lineStyle(1, MENU_COLOR.brassDark, 1).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        g.fillStyle(MENU_COLOR.brass, 1).fillRect(x, y + (down ? 3 : 0), w, 2);
        text.setY(y + h / 2 + (down ? 2 : 0));
      };
      const text = this.add.text(x + w / 2, y + h / 2, label, {
        fontFamily: MENU_FONT.control, fontSize: id === 'act' ? '20px' : '13px', fontStyle: 'bold', color: MENU_HEX.bone,
      }).setOrigin(0.5).setDepth(41);
      g.setDepth(40);
      draw(false);
      const zone = this.add.zone(x, y, w, h).setOrigin(0).setInteractive().setDepth(42);
      const release = (): void => {
        draw(false);
        if (id === 'act') owner.setTouchHold?.(false);
      };
      zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
        draw(true);
        owner.tap?.(id);
        if (id === 'act') owner.setTouchHold?.(true);
      });
      zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, release);
      zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, release);
    };
    button(right - size, bottom - size, size, size, 'ACT', 'act');
    const small = [['CAST', 'cast'], ['AMBUSH', 'strike'], ['SNEAK', 'sneak'], ['SEARCH', 'search'], ['REST', 'rest'], ['BAG', 'pack'], ['MENU', 'menu']];
    const w = 76;
    const h = 40;
    small.forEach(([label, id], index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      button(right - size - 12 - (2 - col) * (w + 8) + 8, bottom - (row + 1) * (h + 8) + 8, w, h, label, id);
    });
  }

  /** Which party member this player controls; its bars fill the frame. */
  setMember(member: MageClass | null): void {
    this.member = member;
  }

  /** On foot: a button at the top that heads straight back to the travel map, as M does. */
  setMapExit(on: boolean): void {
    this.mapExit?.destroy();
    this.mapExit = undefined;
    const owner = this.owner;
    if (!on || !owner?.tap) return;
    this.mapExit = new CabinetChip(this, GAME_WIDTH / 2 - 105, 14, {
      width: 210,
      height: 36,
      label: 'Travel Map   [M]',
      onActivate: () => {
        if (!this.modalOpen) owner.tap?.('map');
      },
    });
  }

  refresh(run: ExplorationRun, place: string, extra = ''): void {
    this.currentRun = run;
    this.currentPlace = place;
    this.currentExtra = extra;
    const leader = memberIn(run, this.member);
    this.title?.setText(place.toUpperCase());
    const note = extra.length > 50 ? `${extra.slice(0, 48).trimEnd()}...` : extra;
    if (this.line && this.line.text !== note) this.line.setText(note);
    this.wheel?.setTime(run.day, run.hour);
    const clock = (run.day - 1) * 24 + run.hour;
    if (this.clockKey >= 0 && Math.abs(clock - this.clockKey) > 1e-3) this.showClock();
    else if (this.clockKey < 0 && bloodmoonOmen(run.day).tonight) this.showClock();
    this.clockKey = clock;
    // The bloodmoon's own arrival replaces its day's card.
    const due = bloodmoonDue(run);
    const shown = this.shownDay || (lastDay?.seed === run.seed ? lastDay.day : 0);
    if (shown && run.day > shown && !due) {
      this.announceDay({ day: run.day, hour: run.hour, news: dayNews(run) });
    }
    this.warnBloodmoon(run, due);
    this.shownDay = run.day;
    lastDay = { seed: run.seed, day: run.day };
    const g = this.bars;
    if (g && leader) {
      this.vitals[0]?.set(leader.hp, leader.maxHp);
      this.minorBars[0]?.set(leader.mana, leader.maxMana);
      this.minorBars[1]?.set(leader.sanity, leader.maxSanity);
      this.drawVitals();
      this.barText?.setText(leader.alive ? `${leader.hp} / ${leader.maxHp}` : 'DOWN').setColor(leader.alive ? MENU_HEX.bone : '#e0806e');
      this.minorLabels[0]?.setText(`MANA  ${leader.mana}/${leader.maxMana}`);
      this.minorLabels[1]?.setText(`SANITY  ${leader.sanity}/${leader.maxSanity}`);
      const minor = `${leader.mageClass}:${leader.mana}/${leader.maxMana}:${leader.sanity}/${leader.maxSanity}`;
      if (this.minorKey && minor !== this.minorKey && minor.split(':')[0] === this.minorKey.split(':')[0]) this.flashMinor();
      this.minorKey = minor;
    }
    const party = partyOf(run);
    const others = party.length > 1 ? party.filter((mage) => mage.mageClass !== leader?.mageClass) : [];
    this.drawParty(run, others);
    const lines = run.bounties.map((b) => `${b.label}  ${bountyProgress(run, b)}/${b.count}`);
    const arms = armsLines(run);
    const site = run.area?.site;
    const goals = site
      ? [site.title.toUpperCase(), ...siteGoals(run, site).map((goal) => `${goal.label}${goal.optional ? '  (optional)' : ''}  ${goal.done ? '\u25A0' : '\u25A1'}`)]
      : [];
    const panel = [
      ...goals,
      ...(goals.length && arms.length ? [''] : []),
      ...arms,
      ...((goals.length || arms.length) && lines.length ? [''] : []),
      ...(lines.length ? ['BOUNTIES', ...lines] : []),
    ];
    const text = this.bountyText;
    const back = this.journalBack;
    if (text && back) {
      text.setText(panel.join('\n')).setVisible(panel.length > 0);
      back.clear();
      if (panel.length) drawPlate(back, GAME_WIDTH - 40 - Math.ceil(text.width), 14, Math.ceil(text.width) + 24, Math.ceil(text.height) + 22);
    }
  }

  private toggleCheatConsole(): void {
    if (this.cheatClose) {
      this.cheatClose();
      return;
    }
    if (this.modalOpen || !this.currentRun) return;

    void this.hold<void>((done) => {
      const run = this.currentRun;
      if (!run) {
        done();
        return;
      }
      const root = this.add.container(0, 0).setDepth(90);
      const close = (): void => {
        this.cheatEntry.finish(false);
        root.destroy(true);
        this.cheatClose = null;
        done();
      };
      this.cheatClose = close;

      const left = GAME_WIDTH / 2 - 220;
      const top = GAME_HEIGHT / 2 - 132;
      const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, MENU_COLOR.pitch, 0.76).setOrigin(0).setInteractive();
      const frame = this.add.graphics();
      drawPlate(frame, left, top, 440, 264);
      const title = this.add.text(GAME_WIDTH / 2, top + 26, 'ADVENTURE CHEATS', {
        fontFamily: MENU_FONT.display, fontSize: '22px', fontStyle: 'bold', color: MENU_HEX.brassLight,
      }).setOrigin(0.5);
      const subtitle = this.add.text(GAME_WIDTH / 2, top + 55, 'Select a value to edit', {
        fontFamily: MENU_FONT.control, fontSize: '13px', color: MENU_HEX.boneDim,
      }).setOrigin(0.5);
      root.add([dim, frame, title, subtitle]);

      const addField = (label: string, y: number, value: string, onEdit: (text: Phaser.GameObjects.Text) => void): void => {
        const labelText = this.add.text(left + 30, y + 13, label, {
          fontFamily: MENU_FONT.control, fontSize: '15px', fontStyle: 'bold', color: MENU_HEX.bone,
        }).setOrigin(0, 0.5);
        const field = this.add.graphics();
        field.fillStyle(MENU_COLOR.charcoal, 1).fillRect(left + 196, y, 210, 42);
        field.lineStyle(1, MENU_COLOR.brassDark, 1).strokeRect(left + 196.5, y + 0.5, 209, 41);
        const valueText = this.add.text(left + 301, y + 21, value, {
          fontFamily: MENU_FONT.control, fontSize: '16px', fontStyle: 'bold', color: MENU_HEX.brassLight,
        }).setOrigin(0.5);
        const zone = this.add.zone(left + 196, y, 210, 42).setOrigin(0).setInteractive();
        zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => onEdit(valueText));
        root.add([labelText, field, valueText, zone]);
      };

      addField('Day', top + 86, String(run.day), (text) => this.editCheatValue(run, 'day', text));
      addField('Gold', top + 142, run.gold.toFixed(1), (text) => this.editCheatValue(run, 'gold', text));

      const closeText = this.add.text(GAME_WIDTH / 2, top + 224, 'CLOSE  [F2]', {
        fontFamily: MENU_FONT.control, fontSize: '14px', fontStyle: 'bold', color: MENU_HEX.bone,
      }).setOrigin(0.5);
      const closeZone = this.add.zone(GAME_WIDTH / 2 - 70, top + 207, 140, 36).setInteractive();
      closeZone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, close);
      root.add([closeText, closeZone]);
    });
  }

  private editCheatValue(run: ExplorationRun, field: 'day' | 'gold', text: Phaser.GameObjects.Text): void {
    const original = field === 'day' ? String(run.day) : run.gold.toFixed(1);
    this.cheatEntry.begin({
      value: original,
      maxLength: field === 'day' ? 7 : 12,
      inputMode: 'numeric',
      ariaLabel: `Adventure ${field}`,
      onChange: (value) => text.setText(value || ' '),
      onDone: (committed) => {
        if (!committed) {
          text.setText(original);
          return;
        }
        const value = text.text.trim().replace(',', '.');
        const parsed = Number(value);
        const valid = field === 'day'
          ? /^\d+$/.test(value) && Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 1_000_000
          : /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(parsed) && parsed <= 1_000_000_000;
        if (!valid) {
          text.setText(original);
          this.toast(field === 'day' ? 'Day must be a whole number from 1 to 1,000,000.' : 'Gold must be between 0 and 1,000,000,000.');
          return;
        }
        if (field === 'day') {
          run.day = parsed;
          this.shownDay = parsed;
          lastDay = { seed: run.seed, day: parsed };
        } else {
          run.gold = money(Math.max(0, parsed));
        }
        saveRun(run);
        text.setText(field === 'day' ? String(run.day) : run.gold.toFixed(1));
        this.refresh(run, this.currentPlace, this.currentExtra);
      },
    });
  }

  /** The rest of the party: a name and a health bar each. */
  private drawParty(run: ExplorationRun, others: ReturnType<typeof partyOf>): void {
    const g = this.partyBack;
    if (!g) return;
    g.clear();
    while (this.partyRows.length > others.length) this.partyRows.pop()?.destroy();
    while (this.partyRows.length < others.length) {
      this.partyRows.push(this.add.text(24, 0, '', { fontFamily: MENU_FONT.control, fontSize: '12px', color: MENU_HEX.bone }));
    }
    if (!others.length) return;
    drawPlate(g, 12, 120, 310, 14 + others.length * 24);
    others.forEach((mage, index) => {
      const y = 130 + index * 24;
      const owed = levelsOwed(run, mage.mageClass) > 0 ? '  +LV' : '';
      const name = (mage.spellClass ? `${mage.name} (${MAGE_CLASS_DEFS[mage.spellClass].label})` : mage.name).slice(0, 22);
      this.partyRows[index].setPosition(24, y).setText(`${name}${owed}`).setColor(mage.alive ? MENU_HEX.bone : MENU_HEX.disabled);
      const x = 178;
      const w = 130;
      g.fillStyle(MENU_COLOR.ink, 1).fillRect(x, y + 4, w, 8);
      if (!mage.alive) {
        g.fillStyle(MENU_COLOR.blood, 0.6).fillRect(x, y + 4, w, 8);
        return;
      }
      const share = Math.max(0, Math.min(1, mage.maxHp > 0 ? mage.hp / mage.maxHp : 0));
      g.fillStyle(0xb8453c, 1).fillRect(x, y + 4, Math.round(w * share), 8);
      g.lineStyle(1, MENU_COLOR.brassDark, 1).strokeRect(x + 0.5, y + 4.5, w - 1, 7);
    });
  }

  setHint(text: string): void {
    this.hint = text;
    this.applyLegend();
  }

  /** On the bloodmoon's day its countdown comes back at noon, at dusk and two hours before midnight. */
  private warnBloodmoon(run: ExplorationRun, due: boolean): void {
    const seen = this.omenSeen;
    this.omenSeen = { day: run.day, hour: run.hour };
    if (!seen || seen.day !== run.day || due || !bloodmoonOmen(run.day).tonight) return;
    const crossed = FINAL_HOURS.filter((hour) => seen.hour < hour && run.hour >= hour);
    if (!crossed.length) return;
    this.announceDay({ day: run.day, hour: run.hour, news: [], countdown: true });
    this.showClock();
  }

  /** The bloodmoon rises over whatever is on screen; resolves on black. */
  bloodmoonRise(): Promise<void> {
    this.prompt?.set(null, false);
    const rise = playBloodmoonRise(this, isReducedMotion());
    AdventureSession.current?.showing(rise);
    return rise;
  }

  /** The words the leader can speak here, with their charges; null hides the bar. */
  setWordBar(text: string | null): void {
    if (!this.wordBar) return;
    if (!text) {
      this.wordBar.setVisible(false);
      return;
    }
    if (this.wordBar.text !== text) this.wordBar.setText(text);
    this.wordBar.setVisible(true);
  }

  /** Show, replace or (with null) remove the overworld panel. */
  setWorldPanel(model: WorldPanel | null): void {
    this.worldPanel?.destroy();
    this.worldPanel = undefined;
    this.worldModel = model;
    this.worldFocus = new MenuFocusGroup();
    if (!model) {
      this.placeWorldToggle(null);
      return;
    }
    this.setWorldBoard(null);
    if (worldHidden) {
      this.placeWorldToggle(null);
      return;
    }
    const width = 400;
    const chipH = 32;
    const gap = 6;
    const lineH = 17;
    const title = this.add.text(0, 0, model.title, {
      fontFamily: MENU_FONT.display,
      fontSize: '20px',
      fontStyle: 'bold',
      color: model.titleColor ?? MENU_HEX.brassLight,
      wordWrap: { width: width - 28 },
    });
    const titleH = Math.max(24, Math.ceil(title.height));
    const head = 12 + titleH + 6;
    const height = head + model.lines.length * lineH + 6 + model.actions.length * (chipH + gap) + 8;
    const left = GAME_WIDTH - width - 16;
    const top = GAME_HEIGHT - 44 - height;
    const root = this.add.container(0, 0).setDepth(10);
    const back = this.add.graphics();
    drawPlate(back, left, top, width, height);
    root.add(back);
    // Clicks on the panel stay on the panel instead of planning a trip underneath.
    root.add(this.add.zone(left, top, width, height).setOrigin(0).setInteractive());
    root.add(title.setPosition(left + 14, top + 12));
    model.lines.forEach((line, index) => {
      root.add(this.add.text(left + 14, top + head + index * lineH, line, {
        fontFamily: MENU_FONT.control,
        fontSize: '12px',
        color: MENU_HEX.bone,
        fixedWidth: width - 28,
      }));
    });
    const chipsTop = top + head + model.lines.length * lineH + 6;
    // The first chip takes focus as it is built: that is not the player looking at it.
    let building = true;
    model.actions.forEach((action, index) => {
      const chip = new CabinetChip(this, left + 12, chipsTop + index * (chipH + gap), {
        width: width - 24,
        height: chipH,
        label: `${index + 1}   ${action.label}`,
        tone: action.tone ?? 'normal',
        enabled: action.enabled,
        onActivate: () => {
          if (!this.modalOpen) model.onAction(action.id);
        },
        onFocus: () => {
          if (!building) model.onHover?.(action.id);
        },
      });
      root.add(chip);
      this.worldFocus.add(chip);
    });
    building = false;
    this.worldPanel = root;
    this.placeWorldToggle(top);
  }

  /** The chip that folds the travel menu away or brings it back; `top` is the open menu's upper edge. */
  private placeWorldToggle(top: number | null): void {
    const shown = !!(this.worldModel || this.boardModel);
    const width = 150;
    const height = 26;
    const y = worldHidden || top === null ? GAME_HEIGHT - 44 - height : top - height - 4;
    const label = worldHidden ? 'Show menu   [Tab]' : 'Hide menu   [Tab]';
    const key = shown ? `${label}@${y}` : '';
    // Rebuilt only when it moves, so a press is not lost to a refresh.
    if (key === this.worldToggleKey && (!!this.worldToggle === shown)) return;
    this.worldToggleKey = key;
    this.worldToggle?.destroy();
    this.worldToggle = undefined;
    if (!shown) return;
    this.worldToggle = new CabinetChip(this, GAME_WIDTH - width - 16, y, {
      width,
      height,
      label,
      tone: worldHidden ? 'primary' : 'normal',
      onActivate: () => {
        if (!this.modalOpen) this.toggleWorldMenu();
      },
    }).setDepth(10);
  }

  private toggleWorldMenu(): void {
    worldHidden = !worldHidden;
    playSound(worldHidden ? 'ui.close' : 'ui.open');
    if (this.boardModel) this.setWorldBoard(this.boardModel, this.boardHooks ?? undefined);
    else if (this.worldModel) this.setWorldPanel(this.worldModel);
  }

  private worldAction(index: number): void {
    if (this.worldBoard) {
      this.worldBoard.pickIndex(index);
      return;
    }
    const action = this.worldModel?.actions[index];
    if (!action?.enabled) return;
    playSound('ui.click');
    this.worldModel?.onAction(action.id);
  }

  setPrompt(text: string | null): void {
    this.prompt?.set(text, !this.modalOpen);
  }

  /** How far a held action has filled, 0..1; null when nothing is held. */
  setHoldProgress(t: number | null): void {
    this.prompt?.setHold(t);
  }

  toast(message: string, ms = 3200): void {
    if (message) this.toasts?.push(message, ms);
  }

  private hold<T>(open: (done: (value: T) => void) => void, animate = true): Promise<T> {
    this.modal += 1;
    this.prompt?.setVisible(false);
    // A day's card on screen plays out before a window (a level-up, a shop) covers it.
    const card = this.cardPlaying ?? Promise.resolve();
    return new Promise<T>((resolve) => {
      void card.then(() => {
        playSound('ui.open');
        // Built next tick, so the key press that opened a window cannot also act inside it.
        this.time.delayedCall(0, () => {
          const before = new Set(this.children.list);
          open((value) => {
            this.release();
            playSound('ui.close');
            resolve(value);
          });
          if (animate && !isReducedMotion()) this.enter(this.children.list.filter((child) => !before.has(child)));
        });
      });
    });
  }

  /** A window (or the night) is over: once nothing is left open, the day's card that waited plays. */
  private release(): void {
    this.modal = Math.max(0, this.modal - 1);
    if (!this.modalOpen && this.pendingCard) {
      const card = this.pendingCard;
      this.pendingCard = null;
      this.announceDay(card);
    }
  }

  /**
   * The party sleeps: the night plays over everything, and the day's card and the
   * world wait until it is over. `black` runs once the screen has gone dark,
   * `dark` once it is dark again after waking, before it fades back in.
   */
  async sleep(nap: RestNap, at: { black?: () => void; dark?: () => void } = {}): Promise<void> {
    this.modal += 1;
    this.prompt?.set(null, false);
    const film = playRestCinematic(this, nap, isReducedMotion());
    AdventureSession.current?.showing(film.done);
    await film.black;
    at.black?.();
    await film.dark;
    at.dark?.();
    await film.done;
    this.release();
  }

  /** A window just built settles in: it fades up and its panels rise into place. */
  private enter(objects: Phaser.GameObjects.GameObject[]): void {
    for (const object of objects) {
      const item = object as Phaser.GameObjects.GameObject & Partial<Phaser.GameObjects.Components.Alpha>;
      if (typeof item.alpha !== 'number' || !item.setAlpha || item.alpha === 0) continue;
      const alpha = item.alpha;
      item.setAlpha(0);
      this.tweens.add({ targets: item, alpha, duration: MENU_MOTION.base, ease: MENU_MOTION.ease });
      if (object instanceof Phaser.GameObjects.Container) {
        const y = object.y;
        object.y = y + 14;
        this.tweens.add({ targets: object, y, duration: MENU_MOTION.base, ease: 'Cubic.Out' });
      }
    }
  }

  /** The day has turned: play its card, or keep it until the open window closes. */
  private announceDay(card: DayCard): void {
    if (this.modalOpen) {
      this.pendingCard = card;
      return;
    }
    const playing = playDayCard(this, card).then(() => {
      if (this.cardPlaying === playing) this.cardPlaying = null;
    });
    this.cardPlaying = playing;
    AdventureSession.current?.showing(playing);
  }

  /** Resolves once no day card is on screen. */
  dayShown(): Promise<void> {
    return this.cardPlaying ?? Promise.resolve();
  }

  /** Offer something spotted off the way. True when the party goes to it. */
  sighting(model: SightingCardModel): Promise<boolean> {
    return this.hold<boolean>((done) => {
      this.worldPanel?.setVisible(false);
      new SightingCard(this, model, (go) => {
        this.worldPanel?.setVisible(true);
        done(go);
      });
    }, false);
  }

  /** A shop's counter. A night at its inn plays out over everything and takes the window with it; `rested` hears of it first. */
  openShop(run: ExplorationRun, shopId: string, townId: string, changed: () => void, actions: ExplorationActions, rested?: (nap: RestNap) => void, inn?: InnHooks, shortRest?: () => string | null): Promise<void> {
    const shop = shopById(shopId);
    if (!shop) return Promise.resolve();
    return this.hold<void>((done) => {
      let closed = false;
      const close = (): void => {
        if (closed) return;
        closed = true;
        if (this.window === view) {
          this.window = null;
          this.windowClose = null;
        }
        view.destroy();
        done();
      };
      const view: ShopView = new ShopView(this, run, shop, {
        townId,
        portrait: `keeper:${shop.keeper}`,
        changed,
        actions,
        inn,
        shortRest,
        slept: (nap) => {
          rested?.(nap);
          void this.sleep(nap, { black: changed, dark: close });
        },
        close,
      });
      this.window = view;
      this.windowClose = close;
    });
  }

  openPack(run: ExplorationRun, changed: () => void, actions: ExplorationActions, pendingFind?: ItemId): Promise<void> {
    return this.hold<void>((done) => {
      const view: PackView = new PackView(this, run, {
        changed,
        actions,
        close: () => {
          if (this.window === view) {
            this.window = null;
            this.windowClose = null;
          }
          view.destroy();
          done();
        },
      }, pendingFind);
      this.window = view;
      this.windowClose = () => {
        if (this.window !== view) return;
        this.window = null;
        this.windowClose = null;
        view.destroy();
        done();
      };
    });
  }

  /** Shut the shop or pack on screen, if any (the party is going to sleep). */
  closeWindow(): void {
    this.windowClose?.();
  }

  /** Redraw an open shop or pack after the run changed under it. */
  refreshWindow(): void {
    this.window?.refresh();
    this.armory?.refresh();
  }

  /** Online: the party's travel plans beside the map, repainted in place; null removes them. */
  setWorldBoard(model: VoteBoardModel | null, hooks?: VoteBoardHooks): void {
    if (!model) {
      this.worldBoard?.destroy();
      this.worldBoard = null;
      this.boardHooks = null;
      this.boardModel = null;
      if (!this.worldModel) this.placeWorldToggle(null);
      return;
    }
    if (this.worldModel) this.setWorldPanel(null);
    this.boardHooks = hooks ?? null;
    this.boardModel = model;
    if (worldHidden) {
      this.worldBoard?.destroy();
      this.worldBoard = null;
      this.placeWorldToggle(null);
      return;
    }
    this.worldBoard ??= new VoteBoard(this, false, {
      pick: (id) => {
        if (!this.modalOpen) this.boardHooks?.pick(id);
      },
      look: (id) => this.boardHooks?.look?.(id),
    });
    this.worldBoard.show(model);
    this.placeWorldToggle(this.worldBoard.frameTop);
  }

  /** Online: a choice the whole party votes on, over everything, kept up to date; null takes it away. */
  showPoll(model: VoteBoardModel | null, hooks?: VoteBoardHooks): void {
    if (!model) {
      if (!this.pollBoard) return;
      this.pollBoard.destroy();
      this.pollBoard = null;
      this.pollHooks = null;
      playSound('ui.close');
      this.release();
      return;
    }
    this.pollHooks = hooks ?? null;
    if (!this.pollBoard) {
      this.modal += 1;
      this.prompt?.setVisible(false);
      playSound('ui.open');
      this.pollBoard = new VoteBoard(this, true, {
        pick: (id) => this.pollHooks?.pick(id),
        look: (id) => this.pollHooks?.look?.(id),
      });
    }
    this.pollBoard.show(model);
  }

  /** The voice in your head asks for two words and a way of doing things. */
  awaken(model: AwakeningModel): Promise<CreationPick> {
    return this.hold<CreationPick>((done) => {
      void playAwakening(this, model).then(done);
    }, false);
  }

  /** The Lodge's pedestals of starter weapons; resolves once the player walks off. */
  openArmory(hooks: ArmoryHooks): Promise<void> {
    return this.hold<void>((done) => {
      const hall: ArmoryHall = new ArmoryHall(this, hooks, () => {
        if (this.armory === hall) this.armory = null;
        done();
      });
      this.armory = hall;
    }, false);
  }

  /** The search window: pick a target, roll for it. Null when the player backs out. */
  search(model: SearchViewModel, roll: SearchViewHooks['roll']): Promise<SearchViewResult | null> {
    return this.hold<SearchViewResult | null>((done) => {
      this.worldPanel?.setVisible(false);
      const view: SearchView = new SearchView(this, model, {
        roll,
        close: (result) => {
          view.destroy();
          this.worldPanel?.setVisible(true);
          done(result);
        },
      });
    });
  }

  levelUps(run: ExplorationRun, actions: ExplorationActions): Promise<boolean> {
    const owed = actions.member ? levelsOwed(run, actions.member) : run.pendingLevels;
    if (owed <= 0) return Promise.resolve(false);
    return this.hold<boolean>((done) => {
      void resolvePendingLevels(this, run, actions).then(done);
    });
  }

  choose<T extends string>(title: string, subtitle: string, options: { id: T; label: string; detail: string; enabled?: boolean }[], cancel?: T): Promise<T> {
    return this.hold<T>((done) => {
      const view: ChoiceMenuView<T> = new ChoiceMenuView<T>(this, title, subtitle, options, (id) => {
        view.destroy();
        done(id);
      }, cancel ? () => {
        view.destroy();
        done(cancel);
      } : undefined);
    });
  }

  openTrade(session: AdventureSession, run: ExplorationRun, place: string): Promise<void> {
    return this.hold<void>((done) => {
      const view: TradeView = new TradeView(this, session, run, place, () => {
        view.destroy();
        done();
      });
    });
  }
}
