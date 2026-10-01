// main/server/core/src/auth/magic-link/routes.ts
/**
 * Magic Link Routes
 *
 * Route definitions for magic link authentication.
 *
 * @module magic-link/routes
 */

import { createRouteMap } from '@bslt/server-system/http';
import {
  magicLinkRequestSchema,
  magicLinkVerifyRequestSchema,
  type MagicLinkRequest,
  type MagicLinkVerifyRequest,
} from '@bslt/shared/core/auth';

import { authPublicRoute, defineAuthRouteEntries } from '../routes/helpers';

import { handleMagicLinkRequest, handleMagicLinkVerify } from './handlers';

// ============================================================================
// Route Entries (for merging with parent routes)
// ============================================================================

/**
 * Magic link route entries for merging with parent auth routes.
 */
export const magicLinkRouteEntries = defineAuthRouteEntries([
  [
    'auth/magic-link/request',
    authPublicRoute<MagicLinkRequest>('POST', handleMagicLinkRequest, magicLinkRequestSchema, {
      summary: 'Request magic link',
      tags: ['Auth', 'Magic Link'],
    }),
  ],

  [
    'auth/magic-link/verify',
    authPublicRoute<MagicLinkVerifyRequest>(
      'POST',
      handleMagicLinkVerify,
      magicLinkVerifyRequestSchema,
      { summary: 'Verify magic link', tags: ['Auth', 'Magic Link'] },
    ),
  ],
]);

// ============================================================================
// Route Map (for standalone use)
// ============================================================================

/**
 * Magic link route map for standalone registration.
 */
export const magicLinkRoutes = createRouteMap(magicLinkRouteEntries);
