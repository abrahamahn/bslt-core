// main/kernel/ui/src/elements/IconButton.test.tsx
/** @vitest-environment jsdom */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { IconButton, type IconButtonProps } from './IconButton';

const elementsCssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../styles/elements.css');

/** The rule body for a single class selector, e.g. `.icon-btn-small { … }`. */
const ruleBody = (css: string, className: string): string =>
  new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

/** The `--ui-icon-btn-size` a class declares, if any. */
const declaredEdge = (css: string, className: string): string | undefined =>
  /--ui-icon-btn-size:\s*([^;]+);/.exec(ruleBody(css, className))?.[1]?.trim();

/** The body of the `@media (pointer: coarse)` block, i.e. what touch devices get. */
const coarsePointerBlock = (css: string): string =>
  /@media\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';

/** What a rendered button's classes actually resolve to: size class, else the base default. */
const resolvedEdge = (css: string, button: HTMLElement): string | undefined => {
  const sizeClass = [...button.classList].find((name) => /^icon-btn-/.test(name)) ?? '';
  return declaredEdge(css, sizeClass) ?? declaredEdge(css, 'icon-btn');
};

const sizes: ReadonlyArray<NonNullable<IconButtonProps['size']>> = ['small', 'medium', 'large'];

describe('IconButton', () => {
  it('renders its icon child', () => {
    render(
      <IconButton aria-label="Show chat">
        <span aria-hidden="true">💬</span>
      </IconButton>,
    );

    expect(screen.getByRole('button', { name: 'Show chat' })).toHaveTextContent('💬');
  });

  it('is a real <button> named by its aria-label', () => {
    render(<IconButton aria-label="Collapse sidebar" />);

    const button = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('requires aria-label at the type level', () => {
    // If `aria-label` were optional, the props minus `aria-label` would still satisfy
    // IconButtonProps, this conditional would resolve to `false`, and the assignment
    // below would not compile. That type error is the test.
    const ariaLabelIsRequired: Omit<IconButtonProps, 'aria-label'> extends IconButtonProps
      ? false
      : true = true;

    expect(ariaLabelIsRequired).toBe(true);
  });

  it('defaults to the medium size', () => {
    render(<IconButton aria-label="Toggle" />);

    expect(screen.getByRole('button')).toHaveClass('icon-btn', 'icon-btn-medium');
  });

  it('maps every size to a distinct edge length in the stylesheet', async () => {
    const css = await readFile(elementsCssPath, 'utf8');

    const edges = sizes.map((size) => {
      const { unmount } = render(<IconButton aria-label="Toggle" size={size} />);
      const edge = resolvedEdge(css, screen.getByRole('button'));
      unmount();
      return edge;
    });

    expect(edges.every((edge) => edge !== undefined && /^\d*\.?\d+rem$/.test(edge))).toBe(true);
    expect(new Set(edges).size).toBe(sizes.length);
  });

  it('drives both axes from the single edge-length variable', async () => {
    const css = await readFile(elementsCssPath, 'utf8');
    const base = ruleBody(css, 'icon-btn');

    for (const axis of ['width', 'height', 'min-width', 'min-height']) {
      expect(base).toMatch(new RegExp(`(^|[;\\s])${axis}:\\s*var\\(--ui-icon-btn-size\\);`));
    }
  });

  it('grows to the touch-target floor on coarse pointers', async () => {
    // `btn-inline` (which IconButton rides on to kill padding) is excluded from the
    // library's coarse-pointer floor, so IconButton has to declare its own.
    const css = await readFile(elementsCssPath, 'utf8');
    const floor = ruleBody(coarsePointerBlock(css), 'icon-btn');

    expect(floor).toMatch(/min-width:\s*var\(--ui-touch-target\);/);
    expect(floor).toMatch(/min-height:\s*var\(--ui-touch-target\);/);
  });

  it('forwards the variant to Button', () => {
    render(<IconButton aria-label="Delete" variant="danger" />);

    expect(screen.getByRole('button')).toHaveClass('btn-danger');
  });

  it('emits both btn-inline and the icon size class', () => {
    // btn-inline kills Button's padding; icon-btn-large sets the edge. If a
    // refactor ever forwards `size` to Button instead, padding comes back and
    // one of these assertions fails.
    render(<IconButton aria-label="Toggle" size="large" />);

    expect(screen.getByRole('button')).toHaveClass('btn-inline', 'icon-btn-large');
  });

  it('keeps consumer class names alongside the icon classes', () => {
    render(<IconButton aria-label="Toggle" className="app-sidebar__collapse" />);

    expect(screen.getByRole('button')).toHaveClass('icon-btn', 'app-sidebar__collapse');
  });

  it('renders a clean class list when className is omitted', () => {
    render(<IconButton aria-label="Toggle" />);

    expect(screen.getByRole('button').className).not.toMatch(/undefined|\s{2,}|\s$/);
  });

  it('does not clobber a consumer type="submit"', () => {
    render(<IconButton aria-label="Save" type="submit" />);

    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();

    render(<IconButton aria-label="Toggle" onClick={handleClick} />);
    await user.click(screen.getByRole('button'));

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire onClick while disabled', async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();

    render(<IconButton aria-label="Toggle" disabled onClick={handleClick} />);
    await user.click(screen.getByRole('button'));

    expect(handleClick).not.toHaveBeenCalled();
  });

  it('leaves the tab order while disabled', async () => {
    const user = userEvent.setup();

    render(<IconButton aria-label="Toggle" disabled />);
    await user.tab();

    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByRole('button')).not.toHaveFocus();
  });
});
