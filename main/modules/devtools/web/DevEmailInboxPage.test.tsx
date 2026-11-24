// main/modules/devtools/web/DevEmailInboxPage.test.tsx
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryRouter } from '@bslt/react/router';

import { DevEmailInboxPage } from './DevEmailInboxPage';

const { mockUseDevEmails } = vi.hoisted(() => ({
  mockUseDevEmails: vi.fn(),
}));

vi.mock('./hooks', () => ({
  useDevEmails: mockUseDevEmails,
}));

describe('DevEmailInboxPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows empty state and disables Clear inbox when no dev emails are captured', () => {
    mockUseDevEmails.mockReturnValue({
      emails: [],
      count: 0,
      isLoading: false,
      error: null,
      isClearing: false,
      refresh: vi.fn(),
      clearInbox: vi.fn(),
    });

    render(
      <MemoryRouter>
        <DevEmailInboxPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('No captured emails yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear inbox' })).toBeDisabled();
  });

  it('renders captured emails, extracted links, HTML/text toggle, and clear action', () => {
    const clearInbox = vi.fn();
    mockUseDevEmails.mockReturnValue({
      emails: [
        {
          id: 'msg-1',
          to: ['alice@acme.dev'],
          subject: 'Verify your email',
          text: 'Visit https://localhost:5173/verify?token=abc',
          html: '<p><a href="https://localhost:5173/verify?token=abc">Verify</a></p>',
          links: ['https://localhost:5173/verify?token=abc'],
          sentAt: '2026-11-24T00:00:00.000Z',
        },
      ],
      count: 1,
      isLoading: false,
      error: null,
      isClearing: false,
      refresh: vi.fn(),
      clearInbox,
    });

    render(
      <MemoryRouter>
        <DevEmailInboxPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { level: 2, name: 'Verify your email' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'https://localhost:5173/verify?token=abc' }),
    ).toHaveAttribute('href', 'https://localhost:5173/verify?token=abc');
    expect(screen.getByTitle('Email preview: Verify your email')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Plain Text' }));
    expect(screen.getByText('Visit https://localhost:5173/verify?token=abc')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear inbox' }));
    expect(clearInbox).toHaveBeenCalledTimes(1);
  });
});
