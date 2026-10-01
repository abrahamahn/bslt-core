// main/server/db/src/repositories/tenant/index.ts
/**
 * Tenant Repositories Barrel
 */

// Tenants
export { createTenantRepository, type TenantRepository } from './tenants';

// Memberships
export { createMembershipRepository, type MembershipRepository } from './memberships';

// Invitations
export { createInvitationRepository, type InvitationRepository } from './invitations';

// Tenant Roles (custom roles — Advanced RBAC)
export { createTenantRoleRepository, type TenantRoleRepository } from './tenant-roles';
