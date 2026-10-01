// main/shared/src/modules/core/feature-flags/feature.flags.ts

/**
 * @file Feature Flags
 * @description Types, schemas, and logic for feature flag configuration, overrides, and evaluation.
 * @module Domain/FeatureFlags
 */

import {
  createSchema,
  parseBoolean,
  parseNumber,
  parseOptional,
  parseString,
  withDefault,
} from '../../../schema';
import { tenantIdSchema } from '../../../schema/ids';

import type { Schema } from '../../../schema';
import type { TenantId } from '../../../schema/ids';

// ============================================================================
// Types
// ============================================================================

/** Metadata for feature flag targeting */
export interface FeatureFlagMetadata {
  allowedUserIds?: string[] | undefined;
  allowedTenantIds?: string[] | undefined;
  rolloutPercentage?: number | undefined;
}

/** Feature flag configuration */
export interface FeatureFlag {
  key: string;
  description?: string | undefined;
  isEnabled: boolean;
  defaultValue?: unknown;
  metadata?: FeatureFlagMetadata | undefined;
}

/** Tenant-specific feature flag override */
export interface TenantFeatureOverride {
  tenantId: TenantId;
  key: string;
  value: unknown;
  isEnabled: boolean;
}

/** Request body for creating a feature flag */
export interface CreateFeatureFlagRequest {
  key: string;
  description?: string | undefined;
  isEnabled?: boolean | undefined;
  defaultValue?: unknown;
  metadata?: FeatureFlagMetadata | undefined;
}

/** Request body for updating a feature flag */
export interface UpdateFeatureFlagRequest {
  description?: string | undefined;
  isEnabled?: boolean | undefined;
  defaultValue?: unknown;
  metadata?: FeatureFlagMetadata | undefined;
}

/** Request body for setting tenant feature override */
export interface SetTenantFeatureOverrideRequest {
  value?: unknown;
  isEnabled?: boolean | undefined;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Canonical flag key format, mirrored by the `feature_flags_key_format`
 * CHECK constraint (0403_feature_flags.sql): lowercase, starts with a
 * letter, then letters/digits/underscores/dots.
 */
export const FEATURE_FLAG_KEY_PATTERN = /^[a-z][a-z0-9_.]+$/;

// ============================================================================
// Schemas
// ============================================================================

/**
 * Parse an optional string array from unknown data.
 *
 * @param data - The unknown value
 * @param label - Field name for errors
 * @returns Parsed string array or undefined
 * @complexity O(n) where n is array length
 */
function parseOptionalStringArray(data: unknown, label: string): string[] | undefined {
  if (data === undefined || data === null) {
    return undefined;
  }
  if (!Array.isArray(data)) {
    throw new Error(`${label} must be an array`);
  }
  return data.map((item: unknown, i: number) => parseString(item, `${label}[${String(i)}]`));
}

/**
 * Parse and validate a feature flag key against the canonical format.
 *
 * @param data - The unknown value
 * @param label - Field name for errors
 * @returns The validated key
 * @complexity O(n) where n is key length
 */
function parseFlagKey(data: unknown, label: string): string {
  const key = parseString(data, label);
  if (!FEATURE_FLAG_KEY_PATTERN.test(key)) {
    throw new Error(
      `${label} must be lowercase, start with a letter, and contain only letters, digits, underscores, or dots`,
    );
  }
  return key;
}

export const featureFlagSchema: Schema<FeatureFlag> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  const key = parseFlagKey(obj['key'], 'key');
  const description = parseOptional(obj['description'], (v) => parseString(v, 'description'));
  const isEnabled = parseBoolean(withDefault(obj['isEnabled'], false), 'isEnabled');
  const defaultValue = obj['defaultValue'];

