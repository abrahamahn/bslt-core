// main/apps/web/src/pages/docsCatalog.ts
/**
 * Starter-Owned App Guide & Auto-Synced Platform Reference Catalog
 *
 * Combines human-friendly onboarding walkthroughs with live, build-time
 * generated reference metadata (`DOCS_REFERENCE` from `pnpm bslt sync docs`)
 * covering every installed module, HTTP API endpoint, web route, PostgreSQL
 * RLS table, outbox domain event, background job, and cron schedule.
 */

import { DOCS_REFERENCE, type DocsModuleRef } from './docsReference.generated';

type DocGroupId = 'start' | 'reference' | 'spaces';

type DocChapterView = 'guide' | 'api' | 'routes' | 'modules' | 'database' | 'events';

export interface DocRouteLink {
  readonly path: `/${string}`;
  readonly label: string;
  readonly access: 'Public' | 'Signed-in' | 'Workspace' | 'Platform Admin' | 'Dev only';
  readonly description: string;
}

interface DocSubsection {
  readonly heading: string;
  readonly body: string;
  readonly bullets?: readonly string[];
  readonly code?: string;
}

export interface DocGuideChapter {
  readonly id: string;
  readonly path: `/${string}`;
  readonly group: DocGroupId;
  readonly view: DocChapterView;
  readonly navLabel: string;
  readonly navCount?: number;
  readonly eyebrow: string;
  readonly title: string;
  readonly summary: string;
  readonly audience:
    'Everyone' | 'Personal Account' | 'Workspace Teams' | 'Platform Admin' | 'Developers';
  readonly keywords: readonly string[];
  readonly relatedModules?: readonly string[];
  readonly routes: readonly DocRouteLink[];
  readonly sections: readonly DocSubsection[];
}

interface DocKernelPackage {
  readonly name: string;
  readonly layer: 'Isomorphic' | 'Server' | 'Client';
  readonly summary: string;
}

interface DocPlatformStat {
  readonly label: string;
  readonly value: number;
  readonly detail: string;
  readonly to: `/${string}`;
}

export const DOC_GROUP_ORDER: readonly DocGroupId[] = ['start', 'reference', 'spaces'];

export const DOC_GROUP_LABELS: Readonly<Record<DocGroupId, string>> = {
  start: 'Start Here',
  reference: 'Full Reference (Auto-Synced)',
  spaces: 'Product Guides & CLI',
};

export const DOC_KERNEL_PACKAGES: readonly DocKernelPackage[] = [
  {
    name: '@bslt/schema',
    layer: 'Isomorphic',
    summary: 'Owned runtime validation combinators, coercion, and JSON Schema generation.',
  },
  {
    name: '@bslt/contract',
    layer: 'Isomorphic',
    summary: 'Typed endpoint contracts, module manifests, event defs, and capability context.',
  },
  {
    name: '@bslt/protocols',
    layer: 'Isomorphic',
    summary: 'Zero-dep wire protocols: PostgreSQL, JWT, TOTP, CBOR, COSE, WebPush, and OTLP.',
  },
  {
    name: '@bslt/db',
    layer: 'Server',
    summary:
      'PostgreSQL 17 pool, transactional RLS session context, typed repositories, and migrations.',
  },
  {
    name: '@bslt/server-system',
    layer: 'Server',
    summary:
      'Owned node:http router, middleware, rate limiting, outbox, background jobs, and crons.',
  },
  {
    name: '@bslt/realtime',
    layer: 'Server',
    summary:
      'WebSocket transport, pub/sub channel fan-out, and authenticated live event streaming.',
  },
  {
    name: '@bslt/storage',
    layer: 'Server',
    summary:
      'Local & S3-compatible object storage, signed URLs, multipart sessions, and media probing.',
  },
  {
    name: '@bslt/comms',
    layer: 'Server',
    summary: 'Transactional email templates, SMTP/dev-inbox transport, SMS, and WebPush delivery.',
  },
  {
    name: '@bslt/client-engine',
    layer: 'Client',
    summary:
      'Typed browser REST client, CSRF handling, token refresh, and cache/offline primitives.',
  },
  {
    name: '@bslt/react',
    layer: 'Client',
    summary:
      'Owned React 19 router, hooks, query/mutation state, and real-time subscription hooks.',
  },
  {
    name: '@bslt/ui',
    layer: 'Client',
    summary:
      '87 owned accessible UI primitives, semantic CSS tokens, icons, and responsive layouts.',
  },
  {
    name: '@bslt/web-platform',
    layer: 'Client',
    summary: 'Module web composition, shell contracts, public SSR routes, and capability gating.',
  },
];

