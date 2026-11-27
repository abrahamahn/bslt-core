// main/apps/web/src/app/routeHead.ts
/**
 * Route-to-Document-Head Resolver for SPA Navigation
 *
 * Ensures every client-side navigation updates `document.title`,
 * `<meta name="description">`, OpenGraph / Twitter Card tags, `robots`, and
 * canonical links so browser tabs and social previews never stay stale.
 */

import { PRODUCT_TAGLINE } from './productMeta';

import type { HeadTags } from '@bslt/web-platform';

import { resolveDocChapter, resolveDocModule } from '#app/pages/docsCatalog';

interface StaticHeadEntry {
  readonly title: string;
  readonly description: string;
  readonly robots?: string | undefined;
}

const STATIC_PUBLIC_HEADS: Readonly<Record<string, StaticHeadEntry>> = {
  '/': {
    title: 'Home',
    description: `${PRODUCT_TAGLINE}.`,
  },
  '/changelog': {
    title: 'Changelog',
    description: `Release history and milestones for ${PRODUCT_TAGLINE}.`,
  },
  '/blog': {
    title: 'Engineering & Product Blog',
    description: 'Architecture deep dives, release notes, and product engineering guides.',
  },
  '/waitlist': {
    title: 'Request Early Access',
    description: 'Join the early-access waitlist and reserve your workspace spot.',
  },
  '/pricing': {
    title: 'Pricing & Plans',
    description: 'Compare Free, Pro, and Team plans with instant workspace upgrades.',
  },
  '/status': {
    title: 'System Status',
    description: 'Real-time service health, component availability, and incident history.',
  },
  '/support': {
    title: 'Support & Contact',
    description: 'Contact support or track help requests.',
  },
  '/report': {
    title: 'Report Content',
    description: 'Submit an abuse, safety, or compliance notice.',
  },
  '/terms': {
    title: 'Terms of Service',
    description: 'Terms of Service governing use of this platform.',
  },
  '/terms-of-service': {
    title: 'Terms of Service',
    description: 'Terms of Service governing use of this platform.',
  },
  '/privacy': {
    title: 'Privacy Policy',
    description: 'How personal data is collected, protected, and controlled.',
  },
  '/privacy-policy': {
    title: 'Privacy Policy',
    description: 'How personal data is collected, protected, and controlled.',
  },
  '/cookies': {
    title: 'Cookie Policy',
    description: 'Cookie categories and consent preferences.',
  },
  '/cookie-policy': {
    title: 'Cookie Policy',
    description: 'Cookie categories and consent preferences.',
  },
  '/acceptable-use': {
    title: 'Acceptable Use Policy',
    description: 'Permitted and prohibited uses of the platform.',
  },
  '/disclaimer': {
    title: 'Disclaimer',
    description: 'Service warranties and liability disclaimer.',
  },
};