  let metadata: FeatureFlagMetadata | undefined;
  if (obj['metadata'] !== undefined) {
    const meta = obj['metadata'];
    if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
      throw new Error('metadata must be an object');
    }
    const m = meta as Record<string, unknown>;
    metadata = {
      allowedUserIds: parseOptionalStringArray(m['allowedUserIds'], 'metadata.allowedUserIds'),
      allowedTenantIds: parseOptionalStringArray(
        m['allowedTenantIds'],
        'metadata.allowedTenantIds',
      ),
      rolloutPercentage: parseOptional(m['rolloutPercentage'], (v) =>
        parseNumber(v, 'metadata.rolloutPercentage', { min: 0, max: 100 }),
      ),
    };
  }

  return { key, description, isEnabled, defaultValue, metadata };
});

export const tenantFeatureOverrideSchema: Schema<TenantFeatureOverride> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    const tenantId = tenantIdSchema.parse(obj['tenantId']);
    const key = parseFlagKey(obj['key'], 'key');
    const value = obj['value'];
    const isEnabled = parseBoolean(obj['isEnabled'], 'isEnabled');

    return { tenantId, key, value, isEnabled };
  },
);

export const createFeatureFlagRequestSchema: Schema<CreateFeatureFlagRequest> = createSchema(
  (data: unknown) => {
    const parsed = featureFlagSchema.parse(data);
    return {
      key: parsed.key,
      description: parsed.description,
      isEnabled: parsed.isEnabled,
      defaultValue: parsed.defaultValue,
      metadata: parsed.metadata,
    };
  },
);

export const updateFeatureFlagRequestSchema: Schema<UpdateFeatureFlagRequest> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    const description = parseOptional(obj['description'], (v) => parseString(v, 'description'));
    const isEnabled = parseOptional(obj['isEnabled'], (v) => parseBoolean(v, 'isEnabled'));
    const defaultValue = obj['defaultValue'];

    let metadata: FeatureFlagMetadata | undefined;
    if (obj['metadata'] !== undefined) {
      const meta = obj['metadata'];
      if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
        throw new Error('metadata must be an object');
      }
      const m = meta as Record<string, unknown>;
      metadata = {
        allowedUserIds: parseOptionalStringArray(m['allowedUserIds'], 'metadata.allowedUserIds'),
        allowedTenantIds: parseOptionalStringArray(
          m['allowedTenantIds'],
          'metadata.allowedTenantIds',
        ),
        rolloutPercentage: parseOptional(m['rolloutPercentage'], (v) =>
          parseNumber(v, 'metadata.rolloutPercentage', { min: 0, max: 100 }),
        ),
      };
    }

    if (
      description === undefined &&
      isEnabled === undefined &&
      defaultValue === undefined &&
      metadata === undefined
    ) {
      throw new Error('At least one field must be provided');
    }

    return { description, isEnabled, defaultValue, metadata };
  },
);

export const setTenantFeatureOverrideRequestSchema: Schema<SetTenantFeatureOverrideRequest> =
  createSchema((data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    const value = obj['value'];
    const isEnabled = parseOptional(obj['isEnabled'], (v) => parseBoolean(v, 'isEnabled'));

    if (value === undefined && isEnabled === undefined) {
      throw new Error('At least one of value or isEnabled must be provided');
    }

    return { value, isEnabled };
  });

// ============================================================================
// Response Schemas (for API contracts)
// ============================================================================

/** Admin-facing feature flag record */
export interface FeatureFlagRecord {
  key: string;
  description: string | null;
  isEnabled: boolean;
  defaultValue: unknown;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** List feature flags response */
export interface FeatureFlagListResponse {
  flags: FeatureFlagRecord[];
}

/** Create/update feature flag response */
export interface FeatureFlagResponse {
  flag: FeatureFlagRecord;
}

/** Delete feature flag response */
export interface FeatureFlagDeleteResponse {
  success: boolean;
  message: string;
}

/** List tenant overrides response */
export interface TenantFeatureOverridesResponse {
  overrides: TenantFeatureOverride[];
}

/** Set tenant override response */
export interface TenantFeatureOverrideResponse {
  override: TenantFeatureOverride;
}

/** Delete tenant override response */
export interface TenantFeatureOverrideDeleteResponse {
  success: boolean;
  message: string;
}

function parseMetadataRecord(data: unknown): Record<string, unknown> {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('metadata must be an object');
  }
  return data as Record<string, unknown>;
}

