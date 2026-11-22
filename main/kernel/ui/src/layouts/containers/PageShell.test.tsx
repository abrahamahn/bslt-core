// main/kernel/ui/src/layouts/containers/PageShell.test.tsx
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { PageHeader, PageShell } from './PageShell';

describe('PageShell and PageHeader', () => {
  it('renders PageShell with PageHeader title, eyebrow, description, and actions', () => {
    const shellRef = createRef<HTMLDivElement>();
    render(
      <PageShell
        ref={shellRef}
        size="md"
        gap="xl"
        header={
          <PageHeader
            eyebrow="Workspace"
            title="Team Settings"
            description="Manage members and permissions."
            actions={<button type="button">Invite</button>}
          />
        }
        data-testid="page-shell"
      >
        <div>Body content</div>
      </PageShell>,
    );

    const shell = screen.getByTestId('page-shell');
    expect(shell.tagName).toBe('DIV');
    expect(shell).toHaveClass('ui-page-shell');
    expect(shell).toHaveAttribute('data-size', 'md');
    expect(shell).toHaveAttribute('data-gap', 'xl');
    expect(shellRef.current).toBe(shell);

    expect(screen.getByRole('heading', { level: 1, name: 'Team Settings' })).toBeInTheDocument();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByText('Manage members and permissions.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite' })).toBeInTheDocument();
    expect(screen.getByText('Body content')).toBeInTheDocument();
  });

  it('omits optional header slots when not provided and falls back on invalid size/gap', () => {
    render(
      <PageShell
        size={'huge' as 'lg'}
        gap={'huge' as 'lg'}
        header={<PageHeader title="Minimal Page" data-testid="minimal-header" />}
        data-testid="fallback-shell"
      />,
    );

    const shell = screen.getByTestId('fallback-shell');
    expect(shell).toHaveAttribute('data-size', 'lg');
    expect(shell).toHaveAttribute('data-gap', 'lg');

    const header = screen.getByTestId('minimal-header');
    expect(header.querySelector('.ui-page-header-eyebrow')).toBeNull();
    expect(header.querySelector('.ui-page-header-description')).toBeNull();
    expect(header.querySelector('.ui-page-header-actions')).toBeNull();
  });

  it('renders PageShell without a header wrapper when header prop is omitted', () => {
    render(
      <PageShell data-testid="headless-shell">
        <p>Standalone body</p>
      </PageShell>,
    );

    const shell = screen.getByTestId('headless-shell');
    expect(shell.querySelector('.ui-page-header')).toBeNull();
    expect(screen.getByText('Standalone body')).toBeInTheDocument();
  });
});
