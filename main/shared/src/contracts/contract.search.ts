// main/shared/src/contracts/contract.search.ts
/**
 * Search Contracts
 *
 * Admin search over the server-side SQL search provider. A single admin-only
 * `GET /api/search` endpoint accepts a free-text query (`q`) and an optional
 * result `limit`, and returns the provider's paginated result shape narrowed
 * to a typed hit projection. Hits carry user ids and emails, so non-admin
 * callers are rejected with 403.
 *
 * @module Contracts/Search
 */

import { SEARCH_DEFAULTS } from '../constants/system/limits';
import { searchResultSchema } from '../modules/db';
import { errorResponseSchema } from '../modules/system';
import { createSchema } from '../schema';

import type { Contract } from '../api/api';
import type { Schema } from '../schema';

// ============================================================================
// Request
// ============================================================================

/** Query parameters accepted by the search endpoint. */
export interface SearchRequestQuery {
  /** Free-text query. Must be non-empty. */
  q: string;
  /** Maximum number of hits to return. */
  limit?: number | undefined;
}

/**
 * Schema for the search request query string.
 *
 * `q` is required and trimmed; `limit` is an optional positive integer capped
 * at {@link SEARCH_DEFAULTS.MAX_LIMIT}. URL query values arrive as strings, so
 * `limit` is coerced from its string form.
 */
export const searchRequestQuerySchema: Schema<SearchRequestQuery> = createSchema(
  (data: unknown): SearchRequestQuery => {
    const obj = (
      data !== null && data !== undefined && typeof data === 'object' ? data : {}
    ) as Record<string, unknown>;

    const rawQ = obj['q'];
    if (typeof rawQ !== 'string' || rawQ.trim().length < 1) {
      throw new Error('Search query "q" must be a non-empty string');
    }

    const result: SearchRequestQuery = { q: rawQ };

    if (obj['limit'] !== undefined) {
      const parsed = typeof obj['limit'] === 'number' ? obj['limit'] : Number(obj['limit']);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > SEARCH_DEFAULTS.MAX_LIMIT) {
        throw new Error(
          `limit must be an integer between 1 and ${String(SEARCH_DEFAULTS.MAX_LIMIT)}`,
        );
      }
      result.limit = parsed;
    }

    return result;
  },
);

// ============================================================================
// Response
// ============================================================================

/**
 * A single search hit, served to admins only.
 *
 * The provider searches the `users` table; this projection omits credentials
 * (password hashes, tokens) but still exposes the user id, email, name, and
 * role, and normalizes column names to camelCase.
 */
export interface SearchHit {
  /** Entity identifier. */
  id: string;
  /** Discriminator for grouping/rendering typed results. */
  type: 'user';
  /** Primary display label (name or username or email). */
  label: string;
  email: string | null;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Schema for a single search hit. */
export const searchHitSchema: Schema<SearchHit> = createSchema((data: unknown): SearchHit => {
  if (data === null || data === undefined || typeof data !== 'object') {
    throw new Error('Invalid search hit');
  }
  const obj = data as Record<string, unknown>;

  if (typeof obj['id'] !== 'string' || obj['id'].length < 1) {
    throw new Error('Search hit must have a string id');
  }
  if (obj['type'] !== 'user') {
    throw new Error('Search hit has an unsupported type');
  }
  if (typeof obj['label'] !== 'string') {
    throw new Error('Search hit must have a label');
  }

  return {
    id: obj['id'],
    type: 'user',
    label: obj['label'],
    email: toNullableString(obj['email']),
    username: toNullableString(obj['username']),
    firstName: toNullableString(obj['firstName']),
    lastName: toNullableString(obj['lastName']),
    role: toNullableString(obj['role']),
  };
});

/** Paginated search response — the provider's result shape over {@link SearchHit}. */
export const searchResponseSchema = searchResultSchema(searchHitSchema);

/** Inferred response type: a paginated set of search hits. */
export type SearchResponse = ReturnType<typeof searchResponseSchema.parse>;

// ============================================================================
// Contract
// ============================================================================

export const searchContract = {
  query: {
    method: 'GET' as const,
    path: '/api/search',
    query: searchRequestQuerySchema,
    responses: {
      200: searchResponseSchema,
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
    },
    summary: 'Search across entities (admin only)',
  },
} satisfies Contract;
