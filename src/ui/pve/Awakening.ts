// The start of a run: a voice in your head (brief, a little flirty) asks for a
// class, two words, a modifier and a stat, one row of orbs at a time. It only
// asks; applying the picks is `applyCreation`'s job.

import Phaser from 'phaser';
import { playSound } from '../../audio';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config/constants';
import { MAGE_CLASSES, type MageClass } from '../../core/Classes';
import { STAT_DEFS, type StatKey } from '../../core/Stats';
import { isModifierWord, MODIFIER_WORDS, WORDS, type WordId } from '../../core/Words';
import { wordCardColor } from '../../core/Colors';
import { CREATION_WORD_ROUNDS, type CreationPick } from '../../pve/exploration/creation';
import { rackIsFull, START_STAT_BONUS } from '../../pve/progression';
import { isReducedMotion } from '../cabinet/motion';
import { MENU_FONT, MENU_HEX } from '../cabinet/theme';

export interface AwakeningModel {
  /** The traveller's name, when several share one screen. */
  who?: string;
  /** The words on offer in word round `round`, given the ones already taken. */
  offers(round: number, taken: readonly WordId[]): WordId[];
  reducedMotion: boolean;
}

const CLASS_FACE: Record<MageClass, { mark: string; color: number }> = {
  objects: { mark: 'Sturdy', color: 0xd9b25a },
  life: { mark: 'Loyal', color: 0x7fd18a },
  hexcraft: { mark: 'Rules', color: 0xb98bff },
};

const STAT_COLOR: Record<StatKey, number> = {
  strength: 0xd9523f,
  dex: 0x6fd35a,
  int: 0x4f8fe0,
  mana: 0x8a6fe0,
  hp: 0xe06f8a,
  luck: 0xe0c24f,
};

const OPENING = [
  'Hey. Hey, you. Face-down in the mud. Cute.',
  "I'm the voice in your head. You're welcome.",
];

const CLASS_ASK = "Class first. So... what's your type? :D";
const WORD_ASKS = ['Pick a word. Any word. Ideally a cute one.', 'Another one! Pick one that describes me :3'];
const MODIFIER_ASK = 'Modifier. How do you like it: quietly, later, or all at once? ;)';
const STAT_ASK = `Last one: a stat (+${START_STAT_BONUS}). What are you good at, besides looking like THAT?`;
const CLOSING = "Now you COULD pick up a weapon at the Guild. OR you could just stay here with me. Choices, choices....";

const CLASS_REACTION: Record<MageClass, string> = {
  objects: 'Sturdy. I do love someone good with their hands.',
  life: "Loyal? Good. I'm the clingy type.",
  hexcraft: "A rule-bender. Well maybe you should bend ME.",
};

const WORD_REACTION: Record<WordId, string> = {
  bind: 'Bind? I already feel so BOUND to you. Emotionally AND Legally. UwU.',
  shadow: 'Shadow? Yours, permanently. Even in the bathroom. Too much? :3',
  veil: 'Veil? A wedding veil?! YES. Wait, you have not asked yet...',
  mind: 'Mind? Read mine. It is just YOU YOU YOU and a tiny shopping list.',
  shatter: 'Shatter my composure, why dont you?! I was being SO normal about you.',
  corrode: 'Corrode? Corrodeeznuts?? I dont even know what that means.',
  curse: 'Curse? Well at least you\'re a BLESSING!!.',
  pierce: 'Pierce? That LOOK pierced straight through my heart. Rude. Do it again >~<.',
  twist: 'Twist? Got me wrapped round your little finger. I live here now ^^.',
  reality: 'Reality? Make our imaginary wedding a reality, coward. :3',
  drain: 'Drain? The joke writes itself, doesnt it? ;).',
  heal: 'Heal? Kiss it better. What hurts? My tragic lack of your attention.',
  sand: 'Sand? Coarse. Rough. Gets everywhere. Unlike you, who gets MY NUMBER.',
  death: 'Death? Till death do us part?! maybe a bit soon. I accept.',
  desecrate: 'Desecrate? There goes my sacred vow to stop flirting. OOPS.',
  fire: 'Fire? Is it hot in your head or are you just thinking about ME?',
  lightning: 'Lightning? That spark between us needs its own safety inspector.',
  storm: 'Storm? Sweep me off my feet! Metaphorically. I have no feet.',
  subtle: 'Subtle? Of course. I shall whisper our wedding plans. VERY LOUDLY.',
  delay: 'Delay? Playing hard to get? Fine. I have already booked the venue.',
  channel: 'Channel? All that attention, straight into ME. Finally, good reception!',
  stop: 'Stop? Stop being so CUTE then. Neither of us is cooperating here.',
  water: 'Water? Thirsty? ME? Absolutely. For your undivided attention. UwU.',
  pain: 'Pain? Being apart from you is AGONY. Even just half a second.',
};

