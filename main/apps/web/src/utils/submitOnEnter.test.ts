// main/apps/web/src/utils/submitOnEnter.test.ts

import { describe, expect, it, vi } from 'vitest';

import { submitOnEnter } from './submitOnEnter';

import type { KeyboardEvent } from 'react';

function makeEvent(overrides: {
  key?: string;
  shiftKey?: boolean;
  tagName?: string;
  type?: string;
}): KeyboardEvent<HTMLElement> {
  const preventDefault = vi.fn();
  return {
    key: overrides.key ?? 'Enter',
    shiftKey: overrides.shiftKey ?? false,
    preventDefault,
    target: { tagName: overrides.tagName ?? 'INPUT', type: overrides.type ?? 'text' },
  } as unknown as KeyboardEvent<HTMLElement>;
}

describe('submitOnEnter', () => {
  it('submits and prevents default on Enter in a text input', () => {
    const submit = vi.fn();
    const event = makeEvent({});
    submitOnEnter(submit)(event);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('ignores non-Enter keys and Shift+Enter', () => {
    const submit = vi.fn();
    submitOnEnter(submit)(makeEvent({ key: 'a' }));
    submitOnEnter(submit)(makeEvent({ shiftKey: true }));
    expect(submit).not.toHaveBeenCalled();
  });

  it('ignores Enter from textareas, selects, buttons, and checkboxes', () => {
    const submit = vi.fn();
    submitOnEnter(submit)(makeEvent({ tagName: 'TEXTAREA' }));
    submitOnEnter(submit)(makeEvent({ tagName: 'SELECT' }));
    submitOnEnter(submit)(makeEvent({ tagName: 'BUTTON' }));
    submitOnEnter(submit)(makeEvent({ type: 'checkbox' }));
    submitOnEnter(submit)(makeEvent({ type: 'radio' }));
    expect(submit).not.toHaveBeenCalled();
  });
});
