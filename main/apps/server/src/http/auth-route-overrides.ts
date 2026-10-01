// main/apps/server/src/http/auth-route-overrides.ts
/**
 * App-local route policy overrides.
 *
 * Keeps auth-strategy filtering and OpenAPI annotations close to the app
 * composition root without leaving that logic embedded in `router.ts`.
 */

import { authRoutes, userRoutes } from '@bslt/core';

import type { RouteMap, RouteOpenApiMeta } from '@bslt/server-system/http';

const LOCAL_AUTH_ROUTES = new Set<string>([
  'auth/register',
  'auth/login',
  'auth/forgot-password',
  'auth/reset-password',
  'auth/set-password',
  'auth/verify-email',
  'auth/resend-verification',
  'auth/password/change',
]);

const OAUTH_STRATEGY_KEYS = new Set<string>([
  'google',
  'github',
  'kakao',
  'facebook',
  'microsoft',
  'apple',
]);

const AUTH_ROUTE_ANNOTATIONS: Record<string, RouteOpenApiMeta> = {
  'auth/login': {
    summary: 'Login with email/username and password',
    tags: ['auth'],
    body: {
      type: 'object',
      properties: {
        identifier: { type: 'string' },
        password: { type: 'string' },
        captchaToken: { type: 'string' },
      },
      required: ['identifier', 'password'],
    },
    response: {
      200: {
        type: 'object',
        properties: {
          user: { type: 'object', additionalProperties: true },
          isNewDevice: { type: 'boolean' },
        },
        required: ['user'],
      },
    },
  },
};

const USER_ROUTE_ANNOTATIONS: Record<string, RouteOpenApiMeta> = {
  'users/me': {
    summary: 'Get current user profile',
    tags: ['users'],
    response: {
      200: {
        type: 'object',
        additionalProperties: true,
      },
    },
  },
};

function cloneRouteMap(routes: RouteMap): RouteMap {
  return new Map(
    [...routes].map(([path, route]) => [
      path,
      {
        ...route,
        ...(route.roles !== undefined ? { roles: [...route.roles] } : {}),
        ...(route.openapi !== undefined ? { openapi: { ...route.openapi } } : {}),
      },
    ]),
  );
}

function withOpenApiAnnotations(
  routes: RouteMap,
  annotations: Record<string, RouteOpenApiMeta>,
): RouteMap {
  const annotated = cloneRouteMap(routes);

  for (const [path, meta] of Object.entries(annotations)) {
    const route = annotated.get(path);
    if (route !== undefined) {
      route.openapi = meta;
    }
  }

  return annotated;
}

function filterAuthRoutesByStrategies(
  routes: RouteMap,
  enabledStrategies: readonly string[],
): RouteMap {
  const enabled = new Set(enabledStrategies);
  const filtered = cloneRouteMap(routes);

  if (!enabled.has('local')) {
    for (const key of LOCAL_AUTH_ROUTES) {
      filtered.delete(key);
    }
  }

  if (!enabled.has('magic')) {
    for (const key of [...filtered.keys()]) {
      if (key.startsWith('auth/magic-link/')) {
        filtered.delete(key);
      }
    }
  }

  const hasAnyOAuthStrategy = [...enabled].some((strategy) => OAUTH_STRATEGY_KEYS.has(strategy));
  if (!hasAnyOAuthStrategy) {
    for (const key of [...filtered.keys()]) {
      if (
        key.startsWith('auth/oauth/') &&
        key !== 'auth/oauth/providers' &&
        key !== 'auth/oauth/connections' &&
        !key.endsWith('/unlink')
      ) {
        filtered.delete(key);
      }
    }
  } else {
    for (const key of [...filtered.keys()]) {
      if (!key.startsWith('auth/oauth/')) {
        continue;
      }
      if (key === 'auth/oauth/providers' || key === 'auth/oauth/connections') {
        continue;
      }
      if (key.endsWith('/unlink')) {
        continue;
      }

      const provider = key.split('/')[2];
      if (provider !== undefined && OAUTH_STRATEGY_KEYS.has(provider) && !enabled.has(provider)) {
        filtered.delete(key);
      }
    }
  }

  return filtered;
}

export function createComposedAuthRoutes(enabledStrategies: readonly string[]): RouteMap {
  return withOpenApiAnnotations(
    filterAuthRoutesByStrategies(authRoutes, enabledStrategies),
    AUTH_ROUTE_ANNOTATIONS,
  );
}

export function createComposedUserRoutes(): RouteMap {
  return withOpenApiAnnotations(userRoutes, USER_ROUTE_ANNOTATIONS);
}
