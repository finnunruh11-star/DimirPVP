// The start of a run: a black screen, a chatty voice in your head, a question
// about what you reach for, three glowing words to pick from, twice, then a way
// of getting things done. It only asks; applying the picks is `applyCreation`'s job.

import Phaser from 'phaser';
import { playSound } from '../../audio';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config/constants';
import { MAGE_CLASSES, type MageClass } from '../../core/Classes';
import { STAT_DEFS, type StatKey } from '../../core/Stats';
import { MODIFIER_WORDS, WORDS, type WordId } from '../../core/Words';
import { CREATION_WORD_ROUNDS, type CreationPick } from '../../pve/exploration/creation';
import { START_STAT_BONUS } from '../../pve/progression';
import { MENU_FONT, MENU_HEX } from '../cabinet/theme';

export interface AwakeningModel {
  /** The traveller's name, when several share one screen. */
  who?: string;
  /** The words on offer in word round `round`, given the ones already taken. */
  offers(round: number, taken: readonly WordId[]): WordId[];
  reducedMotion: boolean;
}

const OPENING = [
  'Hey. Hey, you. Yes, you, standing in the mud.',
  "Don't panic. I'm the voice in your head. Everyone gets one. You got the chatty one.",
  "Quick game: first word that comes to mind. Don't think about it. Thinking is how people end up as accountants.",
];

const FIRST_ASK = 'Go on. First word.';
const SECOND_ASK = 'Another one. The first one looks lonely.';

const CALLING_ASK = 'Before the words. Something needs doing. What do you reach for?';

/** What each calling looks like from inside your head. Never the class's name. */
const CALLING_FACE: Record<MageClass, { title: string; mark: string; line: string; detail: string; reaction: string; color: number }> = {
  objects: {
    title: 'Something Sturdy',
    mark: 'Sturdy',
    line: "A blade. A buckle. A boot. Things that don't argue back.",
    detail: 'Your spells will want to live in what you carry.',
    reaction: 'Practical. Your belongings are about to get very opinionated.',
    color: 0xd9b25a,
  },
  life: {
    title: 'Someone Loyal',
    mark: 'Loyal',
    line: 'A friend, a pet, a thing with teeth. Ideally all three.',
    detail: 'Your spells will want to get up and walk around.',
    reaction: 'Company. Good. I was running out of things to say to just you.',
    color: 0x7fd18a,
  },
  hexcraft: {
    title: 'The Rules',
    mark: 'Rules',
    line: 'Bend them until the whole place works for you.',
    detail: 'Your spells will want to change how everything works.',
    reaction: "A rule-bender. Fine. Don't bend me, I'm load-bearing.",
    color: 0xb98bff,
  },
};

const WORD_REACTION: Partial<Record<WordId, string>> = {
  bind: 'Bind. Tying things up. Very tidy of you.',
  shadow: "Shadow. Moody. You'll want a darker coat.",
  veil: 'Veil. Now you see me, now you owe me money.',
  mind: "Mind. Poking around in other people's heads. Rude, but handy.",
  shatter: 'Shatter. Things are going to break. Try to aim it.',
  corrode: 'Corrode. Melting stuff. Hope you like the smell.',
  curse: 'Curse. Petty, and it lasts. I respect that.',
  pierce: 'Pierce. Pointy. Gets straight to the point.',
  water: "Water. Pushing people around, wetly. They'll hate that.",
  pain: 'Pain. No tricks, it just hurts. Their heads, ideally.',
};

const PAIR_REACTION = [
  "Good pair. They'll get along. Mostly.",
  'Lovely. Those two have never met, but they will now.',
  "Solid. I'd have picked the same. I didn't, but I would have.",
];

const MODIFIER_ASK = "Last one, and it's not really a word. How do you get things done?";

const MODIFIER_FACE: Partial<Record<WordId, { label: string; line: string; reaction: string }>> = {
  subtle: {
    label: 'Quietly',
    line: 'Nobody saw anything. Nobody can prove anything.',
    reaction: "Sneaky. I'll keep my voice down. Starting... now. Okay, maybe next time.",
  },
  delay: {
    label: 'Eventually',
    line: 'When the moment is right. Or when you remember.',
    reaction: 'Fashionably late. Noted. Eventually.',
  },
  channel: {
    label: 'All at once',
    line: 'Big wind-up, bigger bang, then a little sit-down.',
    reaction: 'Loud. Good. I was getting bored in here.',
  },
};

