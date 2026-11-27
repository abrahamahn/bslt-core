// main/apps/web/src/pages/UnavailablePage.tsx
/**
 * Shown when the service is not offered where the visitor is.
 *
 * This is the page the geo gate's 403 points at (`unavailablePath` in the
 * `JURISDICTION_BLOCKED` body from `@bslt/server-system/security`). The tone is
 * deliberate: nobody did anything wrong by arriving here. It is a fact about
 * where the service may operate, not a judgement about the visitor — so the
 * page explains the position and does not ask them to prove or plead anything.
 */

import { Link } from '@bslt/react/router';
import { Heading, PageContainer, Text } from '@bslt/ui';

import './PublicPages.css';

import type { ReactElement } from 'react';

import { useChromeTranslation } from '#app/i18n/chromeLabels';

export const UnavailablePage = (): ReactElement => {
  const { t } = useChromeTranslation();

  return (
    <PageContainer>
      <section
        className="unavailable-section flex-col gap-4 p-4"
        aria-labelledby="unavailable-title"
      >
        <Heading as="h1" size="xl" id="unavailable-title">
          {t('error.unavailableTitle')}
        </Heading>

        <Text>{t('error.unavailableBodyOne')}</Text>

        <Text>{t('error.unavailableBodyTwo')}</Text>

        <Text tone="muted" size="sm">
          <Link to="/support">{t('error.unavailableContactSupport')}</Link> ·{' '}
          {t('error.unavailableReadTermsPrefix')}
          <Link to="/terms">{t('error.unavailableTermsLink')}</Link>
        </Text>
      </section>
    </PageContainer>
  );
};