const installedModuleCount = DOCS_REFERENCE.modules.length;
const apiEndpointCount = DOCS_REFERENCE.apiRoutes.length;
const webRouteCount = DOCS_REFERENCE.webRoutes.length;
const dbTableCount = DOCS_REFERENCE.dbTables.length;
const eventCount = DOCS_REFERENCE.events.length;
const jobCount = DOCS_REFERENCE.jobs.length;
const webhookEventCount = DOCS_REFERENCE.events.filter((ev) => ev.webhook).length;

export function getPlatformStats(): readonly DocPlatformStat[] {
  return [
    {
      label: 'HTTP API Endpoints',
      value: apiEndpointCount,
      detail: 'Typed contract routes with schemas & auth policies',
      to: '/docs/api',
    },
    {
      label: 'Web Routes & Screens',
      value: webRouteCount,
      detail: `${String(DOCS_REFERENCE.adminSurfaces.length)} Admin surfaces, public SSR & workspace UI`,
      to: '/docs/routes',
    },
    {
      label: 'Vertical Modules',
      value: installedModuleCount,
      detail: `Plus ${String(DOC_KERNEL_PACKAGES.length)} owned @bslt/* kernel packages`,
      to: '/docs/modules',
    },
    {
      label: 'PostgreSQL RLS Tables',
      value: dbTableCount,
      detail: `${String(DOCS_REFERENCE.dbTypes.length)} enums & ${String(DOCS_REFERENCE.dbFunctions.length)} SQL security functions`,
      to: '/docs/database',
    },
    {
      label: 'Outbox Domain Events',
      value: eventCount,
      detail: `${String(webhookEventCount)} outbound webhook-eligible events`,
      to: '/docs/events',
    },
    {
      label: 'Background Jobs',
      value: jobCount,
      detail: `Plus ${String(DOCS_REFERENCE.crons.length)} scheduled cron entries`,
      to: '/docs/events',
    },
  ];
}

