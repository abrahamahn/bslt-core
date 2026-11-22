// main/apps/web/src/utils/submitOnEnter.ts
/**
 * Enter-to-submit helper for layouts where a native `<form onSubmit>` does not
 * fit — e.g. a Dialog whose inputs (Dialog.Body) and submit button (Dialog.Footer)
 * live in separate sections.
 */

import type { KeyboardEvent } from 'react';

/**
 * Returns an `onKeyDown` handler that invokes `submit` when Enter is pressed in
 * a single-line text input. Attach it to a container (e.g. `Dialog.Body`) so it
 * catches Enter bubbling up from any input inside.
 *
 * Only plain text-like `<input>` elements trigger submission; textareas,
 * selects, checkboxes/radios, buttons, and custom widgets keep their own Enter
 * behavior. `submit` is expected to self-guard (no-op when the form is
 * incomplete or in flight).
 */
export function submitOnEnter(submit: () => void): (event: KeyboardEvent<HTMLElement>) => void {
  return (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    const target = event.target as HTMLElement;
    if (target.tagName !== 'INPUT') return;
    const type = (target as HTMLInputElement).type;
    if (type === 'checkbox' || type === 'radio' || type === 'button' || type === 'submit') return;
    event.preventDefault();
    submit();
  };
}
