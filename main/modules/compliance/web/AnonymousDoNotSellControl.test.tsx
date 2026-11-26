// main/modules/compliance/web/AnonymousDoNotSellControl.test.tsx
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AnonymousDoNotSellControl } from './AnonymousDoNotSellControl';
import { readConsent, resetConsentCache } from './consent/store';

describe('AnonymousDoNotSellControl', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    resetConsentCache();
  });

  it('toggles local ads consent without requiring auth context and hides description in compact mode', () => {
    render(<AnonymousDoNotSellControl compact />);
    const toggle = screen.getByRole('switch');
    expect(toggle).not.toBeChecked();
    expect(screen.queryByText(/opt out/iu)).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(readConsent()?.ads).toBe('denied');
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);
    expect(readConsent()?.ads).toBe('granted');
    expect(toggle).not.toBeChecked();
  });
});
