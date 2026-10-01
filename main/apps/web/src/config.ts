// main/apps/web/src/config.ts
/**
 * Centralized client configuration.
 *
 * All environment variables and app-level constants in one place.
 */

import { MS_PER_DAY, MS_PER_MINUTE, MS_PER_SECOND } from '@bslt/shared/constants/time';
import { trimTrailingSlashes } from '@bslt/shared/helpers/string';

export const DEFAULT_APP_NAME = 'Your App';

// ============================================================================
// Environment Variables
// ============================================================================

type EnvVars = {
  MODE: string;
  DEV: boolean;
  PROD: boolean;
  [key: string]: string | boolean | undefined;
};

const env: EnvVars = import.meta.env as EnvVars;

// ============================================================================
// Types
// ============================================================================

export type ClientConfig = {
  /** Environment mode (development, production, test) */
  mode: string;

  /** Is development environment */
  isDev: boolean;

  /** Is production environment */
  isProd: boolean;

  /** API base URL */
  apiUrl: string;

  /** Display name used in browser and app chrome */
  appName: string;

  /** Token refresh interval in ms */
  tokenRefreshInterval: number;

  /** UI version string */
  uiVersion: string;

  /** Query cache persistence configuration */
  queryPersistence: {
    maxAge: number; // in milliseconds
    throttleTime: number; // in milliseconds
  };

  /** Stripe publishable key for frontend Elements */
  stripePublishableKey: string;

  // Future additions:
  // wsUrl: string;
};

// ============================================================================
// Factory (for testing)
// ============================================================================

export function createClientConfig(): ClientConfig {
  // Cached VITE variables are re-evaluated when this file changes
  const viteApiUrl = env['VITE_API_URL'] as string | undefined;
  const normalizedApiUrl = trimTrailingSlashes(viteApiUrl ?? '');
  const isLocalApiTarget = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalizedApiUrl);
  const useAbsoluteLocalApiUrl = env['VITE_USE_ABSOLUTE_API_URL'] === '1';
  const apiUrl =
    normalizedApiUrl === '' || (isLocalApiTarget && !useAbsoluteLocalApiUrl)
      ? ''
      : normalizedApiUrl;
  const viteAppName = env['VITE_APP_NAME'];
  return {
    mode: env.MODE,
    isDev: env.DEV,
    isProd: env.PROD,
    // In dev, local API targets use relative /api and Vite proxy to avoid
    // localhost bridging issues across host/WSL boundaries.
    apiUrl,
    appName:
      typeof viteAppName === 'string' && viteAppName.trim() !== ''
        ? viteAppName.trim()
        : DEFAULT_APP_NAME,
    tokenRefreshInterval: 13 * MS_PER_MINUTE,
    uiVersion: '1.1.0',
    queryPersistence: {
      maxAge: MS_PER_DAY,
      throttleTime: MS_PER_SECOND,
    },
    stripePublishableKey: env['VITE_STRIPE_PUBLISHABLE_KEY'] as string,
  };
}

// ============================================================================
// Singleton Instance
// ============================================================================

/** Default client config - use this in app code */
export const clientConfig = createClientConfig();