const STAT_REACTION: Record<StatKey, string> = {
  strength: 'Strong. You carry the bags. And me.',
  dex: 'Speed. So youre a quick one, huh?.',
  int: 'Clever. Finally, someone to talk to.',
  mana: 'Mysterious. I like it.',
  hp: "Tough. Good, that means you have more stamina.",
  luck: 'Lucky. Well, you did meet me.',
};

const W = GAME_WIDTH;
const H = GAME_HEIGHT;
const VOICE_Y = 150;
const ORB_Y = 382;
const EYE_Y = 382;
const SPREAD = 330;

interface Offer {
  id: string;
  title: string;
  sub: string;
  detail: string;
  color: number;
  sigil?: boolean;
}

interface Orb {
  offer: Offer;
  root: Phaser.GameObjects.Container;
  glow: Phaser.GameObjects.Arc;
  ring: Phaser.GameObjects.Graphics;
  detail: Phaser.GameObjects.Text;
}

/** Play the awakening over `scene`; resolves with the words and modifier picked. */
export function playAwakening(scene: Phaser.Scene, model: AwakeningModel): Promise<CreationPick> {
  return new Awakening(scene, model).run();
}

export type LevelWordPick = { word: WordId; replace?: number; ascend?: never }
  | { ascend: WordId; replace: number; word?: never };

export function playLevelWordChoice(
  scene: Phaser.Scene, level: number, offers: readonly WordId[], loadout: readonly WordId[], godWords: readonly WordId[],
): Promise<LevelWordPick> {
  return new Awakening(scene, { reducedMotion: isReducedMotion(), offers: () => [] })
    .runLevelWordChoice(level, offers, loadout, godWords);
}

class Awakening {
  private readonly root: Phaser.GameObjects.Container;
  private readonly eye: Phaser.GameObjects.Container;
  private readonly voice: Phaser.GameObjects.Text;
  private readonly hint: Phaser.GameObjects.Text;
  private readonly strip: Phaser.GameObjects.Container;
  private readonly fast: boolean;
  /** Skips the typing, or the wait after it; the current line's own. */
  private advance: (() => void) | null = null;
  private orbs: Orb[] = [];
  private focus = 0;
  private pickOrb: ((index: number) => void) | null = null;
  private stripCount = 0;
  private readonly onKey = (event: KeyboardEvent): void => this.key(event);
  private readonly onPointer = (): void => {
    if (!this.pickOrb) this.advance?.();
  };