export const DOC_CHAPTERS: readonly DocGuideChapter[] = [
  {
    id: 'overview',
    path: '/docs',
    group: 'start',
    view: 'guide',
    navLabel: 'App Tour & Map',
    eyebrow: '01 / OVERVIEW',
    title: 'Inside the BSLT App',
    summary: `A complete, auto-synced guide to all ${String(installedModuleCount)} modules, ${String(apiEndpointCount)} HTTP API endpoints, ${String(webRouteCount)} web screens, ${String(dbTableCount)} RLS tables, and ${String(eventCount)} domain events wired into this application.`,
    audience: 'Everyone',
    keywords: [
      'tour',
      'overview',
      'architecture',
      'map',
      'spaces',
      'quickstart',
      'navigation',
      'inventory',
    ],
    routes: [
      {
        path: '/docs/api',
        label: `HTTP API Explorer (${String(apiEndpointCount)})`,
        access: 'Public',
        description:
          'Search and filter every registered REST endpoint by module, HTTP method, auth role, and schema.',
      },
      {
        path: '/docs/routes',
        label: `All Web Screens (${String(webRouteCount)})`,
        access: 'Public',
        description:
          'Complete screen directory across Public, Auth, Personal Settings, Workspace, and Admin Console.',
      },
      {
        path: '/docs/modules',
        label: `Vertical Modules (${String(installedModuleCount)})`,
        access: 'Public',
        description:
          'Deep-dive pages for every installed vertical module plus the 12 @bslt/* kernel packages.',
      },
      {
        path: '/register',
        label: 'Create an Account',
        access: 'Public',
        description: 'Register a new user account, accept legal terms, and start the guided setup.',
      },
    ],
    sections: [
      {
        heading: 'How the App Is Organized (Four Clear Spaces)',
        body: 'Every screen in the application belongs to one of four explicit shells, matching how modern SaaS teams operate:',
        bullets: [
          'Public Surface (/, /docs, /docs/api, /pricing, /blog, /waitlist, /changelog, /status, /support, legal pages): fast SSR-prerendered pages anyone can read before signing in.',
          'Personal Account (/profile, /settings/*, /referrals): strictly personal identity — profile, password, passkeys, 2FA, active sessions, notifications, en-US / ko-KR preferences, personal API keys, personal referral link, and GDPR data controls.',
          'Workspace Control Center & Collaboration (/projects, /ai, /workspace, /workspace/*): team-owned multi-tenant spaces — Kanban project boards, streaming AI Assistant with token metering, workspace members, Enterprise OIDC SSO, billing & invoices, entitlements, webhooks, and activity.',
          'Platform Admin Console (/admin/*): cross-tenant operator console for platform administrators — health, users, tenants, growth & waitlist waves, feature flags, plan catalog, moderation, compliance holds, audit logs, and job queues.',
        ],
      },
      {
        heading: '60-Second Guided Walkthrough',
        body: 'Want to experience the live app end-to-end? Follow these five steps in order:',
        bullets: [
          '1. Visit /register to create an account (or /login with Demo Quick Sign-In when DEMO_MODE=true).',
          '2. Run /onboarding to set your name, configure your default workspace, and optionally send team invites.',
          '3. Open /dashboard to inspect your active workspace badge, current plan tier, KPI cards, and setup checklist — and toggle en-US ↔ ko-KR right in the header.',
          '4. Explore /projects (collaborative Kanban boards), /ai (zero-dep SSE AI Assistant), /referrals (invite link), or press ⌘K to jump anywhere.',
          '5. Open /workspace to manage members, Enterprise OIDC SSO, /workspace/billing, /workspace/entitlements, or self-service /workspace/webhooks — and try live endpoints in /docs/api.',
        ],
      },
    ],
  },
  {
    id: 'api',
    path: '/docs/api',
    group: 'reference',
    view: 'api',
    navLabel: 'HTTP API Reference',
    navCount: apiEndpointCount,
    eyebrow: 'REFERENCE / HTTP API',
    title: `HTTP API Reference (${String(apiEndpointCount)} Endpoints)`,
    summary:
      'Every registered HTTP endpoint auto-synced from the composed server route table and module contracts — searchable by path, contract ID, module, HTTP method, auth role, and request/response schemas.',
    audience: 'Developers',
    keywords: [
      'api',
      'endpoints',
      'rest',
      'http',
      'openapi',
      'schemas',
      'contracts',
      'curl',
      'routes',
    ],
    routes: [],
    sections: [],
  },
  {
    id: 'routes',
    path: '/docs/routes',
    group: 'reference',
    view: 'routes',
    navLabel: 'Web Routes & Screens',
    navCount: webRouteCount,
    eyebrow: 'REFERENCE / WEB SURFACE',
    title: `Web Routes & Screens (${String(webRouteCount)} Routes)`,
    summary:
      'Every client and SSR-prerendered page in the web application, attributed to its owning module with route guards, shell stack, and all Platform Admin Console surfaces.',
    audience: 'Everyone',
    keywords: [
      'web',
      'routes',
      'screens',
      'pages',
      'navigation',
      'shells',
      'guards',
      'admin',
      'ssr',
    ],
    routes: [],
    sections: [],
  },
  {
    id: 'modules',
    path: '/docs/modules',
    group: 'reference',
    view: 'modules',
    navLabel: 'Modules & Kernel',
    navCount: installedModuleCount,
    eyebrow: 'REFERENCE / ARCHITECTURE',
    title: `Vertical Modules (${String(installedModuleCount)}) & Kernel (${String(DOC_KERNEL_PACKAGES.length)})`,
    summary:
      'Self-contained vertical domain modules composed via bslt.config.ts over 12 zero-dependency @bslt/* kernel packages. Open any module to inspect its exact API endpoints, screens, RLS tables, events, and jobs.',
    audience: 'Developers',
    keywords: [
      'modules',
      'kernel',
      'architecture',
      'dag',
      'dependencies',
      'packages',
      'projects',
      'tasks',
      'files',
      'search',
      'notifications',
      'moderation',
      'compliance',
      'support',
      'status',
      'analytics',
    ],
    routes: [],
    sections: [],
  },
  {
    id: 'database',
    path: '/docs/database',
    group: 'reference',
    view: 'database',
    navLabel: 'Database & RLS',
    navCount: dbTableCount,
    eyebrow: 'REFERENCE / POSTGRESQL 17',
    title: `Database Schema & Forced RLS (${String(dbTableCount)} Tables)`,
    summary:
      'One flat public PostgreSQL 17 schema with forced Row-Level Security (sys_apply_rls) across every attributed table, plus custom enum types and security-definer/invoker helper functions.',
    audience: 'Developers',
    keywords: [
      'database',
      'postgres',
      'postgresql',
      'rls',
      'tables',
      'schema',
      'enums',
      'functions',
      'migrations',
      'tenancy',
    ],
    routes: [],
    sections: [],
  },
  {
    id: 'events',
    path: '/docs/events',
    group: 'reference',
    view: 'events',
    navLabel: 'Events, Jobs & Crons',
    navCount: eventCount,
    eyebrow: 'REFERENCE / ASYNC RUNTIME',
    title: `Domain Events (${String(eventCount)}), Jobs (${String(jobCount)}) & Crons`,
    summary:
      'Transactional outbox events (sys_outbox), outbound webhook triggers, durable PostgreSQL background jobs (sys_jobs), and scheduled cron definitions.',
    audience: 'Developers',
    keywords: [
      'events',
      'outbox',
      'webhooks',
      'jobs',
      'worker',
      'queue',
      'cron',
      'schedules',
      'async',
    ],
    routes: [],
    sections: [],
  },
  {
    id: 'auth',
    path: '/docs/auth',
    group: 'spaces',
    view: 'guide',
    navLabel: 'Identity & Security',
    eyebrow: 'GUIDE / PERSONAL ACCOUNT',
    title: 'Identity, Authentication & Account Security',
    summary:
      'Complete user lifecycle and personal security controls backed by PostgreSQL 17 forced Row-Level Security, Argon2id hashing, token-family reuse detection, and owned WebAuthn/OAuth protocols.',
    audience: 'Personal Account',
    keywords: [
      'auth',
      'login',
      'register',
      'passkey',
      'webauthn',
      '2fa',
      'mfa',
      'totp',
      'sms',
      'oauth',
      'google',
      'github',
      'apple',
      'sessions',
      'api keys',
      'gdpr',
      'privacy',
    ],
    relatedModules: ['identity', 'compliance', 'notifications'],
    routes: [
      {
        path: '/profile',
        label: 'Profile & Avatar',
        access: 'Signed-in',
        description: 'Update display name, username, bio, and upload a scanned avatar image.',
      },
      {
        path: '/settings/security',
        label: 'Security & Sign-in',
        access: 'Signed-in',
        description:
          'Password changes, WebAuthn passkeys, TOTP/SMS 2FA, backup codes, and OAuth connections.',
      },
      {
        path: '/settings/sessions',
        label: 'Active Sessions & Devices',
        access: 'Signed-in',
        description:
          'Inspect active refresh-token sessions and revoke individual or all other devices.',
      },
      {
        path: '/settings/api-keys',
        label: 'Personal & Org-Scoped API Keys',
        access: 'Signed-in',
        description:
          'Mint personal or workspace-scoped machine tokens with explicit scopes and expiry dates.',
      },
      {
        path: '/settings/data-controls',
        label: 'Data Controls & Privacy',
        access: 'Signed-in',
        description:
          'Consent preferences, age assurance, GDPR data export, and account erasure requests.',
      },
    ],
    sections: [
      {
        heading: 'Sign-In Strategies & Session Safety',
        body: 'Identity supports multiple composable authentication methods controlled via AUTH_STRATEGIES, with zero external auth SDK dependencies:',
        bullets: [
          'Email + password with Argon2id hashing, account lockout protection, email verification, email-change confirm/revert, and password reset flows.',
          'Passwordless Magic Links and Email OTP codes for low-friction login.',
          'Hardware-backed WebAuthn Passkeys (implemented directly over owned CBOR/COSE primitives), TOTP 2FA, SMS MFA, trusted devices, and recovery backup codes.',
          'Social OAuth sign-in and account linking for Google, GitHub, and Apple.',
          'Rotating HttpOnly refresh-token cookies with automatic token-family revocation on reuse detection plus sudo re-authentication.',
        ],
      },
      {
        heading: 'Scoped API Keys & Personal Settings',
        body: 'Every signed-in user gets a unified Settings space under /settings/* strictly scoped to their personal identity:',
        bullets: [
          'Create personal or workspace-scoped API keys (org_id + scopes[]) that display the raw secret once and store only the SHA-256 hash.',
          'Manage notification channels & WebPush subscriptions (/settings/notifications), appearance theme & timezone (/settings/preferences), and legal acceptances (/settings/legal).',
        ],
      },
    ],
  },
  {
    id: 'workspaces',
    path: '/docs/workspaces',
    group: 'spaces',
    view: 'guide',
    navLabel: 'Workspaces & Teams',
    eyebrow: 'GUIDE / MULTI-TENANT WORKSPACE',
    title: 'Workspaces, Roles & Self-Service Webhooks',
    summary:
      'Every team gets a dedicated Workspace Control Center at /workspace with PostgreSQL tenant isolation, custom bitmask roles, email invitations, seat quotas, and self-service webhook endpoints.',
    audience: 'Workspace Teams',
    keywords: [
      'workspace',
      'organization',
      'tenant',
      'teams',
      'members',
      'invitations',
      'roles',
      'permissions',
      'webhooks',
      'audit',
      'seats',
      'projects',
      'kanban',
      'ai',
      'sso',
      'oidc',
    ],
    relatedModules: ['orgs', 'projects', 'ai', 'webhooks', 'audit', 'files', 'tasks', 'search'],
    routes: [
      {
        path: '/projects',
        label: 'Collaborative Projects & Boards',
        access: 'Workspace',
        description:
          'Create org-scoped project boards, add Kanban cards, move columns, and sync updates live over WebSockets.',
      },
      {
        path: '/ai',
        label: 'Zero-Dep AI Assistant',
        access: 'Workspace',
        description:
          'Stream OpenAI, Anthropic, Gemini, or Mock completions over native SSE with persisted history and token metering.',
      },
      {
        path: '/workspace',
        label: 'Workspace Control Center',
        access: 'Workspace',
        description:
          'Switch workspaces, edit workspace details, manage members, send invites, and configure custom roles.',
      },
      {
        path: '/workspace/billing',
        label: 'Workspace Billing & Invoices',
        access: 'Workspace',
        description:
          'View current subscription tier, update payment methods, download invoices, or change plans.',
      },
      {
        path: '/workspace/entitlements',
        label: 'Plan & Entitlements',
        access: 'Workspace',
        description: 'Inspect live feature flags, plan limits, and workspace entitlement grants.',
      },
      {
        path: '/workspace/webhooks',
        label: 'Workspace Webhooks',
        access: 'Workspace',
        description:
          'Register outbound webhook endpoints, rotate HMAC secrets, and inspect delivery logs.',
      },
      {
        path: '/workspace/audit',
        label: 'Audit & Activity',
        access: 'Workspace',
        description:
          'Review recent actions and operational activity associated with your workspace.',
      },
    ],
    sections: [
      {
        heading: 'Tenant Scoping & Switching',
        body: 'Switching your active workspace in the sidebar or top header updates the x-org-id context across every workspace-scoped API call:',
        bullets: [
          'PostgreSQL Row-Level Security policies enforce tenant isolation directly in the database via sys_current_org_id().',
          'Enterprise OIDC SSO supports verified email domains, PKCE authorization flows, JIT user provisioning, and optional domain-wide SSO enforcement.',
          'Seat quotas (org.metadata.maxSeats) are enforced server-side on both direct member additions and pending invitations.',
          'Custom roles use append-only permission bitmasks locked in bslt.lock.json so permissions never silently drift across deploys.',
        ],
      },
      {
        heading: 'Self-Service Outbound Webhooks',
        body: 'Workspace owners can subscribe to domain events without contacting support:',
        bullets: [
          'Register HTTPS endpoints with event filters, automatic HMAC-SHA256 payload signing, and one-click secret rotation.',
          'Inspect per-endpoint delivery attempts, HTTP response codes, and exponential-backoff retries.',
          'Optional WEBHOOK_MAX_PER_ORG cap guards against runaway endpoint creation on lower tiers.',
        ],
      },
    ],
  },
  {
    id: 'billing',
    path: '/docs/billing',
    group: 'spaces',
    view: 'guide',
    navLabel: 'Billing & Entitlements',
    eyebrow: 'GUIDE / MONETIZATION',
    title: 'Pricing, Subscriptions & Entitlements',
    summary:
      'Provider-agnostic subscription billing supporting Stripe, PayPal, and an offline Mock provider — connected end-to-end from public /pricing through checkout into live plan entitlements.',
    audience: 'Workspace Teams',
    keywords: [
      'billing',
      'pricing',
      'plans',
      'stripe',
      'paypal',
      'checkout',
      'invoices',
      'subscriptions',
      'entitlements',
      'quotas',
      'usage',
      'proration',
    ],
    relatedModules: ['billing', 'entitlements', 'flags'],
    routes: [
      {
        path: '/pricing',
        label: 'Public Pricing Page',
        access: 'Public',
        description:
          'Browse active plans (Free, Pro, Team) and preserve chosen plan across registration into checkout.',
      },
      {
        path: '/workspace/billing',
        label: 'Billing & Invoices',
        access: 'Workspace',
        description:
          'Manage active subscription, payment methods, metered usage summary, and invoice history.',
      },
      {
        path: '/workspace/entitlements',
        label: 'Entitlements Overview',
        access: 'Workspace',
        description:
          'See which features and quantitative limits are currently unlocked for your workspace.',
      },
    ],
    sections: [
      {
        heading: 'Public Pricing to Checkout Continuity',
        body: 'Anonymous visitors can explore /pricing without hitting a login wall:',
        bullets: [
          'Choosing a paid plan while signed out redirects to /register?returnTo=/pricing?plan=...&interval=month so the user returns directly into checkout after signup.',
          'Signed-in subscribers see live proration previews when upgrading or downgrading between plans.',
          'Free-tier accounts still see their live Usage Summary inside Billing Settings so upgrade triggers stay clear.',
        ],
      },
      {
        heading: 'Entitlements & Quota Enforcement',
        body: 'Billing plans define canonical limit and toggle features (projects:limit, storage:limit, api:access, team:invite, branding:custom) that synchronize cleanly into entitlements:',
        bullets: [
          'Webhook verification handles Stripe/PayPal lifecycle events idempotently via the transactional outbox.',
          'Local development runs seamlessly with BILLING_PROVIDER=mock and the Devtools Billing Sandbox.',
        ],
      },
    ],
  },
  {
    id: 'admin',
    path: '/docs/admin',
    group: 'spaces',
    view: 'guide',
    navLabel: 'Platform Admin Console',
    eyebrow: 'GUIDE / PLATFORM OPERATIONS',
    title: 'Platform Admin & Governance Console',
    summary: `A unified operator console under /admin/* with ${String(DOCS_REFERENCE.adminSurfaces.length)} surfaces across Operations, Users & Orgs, Trust & Compliance, and Billing & Webhooks.`,
    audience: 'Platform Admin',
    keywords: [
      'admin',
      'console',
      'health',
      'users',
      'tenants',
      'flags',
      'moderation',
      'compliance',
      'audit',
      'security',
      'jobs',
      'impersonation',
      'webhooks',
      'growth',
      'waitlist',
    ],
    relatedModules: [
      'admin',
      'growth',
      'flags',
      'moderation',
      'compliance',
      'audit',
      'support',
      'webhooks',
    ],
    routes: [
      {
        path: '/admin/growth',
        label: 'Growth, Waitlist & Announcements',
        access: 'Platform Admin',
        description:
          'Approve waitlist invite waves, trigger branded invite emails, and publish site-wide announcement banners.',
      },
      {
        path: '/admin/health',
        label: 'System Health & Metrics',
        access: 'Platform Admin',
        description: 'Live database, cache, storage, queue, and latency telemetry.',
      },
      {
        path: '/admin/users',
        label: 'Users & Impersonation',
        access: 'Platform Admin',
        description:
          'Search users, manage bans/roles, and start audited support impersonation sessions.',
      },
      {
        path: '/admin/tenants',
        label: 'Tenant Directory',
        access: 'Platform Admin',
        description: 'Inspect workspaces, member counts, and per-tenant feature flag overrides.',
      },
      {
        path: '/admin/feature-flags',
        label: 'Feature Flags',
        access: 'Platform Admin',
        description:
          'Toggle runtime platform capabilities (flags.billing, orgs.teams, flags.media, etc.) live.',
      },
      {
        path: '/admin/billing/plans',
        label: 'Admin Billing Plans',
        access: 'Platform Admin',
        description: 'Create, edit, archive, and Stripe-sync subscription plans and grant trials.',
      },
      {
        path: '/admin/compliance',
        label: 'Compliance, Holds & Erasures',
        access: 'Platform Admin',
        description:
          'Publish versioned legal docs, manage legal holds, jurisdictions, and GDPR erasure queues.',
      },
      {
        path: '/admin/audit',
        label: 'Audit & Security Logs',
        access: 'Platform Admin',
        description:
          'Filter append-only audit trails, inspect security incidents, and export CSV/JSON reports.',
      },
    ],
    sections: [
      {
        heading: 'Four Operator Sections in One Sidebar',
        body: 'Platform administrators navigate /admin/* through four cohesive sidebar groups matching Settings and Workspace:',
        bullets: [
          'Operations: System Health, Overview Dashboard, Background Jobs & Dead-Letter Queue, Support Tickets, Notifications, and Feature Flags.',
          'Users & Orgs: Cross-tenant User Directory (with audited impersonation banner) and Workspace/Tenant Management.',
          'Trust & Compliance: Moderation Cases & Appeals, Security Events & Exports, Append-Only Audit Log, and Legal/Compliance Controls.',
          'Billing & Webhooks: Plan Catalog Management, Entitlement Grants, and Platform-Wide Webhook Delivery Monitor.',
        ],
      },
    ],
  },
  {
    id: 'cli',
    path: '/docs/cli',
    group: 'spaces',
    view: 'guide',
    navLabel: 'Branding, CLI & Sandbox',
    eyebrow: 'GUIDE / DEVELOPER EXPERIENCE',
    title: 'Single-Manifest Branding, CLI Presets & Offline Sandbox',
    summary:
      'Clone once, rebrand from a single config file, pick your starter preset, install optional modules from the v1.0.0 release catalog, and test emails & billing completely offline.',
    audience: 'Developers',
    keywords: [
      'cli',
      'quickstart',
      'preset',
      'brand',
      'bslt.config.ts',
      'doctor',
      'module',
      'sandbox',
      'emails',
      'seed',
      'self-host',
      'devtools',
    ],
    relatedModules: ['devtools'],
    routes: [
      {
        path: '/developer/emails',
        label: 'Local Dev Email Inbox',
        access: 'Dev only',
        description:
          'Split-pane HTML/text previewer for captured local emails with clickable verify/reset/invite links.',
      },
      {
        path: '/developer/billing-sandbox',
        label: 'Mock Billing Sandbox',
        access: 'Dev only',
        description:
          'Simulate checkouts, plan changes, renewals, and webhook events locally without Stripe keys.',
      },
      {
        path: '/developer/api-routes',
        label: 'Live API Route Inspector',
        access: 'Dev only',
        description:
          'Inspect live running server routes, auth policies, and contract schemas in dev.',
      },
      {
        path: '/ui-library',
        label: 'UI Component Library',
        access: 'Dev only',
        description: 'Interactive catalog of all 87 owned @bslt/ui primitives and variants.',
      },
    ],
    sections: [
      {
        heading: 'One-File White-Label Brand Engine',
        body: 'Edit the brand object in bslt.config.ts and run pnpm bslt sync modules to automatically propagate your product name, tagline, accent color, domain, and support email across:',
        bullets: [
          'The web client, SSR shell, and theme CSS token bootstrap (--ui-color-brand).',
          'HTML <title> in main/apps/web/index.html and PWA main/apps/web/public/manifest.json.',
          'Every @bslt/comms transactional email template header, CTA accent button, and support footer.',
        ],
      },
      {
        heading: 'Essential CLI Workflows',
        body: 'The owned bslt CLI automates onboarding, module composition, diagnostics, docs syncing, and verification:',
        code: [
          '# 1. Bootstrap a fresh clone with a curated SaaS preset',
          'pnpm quickstart --preset b2b-saas   # or: core | solo-saas',
          '',
          '# 2. Verify environment, secrets, Postgres & locked migration checksums',
          'pnpm bslt doctor',
          '',
          '# 3. Seed starter plans (Free/Pro/Team), Acme Studio workspace & flags',
          'pnpm bslt db seed --demo',
          '',
          '# 4. Install optional modules from the v1.0.0 catalog or scaffold your own',
          'BSLT_MODULE_CATALOG=https://github.com/abrahamahn/bslt-core/releases/download/v1.0.0/modules.catalog.json \\',
          '  pnpm bslt module add billing',
          'pnpm bslt module new projects --scope org',
          '',
          '# 5. Keep OpenAPI, markdown references, and this live /docs hub synced',
          'pnpm bslt sync openapi && pnpm bslt sync docs',
        ].join('\n'),
      },
    ],
  },
];

