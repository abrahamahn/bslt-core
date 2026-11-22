// main/modules/identity/server/repository.real-db.test.ts
import { describeOwnerIsolation, describeRealDb } from '@bslt/server-system/testing/real-db';

import type { DbClient } from '@bslt/db';

async function insertReturningId(
  admin: DbClient,
  text: string,
  values: unknown[],
): Promise<string> {
  const [row] = await admin.raw<{ id: string }>(text, values);
  if (row === undefined) throw new Error(`seed returned no row: ${text}`);
  return row.id;
}

const IN_AN_HOUR = `now() + interval '1 hour'`;

describeRealDb('identityRepository owner isolation (Real DB)', (realDb) => {
  describeOwnerIsolation(realDb, [
    {
      table: 'identity_api_keys',
      seedRow: (admin, ownerId) =>
        insertReturningId(
          admin,
          `INSERT INTO identity_api_keys (user_id, name, token_hash, key_prefix, last4)
           VALUES ($1, 'isolation', $2, 'bslt_', 'abcd') RETURNING id`,
          [ownerId, `hash-${ownerId}`],
        ),
      ownerMayDelete: true,
    },
    {
      table: 'identity_credentials',
      idColumn: 'user_id',
      seedRow: async (admin, ownerId) => {
        await admin.raw(
          `INSERT INTO identity_credentials (user_id, password_hash)
           VALUES ($1, 'initial-hash')
           ON CONFLICT (user_id) DO UPDATE SET password_hash = 'initial-hash'`,
          [ownerId],
        );
        return ownerId;
      },
      update: `password_hash = 'rotated-hash'`,
    },
    {
      table: 'identity_lockouts',
      idColumn: 'user_id',
      seedRow: async (admin, ownerId) => {
        await admin.raw(
          `INSERT INTO identity_lockouts (user_id, failed_login_attempts)
           VALUES ($1, 1)
           ON CONFLICT (user_id) DO UPDATE SET failed_login_attempts = 1`,
          [ownerId],
        );
        return ownerId;
      },
    },
    {
      table: 'identity_mfa_backup_codes',
      seedRow: (admin, ownerId) =>
        insertReturningId(
          admin,
          `INSERT INTO identity_mfa_backup_codes (user_id, code_hash)
           VALUES ($1, 'hash') RETURNING id`,
          [ownerId],
        ),
      update: 'used_at = now()',
      ownerMayDelete: true,
    },
    {
      table: 'identity_mfa_sms_codes',
      seedRow: (admin, ownerId) =>
        insertReturningId(
          admin,
          `INSERT INTO identity_mfa_sms_codes (user_id, phone, code_hash, expires_at)
           VALUES ($1, '+15550100', 'hash', ${IN_AN_HOUR}) RETURNING id`,
          [ownerId],
        ),
      update: 'attempts = attempts + 1',
    },
    {
      table: 'identity_oauth_accounts',
      seedRow: (admin, ownerId) =>
        insertReturningId(
          admin,
          `INSERT INTO identity_oauth_accounts (user_id, provider, provider_user_id, access_token)
           VALUES ($1, 'github', $2, 'sealed') RETURNING id`,
          [ownerId, `gh-${ownerId}`],
        ),
      ownerMayDelete: true,
    },
    {
      table: 'identity_passkeys',
      seedRow: (admin, ownerId) =>
        insertReturningId(
          admin,
          `INSERT INTO identity_passkeys (user_id, credential_id, public_key)
           VALUES ($1, $2, 'public-key') RETURNING id`,
          [ownerId, `credential-${ownerId}`],
        ),
      update: `name = 'renamed'`,
      ownerMayDelete: true,
    },
    {
      table: 'identity_profiles',
      idColumn: 'user_id',
      seedRow: async (admin, ownerId) => {
        await admin.raw(
          `INSERT INTO identity_profiles (user_id, first_name)
           VALUES ($1, 'Owner')
           ON CONFLICT (user_id) DO UPDATE SET first_name = 'Owner'`,
          [ownerId],
        );
        return ownerId;
      },
      update: `first_name = 'Renamed'`,
    },
    {
      table: 'identity_refresh_tokens',
      seedRow: (admin, ownerId) =>
        insertReturningId(
          admin,
          `INSERT INTO identity_refresh_tokens (user_id, family_id, token, expires_at)
           VALUES ($1, uuid_generate_v4(), $2, ${IN_AN_HOUR}) RETURNING id`,
          [ownerId, `token-${ownerId}`],
        ),
      update: `family_revoked_at = now(), family_revoke_reason = 'isolation'`,
    },
    {
      table: 'identity_sessions',
      seedRow: (admin, ownerId) =>
        insertReturningId(
          admin,
          `INSERT INTO identity_sessions (user_id) VALUES ($1) RETURNING id`,
          [ownerId],
        ),
    },
    {
      table: 'identity_trusted_devices',
      seedRow: (admin, ownerId) =>
        insertReturningId(
          admin,
          `INSERT INTO identity_trusted_devices (user_id, device_fingerprint)
           VALUES ($1, 'fingerprint') RETURNING id`,
          [ownerId],
        ),
      update: `label = 'renamed'`,
      ownerMayDelete: true,
    },
  ]);
});
