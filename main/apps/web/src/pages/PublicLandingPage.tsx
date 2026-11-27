// main/apps/web/src/pages/PublicLandingPage.tsx
/**
 * Public Landing Page (zero `@bslt/identity/web` dependency)
 *
 * Split from `LandingPage.tsx` so the lean public SSR hydration bundle
 * (`entry-public.tsx`) never pulls in authentication, session, or WebAuthn code.
 */

import { Link } from '@bslt/react/router';
import { Card, Heading, PageContainer, Text } from '@bslt/ui';

import { installedPublicSsrModules } from '../generated/public-modules';

import type { ReactElement } from 'react';

import { PRODUCT_TAGLINE } from '#app/app/productMeta';
import { clientConfig } from '#app/config';

import './PublicPages.css';

const PUBLIC_SSR_MODULE_IDS: ReadonlySet<string> = new Set(
  installedPublicSsrModules.map((mod) => mod.id),
);
const HAS_GROWTH_PUBLIC = PUBLIC_SSR_MODULE_IDS.has('growth');

const CAPABILITIES = [
  {
    eyebrow: '01 / IDENTITY & SSO',
    title: 'Accounts, passkeys & OIDC SSO',
    description:
      'Email/password, Email OTP, Google/GitHub/Apple OAuth, TOTP/SMS MFA, owned WebAuthn passkeys, API keys, and Enterprise OIDC SSO with PKCE & JIT provisioning.',
  },
  {
    eyebrow: '02 / COLLABORATION',
    title: 'Multi-tenant workspaces & boards',
    description:
      'Organizations, custom RBAC roles, invitations, verified domains, collaborative project Kanban boards with forced owner_org RLS, and live WebSocket team sync.',
  },
  {
    eyebrow: '03 / AI & METERING',
    title: 'Zero-dep AI SSE streaming',
    description:
      'Built-in AI Assistant streaming OpenAI, Anthropic, Gemini, or Mock replies over native Server-Sent Events with org-scoped history and monthly token metering.',
  },
  {
    eyebrow: '04 / MONETIZATION',
    title: 'Billing, seats & entitlements',
    description:
      'Provider-agnostic Stripe and PayPal billing, hosted Checkout, per-seat licensing, invoices, metered usage, dunning workflows, and entitlement guards.',
  },
  {
    eyebrow: '05 / GROWTH & API',
    title: 'Blog, waitlist, referrals & OpenAPI',
    description:
      'Statically prerendered SSR blog, invite-wave waitlist with branded emails, personal referral links, announcement banners, and an interactive OpenAPI 3.1 playground.',
  },
  {
    eyebrow: '06 / FOUNDATION',
    title: 'Owned stack & live bilingual UI',
    description:
      'Zero third-party runtime deps outside React, PostgreSQL 17 forced RLS, append-only audit logs, background jobs, en-US / ko-KR locale switching, and 50 merge gates.',
  },
] as const;

const HIGHLIGHTS = [
  { label: 'Runtime stack', value: 'React 19 + Node.js + PostgreSQL 17' },
  { label: 'Database isolation', value: 'Forced Row-Level Security' },
  { label: 'Internationalization', value: 'Live en-US ↔ ko-KR i18n' },
  { label: 'Third-party runtime deps', value: 'Zero outside React' },
] as const;

const EXPLORE_LINKS: readonly { readonly label: string; readonly to: `/${string}` }[] = [
  { label: 'App Guide', to: '/docs' },
  { label: 'API Playground', to: '/docs/api' },
  { label: 'Changelog', to: '/changelog' },
  ...(HAS_GROWTH_PUBLIC
    ? [
        { label: 'Engineering Blog', to: '/blog' as const },
        { label: 'Early Access Waitlist', to: '/waitlist' as const },
      ]
    : []),
  { label: 'System Status', to: '/status' },
];

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

      <section aria-label="Explore live surfaces" className="landing-explore">
        <Text as="span" size="xs" tone="muted" className="landing-highlight__label">
          Explore live surfaces
        </Text>
        <div className="landing-explore__links">
          {EXPLORE_LINKS.map((item) => (
            <Link key={item.to} to={item.to} className="btn btn-secondary btn-small no-underline">
              {item.label}
            </Link>
          ))}
        </div>
      </section>
    </PageContainer>
  );
}

export const PublicLandingPage = (): ReactElement => <LandingPageContent isAuthenticated={false} />;
