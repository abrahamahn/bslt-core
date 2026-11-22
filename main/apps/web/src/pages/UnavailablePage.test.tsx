// main/apps/web/src/pages/UnavailablePage.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UnavailablePage } from './UnavailablePage';

import type { ReactElement, ReactNode } from 'react';

vi.mock('@bslt/react/router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }): ReactElement => (
    <a href={to}>{children}</a>
  ),
}));

describe('UnavailablePage', () => {
  it('says plainly that the service is not available here', () => {
    render(<UnavailablePage />);

    expect(
      screen.getByRole('heading', { name: /isn’t available where you are/iu }),
    ).toBeInTheDocument();
  });

  it('does not blame the visitor', () => {
    render(<UnavailablePage />);

    expect(screen.getByText(/not about you, and not about anything you did/iu)).toBeInTheDocument();
  });

  it('offers a way to reach a human and to read the terms', () => {
    render(<UnavailablePage />);

    expect(screen.getByRole('link', { name: /contact support/iu })).toHaveAttribute(
      'href',
      '/support',
    );
    expect(screen.getByRole('link', { name: /terms of service/iu })).toHaveAttribute(
      'href',
      '/terms',
    );
  });
});
