import Phaser from 'phaser';
import {
  isPveRunMode,
  usesSwampPrep,
  type ItemSetSelection,
  type MatchConfig,
  type MatchMode,
  type MenuCategory,
  type SessionRole,
  type SwampPrepMode,
} from '../../config/MatchConfig';
import { MAGE_CLASSES, MAGE_CLASS_DEFS, type MageClass } from '../../core/Classes';
import type { Scenario } from '../../core/Scenario';
import { MODIFIER_WORDS, WORDS, type WordId } from '../../core/Words';
import { SceneInput } from '../../engine/SceneInput';
import { RAID_BOSS_KINDS, type RaidBossKind } from '../../pve/swamprun';
import { pickScenarioFile } from '../scenarioFile';
import { MenuModel } from './MenuModel';
import { addMenuMageStage, type MenuMageStage } from './art';
import { CabinetButton, CabinetChip, MenuFocusGroup, WordPlate } from '../cabinet/controls';
import { CATEGORY_COPY, MODE_COPY, PREP_COPY, RAID_BOSS_COPY, type MenuEntryCopy } from './content';
import { MenuNavigator, type MenuRoute, type MenuScreenView } from './MenuFlow';
import {
  OnlineCoordinator,
  defaultRelayUrl,
  type OnlineStatus,
} from './OnlineCoordinator';
import { TextEntry } from '../cabinet/TextEntry';
import {
  MENU_COLOR,
  MENU_FONT,
  MENU_HEX,
  addCabinetBackdrop,
  addSectionRule,
} from '../cabinet/theme';

const CATEGORY_MODES: Record<MenuCategory, readonly MatchMode[]> = {
  versus: ['ai', 'hotseat', 'online'],
  adventures: ['swamprun', 'expedition', 'minerun', 'raid'],
  workshop: ['training', 'scenario', 'memory'],
};

const CATEGORY_LABELS: Record<MenuCategory, string> = {
  versus: 'Versus',
  adventures: 'Adventures',
  workshop: 'Workshop',
};

const NATIVE_MODES = new Set<MatchMode>([
  'ai',
  'hotseat',
  'online',
  'training',
  'swamprun',
  'expedition',
  'minerun',
  'raid',
  'scenario',
  'memory',
]);

const PACK_COPY: Record<keyof ItemSetSelection, MenuEntryCopy> = {
  original: {
    label: 'Original Dimir',
    detail: 'Core items and spells',
    title: 'ORIGINAL DIMIR',
    description: 'The base item and spell set. At least 1 pack must stay enabled.',
  },
  finns: {
    label: "Finn's Additions",
    detail: 'Extra items and spells',
    title: "FINN'S ADDITIONS",
    description: 'Adds custom items and spells to drafts, shops and the spell grid.',
  },
  dlc: {
    label: 'Dimir Faithful DLC',
    detail: 'Optional items and spells',
    title: 'DIMIR FAITHFUL DLC',
    description: 'Adds the optional catalogue to drafts, shops and the spell grid.',
  },
};

export class MenuExperience {
  readonly root: Phaser.GameObjects.Container;

