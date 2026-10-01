// main/apps/web/src/pages/UnavailablePage.tsx
/**
 * Shown when the service is not offered where the visitor is.
 *
 * This is the page the geo gate's 403 points at (`unavailablePath` in the
 * `JURISDICTION_BLOCKED` body from `@bslt/shared/core/geo`). The tone is
 * deliberate: nobody did anything wrong by arriving here. It is a fact about
 * where the service may operate, not a judgement about the visitor — so the
 * page explains the position and does not ask them to prove or plead anything.
 */

import { Link } from '@bslt/react/router';
import { Heading, PageContainer, Text } from '@bslt/ui';

import type { ReactElement } from 'react';

export const UnavailablePage = (): ReactElement => (
  <PageContainer>
    <section
      className="flex-col gap-4 p-4"
      style={{ maxWidth: '38rem', margin: '0 auto' }}
      aria-labelledby="unavailable-title"
    >
      <Heading as="h1" size="xl" id="unavailable-title">
        This service isn&rsquo;t available where you are
      </Heading>

      <Text>
        We are not offered in your location, so we can&rsquo;t serve you from here. This is about
        the rules that apply where you are — not about you, and not about anything you did.
      </Text>

      <Text>
        If you already hold an account, or you believe you are seeing this page by mistake, contact
        us and we will look at it properly.
      </Text>

      <Text tone="muted" size="sm">
        <Link to="/support">Contact support</Link> · Read the{' '}
        <Link to="/terms">Terms of Service</Link>
      </Text>
    </section>
  </PageContainer>
);