export const featureFlagRecordSchema: Schema<FeatureFlagRecord> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  const key = parseString(obj['key'], 'key');
  const descriptionValue = obj['description'];
  const description =
    descriptionValue === null ? null : parseString(descriptionValue, 'description');

  return {
    key,
    description,
    isEnabled: parseBoolean(obj['isEnabled'], 'isEnabled'),
    defaultValue: obj['defaultValue'],
    metadata: parseMetadataRecord(obj['metadata']),
    createdAt: parseString(obj['createdAt'], 'createdAt'),
    updatedAt: parseString(obj['updatedAt'], 'updatedAt'),
  };
});

export const featureFlagListResponseSchema: Schema<FeatureFlagListResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    if (!Array.isArray(obj['flags'])) throw new Error('flags must be an array');

    return {
      flags: obj['flags'].map((item) => featureFlagRecordSchema.parse(item)),
    };
  },
);

export const featureFlagResponseSchema: Schema<FeatureFlagResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      flag: featureFlagRecordSchema.parse(obj['flag']),
    };
  },
);

export const featureFlagDeleteResponseSchema: Schema<FeatureFlagDeleteResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      success: parseBoolean(obj['success'], 'success'),
      message: parseString(obj['message'], 'message'),
    };
  },
);

export const tenantFeatureOverridesResponseSchema: Schema<TenantFeatureOverridesResponse> =
  createSchema((data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    if (!Array.isArray(obj['overrides'])) throw new Error('overrides must be an array');

    return {
      overrides: obj['overrides'].map((item) => tenantFeatureOverrideSchema.parse(item)),
    };
  });

export const tenantFeatureOverrideResponseSchema: Schema<TenantFeatureOverrideResponse> =
  createSchema((data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      override: tenantFeatureOverrideSchema.parse(obj['override']),
    };
  });

export const tenantFeatureOverrideDeleteResponseSchema: Schema<TenantFeatureOverrideDeleteResponse> =
  createSchema((data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      success: parseBoolean(obj['success'], 'success'),
      message: parseString(obj['message'], 'message'),
    };
  });

// ============================================================================
// Functions
// ============================================================================

/**
 * Simple hash function for percentage rollouts based on an ID.
 */
function getHashValue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash % 100);
}

/**
 * Evaluates a feature flag in a given context.
 * Supports:
 * 1. Global enable/disable
 * 2. Targeted Users/Tenants
 * 3. Percentage Rollouts
 *
 * @param flag - The feature flag definition
 * @param context - Execution context (tenantId, userId)
 */
export function evaluateFlag(
  flag: FeatureFlag,
  context: { tenantId?: string; userId?: string } = {},
): boolean {
  // 1. If globally disabled, it's off.
  if (!flag.isEnabled) return false;

  // 2. Metadata target checks
  const metadata = flag.metadata;
  if (metadata === undefined) return flag.isEnabled;

  // Targeted Lists
  if (context.userId !== undefined && metadata.allowedUserIds?.includes(context.userId) === true) {
    return true;
  }
  if (
    context.tenantId !== undefined &&
    metadata.allowedTenantIds?.includes(context.tenantId) === true
  ) {
    return true;
  }

  // Percentage Rollout
  if (metadata.rolloutPercentage !== undefined) {
    const targetId = context.userId ?? context.tenantId ?? 'anonymous';
    const hash = getHashValue(targetId);
    return hash < metadata.rolloutPercentage;
  }

  // Default to global state
  return flag.isEnabled;
}