const STAT_ASK = "One more, then I'll stop. Probably. What are you good at?";

const STAT_FACE: Record<StatKey, { line: string; reaction: string; color: number }> = {
  strength: { line: 'Hitting things. Hard.', reaction: 'Strong. Good. You carry the bags.', color: 0xd9523f },
  dex: { line: 'Being somewhere else, quickly.', reaction: 'Quick on your feet. Try not to trip over them.', color: 0x6fd35a },
  int: { line: 'Knowing things. Spells come easier.', reaction: 'Clever. Finally, someone to talk to.', color: 0x4f8fe0 },
  mana: { line: 'Having more in the tank.', reaction: "Deep reserves. You'll need them.", color: 0x8a6fe0 },
  hp: { line: 'Not dying. Very underrated.', reaction: "Tough. I like that. I'm in here too, you know.", color: 0xe06f8a },
  luck: { line: 'Things just... working out.', reaction: "Lucky. Don't push it.", color: 0xe0c24f },
};

const CLOSING = [
  "Right, that's you sorted. Something to reach for, two words, a way of doing things, and something you're good at. More than most people have.",
  "One problem: you're not armed. Kerusai won't let you out the gate like that, I checked.",
  'The Lodge hands out weapons to new folk. Go get something pointy. Or blunt. Your call.',
];

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
    await this.say(CALLING_ASK, 0, true);
    const calling = (await this.choose(MAGE_CLASSES.map((id): Offer => ({
      id,
      title: CALLING_FACE[id].mark,
      sub: `${CALLING_FACE[id].title}. ${CALLING_FACE[id].line}`,
      detail: CALLING_FACE[id].detail,
      color: CALLING_FACE[id].color,
    })))) as MageClass;
    this.engrave(CALLING_FACE[calling].mark, CALLING_FACE[calling].color);
    await this.say(CALLING_FACE[calling].reaction);
    const words: WordId[] = [];
    for (let round = 0; round < CREATION_WORD_ROUNDS; round++) {
      await this.say(round === 0 ? FIRST_ASK : SECOND_ASK, 0, true);
      const offers = this.model.offers(round, words).map((id): Offer => ({
        id,
        title: WORDS[id].label,
        sub: '',
        detail: WORDS[id].blurb,
        color: WORDS[id].color,
      }));
      const word = (await this.choose(offers)) as WordId;
      words.push(word);
      this.engrave(WORDS[word].label, WORDS[word].color);
      await this.say(WORD_REACTION[word] ?? `${WORDS[word].label}. Sure. Why not.`);
      if (round === CREATION_WORD_ROUNDS - 1) {
        await this.say(PAIR_REACTION[(words[0].length + words[1].length) % PAIR_REACTION.length]);
      }
    }
    await this.say(MODIFIER_ASK, 0, true);
    const modifier = (await this.choose(MODIFIER_WORDS.map((id): Offer => {
      const face = MODIFIER_FACE[id];
      return {
        id,
        title: face?.label ?? WORDS[id].label,
        sub: face ? `${face.line}` : '',
        detail: `${WORDS[id].label}. ${WORDS[id].blurb.replace(/^Modifier: /, '')}`,
        color: WORDS[id].color,
      };
    }))) as WordId;
    this.engrave(WORDS[modifier].label, WORDS[modifier].color);
    await this.say(MODIFIER_FACE[modifier]?.reaction ?? 'Noted.');
    await this.say(STAT_ASK, 0, true);
    const stat = (await this.choose(STAT_DEFS.map((def): Offer => ({
      id: def.key,
      title: def.name,
      sub: STAT_FACE[def.key].line,
      detail: `${def.blurb} Starts +${START_STAT_BONUS}.`,
      color: STAT_FACE[def.key].color,
    })))) as StatKey;
    this.engrave(STAT_DEFS.find((def) => def.key === stat)!.name, STAT_FACE[stat].color);
    await this.say(STAT_FACE[stat].reaction);
    for (const line of CLOSING) await this.say(line);
    await this.tween({ targets: this.root, alpha: 0, duration: 800 });
    this.destroy();
    return { calling, words, modifier, stat };
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
    const title = scene.add.text(0, 0, offer.title, {
      fontFamily: MENU_FONT.display,
      fontSize: offer.title.length > 8 ? '19px' : '24px',
      fontStyle: 'bold',
      color: '#ffffff',
    }).setOrigin(0.5).setShadow(0, 0, Phaser.Display.Color.IntegerToColor(offer.color).rgba, 10, true, true);
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
