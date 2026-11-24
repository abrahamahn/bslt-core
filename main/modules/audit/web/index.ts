// main/modules/audit/web/index.ts
import { implementWeb, lazyModulePage } from '@bslt/web-platform';

import enUsMessages from '../i18n/en-US.json';
import { auditModule } from '../module';

export { useAuditEvents, useSecurityMetrics } from './hooks';

export const auditWeb = implementWeb(auditModule, {
  routes: [
    {
      path: '/activities',
      shell: 'app',
      auth: 'user',
      title: 'audit.activitiesTitle',
      page: lazyModulePage(() => import('./ActivityFeedPage'), 'ActivityFeedPage'),
    },
    {
      path: '/workspace/audit',
      shell: 'app',
      auth: 'user',
      title: 'audit.workspaceAuditTitle',
      unlisted: true,
      page: lazyModulePage(() => import('./ActivityFeedPage'), 'ActivityFeedPage'),
    },
    {
      path: '/admin/security',
      shell: 'console',
      auth: 'admin',
      title: 'audit.securityTitle',
      page: lazyModulePage(() => import('./SecurityEventsPage'), 'SecurityEventsPage'),
    },
    {
      path: '/admin/security/:id',
      shell: 'console',
      auth: 'admin',
      title: 'audit.securityDetailTitle',
      unlisted: true,
      page: lazyModulePage(() => import('./SecurityEventDetailPage'), 'SecurityEventDetailPage'),
    },
    {
      path: '/admin/audit',
      shell: 'console',
      auth: 'admin',
      title: 'audit.auditLogTitle',
      page: lazyModulePage(() => import('./AuditEventsPage'), 'AuditEventsPage'),
    },
  ],
  nav: [
    {
      to: '/activities',
      slot: 'app.primary',
      label: 'audit.activitiesNav',
      hint: 'audit.activitiesNavHint',
      icon: 'activity',
      order: 80,
    },
    {
      to: '/activities',
      slot: 'palette',
      label: 'audit.activitiesPaletteLabel',
      description: 'audit.activitiesPaletteDescription',
      keywords: ['feed', 'recent', 'events', 'log'],
      icon: 'activity',
      order: 60,
    },
  ],
  admin: [
    {
      id: 'security',
      label: 'audit.securityAdminNav',
      href: '/admin/security',
      routePath: 'security',
      order: 50,
    },
    {
      id: 'audit',
      label: 'audit.auditLogAdminNav',
      href: '/admin/audit',
      routePath: 'audit',
      order: 60,
    },
  ],
  messages: enUsMessages,
});