export function resolveDocChapter(slug: string | undefined): DocGuideChapter {
  if (slug !== undefined && slug.length > 0) {
    const matched = DOC_CHAPTERS.find((chapter) => chapter.id === slug);
    if (matched !== undefined) return matched;
  }
  return DOC_CHAPTERS[0] as DocGuideChapter;
}

export function resolveDocModule(moduleId: string | undefined): DocsModuleRef | undefined {
  if (moduleId === undefined || moduleId.length === 0) return undefined;
  return DOCS_REFERENCE.modules.find((mod) => mod.id === moduleId);
}

export function filterDocChapters(query: string): readonly DocGuideChapter[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return DOC_CHAPTERS;
  return DOC_CHAPTERS.filter((chapter) => {
    const haystack = [
      chapter.navLabel,
      chapter.title,
      chapter.summary,
      ...chapter.keywords,
      ...(chapter.relatedModules ?? []),
      ...chapter.routes.map((route) => `${route.label} ${route.path} ${route.description}`),
      ...chapter.sections.map((section) => `${section.heading} ${section.body}`),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalized);
  });
}

export function filterDocModules(query: string): readonly DocsModuleRef[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return DOCS_REFERENCE.modules;
  return DOCS_REFERENCE.modules.filter((mod) => {
    const haystack =
      `${mod.id} @bslt/${mod.id} ${mod.summary} ${mod.scope} ${mod.dependsOn.join(' ')}`.toLowerCase();
    return haystack.includes(normalized);
  });
}
