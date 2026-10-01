// Core edition: authentication, account settings, and public legal pages.
import {
  AuthQueryModalRoute,
  ConfirmEmailChangePage,
  ConfirmEmailPage,
  ConnectedAccountsPage,
  LoginModalRoute,
  MagicLinkVerifyPage,
  ReactivatePromptPage,
  RegisterModalRoute,
  ResetPasswordPage,
  RevertEmailChangePage,
} from '@features/auth';
import { AcceptableUsePage, CookiePolicyPage, DisclaimerPage } from '@features/content';
import { ProfileModalRoute, SettingsModalRoute } from '@features/settings';
import { EmailUnsubscribePage } from '@pages/EmailUnsubscribePage';
import { ForbiddenPage } from '@pages/ForbiddenPage';
import { LandingPage } from '@pages/LandingPage';
import { PrivacyPolicyPage, TermsPage } from '@pages/LegalDocumentPage';
import { NotFoundPage } from '@pages/NotFoundPage';
import { UnavailablePage } from '@pages/UnavailablePage';
import { AppLayout } from './layouts';
import type { ElementType } from 'react';
export interface AppRoute {
  path?: string;
  index?: boolean;
  element: ElementType;
  children?: AppRoute[];
  protected?: boolean;
  publicOnly?: boolean;
  publicOnlyRedirectTo?: string;
}
export function createAppRoutes(): AppRoute[] {
  return [
    {
      path: '/',
      element: AppLayout,
      children: [
        {
          index: true,
          element: LandingPage,
          publicOnly: true,
          publicOnlyRedirectTo: '/profile',
        },
        { path: 'login', element: LoginModalRoute },
        { path: 'register', element: RegisterModalRoute },
        { path: 'auth', element: AuthQueryModalRoute },
        { path: 'auth/login', element: LoginModalRoute },
        { path: 'auth/register', element: RegisterModalRoute },
        { path: 'auth/reset-password', element: ResetPasswordPage },
        { path: 'auth/confirm-email', element: ConfirmEmailPage },
        { path: 'auth/change-email/confirm', element: ConfirmEmailChangePage },
        { path: 'auth/change-email/revert', element: RevertEmailChangePage },
        { path: 'auth/magic-link/verify', element: MagicLinkVerifyPage },
        {
          path: 'settings/accounts',
          element: ConnectedAccountsPage,
          protected: true,
        },
        { path: 'email/unsubscribe/:token', element: EmailUnsubscribePage },
        { path: 'reactivate', element: ReactivatePromptPage, protected: true },
        { path: 'profile', element: ProfileModalRoute, protected: true },
        // Compatibility for existing auth callbacks/bookmarks.
        { path: 'dashboard', element: ProfileModalRoute, protected: true },
        { path: 'settings', element: SettingsModalRoute, protected: true },
        { path: 'settings/:tab', element: SettingsModalRoute, protected: true },
        { path: 'terms', element: TermsPage },
        { path: 'terms-of-service', element: TermsPage },
        { path: 'privacy', element: PrivacyPolicyPage },
        { path: 'privacy-policy', element: PrivacyPolicyPage },
        { path: 'cookies', element: CookiePolicyPage },
        { path: 'cookie-policy', element: CookiePolicyPage },
        { path: 'acceptable-use', element: AcceptableUsePage },
        { path: 'disclaimer', element: DisclaimerPage },
        { path: 'forbidden', element: ForbiddenPage },
        { path: 'unavailable', element: UnavailablePage },
        { path: '*', element: NotFoundPage },
      ],
    },
  ];
}
export const appRoutes = createAppRoutes();
export function flattenAppRoutes(
  routes: readonly AppRoute[] = appRoutes,
  basePath = '/',
  pages: Map<string, AppRoute> = new Map(),
): ReadonlyMap<string, AppRoute> {
  for (const route of routes) {
    const path = resolveRoutePath(route, basePath);

    if (route.children !== undefined && route.children.length > 0) {
      flattenAppRoutes(route.children, path, pages);
      continue;
    }

    if (!pages.has(path)) pages.set(path, route);
  }

  return pages;
}

function resolveRoutePath(route: AppRoute, basePath: string): string {
  // An index route has no path of its own: it renders at its parent's.
  if (route.path === undefined) return basePath;
  if (route.path.startsWith('/')) return route.path;

  return basePath === '/' ? `/${route.path}` : `${basePath}/${route.path}`;
}
