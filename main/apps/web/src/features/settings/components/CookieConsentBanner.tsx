// main/apps/web/src/features/settings/components/CookieConsentBanner.tsx
/**
 * Cookie Consent Banner
 *
 * Bottom banner for cookie consent, rendered in-flow as the last child of the
 * app shell so it never overlays floating controls (e.g. the pane-toggle rail).
 *
 * Every button records a REAL ConsentDecision in the local consent store — the
 * store the script gate (lib/consent/gate.ts) reads — so the choice actually
 * enforces something. Accept grants the non-necessary categories; Reject and
 * the Manage dismissal deny them: an unanswered dismissal must fail closed,
 * never load-by-default. The `cookie-consent-dismissed` flag is kept for
 * VISIBILITY only — it decides whether the banner shows, never what may load.
 *
 * Signed-in users get the choice mirrored to the server consent record
 * (best-effort: the local decision already gates scripts, so a failed mirror
 * must never block or reverse the choice).
 */

import { useAuth } from '@auth/hooks';
import { useIsMobile, useLocalStorageValue } from '@bslt/react/hooks';
import { useNavigate } from '@bslt/react/router';
import { Button, Text } from '@bslt/ui';
import { useCallback, type ReactElement } from 'react';

import { useUpdateConsent } from '../hooks/useConsent';

import { toServerConsent, writeConsent } from '@/lib/consent';

// ============================================================================
// Constants
// ============================================================================

/** Visibility only. The enforced decision lives under CONSENT_STORAGE_KEY. */
const STORAGE_KEY = 'cookie-consent-dismissed';

// ============================================================================
// Types
// ============================================================================

export interface CookieConsentBannerProps {
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

export const CookieConsentBanner = ({
  className,
}: CookieConsentBannerProps): ReactElement | null => {
  const isMobile = useIsMobile();
  const [dismissed, setDismissed] = useLocalStorageValue(STORAGE_KEY);
  const navigate = useNavigate();
  const { updateConsent } = useUpdateConsent();
  const { user } = useAuth();
  const visible = dismissed !== 'true';

  const decide = useCallback(
    (status: 'granted' | 'denied'): void => {
      const decision = writeConsent({ analytics: status, ads: status });

      // Anonymous visitors have no consent record; the local decision already
      // gates scripts. Only mirror when there is an account — and best-effort:
      // a failed audit write must never reverse or block the choice.
      if (user !== null) {
        void updateConsent(toServerConsent(decision)).catch(() => {});
      }

      setDismissed('true');
    },
    [updateConsent, user, setDismissed],
  );

  const handleAcceptAll = useCallback(() => {
    decide('granted');
  }, [decide]);

  const handleRejectNonEssential = useCallback(() => {
    decide('denied');
  }, [decide]);

  const handleManage = useCallback(() => {
    // A dismissal is not an answer, so it fails closed: denied until the user
    // grants something on the settings page this navigates to.
    decide('denied');
    navigate('/settings#data-controls');
  }, [decide, navigate]);

  if (!visible) return null;

  return (
    <div
      className={`flex-shrink-0 bg-surface border-t p-4 flex ${
        isMobile ? 'flex-col gap-3' : 'items-center justify-between gap-4'
      } ${className ?? ''}`}
      role="banner"
      aria-label="Cookie consent"
      data-testid="cookie-consent-banner"
    >
      <Text size="sm">
        We use cookies to improve your experience. You can manage your preferences at any time.
      </Text>
      <div className={`flex gap-2 flex-shrink-0 ${isMobile ? 'flex-col' : ''}`}>
        <Button type="button" variant="text" size="small" onClick={handleManage}>
          Manage
        </Button>
        <Button type="button" variant="secondary" size="small" onClick={handleRejectNonEssential}>
          Reject Non-Essential
        </Button>
        <Button type="button" variant="primary" size="small" onClick={handleAcceptAll}>
          Accept All
        </Button>
      </div>
    </div>
  );
};