  constructor(private readonly scene: Phaser.Scene, private readonly model: AwakeningModel) {
    this.fast = model.reducedMotion;
    this.root = scene.add.container(0, 0).setDepth(400);
    const black = scene.add.rectangle(0, 0, W, H, 0x020203, 1).setOrigin(0).setInteractive();
    this.root.add(black);
    this.addMotes();
    this.eye = this.buildEye();
    this.root.add(this.eye);
    if (model.who) {
      this.root.add(scene.add.text(W / 2, 40, model.who.toUpperCase(), {
        fontFamily: MENU_FONT.control,
        fontSize: '13px',
        color: MENU_HEX.brass,
        letterSpacing: 4,
      }).setOrigin(0.5));
    }
    this.voice = scene.add.text(W / 2, VOICE_Y, '', {
      fontFamily: MENU_FONT.display,
      fontSize: '26px',
      fontStyle: 'italic',
      color: MENU_HEX.bone,
      align: 'center',
      wordWrap: { width: 900 },
      lineSpacing: 6,
    }).setOrigin(0.5);
    this.hint = scene.add.text(W / 2, H - 28, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      color: MENU_HEX.boneDim,
    }).setOrigin(0.5).setAlpha(0.8);
    this.strip = scene.add.container(W / 2, H - 92);
    this.root.add([this.voice, this.hint, this.strip]);
    scene.input.keyboard?.on('keydown', this.onKey);
    scene.input.on('pointerdown', this.onPointer);
  }

  async run(): Promise<CreationPick> {
    this.root.setAlpha(0);
    await this.tween({ targets: this.root, alpha: 1, duration: 900 });
    for (const line of OPENING) await this.say(line);
    await this.say(CLASS_ASK, 0, true);
    const calling = (await this.choose(MAGE_CLASSES.map((id): Offer => ({
      id,
      title: CLASS_FACE[id].mark,
      sub: '',
      detail: '',
      color: CLASS_FACE[id].color,
    })))) as MageClass;
    this.engrave(CLASS_FACE[calling].mark, CLASS_FACE[calling].color);
    await this.say(CLASS_REACTION[calling]);
    const words: WordId[] = [];
    for (let round = 0; round < CREATION_WORD_ROUNDS; round++) {
      await this.say(WORD_ASKS[Math.min(round, WORD_ASKS.length - 1)], 0, true);
      const offers = this.model.offers(round, words).map((id): Offer => ({
        id,
        title: WORDS[id].label,
        sub: '',
        detail: WORDS[id].blurb,
        color: wordCardColor(id),
      }));
      const word = (await this.choose(offers)) as WordId;
      words.push(word);
      this.engrave(WORDS[word].label, wordCardColor(word));
      await this.say(WORD_REACTION[word]);
    }
    await this.say(MODIFIER_ASK, 0, true);
    const modifier = (await this.choose(MODIFIER_WORDS.map((id): Offer => ({
      id,
      title: WORDS[id].label,
      sub: '',
      detail: WORDS[id].blurb.replace(/^Modifier: /, ''),
      color: wordCardColor(id),
    })))) as WordId;
    this.engrave(WORDS[modifier].label, wordCardColor(modifier));
    await this.say(WORD_REACTION[modifier]);
    await this.say(STAT_ASK, 0, true);
    const stat = (await this.choose(STAT_DEFS.map((def): Offer => ({
      id: def.key,
      title: def.name,
      sub: '',
      detail: def.blurb,
      color: STAT_COLOR[def.key],
    })))) as StatKey;
    this.engrave(STAT_DEFS.find((def) => def.key === stat)!.name, STAT_COLOR[stat]);
    await this.say(STAT_REACTION[stat]);
    await this.say(CLOSING);
    await this.tween({ targets: this.root, alpha: 0, duration: 800 });
    this.destroy();
    return { calling, words, modifier, stat };
  }

  async runLevelWordChoice(
    level: number, offers: readonly WordId[], loadout: readonly WordId[], godWords: readonly WordId[],
  ): Promise<LevelWordPick> {
    this.root.setAlpha(0);
    await this.tween({ targets: this.root, alpha: 1, duration: 500 });
    await this.say(`Level ${level}: new word`, 0, true);
    const options: Offer[] = offers.map((word) => ({
      id: word, title: WORDS[word].label, sub: '', detail: WORDS[word].blurb, color: wordCardColor(word),
    }));
    if (godWords.length) options.push({
      id: 'phyrexia', title: '', sub: '', detail: 'Swap a word for a god word.',
      color: 0xc55365, sigil: true,
    });
    const picked = await this.choose(options);
    let choice: LevelWordPick;
    if (picked === 'phyrexia') {
      await this.say('Word to give up', 0, true);
      const replace = await this.choose(this.knownWords(loadout));
      await this.say('God word', 0, true);
      const ascend = await this.choose(godWords.map((word): Offer => ({
        id: word, title: WORDS[word].label, sub: '', detail: WORDS[word].blurb, color: wordCardColor(word),
      })));
      choice = { ascend: ascend as WordId, replace: Number(replace) };
    } else if (rackIsFull(loadout)) {
      await this.say('Word to replace', 0, true);
      const replace = await this.choose(this.knownWords(loadout));
      choice = { word: picked as WordId, replace: Number(replace) };
    } else {
      choice = { word: picked as WordId };
    }
    await this.tween({ targets: this.root, alpha: 0, duration: 500 });
    this.destroy();
    return choice;
  }

  private knownWords(loadout: readonly WordId[]): Offer[] {
    return loadout.flatMap((word, index) => isModifierWord(word) ? [] : [{
      id: String(index), title: WORDS[word].label, sub: '', detail: WORDS[word].blurb, color: wordCardColor(word),
    }]);
  }

  // --- Voice ---

  /** Type `text` out, then wait for a click or long enough to read it. `ask` keeps it up. */
  private say(text: string, hold = 0, ask = false): Promise<void> {
    return new Promise((resolve) => {
      this.voice.setText('').setAlpha(1);
      this.hint.setText('Click or press Enter to skip');
      let shown = 0;
      let typed = false;
      let waiter: Phaser.Time.TimerEvent | null = null;
      const finish = (): void => {
        this.advance = null;
        waiter?.remove();
        this.hint.setText('');
        if (ask) {
          resolve();
          return;
        }
        this.tween({ targets: this.voice, alpha: 0, duration: 220 }).then(() => resolve());
      };
      const typedOut = (): void => {
        if (typed) return;
        typed = true;
        typer.remove();
        this.voice.setText(text);
        if (ask) {
          finish();
          return;
        }
        this.hint.setText('Click or press Enter');
        this.advance = finish;
        waiter = this.scene.time.delayedCall(Math.max(hold, 1400 + text.length * 38), finish);
      };
      const typer = this.scene.time.addEvent({
        delay: this.fast ? 4 : 26,
        repeat: text.length - 1,
        callback: () => {
          shown += 1;
          this.voice.setText(text.slice(0, shown));
          if (shown % 4 === 1 && text[shown - 1] !== ' ') playSound('ui.hover', { gain: 0.25 });
          if (shown >= text.length) typedOut();
        },
      });
      this.advance = typedOut;
      this.pulseEye();
    });
  }

  // --- Choices ---

  private choose(offers: Offer[]): Promise<string> {
    return new Promise((resolve) => {
      this.orbs = offers.map((offer, index) => this.buildOrb(offer, index, offers.length));
      this.focus = 0;
      this.hint.setText(`1-${offers.length} or arrows and Enter, or click`);
      this.refocus();
      playSound('spell.summon', { gain: 0.5 });
      this.pickOrb = (index) => {
        this.pickOrb = null;
        this.hint.setText('');
        void this.release(index).then(() => resolve(offers[index].id));
      };
    });
  }

  private buildOrb(offer: Offer, index: number, count: number): Orb {
    const scene = this.scene;
    // Six orbs squeeze together; only the focused one shows its text.
    const crowded = count > 3;
    const spread = crowded ? Math.min(SPREAD, (W - 200) / (count - 1)) : SPREAD;
    const x = W / 2 + (index - (count - 1) / 2) * spread;
    const root = scene.add.container(W / 2, EYE_Y).setScale(0.1).setAlpha(0);
    const glow = scene.add.circle(0, 0, 84, offer.color, 0.16).setBlendMode(Phaser.BlendModes.ADD);
    const halo = scene.add.circle(0, 0, 58, offer.color, 0.1).setBlendMode(Phaser.BlendModes.ADD);
    const core = scene.add.circle(0, 0, 54, 0x0b0910, 0.94).setStrokeStyle(2, offer.color, 0.9);
    const ring = scene.add.graphics();
    ring.lineStyle(2, offer.color, 0.75);
    for (let i = 0; i < 6; i++) {
      const start = (i / 6) * Math.PI * 2;
      ring.beginPath();
      ring.arc(0, 0, 66, start, start + 0.62);
      ring.strokePath();
      ring.fillStyle(offer.color, 0.9);
      ring.fillCircle(Math.cos(start + 0.8) * 66, Math.sin(start + 0.8) * 66, 2);
    }
    const title = offer.sigil ? scene.add.graphics() : scene.add.text(0, 0, offer.title, {
      fontFamily: MENU_FONT.display,
      fontSize: offer.title.length > 8 ? '19px' : '24px',
      fontStyle: 'bold',
      color: '#ffffff',
    }).setOrigin(0.5).setShadow(0, 0, Phaser.Display.Color.IntegerToColor(offer.color).rgba, 10, true, true);
    if (offer.sigil && title instanceof Phaser.GameObjects.Graphics) {
      title.lineStyle(5, 0xf2c7bd, 1);
      title.beginPath();
      title.arc(0, 4, 27, -Math.PI * 0.85, Math.PI * 0.85);
      title.strokePath();
      title.beginPath();
      title.moveTo(0, -35);
      title.lineTo(0, 28);
      title.moveTo(-13, -30);
      title.lineTo(0, -40);
      title.lineTo(13, -30);
      title.strokePath();
      title.fillStyle(0xc55365, 1);
      title.fillCircle(0, 4, 5);
    }
    const key = scene.add.text(0, -98, `${index + 1}`, {
      fontFamily: MENU_FONT.control,
      fontSize: '13px',
      color: MENU_HEX.boneDim,
    }).setOrigin(0.5);
    const lines: Phaser.GameObjects.GameObject[] = [glow, halo, ring, core, title, key];
    const below = offer.sub ? `${offer.sub}\n\n${offer.detail}` : offer.detail;
    const detail = scene.add.text(0, 98, below, {
      fontFamily: MENU_FONT.body,
      fontSize: '14px',
      color: MENU_HEX.bone,
      align: 'center',
      wordWrap: { width: 270 },
      lineSpacing: 3,
    }).setOrigin(0.5, 0).setAlpha(0);
    lines.push(detail);
    root.add(lines);
    root.setSize(170, 170).setInteractive({ useHandCursor: true });
    root.on('pointerover', () => {
      if (!this.pickOrb || this.focus === index) return;
      this.focus = index;
      this.refocus();
      playSound('ui.hover');
    });
    root.on('pointerdown', () => this.pickOrb?.(index));
    this.root.add(root);

    const delay = this.fast ? 0 : 120 + index * 170;
    const duration = this.fast ? 1 : 720;
    scene.tweens.add({ targets: root, x, y: ORB_Y, scale: 1, alpha: 1, delay, duration, ease: 'Back.Out' });
    if (!crowded) scene.tweens.add({ targets: detail, alpha: 1, delay: delay + duration * 0.6, duration: this.fast ? 1 : 360 });
    else detail.setX(W / 2 - x);
    if (!this.fast) {
      scene.tweens.add({ targets: ring, angle: index % 2 === 0 ? 360 : -360, duration: 9000, repeat: -1 });
      scene.tweens.add({ targets: [glow, halo], scale: 1.12, duration: 1300 + index * 170, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      scene.tweens.add({ targets: [core, title, ring, glow, halo], y: '-=7', delay: delay + duration, duration: 1600 + index * 230, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
    return { offer, root, glow, ring, detail };
  }

  private refocus(): void {
    const crowded = this.orbs.length > 3;
    this.orbs.forEach((orb, index) => {
      const on = index === this.focus;
      this.scene.tweens.add({ targets: orb.root, scale: on ? 1.1 : 0.94, duration: this.fast ? 1 : 180, ease: 'Sine.Out' });
      orb.glow.setFillStyle(orb.offer.color, on ? 0.3 : 0.12);
      orb.detail.setColor(on ? MENU_HEX.bone : MENU_HEX.boneDim);
      if (crowded) orb.detail.setAlpha(on ? 1 : 0);
    });
  }

  /** The picked orb drifts into the eye and flares; the rest fade out. */
  private async release(index: number): Promise<void> {
    const picked = this.orbs[index];
    const others = this.orbs.filter((_, i) => i !== index);
    playSound('ui.confirm');
    picked.root.disableInteractive();
    for (const orb of others) {
      orb.root.disableInteractive();
      this.scene.tweens.add({ targets: orb.root, alpha: 0, scale: 0.5, y: ORB_Y + 50, duration: this.fast ? 1 : 420, ease: 'Sine.In' });
    }
    this.scene.tweens.add({ targets: picked.detail, alpha: 0, duration: this.fast ? 1 : 200 });
    await this.tween({ targets: picked.root, x: W / 2, y: EYE_Y, scale: 1.35, duration: this.fast ? 1 : 620, ease: 'Cubic.InOut' });
    playSound('spell.heal', { gain: 0.7 });
    this.flare(picked.offer.color);
    await this.tween({ targets: picked.root, scale: 0.2, alpha: 0, duration: this.fast ? 1 : 360, ease: 'Cubic.In' });
    for (const orb of this.orbs) {
      this.scene.tweens.killTweensOf(orb.root.list);
      this.scene.tweens.killTweensOf(orb.root);
      orb.root.destroy();
    }
    this.orbs = [];
  }

  private flare(color: number): void {
    const scene = this.scene;
    const flash = scene.add.rectangle(0, 0, W, H, color, this.fast ? 0.12 : 0.28).setOrigin(0).setBlendMode(Phaser.BlendModes.ADD);
    this.root.add(flash);
    scene.tweens.add({ targets: flash, alpha: 0, duration: 520, onComplete: () => flash.destroy() });
    if (this.fast) return;
    for (let i = 0; i < 3; i++) {
      const wave = scene.add.circle(W / 2, EYE_Y, 30, color, 0).setStrokeStyle(3 - i, color, 0.9);
      this.root.add(wave);
      scene.tweens.add({ targets: wave, scale: 6 + i * 2, alpha: 0, delay: i * 110, duration: 900, ease: 'Cubic.Out', onComplete: () => wave.destroy() });
    }
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2;
      const spark = scene.add.circle(W / 2, EYE_Y, 2 + (i % 3), color, 1).setBlendMode(Phaser.BlendModes.ADD);
      this.root.add(spark);
      const reach = 140 + (i % 4) * 45;
      scene.tweens.add({
        targets: spark,
        x: W / 2 + Math.cos(angle) * reach,
        y: EYE_Y + Math.sin(angle) * reach,
        alpha: 0,
        duration: 700 + (i % 5) * 80,
        ease: 'Cubic.Out',
        onComplete: () => spark.destroy(),
      });
    }
    this.scene.tweens.add({ targets: this.eye, scale: 1.25, duration: 160, yoyo: true, ease: 'Sine.Out' });
  }

  /** The words named so far, kept along the bottom. */
  private engrave(label: string, color: number): void {
    const x = this.stripCount * 150;
    this.stripCount += 1;
    const text = this.scene.add.text(x, 0, label.toUpperCase(), {
      fontFamily: MENU_FONT.display,
      fontSize: '18px',
      fontStyle: 'bold',
      color: Phaser.Display.Color.IntegerToColor(color).rgba,
      letterSpacing: 3,
    }).setOrigin(0.5).setAlpha(0);
    const dot = this.scene.add.circle(x, 20, 3, color, 1);
    this.strip.add([text, dot]);
    this.strip.x = W / 2 - ((this.stripCount - 1) * 150) / 2;
    this.scene.tweens.add({ targets: text, alpha: 1, y: { from: -30, to: 0 }, duration: this.fast ? 1 : 520, ease: 'Back.Out' });
  }

  // --- Scenery ---

  private addMotes(): void {
    const scene = this.scene;
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * W;
      const y = Math.random() * H;
      const tint = [0x8a6bff, 0x6ad1ff, 0xd8cbae, 0xff8be0][i % 4];
      const mote = scene.add.circle(x, y, Math.random() < 0.2 ? 2 : 1, tint, 0.2 + Math.random() * 0.5);
      this.root.add(mote);
      if (this.fast) continue;
      scene.tweens.add({
        targets: mote,
        y: y - 40 - Math.random() * 120,
        x: x + (Math.random() - 0.5) * 60,
        alpha: 0,
        duration: 5000 + Math.random() * 7000,
        delay: Math.random() * 3000,
        repeat: -1,
        onRepeat: () => mote.setAlpha(0.2 + Math.random() * 0.5),
      });
    }
  }

  /** The thing in the middle that listens: slow rings around a soft glow. */
  private buildEye(): Phaser.GameObjects.Container {
    const scene = this.scene;
    const eye = scene.add.container(W / 2, EYE_Y);
    const glow = scene.add.circle(0, 0, 120, 0x8a6bff, 0.06).setBlendMode(Phaser.BlendModes.ADD);
    const inner = scene.add.circle(0, 0, 36, 0xd8cbae, 0.05).setBlendMode(Phaser.BlendModes.ADD);
    const rings = [150, 196].map((radius, index) => {
      const ring = scene.add.graphics();
      ring.lineStyle(1, 0xd8cbae, 0.16 - index * 0.05);
      const pieces = 12 + index * 6;
      for (let i = 0; i < pieces; i++) {
        const start = (i / pieces) * Math.PI * 2;
        ring.beginPath();
        ring.arc(0, 0, radius, start, start + (Math.PI * 2) / pieces * 0.55);
        ring.strokePath();
      }
      return ring;
    });
    eye.add([glow, inner, ...rings]);
    if (!this.fast) {
      scene.tweens.add({ targets: rings[0], angle: 360, duration: 40000, repeat: -1 });
      scene.tweens.add({ targets: rings[1], angle: -360, duration: 60000, repeat: -1 });
      scene.tweens.add({ targets: glow, scale: 1.15, alpha: 0.1, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
    return eye;
  }

  private pulseEye(): void {
    if (this.fast) return;
    const inner = this.eye.list[1] as Phaser.GameObjects.Arc;
    this.scene.tweens.add({ targets: inner, scale: 1.6, alpha: 0.4, duration: 200, yoyo: true, ease: 'Sine.Out' });
  }

  // --- Plumbing ---

  private key(event: KeyboardEvent): void {
    if (this.pickOrb) {
      const count = this.orbs.length;
      const number = Number(event.key);
      if (Number.isInteger(number) && number >= 1 && number <= count) {
        this.pickOrb(number - 1);
      } else if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') {
        this.focus = (this.focus + count - 1) % count;
        this.refocus();
        playSound('ui.hover');
      } else if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') {
        this.focus = (this.focus + 1) % count;
        this.refocus();
        playSound('ui.hover');
      } else if (event.key === 'Enter' || event.key === ' ' || event.key === 'e' || event.key === 'E') {
        this.pickOrb(this.focus);
      }
      return;
    }
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'e' || event.key === 'E' || event.key === 'Escape') this.advance?.();
  }

  private tween(config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return new Promise((resolve) => {
      this.scene.tweens.add({
        ...config,
        duration: this.fast ? Math.min(Number(config.duration ?? 1), 120) : config.duration,
        onComplete: () => resolve(),
      });
    });
  }

  private destroy(): void {
    this.scene.input.keyboard?.off('keydown', this.onKey);
    this.scene.input.off('pointerdown', this.onPointer);
    this.scene.tweens.killTweensOf(this.root.list);
    for (const child of this.root.list) {
      if (child instanceof Phaser.GameObjects.Container) this.scene.tweens.killTweensOf(child.list);
    }
    this.root.destroy();
  }
}
