// main/modules/compliance/web/ContentPages.test.tsx
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AcceptableUsePage, CookiePolicyPage, DisclaimerPage, DocumentPage } from './ContentPages';

describe('ContentPages', () => {
  afterEach(() => {
    cleanup();
  });

  it('fills placeholders, strips unknown tokens to [pending], and omits optional header/badge when absent', () => {
    render(<DocumentPage body="Hello [[MISSING_FACT]] and [[COMPANY_NAME]]." />);

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByText(/Hello \[pending\] and BSLT\./u)).toBeInTheDocument();

    cleanup();
    render(<CookiePolicyPage />);
    expect(screen.getByText('Cookies')).toBeInTheDocument();
    expect(screen.queryByText(/\[\[/u)).not.toBeInTheDocument();
    expect(screen.queryByText('[pending]')).not.toBeInTheDocument();

    cleanup();
    render(<AcceptableUsePage />);
    expect(screen.getByText('Acceptable use')).toBeInTheDocument();
    expect(screen.queryByText(/\[\[/u)).not.toBeInTheDocument();

    cleanup();
    render(<DisclaimerPage />);
    expect(screen.getAllByText('Disclaimer').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/\[\[/u)).not.toBeInTheDocument();
  });
});