  private readonly input: SceneInput;
  private readonly navigator: MenuNavigator;
  private readonly breadcrumb: Phaser.GameObjects.Text;
  private readonly chapter: Phaser.GameObjects.Text;
  private readonly stage: MenuMageStage;
  private activeRoute: MenuRoute = { id: 'main' };
  private memoryScenario: Scenario | null = null;
  private memoryState: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  private memoryMessage = '';
  private memoryRequest = 0;
  private readonly textEntry = new TextEntry();
  private onlineCoordinator: OnlineCoordinator | null = null;
  private lobbyRoom = '';
  private lobbyUrl = defaultRelayUrl();
  private lobbyAdvanced = false;
  private lobbyBusy = false;
  private lobbyStatus: OnlineStatus | null = null;
  private lobbyAttempt = 0;
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly model: MenuModel,
    private readonly launchConfigured: () => void,
    private readonly launchMemory: (scenario: Scenario) => void,
    private readonly launchOnline: (config: MatchConfig) => void
  ) {
    this.root = scene.add.container(0, 0).setDepth(1000);
    addCabinetBackdrop(scene, this.root);

    const brand = scene.add.text(76, 52, 'DIMIR', {
      fontFamily: MENU_FONT.display,
      fontSize: '40px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    });
    const subtitle = scene.add.text(79, 97, 'TACTICAL MAGE COMBAT', {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      fontStyle: 'bold',
      color: MENU_HEX.brass,
    });
    this.breadcrumb = scene.add.text(76, 132, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '14px',
      color: MENU_HEX.boneDim,
    });
    this.chapter = scene.add.text(790, 70, 'I', {
      fontFamily: MENU_FONT.display,
      fontSize: '28px',
      color: MENU_HEX.brassLight,
    }).setOrigin(1, 0);
    this.root.add([brand, subtitle, this.breadcrumb, this.chapter]);
    addSectionRule(scene, this.root, 76, 119, 714);

    this.stage = addMenuMageStage(scene, this.root);
    const layer = scene.add.container(0, 0);
    this.root.add(layer);
    this.navigator = new MenuNavigator(
      scene,
      layer,
      (route) => this.buildScreen(route),
      (route, history) => this.updateRouteChrome(route, history)
    );

    this.input = new SceneInput(scene);
    this.input.bindKeys([
      { key: 'UP', capture: true, run: () => this.navigator.moveFocus(-1) },
      { key: 'W', run: () => this.navigator.moveFocus(-1) },
      { key: 'DOWN', capture: true, run: () => this.navigator.moveFocus(1) },
      { key: 'S', run: () => this.navigator.moveFocus(1) },
      { key: 'LEFT', capture: true, run: () => this.navigator.adjust(-1) },
      { key: 'A', run: () => this.navigator.adjust(-1) },
      { key: 'RIGHT', capture: true, run: () => this.navigator.adjust(1) },
      { key: 'D', run: () => this.navigator.adjust(1) },
      { key: 'TAB', capture: true, run: (event) => this.navigator.moveFocus(event.shiftKey ? -1 : 1) },
      { key: 'ENTER', capture: true, run: () => this.navigator.activate() },
      { key: 'SPACE', capture: true, run: () => this.navigator.activate() },
      { key: 'ESC', run: () => {
        if (this.activeRoute.id === 'online-lobby' && this.lobbyBusy) this.cancelLobby(true);
        else this.navigator.back();
      } },
    ]);
    this.input.bindAnyKey((event) => {
      if (this.activeRoute.id !== 'mage-build') return;
      if (this.model.feedSecretKey(event.key, this.activeRoute.seat)) this.navigator.refresh();
    });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.navigator.start({ id: 'main' });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.input.destroy();
    this.memoryRequest += 1;
    this.lobbyAttempt += 1;
    this.onlineCoordinator?.cancel();
    this.onlineCoordinator = null;
    this.textEntry.destroy();
    this.navigator.destroy();
    this.root.destroy(true);
  }

  private buildScreen(route: MenuRoute): MenuScreenView {
    switch (route.id) {
      case 'main': return this.buildMain();
      case 'category': return this.buildCategory(route.category);
      case 'mode-intro': return this.buildModeIntro();
      case 'session-role': return this.buildSessionRole();
      case 'roster': return this.buildRoster(route.returnToReview ?? false);
      case 'preparation': return this.buildPreparation(route.returnToReview ?? false);
      case 'content-packs': return this.buildContentPacks(route.returnToReview ?? false);
      case 'player-handoff': return this.buildPlayerHandoff(route.seat);
      case 'mage-build': return this.buildMageBuild(route.seat, route.returnToReview ?? false);
      case 'review': return this.buildReview();
      case 'raid-target': return this.buildRaidTarget(route.returnToReview ?? false);
      case 'team-layout': return this.buildTeamLayout(route.returnToReview ?? false);
      case 'memory-file': return this.buildMemoryFile();
      case 'online-lobby': return this.buildOnlineLobby();
    }
  }

  private buildMain(): MenuScreenView {
    const view = this.createScreen(
      'CHOOSE A TABLE',
      'Pick a game type. Rules and builds are configured next.'
    );
    (Object.keys(CATEGORY_COPY) as MenuCategory[]).forEach((category, index) => {
      const copy = CATEGORY_COPY[category];
      view.focus.add(this.choice(view.root, 76, 246 + index * 88, copy, String(index + 1), () => {
        this.navigator.push({ id: 'category', category });
      }));
    });
    return view;
  }

  private buildCategory(category: MenuCategory): MenuScreenView {
    const copy = CATEGORY_COPY[category];
    const view = this.createScreen(copy.label.toUpperCase(), copy.description);
    CATEGORY_MODES[category].forEach((mode, index) => {
      const modeCopy = MODE_COPY[mode];
      view.focus.add(this.choice(view.root, 76, 226 + index * 78, modeCopy, String(index + 1), () => {
        this.model.setMode(mode);
        if (mode === 'memory') this.navigator.push({ id: 'memory-file' });
        else if (NATIVE_MODES.has(mode)) this.navigator.push({ id: 'mode-intro' });
      }, 70));
    });
    this.addBack(view, category === 'adventures' ? 574 : 520);
    return view;
  }

  private buildModeIntro(): MenuScreenView {
    const copy = MODE_COPY[this.model.mode];
    const view = this.createScreen(copy.title, copy.description);
    const capability = this.model.capability;
    const facts = [
      capability.seats[0] === capability.seats[1]
        ? `${capability.seats[0]} ${capability.seats[0] === 1 ? 'seat' : 'seats'}`
        : `${capability.seats[0]}-${capability.seats[1]} seats`,
      `${capability.loadoutSize} words`,
      capability.allowAi ? 'AI supported' : 'No AI seats',
    ];
    const plaque = this.scene.add.text(76, 282, facts.join('  /  ').toUpperCase(), {
      fontFamily: MENU_FONT.control,
      fontSize: '14px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
      backgroundColor: '#17110d',
      fixedWidth: 714,
      align: 'center',
      padding: { y: 14 },
    });
    const proceed = new CabinetButton(this.scene, 76, 392, {
      width: 714,
      height: 64,
      label: 'Configure This Mode',
      index: '>',
      primary: true,
      onActivate: () => this.advanceFromIntro(),
      onFocus: () => this.stage.setCaption(copy.title, 'Continue to setup.'),
    });
    view.root.add([plaque, proceed]);
    view.focus.add(proceed);
    this.addBack(view, 574);
    return view;
  }

  private buildSessionRole(): MenuScreenView {
    const copy = MODE_COPY[this.model.mode];
    const view = this.createScreen(`ENTER ${copy.label.toUpperCase()}`, copy.description);
    const roles = this.model.capability.roles.map((role): { role: SessionRole; copy: MenuEntryCopy } => {
      if (role === 'local') {
        return {
          role,
          copy: {
            label: 'Local Run', detail: 'One device, optional AI allies', title: 'LOCAL RUN',
            description: 'Build every human mage on this device. Remaining seats are filled with AI.',
          },
        };
      }
      const versus = this.model.mode === 'online';
      return role === 'host'
        ? {
          role,
          copy: {
            label: versus ? 'Host Match' : 'Host Co-op',
            detail: 'Create a room and set the rules',
            title: versus ? 'HOST ONLINE MATCH' : 'HOST CO-OP',
            description: 'Set the table, packs and AI fill, then wait for other players to join.',
          },
        }
        : {
          role,
          copy: {
            label: versus ? 'Join Match' : 'Join Co-op',
            detail: 'Bring 1 mage into a hosted match',
            title: versus ? 'JOIN ONLINE MATCH' : 'JOIN CO-OP',
            description: 'Build your mage and join by room code. Rules come from the host.',
          },
        };
    });
    roles.forEach(({ role, copy: roleCopy }, index) => {
      view.focus.add(this.choice(view.root, 76, 246 + index * 88, roleCopy, String(index + 1), () => {
        this.model.setRole(role);
        this.lobbyRoom = '';
        this.lobbyStatus = null;
        if (role === 'local') this.model.setSeatCount(1);
        if (role === 'host' && this.model.seatCount < 2) this.model.setSeatCount(2);
        if (role === 'guest') this.navigator.push({ id: 'mage-build', seat: 0 });
        else this.navigator.push({ id: 'roster' });
      }));
    });
    this.addBack(view, 574);
    return view;
  }

  private buildRaidTarget(returnToReview: boolean): MenuScreenView {
    const view = this.createScreen(
      'SELECT RAID TARGET',
      'The party gets a preparation phase before this boss is summoned.'
    );
    const buttons = new Map<RaidBossKind, CabinetButton>();
    RAID_BOSS_KINDS.forEach((boss, index) => {
      const copy = RAID_BOSS_COPY[boss];
      const button = this.choice(view.root, 76, 238 + index * 82, copy, String(index + 1), () => {
        this.model.setRaidBoss(boss);
        refresh();
        this.stage.setCaption(copy.title, copy.description);
      }, 72, this.model.raidBoss === boss);
      buttons.set(boss, button);
      view.focus.add(button);
    });
    const proceed = new CabinetButton(this.scene, 76, 500, {
      width: 714,
      height: 60,
      label: returnToReview ? 'Return to Review' : 'Choose Session',
      index: '>',
      primary: true,
      onActivate: () => this.navigator.push(returnToReview ? { id: 'review' } : { id: 'session-role' }),
      onFocus: () => this.stage.setCaption(
        RAID_BOSS_COPY[this.model.raidBoss].title,
        RAID_BOSS_COPY[this.model.raidBoss].description
      ),
    });
    view.root.add(proceed);
    view.focus.add(proceed);
    this.addBack(view, 584);
    const refresh = (): void => {
      for (const [boss, button] of buttons) button.setSelected(this.model.raidBoss === boss);
    };
    refresh();
    return view;
  }

  private buildRoster(returnToReview: boolean): MenuScreenView {
    const pve = isPveRunMode(this.model.mode);
    const aiLabel = pve
      ? 'AI Allies'
      : this.model.mode === 'ai'
        ? 'AI Opponents'
        : 'AI Seats';
    const view = this.createScreen(
      pve ? 'ASSEMBLE THE PARTY' : 'SET THE TABLE',
      this.model.role === 'host'
        ? 'Requires 2+ human players. AI fills the remaining seats.'
        : this.model.mode === 'ai'
          ? 'Set the number of combatants and whether they fight in teams or free-for-all.'
          : pve
            ? 'Set the party size, then how many seats are AI.'
            : 'Set the table size, then how many seats are AI.'
    );

    const explorers = new CabinetButton(this.scene, 76, 262, {
      width: 714,
      label: `${pve ? 'Explorers' : 'Combatants'}  ${this.model.seatCount}`,
      detail: `Total seats, ${this.model.capability.seats[0]} to ${this.model.capability.seats[1]}`,
      index: 'I',
      onActivate: () => updateExplorers(1),
      onAdjust: (direction) => updateExplorers(direction),
      onFocus: () => this.stage.setCaption(pve ? 'PARTY SIZE' : 'TABLE SIZE', this.rosterSummary()),
    });
    const allies = new CabinetButton(this.scene, 76, 354, {
      width: 714,
      label: `${aiLabel}  ${this.model.aiCount}`,
      detail: this.model.mode === 'ai'
        ? 'Seat 1 is always yours'
        : 'Human seats always come first',
      index: 'II',
      onActivate: () => updateAllies(1),
      onAdjust: (direction) => updateAllies(direction),
      onFocus: () => this.stage.setCaption('AI SEATS', this.rosterSummary()),
    });
    const proceed = new CabinetButton(this.scene, 76, 478, {
      width: 714,
      height: 64,
      label: returnToReview
        ? 'Return to Review'
        : this.shouldChooseTeams()
          ? 'Assign Teams'
          : usesSwampPrep(this.model.mode)
            ? 'Choose Preparation'
            : 'Choose Content Packs',
      index: '>',
      primary: true,
      onActivate: () => {
        if (returnToReview) this.navigator.push({ id: 'review' });
        else if (this.shouldChooseTeams()) this.navigator.push({ id: 'team-layout' });
        else if (usesSwampPrep(this.model.mode)) this.navigator.push({ id: 'preparation' });
        else this.navigator.push({ id: 'content-packs' });
      },
      onFocus: () => this.stage.setCaption('ROSTER READY', this.rosterSummary()),
    });

    const showAiAdjust = this.model.capability.allowAi && this.model.mode !== 'ai';
    const showFormat = !pve && this.model.capability.formats.length > 1;
    let format: CabinetButton | null = null;

    const refresh = (): void => {
      explorers.setCopy(`${pve ? 'Explorers' : 'Combatants'}  ${this.model.seatCount}`);
      if (showAiAdjust) {
        allies.setCopy(`${aiLabel}  ${this.model.aiCount}`);
      }
      format?.setCopy(`Formation: ${this.model.formatLabel()}`);
      const valid = this.model.role !== 'host' || this.model.humanCount() >= 2;
      proceed.setEnabled(valid);
      proceed.setCopy(valid
        ? returnToReview
          ? 'Return to Review'
          : this.shouldChooseTeams()
            ? 'Assign Teams'
            : usesSwampPrep(this.model.mode)
              ? 'Choose Preparation'
              : 'Choose Content Packs'
        : 'Two Humans Required');
    };
    const updateExplorers = (direction: -1 | 1): void => {
      const [minimum, maximum] = this.model.capability.seats;
      const next = this.model.seatCount + direction;
      this.model.setSeatCount(next > maximum ? minimum : next < minimum ? maximum : next);
      refresh();
      this.stage.setCaption(pve ? 'PARTY SIZE' : 'TABLE SIZE', this.rosterSummary());
    };
    const updateAllies = (direction: -1 | 1): void => {
      const maximum = Math.max(0, this.model.seatCount - 1);
      const next = this.model.aiCount + direction;
      this.model.setAiCount(next > maximum ? 0 : next < 0 ? maximum : next);
      refresh();
      this.stage.setCaption('AI SEATS', this.rosterSummary());
    };
    const updateFormat = (direction: -1 | 1): void => {
      const formats = this.model.capability.formats;
      if (formats.length < 2) return;
      const current = formats.indexOf(this.model.teamFormat);
      const next = (current + direction + formats.length) % formats.length;
      this.model.setTeamFormat(formats[next]);
      refresh();
      this.stage.setCaption('FORMATION', this.rosterSummary());
    };

    view.root.add(explorers);
    view.focus.add(explorers);
    if (showAiAdjust) {
      view.root.add(allies);
      view.focus.add(allies);
    } else {
      allies.destroy(true);
    }
    if (showFormat) {
      format = new CabinetButton(this.scene, 76, showAiAdjust ? 446 : 354, {
        width: 714,
        label: `Formation: ${this.model.formatLabel()}`,
        detail: this.model.teamFormat === 'teams' ? 'Combatants share two sides' : 'Every combatant has their own side',
        index: 'III',
        onActivate: () => updateFormat(1),
        onAdjust: (direction) => updateFormat(direction),
        onFocus: () => this.stage.setCaption('FORMATION', this.rosterSummary()),
      });
      view.root.add(format);
      view.focus.add(format);
    }
    proceed.setY(showFormat ? (showAiAdjust ? 538 : 446) : showAiAdjust ? 446 : 354);
    view.root.add(proceed);
    view.focus.add(proceed);
    this.addBack(view, 626);
    refresh();
    return view;
  }

  private buildTeamLayout(returnToReview: boolean): MenuScreenView {
    const view = this.createScreen(
      'ASSIGN TEAMS',
      'Put every seat on 1 of 2 sides. Neither side may be empty.'
    );
    for (let seat = 0; seat < this.model.seatCount; seat++) {
      const human = seat < this.model.humanCount();
      const label = human ? `Player ${seat + 1}` : `AI ${seat + 1}`;
      const button = new CabinetButton(this.scene, 76, 236 + seat * 70, {
        width: 714,
        height: 60,
        label: `${label}  /  Team ${this.model.teamOf(seat)}`,
        index: String(seat + 1),
        selected: this.model.teamOf(seat) === 1,
        onActivate: () => {
          const next = this.model.teamOf(seat) === 1 ? 2 : 1;
          if (this.model.setSeatTeam(seat, next)) this.navigator.refresh();
          else this.stage.setCaption('BOTH SIDES REQUIRED', 'Move another seat first.');
        },
        onFocus: () => this.stage.setCaption(label, `Team ${this.model.teamOf(seat)}.`),
      });
      view.root.add(button);
      view.focus.add(button);
    }
    const proceedY = 246 + this.model.seatCount * 70;
    const proceed = new CabinetButton(this.scene, 438, proceedY, {
      width: 352,
      height: 54,
      label: returnToReview ? 'Return to Review' : 'Choose Content Packs',
      index: '>',
      primary: true,
      onActivate: () => this.navigator.push(returnToReview ? { id: 'review' } : { id: 'content-packs' }),
      onFocus: () => this.stage.setCaption('TEAMS READY', this.teamSummary()),
    });
    view.root.add(proceed);
    view.focus.add(proceed);
    this.addBack(view, proceedY + 8);
    return view;
  }

  private buildPreparation(returnToReview: boolean): MenuScreenView {
    const view = this.createScreen(
      'CHOOSE PREPARATION',
      'Sets how the party is equipped before the run starts.'
    );
    const buttons: Partial<Record<SwampPrepMode, CabinetButton>> = {};
    (Object.keys(PREP_COPY) as SwampPrepMode[]).forEach((prep, index) => {
      const copy = PREP_COPY[prep];
      const button = this.choice(view.root, 76, 230 + index * 80, copy, String(index + 1), () => {
        this.model.setPrepMode(prep);
        for (const [key, control] of Object.entries(buttons)) control?.setSelected(key === prep);
        this.stage.setCaption(copy.title, copy.description);
      }, 72, this.model.prepMode === prep);
      buttons[prep] = button;
      view.focus.add(button);
    });
    const proceed = new CabinetButton(this.scene, 76, 492, {
      width: 714,
      height: 64,
      label: returnToReview ? 'Return to Review' : 'Choose Content Packs',
      index: '>',
      primary: true,
      onActivate: () => this.navigator.push(returnToReview ? { id: 'review' } : { id: 'content-packs' }),
      onFocus: () => this.stage.setCaption('PREPARATION READY', `${this.rosterSummary()} Preparation: ${PREP_COPY[this.model.prepMode].label}.`),
    });
    view.root.add(proceed);
    view.focus.add(proceed);
    this.addBack(view, 584);
    return view;
  }

  private buildContentPacks(returnToReview: boolean): MenuScreenView {
    const view = this.createScreen(
      'CHOOSE CONTENT PACKS',
      'Enabled packs decide which items and spells can appear.'
    );
    const buttons = new Map<keyof ItemSetSelection, CabinetButton>();
    (Object.keys(PACK_COPY) as (keyof ItemSetSelection)[]).forEach((pack, index) => {
      const copy = PACK_COPY[pack];
      const button = this.choice(view.root, 76, 238 + index * 82, copy, String(index + 1), () => {
        this.model.toggleItemSet(pack);
        refresh();
      }, 72, this.model.itemSets[pack]);
      buttons.set(pack, button);
      view.focus.add(button);
    });
    const proceed = new CabinetButton(this.scene, 76, 500, {
      width: 714,
      height: 60,
      label: returnToReview ? 'Return to Review' : 'Build Mages',
      index: '>',
      primary: true,
      onActivate: () => {
        if (returnToReview) this.navigator.push({ id: 'review' });
        else this.navigator.push({ id: 'mage-build', seat: this.model.localDraftSeats()[0] ?? 0 });
      },
      onFocus: () => this.stage.setCaption('CATALOGUES READY', this.packSummary()),
    });
    view.root.add(proceed);
    view.focus.add(proceed);
    this.addBack(view, 584);
    const refresh = (): void => {
      for (const [pack, button] of buttons) button.setSelected(this.model.itemSets[pack]);
    };
    refresh();
    return view;
  }

  private buildPlayerHandoff(seat: number): MenuScreenView {
    const view = this.createScreen(
      `PLAYER ${seat + 1}`,
      'Pass control before the next build is shown.'
    );
    const cover = this.scene.add.text(76, 278, 'BUILD CONCEALED', {
      fontFamily: MENU_FONT.display,
      fontSize: '28px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
      backgroundColor: '#17110d',
      fixedWidth: 714,
      align: 'center',
      padding: { y: 24 },
    });
    const proceed = new CabinetButton(this.scene, 76, 414, {
      width: 714,
      height: 64,
      label: `Player ${seat + 1} Is Ready`,
      index: '>',
      primary: true,
      onActivate: () => this.navigator.push({ id: 'mage-build', seat }),
      onFocus: () => this.stage.setCaption(`PLAYER ${seat + 1}`, 'Continue when the next player has control.'),
    });
    view.root.add([cover, proceed]);
    view.focus.add(proceed);
    this.addBack(view, 574);
    return view;
  }

  private buildMageBuild(seat: number, returnToReview: boolean): MenuScreenView {
    const draft = this.model.draftFor(seat);
    const draftSeats = this.model.localDraftSeats();
    const draftIndex = Math.max(0, draftSeats.indexOf(seat));
    const nextSeat = draftSeats[draftIndex + 1];
    const view = this.createScreen(
      draftSeats.length > 1 ? `BUILD PLAYER ${seat + 1}` : 'BUILD YOUR MAGE',
      `Choose 1 discipline, ${this.model.loadoutLimit()} words and 1 method.`
    );

    const disciplineLabel = this.scene.add.text(76, 230, 'DISCIPLINE', {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      fontStyle: 'bold',
      color: MENU_HEX.brass,
    });
    const wordsLabel = this.scene.add.text(76, 316, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      fontStyle: 'bold',
      color: MENU_HEX.brass,
    });
    view.root.add([disciplineLabel, wordsLabel]);

    const classButtons = new Map<MageClass, CabinetButton>();
    MAGE_CLASSES.forEach((mageClass, index) => {
      const definition = MAGE_CLASS_DEFS[mageClass];
      const button = new CabinetButton(this.scene, 76 + index * 244, 248, {
        width: 226,
        height: 52,
        label: definition.label,
        index: String(index + 1),
        selected: draft.mageClass === mageClass,
        onActivate: () => {
          this.model.setClass(seat, mageClass);
          refresh();
        },
        onFocus: () => this.stage.setCaption(definition.focus, definition.blurb),
      });
      classButtons.set(mageClass, button);
      view.root.add(button);
      view.focus.add(button);
    });

    const visibleWords = this.model.visibleWords();
    const compact = visibleWords.length > 10;
    const columns = visibleWords.length > 8 ? 5 : 4;
    const gap = compact ? 8 : 12;
    const plateWidth = Math.floor((714 - gap * (columns - 1)) / columns);
    const plateHeight = compact ? 48 : 64;
    const wordStartY = compact ? 334 : 342;
    const rowGap = compact ? 7 : 8;
    const wordButtons = new Map<WordId, WordPlate>();
    visibleWords.forEach((word, index) => {
      const definition = WORDS[word];
      const button = new WordPlate(
        this.scene,
        76 + (index % columns) * (plateWidth + gap),
        wordStartY + Math.floor(index / columns) * (plateHeight + rowGap),
        {
          width: plateWidth,
          height: plateHeight,
          label: definition.label,
          accent: definition.color,
          reaction: definition.grantsReaction,
          selectedOrder: draft.words.indexOf(word) + 1,
          onActivate: () => {
            this.model.toggleWord(seat, word);
            refresh();
          },
          onFocus: () => this.stage.setCaption(
            definition.label,
            `${definition.blurb}${definition.grantsReaction ? ' Grants reaction casting.' : ''}`
          ),
        }
      );
      wordButtons.set(word, button);
      view.root.add(button);
      view.focus.add(button);
    });

    const actionY = compact ? 560 : 500;
    const backY = compact ? 632 : 590;
    const modifier = new CabinetButton(this.scene, 76, actionY, {
      width: 344,
      height: 58,
      label: `Method: ${WORDS[draft.modifier].label}`,
      index: 'M',
      onActivate: () => cycleModifier(1),
      onAdjust: (direction) => cycleModifier(direction),
      onFocus: () => this.stage.setCaption(WORDS[draft.modifier].label, WORDS[draft.modifier].blurb),
    });
    const proceed = new CabinetButton(this.scene, 438, actionY, {
      width: 352,
      height: 58,
      label: '',
      index: '>',
      primary: true,
      onActivate: () => {
        if (!this.model.loadoutReady(seat)) return;
        if (returnToReview) this.navigator.push({ id: 'review' });
        else if (nextSeat != null) this.navigator.push({ id: 'player-handoff', seat: nextSeat });
        else this.navigator.push({ id: 'review' });
      },
      onFocus: () => this.stage.setCaption(
        returnToReview ? 'RETURN TO REVIEW' : nextSeat != null ? 'NEXT MAGE' : 'REVIEW SETUP',
        returnToReview
          ? 'Keep this build and return to the summary.'
          : nextSeat != null
            ? `Pass control to Player ${nextSeat + 1}.`
            : this.rosterSummary()
      ),
    });
    const status = this.scene.add.text(278, backY + 14, '', {
      fontFamily: MENU_FONT.body,
      fontSize: '14px',
      color: MENU_HEX.boneDim,
    });
    view.root.add([modifier, proceed, status]);
    view.focus.add(modifier);
    view.focus.add(proceed);
    this.addBack(view, backY);

    const cycleModifier = (direction: -1 | 1): void => {
      const current = MODIFIER_WORDS.indexOf(draft.modifier);
      const next = (current + direction + MODIFIER_WORDS.length) % MODIFIER_WORDS.length;
      this.model.setModifier(seat, MODIFIER_WORDS[next]);
      refresh();
      this.stage.setCaption(WORDS[draft.modifier].label, WORDS[draft.modifier].blurb);
    };
    const refresh = (): void => {
      for (const [mageClass, button] of classButtons) button.setSelected(draft.mageClass === mageClass);
      for (const [word, button] of wordButtons) button.setSelectedOrder(draft.words.indexOf(word) + 1);
      modifier.setCopy(`Method: ${WORDS[draft.modifier].label}`);
      wordsLabel.setText(`WORDS  ${draft.words.length}/${this.model.loadoutLimit()}`);
      const ready = this.model.loadoutReady(seat);
      const missing = this.model.missingWords(seat);
      const finalLabel = returnToReview ? 'Return to Review' : nextSeat != null ? `Build Player ${nextSeat + 1}` : 'Review Setup';
      proceed.setCopy(ready ? finalLabel : `Choose ${missing} More`);
      proceed.setEnabled(ready);
      status.setText(ready ? `${MAGE_CLASS_DEFS[draft.mageClass].label} build ready.` : `${missing} word${missing === 1 ? '' : 's'} still required.`);
    };
    refresh();
    return view;
  }

  private buildReview(): MenuScreenView {
    const copy = MODE_COPY[this.model.mode];
    const rulesOwner = this.model.role !== 'guest';
    const view = this.createScreen('REVIEW SETUP', 'Check the configuration before starting.');
    const rows: { label: string; detail: string; edit: () => void }[] = [
      {
        label: `Mode: ${copy.label}`,
        detail: copy.description,
        edit: () => this.navigator.push({ id: 'category', category: this.model.capability.category }),
      },
    ];
    if (this.model.capability.roles.length > 1) {
      rows.push({
        label: `Session: ${this.roleLabel()}`,
        detail: this.rosterSummary(),
        edit: () => this.navigator.push({ id: 'session-role' }),
      });
    }
    if (rulesOwner && this.model.mode === 'raid') {
      rows.push({
        label: `Target: ${RAID_BOSS_COPY[this.model.raidBoss].label}`,
        detail: RAID_BOSS_COPY[this.model.raidBoss].description,
        edit: () => this.navigator.push({ id: 'raid-target', returnToReview: true }),
      });
    }
    if (rulesOwner && (this.model.capability.seats[0] !== this.model.capability.seats[1] || this.model.mode === 'ai')) {
      rows.push({
        label: `${isPveRunMode(this.model.mode) ? 'Party' : 'Table'}: ${this.rosterSummary()}`,
        detail: 'Edit seats, AI fill and formation.',
        edit: () => this.navigator.push({ id: 'roster', returnToReview: true }),
      });
    }
    if (rulesOwner && this.shouldChooseTeams()) {
      rows.push({
        label: `Teams: ${this.teamSummary()}`,
        detail: 'Edit which seats share a side.',
        edit: () => this.navigator.push({ id: 'team-layout', returnToReview: true }),
      });
    }
    if (rulesOwner && usesSwampPrep(this.model.mode)) {
      rows.push({
        label: `Preparation: ${PREP_COPY[this.model.prepMode].label}`,
        detail: PREP_COPY[this.model.prepMode].description,
        edit: () => this.navigator.push({ id: 'preparation', returnToReview: true }),
      });
    }
    if (rulesOwner) {
      rows.push({
        label: `Content: ${this.packSummary()}`,
        detail: 'Edit the packs available to this match.',
        edit: () => this.navigator.push({ id: 'content-packs', returnToReview: true }),
      });
    }
    rows.push({
      label: `Mage Builds: ${this.buildSummary()}`,
      detail: 'Rebuild every local mage from the start.',
      edit: () => this.navigator.push({ id: 'mage-build', seat: this.model.localDraftSeats()[0] ?? 0 }),
    });
    const rowStart = rows.length > 6 ? 220 : 226;
    const rowGap = rows.length > 6 ? 47 : 54;
    const rowHeight = rows.length > 6 ? 41 : 46;
    rows.forEach((row, index) => {
      const button = new CabinetButton(this.scene, 76, rowStart + index * rowGap, {
        width: 714,
        height: rowHeight,
        label: row.label,
        index: String(index + 1),
        onActivate: row.edit,
        onFocus: () => this.stage.setCaption(row.label, row.detail),
      });
      view.root.add(button);
      view.focus.add(button);
    });
    const ready = this.model.isReady();
    const launch = new CabinetButton(this.scene, 438, 570, {
      width: 352,
      height: 54,
      label: ready ? this.launchLabel() : 'Setup Incomplete',
      index: '>',
      primary: true,
      enabled: ready,
      onActivate: () => {
        if (this.model.role === 'local') this.launchConfigured();
        else this.navigator.push({ id: 'online-lobby' });
      },
      onFocus: () => this.stage.setCaption(
        ready ? 'READY' : 'SETUP INCOMPLETE',
        ready ? 'Start with this configuration.' : this.model.validationIssues().join(' ')
      ),
    });
    view.root.add(launch);
    view.focus.add(launch);
    this.addBack(view, 578);
    return view;
  }

  private buildMemoryFile(): MenuScreenView {
    const scenario = this.memoryScenario;
    const view = this.createScreen(
      scenario ? 'REVIEW MEMORY' : 'OPEN A MEMORY',
      scenario
        ? 'This scenario replaces the drafted roster and resumes at its recorded turn.'
        : 'Choose a saved .dimir.json scenario. The file is validated before it is shown or launched.'
    );

    if (!scenario) {
      const slot = this.scene.add.text(76, 270, this.memoryState === 'loading' ? 'READING FILE...' : 'NO MEMORY LOADED', {
        fontFamily: MENU_FONT.display,
        fontSize: '26px',
        fontStyle: 'bold',
        color: this.memoryState === 'error' ? '#b96b62' : MENU_HEX.brassLight,
        backgroundColor: '#17110d',
        fixedWidth: 714,
        align: 'center',
        padding: { y: 25 },
      });
      const message = this.scene.add.text(76, 360, this.memoryMessage, {
        fontFamily: MENU_FONT.body,
        fontSize: '14px',
        color: this.memoryState === 'error' ? '#cf8d82' : MENU_HEX.boneDim,
        fixedWidth: 714,
        align: 'center',
        wordWrap: { width: 714 },
      });
      const choose = new CabinetButton(this.scene, 76, 430, {
        width: 714,
        height: 64,
        label: this.memoryState === 'loading' ? 'File Picker Open' : 'Choose Memory File',
        index: '>',
        primary: true,
        enabled: this.memoryState !== 'loading',
        onActivate: () => void this.chooseMemoryFile(),
        onFocus: () => this.stage.setCaption('CHOOSE MEMORY', 'Open a scenario file from this device.'),
      });
      view.root.add([slot, message, choose]);
      view.focus.add(choose);
      this.addBack(view, 574);
      return view;
    }

    const teams = new Set(scenario.entities.map((entity) => entity.team)).size;
    const humans = scenario.entities.filter((entity) => !entity.isAI).length;
    const activeEntityIndex = scenario.turn.order[scenario.turn.currentIndex];
    const activeName = scenario.entities[activeEntityIndex]?.name ?? 'Unknown';
    const plaque = this.scene.add.graphics();
    plaque.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(76, 238, 714, 68);
    plaque.lineStyle(1, MENU_COLOR.brassDark, 1).strokeRect(76.5, 238.5, 713, 67);
    const name = this.scene.add.text(94, 250, scenario.name, {
      fontFamily: MENU_FONT.display,
      fontSize: '23px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
      fixedWidth: 470,
    });
    const meta = this.scene.add.text(772, 253, `ROUND ${scenario.turn.round}\n${scenario.entities.length} ENTITIES / ${teams} SIDES`, {
      fontFamily: MENU_FONT.control,
      fontSize: '11px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
      align: 'right',
    }).setOrigin(1, 0);
    view.root.add([plaque, name, meta]);

    const shown = scenario.entities.slice(0, 5);
    shown.forEach((entity, index) => {
      const y = 320 + index * 38;
      const row = this.scene.add.graphics();
      row.fillStyle(MENU_COLOR.charcoalRaised, 1).fillRect(76, y, 714, 32);
      row.fillStyle(entity.team === 1 ? MENU_COLOR.verdigris : MENU_COLOR.blood, 1).fillRect(76, y, 5, 32);
      row.lineStyle(1, MENU_COLOR.brassDark, 0.7).strokeRect(76.5, y + 0.5, 713, 31);
      const words = entity.loadout.filter((word) => !MODIFIER_WORDS.includes(word)).slice(0, 3);
      const rowText = this.scene.add.text(92, y + 8, `${entity.name}  /  TEAM ${entity.team}  /  ${entity.isAI ? 'AI' : 'HUMAN'}  /  ${words.map((word) => WORDS[word].label).join(' + ') || 'NO WORDS'}`, {
        fontFamily: MENU_FONT.control,
        fontSize: '12px',
        color: MENU_HEX.bone,
        fixedWidth: 680,
      });
      view.root.add([row, rowText]);
    });
    if (scenario.entities.length > shown.length) {
      const remaining = this.scene.add.text(92, 515, `...and ${scenario.entities.length - shown.length} more entities`, {
        fontFamily: MENU_FONT.body,
        fontSize: '12px',
        color: MENU_HEX.boneDim,
      });
      view.root.add(remaining);
    }

    const chooseAgain = new CabinetButton(this.scene, 76, 554, {
      width: 260,
      height: 54,
      label: this.memoryState === 'loading' ? 'File Picker Open' : 'Choose Another',
      index: '<',
      enabled: this.memoryState !== 'loading',
      onActivate: () => void this.chooseMemoryFile(),
      onFocus: () => this.stage.setCaption('CHOOSE ANOTHER', 'Replace this scenario with a different file.'),
    });
    const launch = new CabinetButton(this.scene, 438, 554, {
      width: 352,
      height: 54,
      label: 'Enter This Memory',
      index: '>',
      primary: true,
      enabled: this.memoryState !== 'loading',
      onActivate: () => this.launchMemory(scenario),
      onFocus: () => this.stage.setCaption(
        scenario.name,
        `${humans} human-controlled entities. Round ${scenario.turn.round}; ${activeName} acts next.`
      ),
    });
    view.root.add([chooseAgain, launch]);
    view.focus.add(chooseAgain);
    view.focus.add(launch);
    this.addBack(view, 616);
    return view;
  }

  private async chooseMemoryFile(): Promise<void> {
    if (this.memoryState === 'loading') return;
    const request = ++this.memoryRequest;
    this.memoryState = 'loading';
    this.memoryMessage = '';
    this.navigator.refresh();
    try {
      const scenario = await pickScenarioFile();
      if (this.destroyed || request !== this.memoryRequest) return;
      if (!scenario) {
        this.memoryState = 'idle';
        this.memoryMessage = 'No file selected.';
      } else {
        this.memoryScenario = scenario;
        this.memoryState = 'ready';
        this.memoryMessage = '';
      }
    } catch (error) {
      if (this.destroyed || request !== this.memoryRequest) return;
      this.memoryScenario = null;
      this.memoryState = 'error';
      this.memoryMessage = error instanceof Error ? error.message : 'That memory could not be loaded.';
    }
    this.navigator.refresh();
  }

  private buildOnlineLobby(): MenuScreenView {
    const host = this.model.role === 'host';
    if (host && !this.lobbyRoom) this.lobbyRoom = String(1000 + Math.floor(Math.random() * 9000));
    const view = this.createScreen(
      host ? 'HOST ONLINE ROOM' : 'JOIN ONLINE ROOM',
      host
        ? 'Share the room code. The match begins when every human seat is filled.'
        : 'Enter the room code supplied by the host. Host-owned rules arrive after connection.'
    );

    const fieldGraphics = this.scene.add.graphics();
    const drawField = (x: number, y: number, width: number): void => {
      fieldGraphics.fillStyle(MENU_COLOR.pitch, 1).fillRect(x - 4, y - 4, width + 8, 62);
      fieldGraphics.fillStyle(MENU_COLOR.bone, 1).fillRect(x, y, width, 54);
      fieldGraphics.lineStyle(1, MENU_COLOR.brassDark, 1).strokeRect(x + 0.5, y + 0.5, width - 1, 53);
    };
    drawField(76, 260, 714);
    const roomLabel = this.scene.add.text(94, 270, 'ROOM CODE', {
      fontFamily: MENU_FONT.control,
      fontSize: '10px',
      fontStyle: 'bold',
      color: '#675735',
    });
    const roomValue = this.scene.add.text(94, 286, this.lobbyRoom || 'Select to enter', {
      fontFamily: MENU_FONT.control,
      fontSize: '19px',
      fontStyle: 'bold',
      color: MENU_HEX.ink,
      fixedWidth: 650,
    });
    const roomHit = this.scene.add.zone(76, 260, 714, 54).setOrigin(0).setInteractive({ useHandCursor: !this.lobbyBusy });
    roomHit.on('pointerdown', () => this.beginLobbyEntry('room', roomValue));
    const roomEdit = new CabinetChip(this.scene, 658, 267, {
      width: 116,
      height: 40,
      label: host ? 'Change Code' : 'Enter Code',
      enabled: !this.lobbyBusy,
      onActivate: () => this.beginLobbyEntry('room', roomValue),
      onFocus: () => this.stage.setCaption('ROOM CODE', host ? 'Edit the code shared with other players.' : 'Enter the code from the host.'),
    });
    view.root.add([fieldGraphics, roomLabel, roomValue, roomHit, roomEdit]);
    view.focus.add(roomEdit);

    const advanced = new CabinetButton(this.scene, 76, 338, {
      width: 714,
      height: 50,
      label: this.lobbyAdvanced ? 'Connection Details: Shown' : 'Connection Details',
      detail: 'The default relay works for local and hosted sessions',
      index: 'A',
      selected: this.lobbyAdvanced,
      enabled: !this.lobbyBusy,
      onActivate: () => {
        this.lobbyAdvanced = !this.lobbyAdvanced;
        this.navigator.refresh();
      },
      onFocus: () => this.stage.setCaption('CONNECTION DETAILS', 'Change the relay only for a custom server or tunnel.'),
    });
    view.root.add(advanced);
    view.focus.add(advanced);

    let urlValue: Phaser.GameObjects.Text | null = null;
    if (this.lobbyAdvanced) {
      drawField(76, 406, 714);
      const urlLabel = this.scene.add.text(94, 416, 'RELAY URL', {
        fontFamily: MENU_FONT.control,
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#675735',
      });
      urlValue = this.scene.add.text(94, 432, this.lobbyUrl, {
        fontFamily: MENU_FONT.control,
        fontSize: '15px',
        fontStyle: 'bold',
        color: MENU_HEX.ink,
        fixedWidth: 650,
      });
      const urlHit = this.scene.add.zone(76, 406, 714, 54).setOrigin(0).setInteractive({ useHandCursor: !this.lobbyBusy });
      const currentUrlValue = urlValue;
      urlHit.on('pointerdown', () => this.beginLobbyEntry('url', currentUrlValue));
      const urlEdit = new CabinetChip(this.scene, 658, 413, {
        width: 116,
        height: 40,
        label: 'Edit URL',
        enabled: !this.lobbyBusy,
        onActivate: () => this.beginLobbyEntry('url', currentUrlValue),
        onFocus: () => this.stage.setCaption('RELAY URL', 'Enter a ws:// or wss:// relay endpoint.'),
      });
      view.root.add([urlLabel, urlValue, urlHit, urlEdit]);
      view.focus.add(urlEdit);
    }

    const statusY = this.lobbyAdvanced ? 480 : 416;
    const status = this.scene.add.text(76, statusY, this.lobbyStatus?.message ?? this.lobbyHelp(), {
      fontFamily: MENU_FONT.body,
      fontSize: '14px',
      color: this.lobbyStatus?.stage === 'error' ? '#cf8d82' : MENU_HEX.boneDim,
      fixedWidth: 714,
      align: 'center',
      wordWrap: { width: 714 },
    });
    view.root.add(status);

    const actionY = this.lobbyAdvanced ? 542 : 500;
    const back = new CabinetButton(this.scene, 76, actionY, {
      width: 260,
      height: 56,
      label: this.lobbyBusy ? 'Cancel Connection' : 'Back',
      index: '<',
      onActivate: () => this.cancelLobby(true),
      onFocus: () => this.stage.setCaption(
        this.lobbyBusy ? 'CANCEL CONNECTION' : 'BACK',
        this.lobbyBusy ? 'Close the socket and return with your setup intact.' : 'Return to Review.'
      ),
    });
    const connect = new CabinetButton(this.scene, 438, actionY, {
      width: 352,
      height: 56,
      label: this.lobbyBusy ? 'Connecting...' : host ? 'Create Room' : 'Join Room',
      index: '>',
      primary: true,
      enabled: !this.lobbyBusy && !!this.lobbyRoom.trim() && /^wss?:\/\//.test(this.lobbyUrl.trim()),
      onActivate: () => void this.connectLobby(),
      onFocus: () => this.stage.setCaption(
        host ? 'CREATE ROOM' : 'JOIN ROOM',
        host ? `Open room ${this.lobbyRoom} for ${this.model.humanCount()} human players.` : `Join room ${this.lobbyRoom || '(not entered)'}.`
      ),
    });
    view.root.add([back, connect]);
    view.focus.add(back);
    view.focus.add(connect);
    return view;
  }

  private beginLobbyEntry(field: 'room' | 'url', valueText: Phaser.GameObjects.Text): void {
    if (this.lobbyBusy) return;
    const original = field === 'room' ? this.lobbyRoom : this.lobbyUrl;
    this.textEntry.begin({
      value: original,
      maxLength: field === 'room' ? 24 : 256,
      inputMode: field === 'room' ? 'text' : 'url',
      onChange: (value) => {
        if (field === 'room') this.lobbyRoom = value;
        else this.lobbyUrl = value;
        valueText.setText(value || ' ');
      },
      onDone: (committed) => {
        if (!committed) {
          if (field === 'room') this.lobbyRoom = original;
          else this.lobbyUrl = original;
        }
        if (!this.destroyed && this.activeRoute.id === 'online-lobby') this.navigator.refresh();
      },
    });
  }

  private async connectLobby(): Promise<void> {
    if (this.lobbyBusy) return;
    const attempt = ++this.lobbyAttempt;
    this.lobbyBusy = true;
    this.lobbyStatus = { stage: 'connecting', message: 'Connecting to relay...' };
    this.textEntry.finish(true);
    this.onlineCoordinator = new OnlineCoordinator(this.model, (status) => {
      if (this.destroyed || attempt !== this.lobbyAttempt) return;
      this.lobbyStatus = status;
      if (this.activeRoute.id === 'online-lobby') this.navigator.refresh();
    });
    this.navigator.refresh();
    try {
      const config = await this.onlineCoordinator.connect({
        role: this.model.role === 'guest' ? 'guest' : 'host',
        room: this.lobbyRoom,
        url: this.lobbyUrl,
      });
      if (this.destroyed || attempt !== this.lobbyAttempt) {
        config.net?.close();
        return;
      }
      this.onlineCoordinator = null;
      this.launchOnline(config);
    } catch (error) {
      if (this.destroyed || attempt !== this.lobbyAttempt) return;
      this.onlineCoordinator = null;
      this.lobbyBusy = false;
      this.lobbyStatus = {
        stage: 'error',
        message: error instanceof Error ? error.message : 'Connection lost.',
      };
      this.navigator.refresh();
    }
  }

  private cancelLobby(returnToReview: boolean): void {
    this.lobbyAttempt += 1;
    this.onlineCoordinator?.cancel();
    this.onlineCoordinator = null;
    this.textEntry.destroy();
    this.lobbyBusy = false;
    this.lobbyStatus = null;
    if (returnToReview) this.navigator.back();
    else if (this.activeRoute.id === 'online-lobby') this.navigator.refresh();
  }

  private lobbyHelp(): string {
    return this.model.role === 'host'
      ? `${this.model.humanCount()} human seats are required before the room starts.`
      : 'Enter the exact room code shared by the host.';
  }

  private createScreen(title: string, summary: string): MenuScreenView {
    const root = this.scene.add.container(0, 0);
    const focus = new MenuFocusGroup();
    const heading = this.scene.add.text(76, 160, title, {
      fontFamily: MENU_FONT.display,
      fontSize: '31px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    });
    const body = this.scene.add.text(76, 201, summary, {
      fontFamily: MENU_FONT.body,
      fontSize: '15px',
      color: MENU_HEX.boneDim,
      fixedWidth: 714,
      wordWrap: { width: 714 },
    });
    root.add([heading, body]);
    return { root, focus };
  }

  private choice(
    root: Phaser.GameObjects.Container,
    x: number,
    y: number,
    copy: MenuEntryCopy,
    index: string,
    onActivate: () => void,
    height = 76,
    selected = false
  ): CabinetButton {
    const button = new CabinetButton(this.scene, x, y, {
      width: 714,
      height,
      label: copy.label,
      detail: copy.detail,
      index,
      selected,
      onActivate,
      onFocus: () => this.stage.setCaption(copy.title, copy.description),
    });
    root.add(button);
    return button;
  }

  private addBack(view: MenuScreenView, y: number): void {
    const back = new CabinetButton(this.scene, 76, y, {
      width: 180,
      height: 46,
      label: 'Back',
      index: '<',
      onActivate: () => this.navigator.back(),
      onFocus: () => this.stage.setCaption('BACK', 'Return to the previous step. Choices are kept.'),
    });
    view.root.add(back);
    view.focus.add(back);
  }

  private updateRouteChrome(route: MenuRoute, history: readonly MenuRoute[]): void {
    this.activeRoute = route;
    const trail = history.map((item) => this.routeLabel(item));
    trail.push(this.routeLabel(route));
    this.breadcrumb.setText(trail.join('  /  ').toUpperCase());
    this.chapter.setText(this.roman(history.length + 1));
    this.scene.game.canvas.setAttribute('aria-label', `Dimir menu: ${this.routeLabel(route)}`);
  }

  private routeLabel(route: MenuRoute): string {
    switch (route.id) {
      case 'main': return 'Main';
      case 'category': return CATEGORY_LABELS[route.category];
      case 'mode-intro': return MODE_COPY[this.model.mode].label;
      case 'raid-target': return 'Raid Target';
      case 'session-role': return 'Session';
      case 'roster': return isPveRunMode(this.model.mode) ? 'Party' : 'Table';
      case 'team-layout': return 'Teams';
      case 'preparation': return 'Preparation';
      case 'content-packs': return 'Content';
      case 'player-handoff': return `Player ${route.seat + 1}`;
      case 'mage-build': return `Player ${route.seat + 1} Build`;
      case 'review': return 'Review';
      case 'memory-file': return 'Memory File';
      case 'online-lobby': return 'Online Lobby';
    }
  }

  private advanceFromIntro(): void {
    if (this.model.mode === 'raid') {
      this.navigator.push({ id: 'raid-target' });
      return;
    }
    if (this.model.capability.roles.length > 1) {
      this.navigator.push({ id: 'session-role' });
      return;
    }
    if (this.model.mode === 'ai' || this.model.mode === 'hotseat' || this.model.mode === 'scenario') {
      this.navigator.push({ id: 'roster' });
      return;
    }
    this.navigator.push({ id: 'content-packs' });
  }

  private rosterSummary(): string {
    const humans = this.model.humanCount();
    if (this.model.mode === 'training') return 'Solo sandbox with one configurable training opponent.';
    if (this.model.mode === 'expedition') return 'One local explorer in a solo campaign.';
    if (isPveRunMode(this.model.mode)) {
      return `${this.model.seatCount} explorer${this.model.seatCount === 1 ? '' : 's'}: ${humans} human, ${this.model.aiCount} AI.`;
    }
    return `${this.model.formatLabel()}: ${this.model.seatCount} seats, ${humans} human, ${this.model.aiCount} AI.`;
  }

  private shouldChooseTeams(): boolean {
    return !isPveRunMode(this.model.mode) && this.model.teamFormat === 'teams' && this.model.seatCount >= 3;
  }

  private teamSummary(): string {
    const teamOne: string[] = [];
    const teamTwo: string[] = [];
    for (let seat = 0; seat < this.model.seatCount; seat++) {
      const label = seat < this.model.humanCount() ? `P${seat + 1}` : `AI${seat + 1}`;
      (this.model.teamOf(seat) === 1 ? teamOne : teamTwo).push(label);
    }
    return `${teamOne.join(' + ')} vs ${teamTwo.join(' + ')}`;
  }

  private roleLabel(): string {
    return this.model.role === 'host' ? 'Host co-op' : this.model.role === 'guest' ? 'Join co-op' : 'Local';
  }

  private packSummary(): string {
    return [
      this.model.itemSets.original ? 'Original' : '',
      this.model.itemSets.finns ? "Finn's" : '',
      this.model.itemSets.dlc ? 'DLC' : '',
    ].filter(Boolean).join(' + ');
  }

  private buildSummary(): string {
    const seats = this.model.localDraftSeats();
    const ready = seats.filter((seat) => this.model.loadoutReady(seat)).length;
    return `${ready}/${seats.length} ready`;
  }

  private launchLabel(): string {
    if (this.model.mode === 'training') return 'Start Training';
    if (this.model.mode === 'expedition') return 'Begin Expedition';
    if (this.model.mode === 'ai') return 'Start AI Duel';
    if (this.model.mode === 'hotseat') return 'Start Hotseat Match';
    if (this.model.mode === 'scenario') return 'Open Scenario Lab';
    if (this.model.role === 'host') return 'Create Co-op Room';
    if (this.model.role === 'guest') return 'Join Co-op Room';
    if (this.model.mode === 'minerun') return 'Enter the Mine';
    if (this.model.mode === 'raid') return `Begin ${RAID_BOSS_COPY[this.model.raidBoss].label} Raid`;
    return 'Begin Swamprun';
  }

  private roman(value: number): string {
    return ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][Math.max(0, Math.min(6, value - 1))];
  }

  setStatus(message: string): void {
    if (message) this.stage.setCaption('CONNECTION', message);
  }
}