const STATIC_PRIVATE_HEADS: Readonly<Record<string, StaticHeadEntry>> = {
  '/login': {
    title: 'Sign In',
    description: 'Sign in with password, email code, passkey, or OAuth.',
    robots: 'noindex, nofollow',
  },
  '/auth/login': {
    title: 'Sign In',
    description: 'Sign in with password, email code, passkey, or OAuth.',
    robots: 'noindex, nofollow',
  },
  '/register': {
    title: 'Create Account',
    description: 'Create your account and launch your workspace.',
    robots: 'noindex, nofollow',
  },
  '/auth/register': {
    title: 'Create Account',
    description: 'Create your account and launch your workspace.',
    robots: 'noindex, nofollow',
  },
  '/auth': {
    title: 'Authentication',
    description: 'Sign in or create an account.',
    robots: 'noindex, nofollow',
  },
  '/auth/reset-password': {
    title: 'Reset Password',
    description: 'Set a new password for your account.',
    robots: 'noindex, nofollow',
  },
  '/auth/confirm-email': {
    title: 'Confirm Email',
    description: 'Verify your email address.',
    robots: 'noindex, nofollow',
  },
  '/auth/change-email/confirm': {
    title: 'Confirm Email Change',
    description: 'Confirm your updated account email address.',
    robots: 'noindex, nofollow',
  },
  '/auth/change-email/revert': {
    title: 'Revert Email Change',
    description: 'Restore your previous account email address.',
    robots: 'noindex, nofollow',
  },
  '/auth/magic-link/verify': {
    title: 'Verify Sign-In Link',
    description: 'Completing passwordless sign-in.',
    robots: 'noindex, nofollow',
  },
  '/auth/sso/callback': {
    title: 'Enterprise SSO Sign-In',
    description: 'Completing workspace single sign-on.',
    robots: 'noindex, nofollow',
  },
  '/reactivate': {
    title: 'Reactivate Account',
    description: 'Restore your deactivated account.',
    robots: 'noindex, nofollow',
  },
  '/dashboard': {
    title: 'Dashboard',
    description: 'Active workspace overview, plan status, and quick actions.',
    robots: 'noindex, nofollow',
  },
  '/onboarding': {
    title: 'Workspace Onboarding',
    description: 'Set up your profile, workspace, and team invitations.',
    robots: 'noindex, nofollow',
  },
  '/profile': {
    title: 'Profile',
    description: 'Manage your public display name, username, bio, and avatar.',
    robots: 'noindex, nofollow',
  },
  '/settings': {
    title: 'Account Settings',
    description: 'Manage personal security, sessions, notifications, API keys, and privacy.',
    robots: 'noindex, nofollow',
  },
  '/workspace': {
    title: 'Workspace Control Center',
    description: 'Manage workspace members, invitations, custom roles, and settings.',
    robots: 'noindex, nofollow',
  },
  '/organization': {
    title: 'Workspace Control Center',
    description: 'Manage workspace members, invitations, custom roles, and settings.',
    robots: 'noindex, nofollow',
  },
  '/workspace/billing': {
    title: 'Workspace Billing',
    description: 'Manage subscription plan, payment methods, usage, and invoices.',
    robots: 'noindex, nofollow',
  },
  '/workspace/entitlements': {
    title: 'Plan & Entitlements',
    description: 'Inspect active plan features, quotas, and workspace entitlements.',
    robots: 'noindex, nofollow',
  },
  '/workspace/webhooks': {
    title: 'Workspace Webhooks',
    description: 'Manage outbound webhook endpoints, secrets, and delivery logs.',
    robots: 'noindex, nofollow',
  },
  '/workspace/audit': {
    title: 'Workspace Audit & Activity',
    description: 'Inspect operational activity and audit events for your workspace.',
    robots: 'noindex, nofollow',
  },
  '/tasks': {
    title: 'Tasks',
    description: 'Track and manage your tasks.',
    robots: 'noindex, nofollow',
  },
  '/projects': {
    title: 'Projects',
    description: 'Collaborative multi-tenant workspaces and Kanban boards.',
    robots: 'noindex, nofollow',
  },
  '/ai': {
    title: 'AI Assistant',
    description: 'Streaming AI conversations with org-scoped history and token metering.',
    robots: 'noindex, nofollow',
  },
  '/referrals': {
    title: 'Referrals',
    description: 'Share your personal referral link and track signups.',
    robots: 'noindex, nofollow',
  },
  '/files': {
    title: 'Files & Media',
    description: 'Upload, organize, and share workspace files and media assets.',
    robots: 'noindex, nofollow',
  },
  '/search': {
    title: 'Search',
    description: 'Search tasks, files, and workspace teammates.',
    robots: 'noindex, nofollow',
  },
  '/activities': {
    title: 'Activity Feed',
    description: 'Chronological stream of account and workspace events.',
    robots: 'noindex, nofollow',
  },
  '/billing/success': {
    title: 'Checkout Complete',
    description: 'Your subscription checkout succeeded.',
    robots: 'noindex, nofollow',
  },
  '/billing/cancel': {
    title: 'Checkout Canceled',
    description: 'Your checkout was canceled before completion.',
    robots: 'noindex, nofollow',
  },
  '/moderation/appeals': {
    title: 'Moderation Appeals',
    description: 'Submit or review moderation appeal requests.',
    robots: 'noindex, nofollow',
  },
  '/developer/emails': {
    title: 'Local Dev Email Inbox',
    description: 'Preview captured local development emails.',
    robots: 'noindex, nofollow',
  },
  '/developer/billing-sandbox': {
    title: 'Mock Billing Sandbox',
    description: 'Simulate local subscription lifecycle events without Stripe.',
    robots: 'noindex, nofollow',
  },
  '/developer/api-routes': {
    title: 'API Route Inspector',
    description: 'Inspect live registered server routes.',
    robots: 'noindex, nofollow',
  },
  '/ui-library': {
    title: 'UI Component Library',
    description: 'Interactive catalog of owned @bslt/ui components.',
    robots: 'noindex, nofollow',
  },
  '/side-peek-ui-library': {
    title: 'Side-Peek UI Library',
    description: 'Side-peek interactive preview of owned @bslt/ui components.',
    robots: 'noindex, nofollow',
  },
  '/clean': {
    title: 'Dev Workspace Docs',
    description: 'Local developer documentation viewer.',
    robots: 'noindex, nofollow',
  },
  '/forbidden': {
    title: 'Access Denied',
    description: 'You do not have permission to view this page.',
    robots: 'noindex, nofollow',
  },
  '/unavailable': {
    title: 'Service Unavailable',
    description: 'This surface is currently unavailable.',
    robots: 'noindex, nofollow',
  },
};

const SETTINGS_TAB_LABELS: Readonly<Record<string, string>> = {
  profile: 'Profile Settings',
  security: 'Security & Sign-in',
  sessions: 'Active Sessions & Devices',
  accounts: 'Connected OAuth Accounts',
  'api-keys': 'API Keys',
  notifications: 'Notification Preferences',
  preferences: 'Appearance & Preferences',
  billing: 'Billing Settings',
  entitlements: 'Entitlements',
  legal: 'Legal & Agreements',
  'data-controls': 'Data Controls & Privacy',
};

