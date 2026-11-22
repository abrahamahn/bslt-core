// main/modules/identity/web/IdentityCards.test.tsx
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  DeviceRowCard,
  ProfileCompletenessCard,
  SessionCard,
  parseIdentityUserAgent,
} from './IdentityCards';

describe('IdentityCards', () => {
  describe('parseIdentityUserAgent', () => {
    it('returns fallback labels for null or empty user agents', () => {
      expect(parseIdentityUserAgent(null)).toEqual({
        browser: 'Unknown browser',
        os: 'Unknown device',
      });
      expect(parseIdentityUserAgent('')).toEqual({
        browser: 'Unknown browser',
        os: 'Unknown device',
      });
    });

    it('identifies browser and OS without misclassifying Edge/Opera as Chrome', () => {
      expect(
        parseIdentityUserAgent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0 Edg/125.0.0.0',
        ),
      ).toEqual({ browser: 'Edge', os: 'Windows' });
      expect(
        parseIdentityUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605'),
      ).toEqual({ browser: 'Safari', os: 'iOS' });
    });
  });

  describe('SessionCard', () => {
    it('omits revoke button on current session and handles null IP and invalid dates', () => {
      render(
        <SessionCard
          session={{
            id: 's1',
            userAgent: null,
            ipAddress: null,
            createdAt: 'invalid-date',
            isCurrent: true,
          }}
          onRevoke={vi.fn()}
        />,
      );
      expect(screen.getByText('Current Session')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /revoke/i })).not.toBeInTheDocument();
      expect(screen.getByText(/invalid-date/i)).toBeInTheDocument();
    });

    it('disables revoke button while revoking non-current session', () => {
      const onRevoke = vi.fn();
      render(
        <SessionCard
          session={{
            id: 's2',
            userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/126.0',
            ipAddress: '192.0.2.10',
            createdAt: '2026-01-15T10:00:00Z',
            isCurrent: false,
          }}
          onRevoke={onRevoke}
          isRevoking={true}
        />,
      );
      const button = screen.getByRole('button', { name: 'Revoking...' });
      expect(button).toBeDisabled();
    });
  });

  describe('DeviceRowCard', () => {
    it('renders Unknown IP fallback when ipAddress is null and hides Trust button when already trusted', () => {
      const onTrust = vi.fn();
      const onRevoke = vi.fn();
      render(
        <DeviceRowCard
          device={{
            id: 'd1',
            label: null,
            ipAddress: null,
            userAgent: null,
            lastSeenAt: '2026-01-15T10:00:00Z',
            trusted: true,
          }}
          onTrust={onTrust}
          onRevoke={onRevoke}
        />,
      );
      expect(screen.getByText('Trusted')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Trust' })).not.toBeInTheDocument();
      expect(screen.getByText(/Unknown IP/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
      expect(onRevoke).toHaveBeenCalledWith('d1');
    });
  });

  describe('ProfileCompletenessCard', () => {
    it('returns null at or above 100%', () => {
      const { container } = render(
        <ProfileCompletenessCard percentage={100} missingFields={['Bio']} />,
      );
      expect(container).toBeEmptyDOMElement();
    });

    it('renders missing field summary below 100% and omits Missing line when array is empty', () => {
      const { rerender } = render(
        <ProfileCompletenessCard percentage={40} missingFields={['Avatar', 'Bio']} />,
      );
      expect(screen.getByText('40%')).toBeInTheDocument();
      expect(screen.getByText('Missing: Avatar, Bio')).toBeInTheDocument();

      rerender(<ProfileCompletenessCard percentage={95} missingFields={[]} />);
      expect(screen.queryByText(/Missing:/)).not.toBeInTheDocument();
    });
  });
});
