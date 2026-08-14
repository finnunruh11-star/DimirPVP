export interface TextEntryOptions {
  value: string;
  maxLength: number;
  inputMode?: 'text' | 'url' | 'numeric';
  ariaLabel?: string;
  commitOnBlur?: boolean;
  onChange: (value: string) => void;
  onDone: (committed: boolean) => void;
}

export class TextEntry {
  private input: HTMLInputElement | null = null;
  private finishCallback: ((committed: boolean) => void) | null = null;

  get active(): boolean {
    return this.input !== null;
  }

  begin(options: TextEntryOptions): void {
    this.finish(false);
    const input = document.createElement('input');
    input.type = 'text';
    input.value = options.value;
    input.maxLength = options.maxLength;
    input.inputMode = options.inputMode ?? 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', options.ariaLabel ?? 'Dimir menu text entry');
    Object.assign(input.style, {
      position: 'fixed',
      left: '-10000px',
      top: '0',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
    });
    this.input = input;
    this.finishCallback = options.onDone;

    const stop = (event: Event): void => event.stopPropagation();
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        this.finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.finish(false);
      }
    });
    input.addEventListener('keyup', stop);
    input.addEventListener('input', () => options.onChange(input.value));
    if (options.commitOnBlur !== false) input.addEventListener('blur', () => this.finish(true));
    document.body.appendChild(input);
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
  }

  finish(committed: boolean): void {
    const input = this.input;
    const callback = this.finishCallback;
    this.input = null;
    this.finishCallback = null;
    if (input) {
      input.onblur = null;
      input.remove();
    }
    callback?.(committed);
  }

  focus(): void {
    this.input?.focus({ preventScroll: true });
  }

  destroy(): void {
    this.finish(false);
  }
}
