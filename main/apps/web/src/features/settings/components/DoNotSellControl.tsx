// main/apps/web/src/features/settings/components/DoNotSellControl.tsx
/**
 * "Do Not Sell or Share My Personal Information" — the CPRA opt-out.
 *
 * Serving a personalised ad means sharing personal information with an
 * advertising partner, and under the CPRA a Californian may refuse that. This
 * is the control that lets them, and it is a REAL control: flipping it
 * rewrites the consent decision that gates every third-party script
 * (lib/consent/gate.ts), so nothing loads over a refusal. It does not merely
 * store a flag.
 *
 * It renders in two places — Settings → Data Controls, and the site footer —
 * because §7026 forbids requiring a consumer to create an account or log in to
 * opt out, and /settings is a protected route. The footer copy is therefore
 * the control itself, not a link to it: an anonymous visitor can opt out in
 * place. Both mount THIS component and write THIS store, so there is one
 * opt-out, not two that can disagree.
 *
 * Signed-in users additionally get the choice mirrored to the server consent
 * record, which is the durable, auditable copy. That mirror is best-effort:
 * the local decision is what gates scripts, so a failed request cannot leave
 * a user who asked to opt out still being tracked.
 *
 * Prerender-safe: the footer renders at build time under react-dom/static, so
 * the decision is read via useSyncExternalStore with a null server snapshot —
 * no window or localStorage access happens during render.
 */

import { useAuth } from '@auth/hooks';
import { Switch, Text } from '@bslt/ui';
import { useCallback, useSyncExternalStore, type ReactElement } from 'react';

import { useUpdateConsent } from '../hooks/useConsent';

import { readConsent, subscribeConsent, toServerConsent, writeConsent } from '@/lib/consent';

/** Stable anchor for deep links into the opt-out. */
const DO_NOT_SELL_ANCHOR = 'do-not-sell';

/** Prerender has no localStorage and no decision — the control renders unchecked. */
function serverSnapshot(): null {
  return null;
}

export interface DoNotSellControlProps {
  /** Footer rendering drops the explanatory prose to keep the bar compact. */
  compact?: boolean;
  className?: string;
}

export const DoNotSellControl = ({
  compact = false,
  className,
}: DoNotSellControlProps): ReactElement => {
  const consent = useSyncExternalStore(subscribeConsent, readConsent, serverSnapshot);
  const { updateConsent } = useUpdateConsent();
  const { user } = useAuth();

  // Checked means "do not sell/share" — i.e. personalisation is DENIED.
  const optedOut = consent?.ads === 'denied';

  const handleToggle = useCallback(
    (nextOptedOut: boolean): void => {
      const decision = writeConsent({ ads: nextOptedOut ? 'denied' : 'granted' });

      // Anonymous visitors have no consent record to write to; the local
      // decision already governs the gate. Only mirror when there is an account.
      if (user !== null) {
        void updateConsent(toServerConsent(decision)).catch(() => {
          // The gate is local and has already been updated. The audit copy can
          // retry on the next change; it must never block the opt-out itself.
        });
      }
    },
    [updateConsent, user],
  );

  const rootClassName = ['settings-toggle-row flex items-center justify-between gap-3', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClassName} id={DO_NOT_SELL_ANCHOR} data-testid="do-not-sell-control">
      <div className="settings-toggle-row__content">
        <label htmlFor="do-not-sell-switch">
          <Text className="font-medium">Do Not Sell or Share My Personal Information</Text>
        </label>
        {!compact && (
          <Text tone="muted" size="sm">
            Personalised advertising shares information about you with advertising partners. Turn
            this on and no advertising script will load or personalise.
          </Text>
        )}
      </div>
      <Switch
        id="do-not-sell-switch"
        checked={optedOut}
        onChange={handleToggle}
        aria-label="Do Not Sell or Share My Personal Information"
      />
    </div>
  );
};
