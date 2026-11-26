// main/modules/compliance/web/AnonymousDoNotSellControl.tsx
import { useCallback, useSyncExternalStore, type ReactElement } from 'react';

import { Switch, Text } from '@bslt/ui';
import { useModuleMessages } from '@bslt/web-platform';

import enUsMessages from '../i18n/en-US.json';

import { readConsent, subscribeConsent, writeConsent } from './consent/store';

const DO_NOT_SELL_ANCHOR = 'do-not-sell';

function serverSnapshot(): null {
  return null;
}

interface AnonymousDoNotSellControlProps {
  compact?: boolean;
  className?: string;
}

/**
 * Lightweight, zero-auth CPRA "Do Not Sell / Share" toggle used by the public SSR
 * footer (`PublicDocumentShell`). Kept separate from `ComplianceSettings.tsx` so the
 * public entry bundle never imports `@bslt/identity/web` or authenticated settings UI.
 */
export const AnonymousDoNotSellControl = ({
  compact = false,
  className,
}: AnonymousDoNotSellControlProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const consent = useSyncExternalStore(subscribeConsent, readConsent, serverSnapshot);
  const optedOut = consent?.ads === 'denied';

  const handleToggle = useCallback((nextOptedOut: boolean): void => {
    writeConsent({ ads: nextOptedOut ? 'denied' : 'granted' });
  }, []);

  const rootClassName = ['settings-toggle-row flex items-center justify-between gap-3', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClassName} id={DO_NOT_SELL_ANCHOR} data-testid="do-not-sell-control">
      <div className="settings-toggle-row__content">
        <label htmlFor="do-not-sell-switch">
          <Text className="font-medium">{t('compliance.cpra.label')}</Text>
        </label>
        {!compact && (
          <Text tone="muted" size="sm">
            {t('compliance.cpra.description')}
          </Text>
        )}
      </div>
      <Switch
        id="do-not-sell-switch"
        checked={optedOut}
        onChange={handleToggle}
        aria-label={t('compliance.cpra.label')}
      />
    </div>
  );
};
