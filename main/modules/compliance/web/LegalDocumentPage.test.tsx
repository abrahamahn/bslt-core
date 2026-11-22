// main/modules/compliance/web/LegalDocumentPage.test.tsx
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemoryRouter } from '@bslt/react/router';

import { PrivacyPolicyPage, TermsPage } from './LegalDocumentPage';

const mockUseCurrentLegal = vi.hoisted(() => vi.fn());

vi.mock('./hooks', () => ({
  useCurrentLegal: () => mockUseCurrentLegal(),
}));

describe('LegalDocumentPage', () => {
  afterEach(() => {
    cleanup();
  });

  it('holds skeleton while pending, renders error alerts on failure, and shows empty state only after fetch resolves empty', () => {
    mockUseCurrentLegal.mockReturnValue({
      documents: [],
      isLoading: false,
      isPending: true,
      error: null,
      refresh: vi.fn(),
    });
    const { container } = render(
      <MemoryRouter>
        <TermsPage />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/unavailable/iu)).not.toBeInTheDocument();
    expect(screen.queryByText(/has not been published yet/iu)).not.toBeInTheDocument();
    expect(container.querySelector('.legal-document-page__skeleton')).not.toBeNull();

    cleanup();
    mockUseCurrentLegal.mockReturnValue({
      documents: [],
      isLoading: false,
      isPending: false,
      error: new Error('Failed to load legal docs'),
      refresh: vi.fn(),
    });
    render(
      <MemoryRouter>
        <PrivacyPolicyPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('Failed to load legal docs')).toBeInTheDocument();

    cleanup();
    mockUseCurrentLegal.mockReturnValue({
      documents: [],
      isLoading: false,
      isPending: false,
      error: null,
      refresh: vi.fn(),
    });
    render(
      <MemoryRouter>
        <TermsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('Terms of Service unavailable')).toBeInTheDocument();
    expect(screen.getByText('This legal document has not been published yet.')).toBeInTheDocument();
  });
});
