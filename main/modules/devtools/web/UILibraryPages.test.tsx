// main/modules/devtools/web/UILibraryPages.test.tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemoryRouter } from '@bslt/react/router';
import { AppLayoutContext } from '@bslt/web-platform';

import {
  SidePeekUILibraryContent,
  SidePeekUILibraryLayout,
  SidePeekUILibraryPage,
  UILibraryPage,
} from './UILibraryPages';

function SidebarHarness({ children }: { children: ReactNode }) {
  const [sidebar, setSidebar] = useState<ReactNode>(null);
  return (
    <AppLayoutContext.Provider value={{ setRightSidebar: setSidebar }}>
      {children}
      <aside data-testid="sidebar-slot">{sidebar}</aside>
    </AppLayoutContext.Provider>
  );
}

describe('UILibraryPages', () => {
  afterEach(() => {
    cleanup();
  });

  it('KEEPS selection intact when Escape is pressed inside an input and clears when pressed on window', () => {
    render(
      <MemoryRouter>
        <SidebarHarness>
          <UILibraryPage />
        </SidebarHarness>
      </MemoryRouter>,
    );

    expect(
      screen.getByText('Select a component from the left sidebar to view demos'),
    ).not.toBeNull();

    fireEvent.click(screen.getByText('Button'));
    expect(screen.getAllByText('View Code').length).toBeGreaterThan(0);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getAllByText('View Code').length).toBeGreaterThan(0);
    document.body.removeChild(input);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryAllByText('View Code')).toHaveLength(0);
  });

  it('renders SidePeekUILibraryContent, SidePeekUILibraryLayout, and SidePeekUILibraryPage', () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <div>
          <SidePeekUILibraryContent />
          <SidePeekUILibraryLayout open={false} onClose={onClose} />
          <SidePeekUILibraryPage />
        </div>
      </MemoryRouter>,
    );
    expect(screen.getByText('Side Peek UI Library')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Back to UI Library' })).not.toBeNull();
  });

  it('preselects a story from ?story=<id> query parameter and ignores unknown story ids', () => {
    render(
      <MemoryRouter initialEntries={['/ui-library?story=card']}>
        <SidebarHarness>
          <UILibraryPage />
        </SidebarHarness>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Card' })).not.toBeNull();
    expect(screen.getByText('Titled Card')).not.toBeNull();

    cleanup();

    render(
      <MemoryRouter initialEntries={['/ui-library?story=unknown-story-id']}>
        <SidebarHarness>
          <UILibraryPage />
        </SidebarHarness>
      </MemoryRouter>,
    );
    expect(
      screen.getByText('Select a component from the left sidebar to view demos'),
    ).not.toBeNull();
  });

  it('mounts fresh variant cards with component-scoped keys instead of reusing index keys across components', () => {
    const { container } = render(
      <MemoryRouter>
        <SidebarHarness>
          <UILibraryPage />
        </SidebarHarness>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText('Button'));
    const firstDetails = container.querySelector('details.code-details') as HTMLDetailsElement;
    expect(firstDetails).not.toBeNull();
    firstDetails.open = true;
    expect(firstDetails.open).toBe(true);

    fireEvent.click(screen.getByText('Alert'));
    const nextDetails = container.querySelector('details.code-details') as HTMLDetailsElement;
    expect(nextDetails).not.toBeNull();
    expect(nextDetails.open).toBe(false);
  });
});