const ADMIN_SECTION_LABELS: Readonly<Record<string, string>> = {
  health: 'System Health',
  dashboard: 'Admin Overview',
  users: 'User Management',
  tenants: 'Tenant Directory',
  'feature-flags': 'Feature Flags',
  growth: 'Growth & Launch',
  search: 'Workspace Search',
  billing: 'Admin Billing Plans',
  entitlements: 'Admin Entitlements',
  compliance: 'Compliance & Holds',
  legal: 'Legal Documents',
  moderation: 'Moderation Queue',
  audit: 'Audit Log',
  security: 'Security Events',
  support: 'Support Inbox',
  notifications: 'Notification Sender',
  jobs: 'Background Jobs',
  webhooks: 'Webhook Endpoints',
  'webhook-monitor': 'Webhook Monitor',
  routes: 'Route Manifest',
};

function normalizePathname(pathname: string): string {
  if (pathname === '' || pathname === '/') return '/';
  const trimmed = pathname.replace(/\/+$/u, '');
  return trimmed === '' ? '/' : trimmed;
}

function formatTitle(pageTitle: string, appName: string): string {
  if (pageTitle === '' || pageTitle === appName) return appName;
  if (pageTitle === 'Home') return appName;
  return `${pageTitle} · ${appName}`;
}

export function resolveRouteHead(pathname: string, appName: string): HeadTags {
  const clean = normalizePathname(pathname);

  const staticPublic = STATIC_PUBLIC_HEADS[clean];
  if (staticPublic !== undefined) {
    return {
      title: formatTitle(staticPublic.title, appName),
      description: staticPublic.description,
      ogType: 'website',
    };
  }

  const staticPrivate = STATIC_PRIVATE_HEADS[clean];
  if (staticPrivate !== undefined) {
    return {
      title: formatTitle(staticPrivate.title, appName),
      description: staticPrivate.description,
      robots: staticPrivate.robots,
    };
  }

  if (clean === '/docs' || clean.startsWith('/docs/')) {
    const segments = clean.slice('/docs'.length).split('/').filter(Boolean);
    if (segments[0] === 'modules' && segments[1] !== undefined) {
      const mod = resolveDocModule(segments[1]);
      if (mod !== undefined) {
        return {
          title: `@bslt/${mod.id} Module Reference · ${appName} Docs`,
          description: mod.summary,
          ogType: 'article',
        };
      }
    }
    const chapter = resolveDocChapter(segments[0]);
    return {
      title: `${chapter.title} · ${appName} Docs`,
      description: chapter.summary,
      ogType: 'article',
    };
  }

  if (clean.startsWith('/settings/')) {
    const tab = clean.slice('/settings/'.length).split('/')[0] ?? '';
    const label = SETTINGS_TAB_LABELS[tab] ?? 'Account Settings';
    return {
      title: formatTitle(label, appName),
      description: 'Manage your personal account settings and security controls.',
      robots: 'noindex, nofollow',
    };
  }

  if (clean === '/admin' || clean.startsWith('/admin/')) {
    const section =
      clean === '/admin' ? 'health' : (clean.slice('/admin/'.length).split('/')[0] ?? '');
    const label = ADMIN_SECTION_LABELS[section] ?? 'Platform Admin';
    return {
      title: formatTitle(`${label} — Admin`, appName),
      description: 'Platform administration and governance console.',
      robots: 'noindex, nofollow',
    };
  }

  if (clean.startsWith('/blog/')) {
    const slug = clean.slice('/blog/'.length).split('/')[0] ?? '';
    const readableSlug = slug
      .split('-')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    return {
      title: formatTitle(readableSlug !== '' ? `${readableSlug} — Blog` : 'Blog', appName),
      description: 'Architecture deep dives, release notes, and product engineering guides.',
      ogType: 'article',
    };
  }

  if (clean.startsWith('/projects/')) {
    return {
      title: formatTitle('Project Board', appName),
      description: 'Collaborative multi-tenant Kanban board and project cards.',
      robots: 'noindex, nofollow',
    };
  }

  if (clean.startsWith('/workspace/webhooks/')) {
    return {
      title: formatTitle('Webhook Details', appName),
      description: 'Inspect outbound webhook configuration and delivery history.',
      robots: 'noindex, nofollow',
    };
  }

  if (clean.startsWith('/invitations/')) {
    return {
      title: formatTitle('Accept Workspace Invitation', appName),
      description: 'Join an invited workspace.',
      robots: 'noindex, nofollow',
    };
  }

  if (clean.startsWith('/email/unsubscribe/')) {
    return {
      title: formatTitle('Email Unsubscribe', appName),
      description: 'Manage email notification preferences.',
      robots: 'noindex, nofollow',
    };
  }

  return {
    title: formatTitle('Page Not Found', appName),
    description: `${appName} — ${PRODUCT_TAGLINE}.`,
    robots: 'noindex, nofollow',
  };
}
