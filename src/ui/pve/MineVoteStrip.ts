// A party vote shown in a mine window: who wants which way, and, for the leader,
// a button that settles it on the votes cast so far.

import Phaser from 'phaser';
import { CabinetChip, type MenuFocusGroup } from '../cabinet/controls';
import { MENU_FONT, MENU_HEX } from '../cabinet/theme';

export interface MineVoteMark {
  choice: string;
  color: number;
  initial: string;
}

export interface MineVoteState {
  /** "Votes 2/3   Finn: North   Alex: East   Waiting: Sam". */
  line: string;
  marks: MineVoteMark[];
  /** The leader may settle the vote on what has been cast. */
  canDecide: boolean;
}

/** Windows that can show a running vote. */
export interface MineVoteDisplay {
  setVotes(state: MineVoteState): void;
}

export class MineVoteStrip {
  private readonly text: Phaser.GameObjects.Text;
  private readonly chip?: CabinetChip;

  constructor(
    scene: Phaser.Scene,
    parent: Phaser.GameObjects.Container,
    at: { x: number; y: number; width: number; chip?: { x: number; y: number } },
    focus: MenuFocusGroup,
    decide: () => void,
  ) {
    this.text = scene.add.text(at.x, at.y, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
      align: 'center',
      fixedWidth: at.width,
    }).setOrigin(0.5);
    parent.add(this.text);
    if (at.chip) {
      this.chip = new CabinetChip(scene, at.chip.x, at.chip.y, {
        width: 170,
        height: 34,
        label: 'Decide now',
        tone: 'primary',
        onActivate: decide,
      });
      this.chip.setVisible(false).setEnabled(false);
      parent.add(this.chip);
      focus.add(this.chip);
    }
  }

  set(state: MineVoteState): void {
    this.text.setText(state.line);
    this.chip?.setVisible(state.canDecide).setEnabled(state.canDecide);
  }
}
