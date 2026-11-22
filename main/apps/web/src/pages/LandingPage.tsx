// main/apps/web/src/pages/LandingPage.tsx
/**
 * Landing Page
 *
 * The public front door for a fresh clone. Intentionally small and brandable:
 * a fork edits the copy, swaps the capability cards, and restyles via theme
 * tokens without touching app wiring. Authenticated visitors are pointed at the
 * dashboard. Replace this with your product's marketing page.
 */

import { useAuth } from '@bslt/identity/web';
import { Link } from '@bslt/react/router';
import { Card, Heading, PageContainer, Text } from '@bslt/ui';

import type { ReactElement } from 'react';

import { PRODUCT_TAGLINE } from '#app/app/productMeta';
import { clientConfig } from '#app/config';

import './PublicPages.css';

const CAPABILITIES = [
  {
    title: 'Accounts & access',
    description:
      'Email/password auth, verification, password reset, sessions, and profile management ship working out of the box.',
  },
  {
    title: 'Billing & subscriptions',
    description:
      'Stripe and PayPal, plans, metered usage, and dunning are wired behind a provider-agnostic interface.',
  },
  {
    title: 'Production platform',
    description:
      'Rate limiting, CSRF, audit logging, RBAC, background jobs, and CI/CD come pre-assembled and typed end to end.',
  },
] as const;

function LandingPageContent({
  isAuthenticated,
}: {
  readonly isAuthenticated: boolean;
}): ReactElement {
  const primaryHref = isAuthenticated ? '/dashboard' : '/register';
  const primaryLabel = isAuthenticated ? 'Open dashboard' : 'Get started';

  return (
    <PageContainer maxWidth={1080}>
      <section
        aria-labelledby="landing-title"
        className="landing-hero flex flex-col items-center text-center gap-4"
      >
        {/* The same sentence the footer prints — one source, in productMeta. */}
        <Text as="p" tone="muted" size="sm">
          {PRODUCT_TAGLINE}
        </Text>
        <Heading as="h1" id="landing-title" size="xl">
          {clientConfig.appName}
        </Heading>
        <Text tone="muted" className="landing-lead">
          A small, production-ready SaaS shell — authentication, billing, an admin surface, and the
          platform plumbing already connected. Rename it, add your first feature, and deploy.
        </Text>
        <div className="flex flex-wrap justify-center gap-3">
          <Link to={primaryHref} className="btn btn-primary btn-medium no-underline">
            {primaryLabel}
          </Link>
          {isAuthenticated ? null : (
            <Link to="/login" className="btn btn-secondary btn-medium no-underline">
              Sign in
            </Link>
          )}
        </div>
      </section>

      <section aria-label="What's included" className="landing-grid">
        {CAPABILITIES.map((capability) => (
          <Card key={capability.title} className="p-4 flex flex-col gap-2">
            <Heading as="h2" size="md">
              {capability.title}
            </Heading>
            <Text tone="muted" size="sm">
              {capability.description}
            </Text>
          </Card>
        ))}
      </section>
    </PageContainer>
  );
}

export const PublicLandingPage = (): ReactElement => <LandingPageContent isAuthenticated={false} />;

export const LandingPage = (): ReactElement => {
  const { isAuthenticated } = useAuth();
  return <LandingPageContent isAuthenticated={isAuthenticated} />;
};
