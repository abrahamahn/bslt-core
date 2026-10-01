// main/shared/src/modules/core/tenant/tenant.schemas.ts

/**
 * @file Tenant Contracts
 * @description Types and schemas for tenant management.
 * @module Core/Tenant
 */

import {
  createSchema,
  parseBoolean,
  parseNullableOptional,
  parseOptional,
  parseRecord,
  parseString,
  withDefault,
} from '../../../schema';
import { tenantIdSchema, userIdSchema } from '../../../schema/ids';
import { isoDateTimeSchema } from '../schemas';

import type { Schema } from '../../../schema';
import type { TenantId, UserId } from '../../../schema/ids';

// ============================================================================
// Types
// ============================================================================

/** Slug format regex: lowercase alphanumeric and hyphens */
const SLUG_REGEX = /^[a-z0-9-]+$/;

/** Full tenant entity */
export interface Tenant {
  id: TenantId;
  name: string;
  slug: string;
  logoUrl?: string | null | undefined;
  ownerId: UserId;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
  allowedEmailDomains?: string[] | undefined;
}

/** Input for creating a new tenant */
export interface CreateTenantInput {
  name: string;
  slug?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

/** Input for updating an existing tenant */
export interface UpdateTenantInput {
  name?: string | undefined;
  logoUrl?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
  allowedEmailDomains?: string[] | undefined;
}

/** Input for transferring tenant ownership */
export interface TransferOwnershipInput {
  newOwnerId: string;
}

// ============================================================================
// Schemas
// ============================================================================

export const tenantSchema: Schema<Tenant> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  return {
    id: tenantIdSchema.parse(obj['id']),
    name: parseString(obj['name'], 'name', { min: 1, max: 100 }),
    slug: parseString(obj['slug'], 'slug', {
      min: 1,
      max: 100,
      regex: SLUG_REGEX,
      regexMessage: 'slug must contain only lowercase letters, numbers, and hyphens',
    }),
    logoUrl: parseNullableOptional(obj['logoUrl'], (v) => parseString(v, 'logoUrl', { url: true })),
    ownerId: userIdSchema.parse(obj['ownerId']),
    isActive: parseBoolean(withDefault(obj['isActive'], true), 'isActive'),
    createdAt: isoDateTimeSchema.parse(obj['createdAt']),
    updatedAt: isoDateTimeSchema.parse(obj['updatedAt']),
    metadata:
      withDefault(obj['metadata'], {}) !== undefined
        ? parseRecord(withDefault(obj['metadata'], {}), 'metadata')
        : {},
    allowedEmailDomains: parseOptional(obj['allowedEmailDomains'], (v) => {
      if (!Array.isArray(v)) throw new Error('allowedEmailDomains must be an array');
      return v.map((item) => parseString(item, 'allowedEmailDomains[]', { min: 1, max: 253 }));
    }),
  };
});

// ============================================================================
// Input Schemas
// ============================================================================

export const createTenantSchema: Schema<CreateTenantInput> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  return {
    name: parseString(obj['name'], 'name', { min: 1, max: 100 }),
    slug: parseOptional(obj['slug'], (v) =>
      parseString(v, 'slug', {
        min: 1,
        max: 100,
        regex: SLUG_REGEX,
        regexMessage: 'slug must contain only lowercase letters, numbers, and hyphens',
      }),
    ),
    metadata: parseOptional(obj['metadata'], (v) => parseRecord(v, 'metadata')),
  };
});

export const updateTenantSchema: Schema<UpdateTenantInput> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  return {
    name: parseOptional(obj['name'], (v) => parseString(v, 'name', { min: 1, max: 100 })),
    logoUrl: parseNullableOptional(obj['logoUrl'], (v) => parseString(v, 'logoUrl', { url: true })),
    metadata: parseOptional(obj['metadata'], (v) => parseRecord(v, 'metadata')),
    allowedEmailDomains: parseOptional(obj['allowedEmailDomains'], (v) => {
      if (!Array.isArray(v)) throw new Error('allowedEmailDomains must be an array');
      return v.map((item) => parseString(item, 'allowedEmailDomains[]', { min: 1, max: 253 }));
    }),
  };
});

export const transferOwnershipSchema: Schema<TransferOwnershipInput> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      newOwnerId: parseString(obj['newOwnerId'], 'newOwnerId', { min: 1 }),
    };
  },
);

// ============================================================================
// Response Schemas
// ============================================================================

/** List of tenants */
export interface TenantListResponse {
  data: Tenant[];
}

export const tenantListResponseSchema: Schema<TenantListResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    if (!Array.isArray(obj['data'])) throw new Error('data must be an array');

    return {
      data: obj['data'].map((item) => tenantSchema.parse(item)),
    };
  },
);
