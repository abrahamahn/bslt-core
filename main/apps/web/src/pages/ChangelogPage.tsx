// main/apps/web/src/pages/ChangelogPage.tsx
/**
 * Starter-Owned Public Changelog
 *
 * Pre-rendered at build time and served over public SSR alongside `/` and
 * `/status`. Edit `CHANGELOG_ENTRIES` to announce product releases directly
 * from your application without standing up a separate marketing site.
 */

import { Link } from '@bslt/react/router';
import { Badge, Card, Heading, PageContainer, Text } from '@bslt/ui';

import type { ReactElement } from 'react';

import { PRODUCT_TAGLINE } from '#app/app/productMeta';
import { clientConfig } from '#app/config';

import './PublicPages.css';

interface ChangelogEntry {
  readonly version: string;
  readonly date: string;
  readonly tone: 'info' | 'success';
  readonly title: string;
  readonly summary: string;
  readonly highlights: readonly string[];
}

const CHANGELOG_ENTRIES: readonly ChangelogEntry[] = [
  {
    version: 'v1.1.0',
    date: '2026-11-27',
    tone: 'success',
    title: 'Complete SaaS Starter: Projects, AI Streaming, Enterprise SSO, Growth Kit & Live i18n',
    summary:
      'Expanded the platform into a complete multi-tenant TypeScript SaaS starter with collaborative boards, zero-dep AI streaming, Enterprise OIDC SSO, growth & SEO surfaces, OpenAPI 3.1 playground, and full en-US / ko-KR localization.',
    highlights: [
      'Multi-tenant Projects & Kanban boards (/projects) with forced owner_org RLS, custom RBAC, quotas, and WebSocket team sync.',
      'Zero-dependency AI Assistant (/ai) streaming OpenAI, Anthropic, Gemini, or Mock completions over SSE with token metering.',
      'Enterprise OIDC SSO (discovery, PKCE, JIT provisioning, verified domain enforcement), org-scoped API keys, and per-seat billing.',
      'Growth & SEO Kit: prerendered SSR /blog, invite-wave /waitlist with branded emails, personal /referrals, /sitemap.xml, raster Open Graph preview, and interactive OpenAPI 3.1 API playground (/docs/api).',
      'End-to-end live en-US ↔ ko-KR localization across shell chrome, dashboard, workspace, onboarding, and all 21 modules, backed by 100% colocated TypeScript test coverage.',
    ],
  },
  {
    version: 'v1.0.0',
    date: '2026-11-24',
    tone: 'success',
    title: 'Unified SaaS Starter Platform',
    summary:
      'Single-manifest branding, separated Personal / Workspace / Platform Admin spaces, guided onboarding, workspace search, and offline dev sandboxes.',
    highlights: [
      'Single-source brand manifest in bslt.config.ts syncing web, PWA manifest, HTML title, and transactional emails.',
      'Dedicated Workspace Control Center (/workspace) uniting team members, billing, entitlements, self-service webhooks, and activity.',
      'Guided 3-step onboarding wizard (/onboarding), Workspace Search, and per-user file storage quota guards.',
      'Curated starter presets (core, solo-saas, b2b-saas), org-scoped module scaffolding, and bslt doctor diagnostics.',
    ],
  },
  {
    version: 'foundation-v1',
    date: '2026-11-21',
    tone: 'info',
    title: 'Zero-Dependency Platform Core',
    summary:
      'Self-owned React 19, Node.js, and PostgreSQL 17 platform foundation with forced Row-Level Security and 50 automated merge gates.',
    highlights: [
      'Zero third-party runtime npm dependencies outside React and ReactDOM.',
      '17 modular vertical domains plus devtools with deterministic Core export and versioned module catalog.',
      'Public-only SSR seam with zero auth hydration overhead for marketing, legal, status, and changelog routes.',
    ],
  },
];

export const ChangelogPage = (): ReactElement => {
  return (
    <PageContainer maxWidth={900} className="changelog-page">
      <section aria-labelledby="changelog-title" className="changelog-header">
        <span className="landing-eyebrow">
          <span className="landing-eyebrow__dot" aria-hidden="true" />
          <span>{PRODUCT_TAGLINE}</span>
        </span>
        <Heading as="h1" id="changelog-title" size="2xl" className="landing-title">
          {`${clientConfig.appName} Changelog`}
        </Heading>
        <Text tone="muted" className="landing-lead">
          Product releases, architecture milestones, and platform improvements shipped in this
          workspace.
        </Text>
      </section>

      <section aria-label="Release history" className="changelog-list">
        {CHANGELOG_ENTRIES.map((entry) => (
          <Card key={entry.version} className="changelog-card">
            <div className="changelog-card__meta">
              <Badge tone={entry.tone}>{entry.version}</Badge>
              <Text as="time" size="sm" tone="muted">
                {entry.date}
              </Text>
            </div>
            <Heading as="h2" size="md">
              {entry.title}
            </Heading>
            <Text tone="muted" size="sm">
              {entry.summary}
            </Text>
            <ul className="changelog-card__highlights">
              {entry.highlights.map((highlight) => (
                <li key={highlight}>
                  <Text as="span" size="sm">
                    {highlight}
                  </Text>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </section>

      <div className="landing-actions">
        <Link to="/register" className="btn btn-primary btn-medium no-underline">
          Get started
        </Link>
        <Link to="/docs/api" className="btn btn-secondary btn-medium no-underline">
          API Playground
        </Link>
        <Link to="/status" className="btn btn-secondary btn-medium no-underline">
          System status
        </Link>
      </div>
    </PageContainer>
  );
};
