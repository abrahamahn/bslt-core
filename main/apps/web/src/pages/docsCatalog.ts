// main/apps/web/src/pages/docsCatalog.ts
/**
 * Starter-Owned App Guide Catalog
 *
 * Pure, zero-auth metadata describing the spaces, routes, modules, and CLI
 * workflows inside this BSLT application. Keeps public SSR lean while giving
 * both anonymous visitors and signed-in users a complete map of the product.
 */

type DocGroupId = 'start' | 'spaces' | 'modules';

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

interface DocGuideChapter {
  readonly id: string;
  readonly path: `/${string}`;
  readonly group: DocGroupId;
  readonly navLabel: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly summary: string;
  readonly audience:
    'Everyone' | 'Personal Account' | 'Workspace Teams' | 'Platform Admin' | 'Developers';
  readonly keywords: readonly string[];
  readonly routes: readonly DocRouteLink[];
  readonly sections: readonly DocSubsection[];
}

export const DOC_GROUP_ORDER: readonly DocGroupId[] = ['start', 'spaces', 'modules'];

export const DOC_GROUP_LABELS: Readonly<Record<DocGroupId, string>> = {
  start: 'Start Here',
  spaces: 'Core Product Spaces',
  modules: 'Modules & Operations',
};

export const DOC_CHAPTERS: readonly DocGuideChapter[] = [
  {
    id: 'overview',
    path: '/docs',
    group: 'start',
    navLabel: 'App Tour & Map',
    eyebrow: '01 / OVERVIEW',
    title: 'Inside the BSLT App',
    summary:
      'A complete tour of every space, module, and live route wired into this application — organized around four clear boundaries so personal settings, team workspaces, and platform operations never collide.',
    audience: 'Everyone',
    keywords: ['tour', 'overview', 'architecture', 'map', 'spaces', 'quickstart', 'navigation'],
    routes: [
      {
        path: '/register',
        label: 'Create an Account',
        access: 'Public',
        description: 'Register a new user account, accept legal terms, and start the guided setup.',
      },
      {
        path: '/onboarding',
        label: '3-Step Onboarding Wizard',
        access: 'Signed-in',
        description:
          'Confirm profile details, name your workspace, and invite teammates in one flow.',
      },
      {
        path: '/dashboard',
        label: 'Workspace Dashboard',
        access: 'Signed-in',
        description:
          'Active workspace & plan badges, KPI cards, setup checklist, and quick actions.',
      },
      {
        path: '/pricing',
        label: 'Public Pricing & Plans',
        access: 'Public',
        description:
          'Compare Free, Pro, and Team tiers with seamless signup-to-checkout continuity.',
      },
    ],
    sections: [
      {
        heading: 'How the App Is Organized (Four Clear Spaces)',
        body: 'Every screen in the application belongs to one of four explicit shells, matching how modern SaaS teams operate:',
        bullets: [
          'Public Surface (/, /docs, /pricing, /changelog, /status, /support, legal pages): fast SSR-prerendered pages anyone can read before signing in.',
          'Personal Account (/profile, /settings/*): strictly personal identity — profile, password, passkeys, 2FA, active sessions, notifications, preferences, personal API keys, and GDPR data controls.',
          'Workspace Control Center (/workspace, /workspace/*): team-owned multi-tenant space — workspace members, invitations, custom roles, billing & invoices, plan entitlements, self-service webhooks, and activity.',
          'Platform Admin Console (/admin/*): cross-tenant operator console for platform administrators — health, users, tenants, feature flags, plan catalog, moderation, compliance holds, audit logs, and job queues.',
        ],
      },
      {
        heading: '60-Second Guided Walkthrough',
        body: 'Want to experience the live app end-to-end? Follow these five steps in order:',
        bullets: [
          '1. Visit /register to create an account (or /login if you already have one).',
          '2. Run /onboarding to set your name, configure your default workspace, and optionally send team invites.',
          '3. Open /dashboard to inspect your active workspace badge, current plan tier, KPI cards, and setup checklist.',
          '4. Press ⌘K (or click Jump to…) from any signed-in screen to navigate across Tasks, Files, Workspace Search, Settings, and Workspace Controls.',
          '5. Open /workspace to manage members, view /workspace/billing and /workspace/entitlements, or register self-service /workspace/webhooks.',
        ],
      },
    ],
  },
  {
    id: 'auth',
    path: '/docs/auth',
    group: 'spaces',
    navLabel: 'Identity & Security',
    eyebrow: '02 / PERSONAL ACCOUNT',
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
      'oauth',
      'google',
      'github',
      'apple',
      'sessions',
      'api keys',
      'gdpr',
      'privacy',
    ],
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
          'Password changes, WebAuthn passkeys, TOTP 2FA, and connected Google/GitHub/Apple accounts.',
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
          'Email + password with Argon2id hashing, account lockout protection, email verification, and password reset flows.',
          'Passwordless Magic Links and Email OTP codes for low-friction login.',
          'Hardware-backed WebAuthn Passkeys (implemented directly over owned CBOR/COSE primitives) plus TOTP 2FA with recovery codes.',
          'Social OAuth sign-in and account linking for Google, GitHub, and Apple.',
          'Rotating HttpOnly refresh-token cookies with automatic token-family revocation on reuse detection.',
        ],
      },
      {
        heading: 'Scoped API Keys & Personal Settings',
        body: 'Every signed-in user gets a unified Settings space under /settings/* strictly scoped to their personal identity:',
        bullets: [
          'Create personal or workspace-scoped API keys (org_id + scopes[]) that display the raw secret once and store only the SHA-256 hash.',
          'Manage notification channels (/settings/notifications), appearance theme & timezone (/settings/preferences), and legal acceptances (/settings/legal).',
        ],
      },
    ],
  },
  {
    id: 'workspaces',
    path: '/docs/workspaces',
    group: 'spaces',
    navLabel: 'Workspaces & Teams',
    eyebrow: '03 / MULTI-TENANT WORKSPACE',
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
    ],
    routes: [
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
    navLabel: 'Billing & Entitlements',
    eyebrow: '04 / MONETIZATION',
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
    id: 'modules',
    path: '/docs/modules',
    group: 'modules',
    navLabel: 'Everyday App Modules',
    eyebrow: '05 / VERTICAL MODULES',
    title: 'Tasks, Files, Search, Status & Compliance',
    summary:
      'Beyond identity, teams, and billing, the full workspace includes vertical domain modules you can keep, customize, or remove cleanly via bslt.config.ts.',
    audience: 'Everyone',
    keywords: [
      'tasks',
      'files',
      'media',
      'uploads',
      'search',
      'notifications',
      'activities',
      'support',
      'status',
      'legal',
      'changelog',
      'modules',
    ],
    routes: [
      {
        path: '/tasks',
        label: 'Tasks',
        access: 'Signed-in',
        description:
          'Owner-isolated personal task tracker demonstrating clean CRUD + RLS module architecture.',
      },
      {
        path: '/files',
        label: 'Files & Media',
        access: 'Signed-in',
        description:
          'Direct & resumable multipart uploads, content scanning, signed URLs, media transforms, and storage quotas.',
      },
      {
        path: '/search',
        label: 'Workspace Search',
        access: 'Signed-in',
        description:
          'Search your own tasks, files, and active workspace teammates (admins can toggle to Directory search).',
      },
      {
        path: '/activities',
        label: 'Activity Feed',
        access: 'Signed-in',
        description: 'Chronological stream of account and workspace events.',
      },
      {
        path: '/support',
        label: 'Support & Contact',
        access: 'Public',
        description:
          'Public support intake form plus priority support requests for signed-in users.',
      },
      {
        path: '/status',
        label: 'System Status',
        access: 'Public',
        description: 'SSR-rendered real-time service health and incident timeline.',
      },
      {
        path: '/changelog',
        label: 'Product Changelog',
        access: 'Public',
        description: 'Starter-owned SSR release notes driven by your brand configuration.',
      },
    ],
    sections: [
      {
        heading: 'Built-In Productivity & Storage Workflows',
        body: 'Each vertical module is self-contained with its own contract, migrations, forced RLS policies, server handlers, React UI, and i18n bundle:',
        bullets: [
          'Files & Media (/files): enforces MIME/size validation, fail-closed content scanning, resumable multipart upload sessions, ffmpeg media probing/transforms, and optional FILE_MAX_USER_STORAGE_BYTES quotas.',
          'Workspace Search (/search): accessible from the header search bar and ⌘K for every signed-in user, scoped strictly to your own tasks, files, and active workspace members.',
          'Real-Time Notifications: WebSocket-backed notification bell in the header with per-channel preferences under /settings/notifications.',
          'Legal & Compliance (/terms, /privacy, /cookies, /acceptable-use, /disclaimer): versioned legal documents, cookie consent banner, CPRA Do-Not-Sell control, and mandatory ToS re-acceptance gates.',
        ],
      },
    ],
  },
  {
    id: 'admin',
    path: '/docs/admin',
    group: 'modules',
    navLabel: 'Platform Admin Console',
    eyebrow: '06 / PLATFORM OPERATIONS',
    title: 'Platform Admin & Governance Console',
    summary:
      'A unified operator console under /admin/* with a grouped sticky sidebar for monitoring health, managing users & tenants, tuning feature flags, moderating content, and auditing compliance.',
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
    ],
    routes: [
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
        path: '/admin/billing',
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
    group: 'modules',
    navLabel: 'Branding, CLI & Dev Sandbox',
    eyebrow: '07 / DEVELOPER EXPERIENCE',
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
        label: 'API Route Inspector',
        access: 'Dev only',
        description: 'Browse every registered API route, auth policy, and contract schema.',
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
        body: 'The owned bslt CLI automates onboarding, module composition, diagnostics, and verification:',
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

export function filterDocChapters(query: string): readonly DocGuideChapter[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return DOC_CHAPTERS;
  return DOC_CHAPTERS.filter((chapter) => {
    const haystack = [
      chapter.navLabel,
      chapter.title,
      chapter.summary,
      ...chapter.keywords,
      ...chapter.routes.map((route) => `${route.label} ${route.path} ${route.description}`),
      ...chapter.sections.map((section) => `${section.heading} ${section.body}`),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalized);
  });
}
