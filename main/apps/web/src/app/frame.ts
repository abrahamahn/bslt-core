// main/apps/web/src/app/frame.ts
/**
 * App-frame metadata (`AppFrameConfig`) for application-level surfaces not
 * owned by a domain `WebModule` (landing home, dashboard hub, theme preferences
 * settings section, theme toggle action, and the composite admin dashboard).
 *
 * Kept free of React/UI imports so `webApp.ts` remains cycle-free.
 */

import { DEFAULT_SITE_SECTIONS, type AppFrameConfig } from '@bslt/web-platform';

import { hasAdminModule } from '../generated/modules';

import type { AppRouteFlags } from './routeFlags';
import type { DocumentType } from '@bslt/compliance/contract';

export const appFrame: AppFrameConfig<AppRouteFlags, DocumentType> = Object.freeze<
  AppFrameConfig<AppRouteFlags, DocumentType>
>({
  primaryNav: [
    {
      to: '/',
      label: 'Home',
      audience: 'public',
      order: 10,
    },
    {
      to: '/dashboard',
      label: 'Dashboard',
      audience: 'authenticated',
      order: 10,
    },
    {
      to: '/settings',
      label: 'Settings',
      audience: 'authenticated',
      order: 90,
      hint: {
        featureKey: 'settings',
        title: 'Settings',
        description: 'Customize your profile, security, and preferences',
      },
    },
    ...(hasAdminModule
      ? []
      : [
          {
            to: '/admin',
            label: 'Admin',
            audience: 'admin' as const,
            order: 100,
          },
        ]),
  ],
  palette: [
    {
      id: 'nav-dashboard',
      label: 'Go to Dashboard',
      description: 'Navigate to the main dashboard',
      category: 'navigation',
      to: '/dashboard',
      keywords: ['home', 'main', 'overview'],
      order: 10,
    },
    {
      id: 'nav-profile',
      label: 'Go to Profile',
      description: 'Edit your profile, avatar, and handle',
      category: 'navigation',
      to: '/profile',
      keywords: ['avatar', 'username', 'bio', 'me'],
      order: 15,
    },
    {
      id: 'nav-settings',
      label: 'Go to Settings',
      description: 'Navigate to account settings',
      category: 'navigation',
      to: '/settings',
      keywords: ['profile', 'account', 'preferences', 'security'],
      order: 20,
    },
    {
      id: 'nav-onboarding',
      label: 'Run Workspace Setup',
      description: 'Open the guided profile, workspace, and team setup wizard',
      category: 'navigation',
      to: '/onboarding',
      keywords: ['onboarding', 'setup', 'getting started', 'wizard', 'workspace'],
      order: 25,
    },
    ...(hasAdminModule
      ? []
      : [
          {
            id: 'nav-admin',
            label: 'Go to Admin',
            description: 'Open the admin control center',
            category: 'navigation' as const,
            adminOnly: true,
            to: '/admin' as const,
            keywords: ['manage', 'users', 'system'],
            order: 40,
          },
        ]),
    {
      id: 'action-change-theme',
      label: 'Change Theme',
      description: 'Cycle through light, dark, and system themes',
      category: 'action',
      actionId: 'change-theme',
      keywords: ['dark', 'light', 'mode', 'appearance', 'toggle'],
      order: 100,
    },
  ],
  adminSurfaces: [
    {
      id: 'dashboard',
      label: 'Dashboard',
      href: '/admin/dashboard',
      routePath: 'dashboard',
      order: 10,
      ...(hasAdminModule ? { when: (f: AppRouteFlags): boolean => f.advancedAdminEnabled } : {}),
    },
  ],
  settingsSections: [
    {
      id: 'preferences',
      label: 'Preferences',
      kind: 'section',
      order: 50,
    },
  ],
  siteSections: DEFAULT_SITE_SECTIONS,
  sitePages: [
    {
      path: '/',
      title: 'Home',
      section: 'product',
      live: true,
      order: 10,
    },
  ],
  dashboardQuickActions: [
    { label: 'Profile', to: '/profile', order: 30 },
    { label: 'Settings', to: '/settings', order: 40 },
  ],
  dashboardTiles: [],
});
