// main/modules/devtools/web/HomePage.test.tsx
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemoryRouter } from '@bslt/react/router';

import { HomeDocViewer, HomePage, HomeRightSidebar } from './HomePage';

vi.mock('./hooks', () => ({
  useDocContent: () => ({ content: '# Starter Overview', isLoading: false }),
}));

describe('HomePage', () => {
  afterEach(() => {
    cleanup();
  });

  it('HomeDocViewer RENDERS welcome prompt when selectedDoc is null and falls back unknown ?doc= to readme', () => {
    render(<HomeDocViewer selectedDoc={null} content={null} isLoading={false} />);
    expect(screen.getByText('Welcome')).not.toBeNull();
    expect(
      screen.getByText('Select a document from the left panel to view its content.'),
    ).not.toBeNull();
    cleanup();

    render(
      <MemoryRouter initialEntries={['/clean?doc=unknown-doc-xyz']}>
        <HomePage />
      </MemoryRouter>,
    );
    expect(screen.getByText('Starter Overview')).not.toBeNull();
  });

  it('renders starter landing view without ?doc= and HomeRightSidebar links', () => {
    render(
      <MemoryRouter initialEntries={['/clean']}>
        <div>
          <HomePage />
          <HomeRightSidebar />
        </div>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Create account' }).getAttribute('href')).toBe(
      '/register',
    );
    expect(screen.getByRole('link', { name: 'Read docs' }).getAttribute('href')).toBe(
      '/clean?doc=readme',
    );
  });

  it('renders VITE_APP_NAME as the level-1 heading when configured', () => {
    vi.stubEnv('VITE_APP_NAME', 'BSLT');
    try {
      render(
        <MemoryRouter initialEntries={['/clean']}>
          <HomePage />
        </MemoryRouter>,
      );
      expect(screen.getByRole('heading', { level: 1, name: 'BSLT' })).not.toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
