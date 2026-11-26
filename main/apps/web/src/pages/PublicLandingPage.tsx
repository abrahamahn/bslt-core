// main/apps/web/src/pages/PublicLandingPage.tsx
/**
 * Public Landing Page (zero `@bslt/identity/web` dependency)
 *
 * Split from `LandingPage.tsx` so the lean public SSR hydration bundle
 * (`entry-public.tsx`) never pulls in authentication, session, or WebAuthn code.
 */

import { Link } from '@bslt/react/router';
import { Card, Heading, PageContainer, Text } from '@bslt/ui';

import type { ReactElement } from 'react';

import { PRODUCT_TAGLINE } from '#app/app/productMeta';
import { clientConfig } from '#app/config';

import './PublicPages.css';

const CAPABILITIES = [
  {
    eyebrow: '01 / IDENTITY',
    title: 'Accounts & access',
    description:
      'Email/password auth, verification, password reset, passkeys, 2FA, sessions, and unified profile settings ship working out of the box.',
  },
  {
    eyebrow: '02 / MONETIZATION',
    title: 'Billing & subscriptions',
    description:
      'Stripe and PayPal, plans, entitlements, metered usage, and dunning are wired behind a provider-agnostic interface.',
  },
  {
    eyebrow: '03 / FOUNDATION',
    title: 'Production platform',
    description:
      'PostgreSQL 17 forced RLS, CSRF protection, append-only audit logs, background jobs, and owned wire protocols come pre-assembled.',
  },
] as const;

const HIGHLIGHTS = [
  { label: 'Runtime stack', value: 'React 19 + Node.js + PostgreSQL 17' },
  { label: 'Database isolation', value: 'Forced Row-Level Security' },
  { label: 'Rendering model', value: 'Public SSR + Authenticated SPA' },
  { label: 'Third-party runtime deps', value: 'Zero outside React' },
] as const;

export function LandingPageContent({
  isAuthenticated,
}: {
  readonly isAuthenticated: boolean;
}): ReactElement {
  const primaryHref = isAuthenticated ? '/dashboard' : '/register';
  const primaryLabel = isAuthenticated ? 'Open dashboard' : 'Get started';

  return (
    <PageContainer maxWidth={1080} className="landing-page">
      <section aria-labelledby="landing-title" className="landing-hero">
        {/* The same sentence the footer prints — one source, in productMeta. */}
        <span className="landing-eyebrow">
          <span className="landing-eyebrow__dot" aria-hidden="true" />
          <span>{PRODUCT_TAGLINE}</span>
        </span>
        <Heading as="h1" id="landing-title" size="2xl" className="landing-title">
          {clientConfig.appName}
        </Heading>
        <Text tone="muted" className="landing-lead">
          A self-owned, production-ready SaaS foundation — authentication, billing, compliance, an
          admin console, and platform infrastructure already connected as one cohesive app.
        </Text>
        <div className="landing-actions">
          <Link to={primaryHref} className="btn btn-primary btn-medium no-underline">
            {primaryLabel}
          </Link>
          <Link to="/docs" className="btn btn-secondary btn-medium no-underline">
            Explore App Guide
          </Link>
          {isAuthenticated ? null : (
            <Link to="/login" className="btn btn-secondary btn-medium no-underline">
              Sign in
            </Link>
          )}
        </div>
        <div className="landing-highlights" aria-label="Platform highlights">
          {HIGHLIGHTS.map((item) => (
            <div key={item.label} className="landing-highlight">
              <Text as="span" size="xs" tone="muted" className="landing-highlight__label">
                {item.label}
              </Text>
              <Text as="span" size="sm" className="landing-highlight__value">
                {item.value}
              </Text>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="What's included" className="landing-grid">
        {CAPABILITIES.map((capability) => (
          <Card key={capability.title} className="landing-card">
            <Text as="span" size="xs" tone="muted" className="landing-card__eyebrow">
              {capability.eyebrow}
            </Text>
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
