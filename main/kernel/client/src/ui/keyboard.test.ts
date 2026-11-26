// main/kernel/client/src/ui/keyboard.test.ts
import { describe, expect, it } from 'vitest';

import {
  formatKeyBinding,
  isEditableElement,
  isMac,
  matchesAnyBinding,
  matchesKeyBinding,
  matchesModifiers,
  parseKeyBinding,
} from './keyboard';

function makeKeyEvent(init: {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
  readonly metaKey?: boolean;
}): KeyboardEvent {
  return {
    key: init.key,
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
    metaKey: init.metaKey ?? false,
  } as unknown as KeyboardEvent;
}

describe('keyboard utilities', () => {
  it('handles non-DOM targets safely and exposes platform detection', () => {
    expect(isEditableElement(null)).toBe(false);
    expect(isEditableElement({} as EventTarget)).toBe(false);
    expect(typeof isMac()).toBe('boolean');
  });

  it('parses modifier aliases, matches keyboard events strictly, and formats bindings per OS', () => {
    const parsed = parseKeyBinding('ctrl+shift+k');
    expect(parsed).toEqual({ key: 'k', ctrl: true, alt: false, shift: true, meta: false });

    expect(parseKeyBinding('cmd+option+enter')).toEqual({
      key: 'enter',
      ctrl: false,
      alt: true,
      shift: false,
      meta: true,
    });

    const wrongKey = makeKeyEvent({ key: 'j', ctrlKey: true, shiftKey: true });
    expect(matchesKeyBinding(wrongKey, parsed)).toBe(false);

    const missingShift = makeKeyEvent({ key: 'k', ctrlKey: true, shiftKey: false });
    expect(matchesKeyBinding(missingShift, parsed)).toBe(false);

    const exact = makeKeyEvent({ key: 'K', ctrlKey: true, shiftKey: true });
    expect(matchesModifiers(exact, parsed, false)).toBe(true);
    expect(matchesAnyBinding(exact, ['alt+x', 'ctrl+shift+k'])).toBe(true);
    expect(matchesAnyBinding(wrongKey, ['alt+x', 'ctrl+shift+k'])).toBe(false);

    expect(formatKeyBinding(parsed, true)).toBe('Cmd+Shift+K');
    expect(formatKeyBinding(parsed, false)).toBe('Ctrl+Shift+K');
    expect(formatKeyBinding(parseKeyBinding('meta+alt+p'), false)).toBe('Win+Alt+P');
  });
});
