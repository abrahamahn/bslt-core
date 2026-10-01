// main/server/core/src/auth/personal-tenant.ts
/**
 * Personal tenant provisioning.
 *
 * The product runs a B2C-first multi-tenant model: every user belongs to at
 * least one tenant (their personal workspace), which is the billing/scoping
 * boundary. New accounts don't have a tenant at creation time, so we provision
 * one lazily at login.
 *
 * `ensurePersonalTenant` is idempotent — it is a no-op when the user already
 * belongs to any tenant — so it can safely run on every login. This also
 * back-fills existing accounts the next time they sign in, without a bulk
 * migration.
 */

import { slugify } from '@bslt/shared/helpers';

import type { MembershipRepository, TenantRepository } from '@bslt/db';

/** Minimal repository surface needed to provision a personal tenant. */
export interface PersonalTenantRepos {
  tenants: TenantRepository;
  memberships: MembershipRepository;
}

/** Minimal user shape needed to name and own a personal tenant. */
export interface PersonalTenantUser {
  id: string;
  email: string;
  username?: string | null;
  firstName?: string | null;
}

const MAX_SLUG_ATTEMPTS = 50;

function baseSlugFor(user: PersonalTenantUser): string {
  const fromUsername = user.username !== null && user.username !== undefined ? user.username : '';
  const fromEmail = user.email.split('@')[0] ?? '';
  const candidate = slugify(fromUsername !== '' ? fromUsername : fromEmail);
  return candidate !== '' ? candidate : 'workspace';
}

function displayNameFor(user: PersonalTenantUser): string {
  const candidates = [user.firstName, user.username, user.email.split('@')[0]];
  const name = candidates.find(
    (value): value is string => typeof value === 'string' && value.trim() !== '',
  );
  return (name ?? 'My').trim();
}

/**
 * Ensure the user owns a personal tenant. No-op if they already belong to one.
 *
 * @param repos - Minimal tenant/membership repositories.
 * @param user - The user to provision a personal tenant for.
 * @param provisionSchema - Optional per-tenant schema provisioner. Supplied only
 *   in `schema-per-tenant` tenancy mode; omitted (no-op) in the default
 *   `shared-rls` mode, keeping login/provisioning byte-unchanged.
 * @returns The id of the user's tenant (existing or newly created), or null if
 *          provisioning was skipped/failed in a way the caller should ignore.
 */
export async function ensurePersonalTenant(
  repos: PersonalTenantRepos,
  user: PersonalTenantUser,
  provisionSchema?: (tenantId: string) => Promise<void>,
): Promise<string | null> {
  const memberships = await repos.memberships.findByUserId(user.id);
  if (memberships.length > 0) {
    return memberships[0]?.tenantId ?? null;
  }

  // Find an unused slug derived from the user's handle.
  const base = baseSlugFor(user);
  let slug = base;
  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
    const taken = await repos.tenants.findBySlug(slug);
    if (taken === null) break;
    slug = `${base}-${String(attempt + 1)}`;
  }

  const tenant = await repos.tenants.create({
    name: `${displayNameFor(user)}'s Workspace`,
    slug,
    ownerId: user.id,
    isActive: true,
  });

  await repos.memberships.create({
    tenantId: tenant.id,
    userId: user.id,
    role: 'owner',
    isBillingAdmin: true,
  });

  // Provision the tenant's dedicated schema (schema-per-tenant mode only).
  // Idempotent; no-op when the hook is absent (default shared-rls mode).
  if (provisionSchema !== undefined) {
    await provisionSchema(tenant.id);
  }

  return tenant.id;
}
