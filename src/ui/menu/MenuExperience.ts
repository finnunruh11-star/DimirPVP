import Phaser from 'phaser';
import {
  type MatchMode,
  type MenuCategory,
  type SessionRole,
  type SwampPrepMode,
} from '../../config/MatchConfig';
import { MAGE_CLASSES, MAGE_CLASS_DEFS, type MageClass } from '../../core/Classes';
import { MODIFIER_WORDS, WORDS, type WordId } from '../../core/Words';
import { SceneInput } from '../../engine/SceneInput';
import { MenuModel } from './MenuModel';
import { addMenuMageStage, type MenuMageStage } from './art';
import { CabinetButton, MenuFocusGroup, WordPlate } from './controls';
import { CATEGORY_COPY, MODE_COPY, PREP_COPY, type MenuEntryCopy } from './content';
import { MenuNavigator, type MenuRoute, type MenuScreenView } from './MenuFlow';
import {
  MENU_COLOR,
  MENU_FONT,
  MENU_HEX,
  addCabinetBackdrop,
  addSectionRule,
} from './theme';

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

export class MenuExperience {
  readonly root: Phaser.GameObjects.Container;

  private readonly input: SceneInput;
  private readonly navigator: MenuNavigator;
  private readonly breadcrumb: Phaser.GameObjects.Text;
  private readonly chapter: Phaser.GameObjects.Text;
  private readonly stage: MenuMageStage;
  private activeRoute: MenuRoute = { id: 'main' };
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly model: MenuModel,
    private readonly openLegacy: (mode: MatchMode) => void,
    private readonly launchConfigured: () => void
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
      { key: 'ESC', run: () => this.navigator.back() },
    ]);
    this.input.bindAnyKey((event) => {
      if (this.activeRoute.id !== 'swamprun-build') return;
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
    this.navigator.destroy();
    this.root.destroy(true);
  }

  private buildScreen(route: MenuRoute): MenuScreenView {
    switch (route.id) {
      case 'main': return this.buildMain();
      case 'category': return this.buildCategory(route.category);
      case 'swamprun': return this.buildSwamprunRole();
      case 'swamprun-party': return this.buildSwamprunParty();
      case 'swamprun-prep': return this.buildSwamprunPrep();
      case 'swamprun-build': return this.buildSwamprunBuild(route.seat);
    }
  }

  private buildMain(): MenuScreenView {
    const view = this.createScreen(
      'CHOOSE A TABLE',
      'Every path begins with a single kind of game. Rules and builds come later.'
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
        if (mode === 'swamprun') this.navigator.push({ id: 'swamprun' });
        else this.openLegacy(mode);
      }, 70));
    });
    this.addBack(view, category === 'adventures' ? 574 : 520);
    return view;
  }

  private buildSwamprunRole(): MenuScreenView {
    const copy = MODE_COPY.swamprun;
    const view = this.createScreen('ENTER THE SWAMP', copy.description);
    const roles: { role: SessionRole; copy: MenuEntryCopy }[] = [
      {
        role: 'local',
        copy: {
          label: 'Local Run', detail: 'One screen, with optional AI allies', title: 'LOCAL RUN',
          description: 'Build every human-controlled mage on this machine and fill remaining seats with AI allies.',
        },
      },
      {
        role: 'host',
        copy: {
          label: 'Host Co-op', detail: 'Create a room and own the run rules', title: 'HOST CO-OP',
          description: 'Choose the party and preparation, then wait for the other human explorers to join.',
        },
      },
      {
        role: 'guest',
        copy: {
          label: 'Join Co-op', detail: 'Bring one mage into a host-owned run', title: 'JOIN CO-OP',
          description: 'Build your mage and join with the room code. Party rules arrive from the host.',
        },
      },
    ];
    roles.forEach(({ role, copy: roleCopy }, index) => {
      view.focus.add(this.choice(view.root, 76, 246 + index * 88, roleCopy, String(index + 1), () => {
        this.model.setRole(role);
        if (role === 'local') this.model.setSeatCount(1);
        if (role === 'host' && this.model.seatCount < 2) this.model.setSeatCount(2);
        if (role === 'guest') this.navigator.push({ id: 'swamprun-build', seat: 0 });
        else this.navigator.push({ id: 'swamprun-party' });
      }));
    });
    this.addBack(view, 574);
    return view;
  }

  private buildSwamprunParty(): MenuScreenView {
    const view = this.createScreen(
      'ASSEMBLE THE PARTY',
      this.model.role === 'host'
        ? 'The room needs at least two human explorers. AI occupies the final seats.'
        : 'Choose the total party size, then decide how many seats the machine controls.'
    );

    const explorers = new CabinetButton(this.scene, 76, 262, {
      width: 714,
      label: `Explorers  ${this.model.seatCount}`,
      detail: 'Total seats in the party, from one to four',
      index: 'I',
      onActivate: () => updateExplorers(1),
      onAdjust: (direction) => updateExplorers(direction),
      onFocus: () => this.stage.setCaption('PARTY SIZE', 'A larger party increases the Swamp encounter budget.'),
    });
    const allies = new CabinetButton(this.scene, 76, 354, {
      width: 714,
      label: `AI Allies  ${this.model.aiCount}`,
      detail: 'Human explorers always occupy the first seats',
      index: 'II',
      onActivate: () => updateAllies(1),
      onAdjust: (direction) => updateAllies(direction),
      onFocus: () => this.stage.setCaption('AI ALLIES', 'AI allies fight locally and do not consume online room seats.'),
    });
    const proceed = new CabinetButton(this.scene, 76, 478, {
      width: 714,
      height: 64,
      label: 'Choose Preparation',
      index: '>',
      primary: true,
      onActivate: () => this.navigator.push({ id: 'swamprun-prep' }),
      onFocus: () => this.stage.setCaption('PARTY READY', this.partySummary()),
    });

    const refresh = (): void => {
      explorers.setCopy(`Explorers  ${this.model.seatCount}`);
      allies.setCopy(`AI Allies  ${this.model.aiCount}`);
      const valid = this.model.role !== 'host' || this.model.humanCount() >= 2;
      proceed.setEnabled(valid);
      proceed.setCopy(valid ? 'Choose Preparation' : 'Two Humans Required');
    };
    const updateExplorers = (direction: -1 | 1): void => {
      const [minimum, maximum] = this.model.capability.seats;
      const next = this.model.seatCount + direction;
      this.model.setSeatCount(next > maximum ? minimum : next < minimum ? maximum : next);
      refresh();
      this.stage.setCaption('PARTY SIZE', this.partySummary());
    };
    const updateAllies = (direction: -1 | 1): void => {
      const maximum = Math.max(0, this.model.seatCount - 1);
      const next = this.model.aiCount + direction;
      this.model.setAiCount(next > maximum ? 0 : next < 0 ? maximum : next);
      refresh();
      this.stage.setCaption('AI ALLIES', this.partySummary());
    };

    view.root.add([explorers, allies, proceed]);
    view.focus.add(explorers);
    view.focus.add(allies);
    view.focus.add(proceed);
    this.addBack(view, 584);
    refresh();
    return view;
  }

  private buildSwamprunPrep(): MenuScreenView {
    const view = this.createScreen(
      'CHOOSE PREPARATION',
      'This choice changes only the party setup before the first wave.'
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
      label: 'Continue to Mage Build',
      index: '>',
      primary: true,
      onActivate: () => this.navigator.push({ id: 'swamprun-build', seat: this.model.localDraftSeats()[0] ?? 0 }),
      onFocus: () => this.stage.setCaption('READY TO BUILD', `${this.partySummary()} Preparation: ${PREP_COPY[this.model.prepMode].label}.`),
    });
    view.root.add(proceed);
    view.focus.add(proceed);
    this.addBack(view, 584);
    return view;
  }

  private buildSwamprunBuild(seat: number): MenuScreenView {
    const draft = this.model.draftFor(seat);
    const draftSeats = this.model.localDraftSeats();
    const draftIndex = Math.max(0, draftSeats.indexOf(seat));
    const nextSeat = draftSeats[draftIndex + 1];
    const view = this.createScreen(
      draftSeats.length > 1 ? `BUILD PLAYER ${seat + 1}` : 'BUILD YOUR MAGE',
      `Choose one discipline, ${this.model.loadoutLimit()} words, and a casting method.`
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
        if (nextSeat != null) this.navigator.push({ id: 'swamprun-build', seat: nextSeat });
        else this.launchConfigured();
      },
      onFocus: () => this.stage.setCaption(
        nextSeat != null ? 'NEXT MAGE' : 'ENTER THE SWAMP',
        nextSeat != null ? `Pass control to Player ${nextSeat + 1} for their build.` : this.partySummary()
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
      const finalLabel = this.model.role === 'host'
        ? 'Create Co-op Room'
        : this.model.role === 'guest'
          ? 'Join Co-op Room'
          : 'Begin Swamprun';
      proceed.setCopy(ready ? (nextSeat != null ? `Build Player ${nextSeat + 1}` : finalLabel) : `Choose ${missing} More`);
      proceed.setEnabled(ready);
      status.setText(ready ? `${MAGE_CLASS_DEFS[draft.mageClass].label} build ready.` : `${missing} word${missing === 1 ? '' : 's'} still required.`);
    };
    refresh();
    return view;
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
      onFocus: () => this.stage.setCaption('BACK', 'Return to the previous decision without discarding your choices.'),
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
    if (route.id === 'main') return 'Main';
    if (route.id === 'category') return CATEGORY_LABELS[route.category];
    if (route.id === 'swamprun') return 'Swamprun';
    if (route.id === 'swamprun-party') return 'Party';
    if (route.id === 'swamprun-prep') return 'Preparation';
    return `Player ${route.seat + 1} Build`;
  }

  private partySummary(): string {
    const humans = this.model.humanCount();
    return `${this.model.seatCount} explorer${this.model.seatCount === 1 ? '' : 's'}: ${humans} human, ${this.model.aiCount} AI.`;
  }

  private roman(value: number): string {
    return ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][Math.max(0, Math.min(6, value - 1))];
  }

  setStatus(message: string): void {
    if (message) this.stage.setCaption('CONNECTION', message);
  }
}