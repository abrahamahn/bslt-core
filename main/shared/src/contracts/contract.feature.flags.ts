// main/shared/src/contracts/contract.feature.flags.ts
/**
 * Feature Flags Contracts
 *
 * API contract definitions for admin feature flag management.
 * @module Contracts/FeatureFlags
 */

import {
  createFeatureFlagRequestSchema,
  featureFlagDeleteResponseSchema,
  featureFlagListResponseSchema,
  featureFlagResponseSchema,
  setTenantFeatureOverrideRequestSchema,
  tenantFeatureOverrideDeleteResponseSchema,
  tenantFeatureOverrideResponseSchema,
  tenantFeatureOverridesResponseSchema,
  updateFeatureFlagRequestSchema,
} from '../modules/core';
import { errorResponseSchema, successResponseSchema } from '../modules/system';
import { createSchema, parseBoolean } from '../schema';

import type { Contract } from '../api/api';

// ============================================================================
// Response Schemas
// ============================================================================

const featureFlagEvaluationResponseSchema = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const rawFlags = obj['flags'];
  if (rawFlags === null || typeof rawFlags !== 'object' || Array.isArray(rawFlags)) {
    throw new Error('flags must be an object');
  }

  const flags: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(rawFlags)) {
    flags[key] = parseBoolean(value, `flags.${key}`);
  }

  return { flags };
});

// ============================================================================
// Contract Definition
// ============================================================================

export const featureFlagsContract = {
  list: {
    method: 'GET' as const,
    path: '/api/admin/feature-flags',
    responses: {
      200: successResponseSchema(featureFlagListResponseSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
    },
    summary: 'List all feature flags (admin only)',
  },

  create: {
    method: 'POST' as const,
    path: '/api/admin/feature-flags/create',
    body: createFeatureFlagRequestSchema,
    responses: {
      201: successResponseSchema(featureFlagResponseSchema),
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      409: errorResponseSchema,
    },
    summary: 'Create a feature flag (admin only)',
  },

  update: {
    method: 'POST' as const,
    path: '/api/admin/feature-flags/:key/update',
    body: updateFeatureFlagRequestSchema,
    responses: {
      200: successResponseSchema(featureFlagResponseSchema),
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Update a feature flag (admin only)',
  },

  delete: {
    method: 'POST' as const,
    path: '/api/admin/feature-flags/:key/delete',
    responses: {
      200: successResponseSchema(featureFlagDeleteResponseSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Delete a feature flag (admin only)',
  },

  listTenantOverrides: {
    method: 'GET' as const,
    path: '/api/admin/tenants/:tenantId/feature-overrides',
    responses: {
      200: successResponseSchema(tenantFeatureOverridesResponseSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'List tenant-specific feature flag overrides (admin only)',
  },

  setTenantOverride: {
    method: 'PUT' as const,
    path: '/api/admin/tenants/:tenantId/feature-overrides/:key',
    body: setTenantFeatureOverrideRequestSchema,
    responses: {
      200: successResponseSchema(tenantFeatureOverrideResponseSchema),
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Set a tenant-specific feature flag override (admin only)',
  },

  deleteTenantOverride: {
    method: 'POST' as const,
    path: '/api/admin/tenants/:tenantId/feature-overrides/:key/delete',
    responses: {
      200: successResponseSchema(tenantFeatureOverrideDeleteResponseSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Remove a tenant-specific feature flag override (admin only)',
  },

  evaluate: {
    method: 'GET' as const,
    path: '/api/feature-flags/evaluate',
    responses: {
      200: successResponseSchema(featureFlagEvaluationResponseSchema),
      401: errorResponseSchema,
    },
    summary: 'Evaluate feature flags for the authenticated user',
  },
} satisfies Contract;
