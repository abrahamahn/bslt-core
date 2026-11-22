// main/kernel/ui/src/components/Markdown.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Markdown } from './Markdown';

describe('Markdown', () => {
  it('renders raw HTML in a document as visible text, never as markup', () => {
    const { container } = render(<Markdown>{'<script>alert(1)</script>'}</Markdown>);

    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
  });

  it('renders an img with an onerror handler as text, not as an element', () => {
    const { container } = render(<Markdown>{'<img src=x onerror=alert(1)>'}</Markdown>);

    expect(container.querySelector('img')).toBeNull();
  });

  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['vbscript:msgbox(1)'],
  ])('neutralises a %s link to an inert #', (hostile) => {
    render(<Markdown>{`[click me](${hostile})`}</Markdown>);

    expect(screen.getByRole('link', { name: 'click me' })).toHaveAttribute('href', '#');
  });

  it('opens an external link in a new tab without handing it a window handle', () => {
    render(<Markdown>{'[docs](https://example.com/docs)'}</Markdown>);

    const link = screen.getByRole('link', { name: 'docs' });
    expect(link).toHaveAttribute('href', 'https://example.com/docs');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer noopener');
  });

  it('keeps an internal link in the same tab', () => {
    render(<Markdown>{'[our terms](/terms)'}</Markdown>);

    const link = screen.getByRole('link', { name: 'our terms' });
    expect(link).toHaveAttribute('href', '/terms');
    expect(link).not.toHaveAttribute('target');
  });

  it('renders nested emphasis as nested elements', () => {
    const { container } = render(<Markdown>{'_read this **carefully**_'}</Markdown>);

    expect(container.querySelector('em > strong')).not.toBeNull();
    expect(container.textContent).not.toContain('*');
  });

  it('renders a heading, a list and a table', () => {
    render(
      <Markdown>
        {'# Title\n\n- one\n- two\n\n| Cookie | Purpose |\n| --- | --- |\n| sid | Session |'}
      </Markdown>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('columnheader', { name: 'Cookie' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'sid' })).toBeInTheDocument();
  });

  it('renders an empty document as an empty wrapper rather than throwing', () => {
    const { container } = render(<Markdown>{''}</Markdown>);

    expect(container.querySelector('.markdown-content')?.childElementCount).toBe(0);
  });

  it('carries the design-system markdown class and appends a caller className', () => {
    const { container } = render(<Markdown className="legal">{'Body.'}</Markdown>);

    expect(container.firstElementChild).toHaveClass('markdown-content', 'legal');
  });
});
