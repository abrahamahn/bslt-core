// main/modules/compliance/server/repository.real-db.test.ts
import { randomUUID } from 'node:crypto';

import { expect, it } from 'vitest';

import { describeOwnerIsolation, describeRealDb } from '@bslt/server-system/testing/real-db';

import { complianceRepository } from './repository';

import type { DbClient } from '@bslt/db';

async function insertReturningId(
  admin: DbClient,
  text: string,
  values: unknown[],
): Promise<string> {
  const row = await admin.queryOne<{ id: string }>({ text, values });
  if (row === null) throw new Error(`INSERT returned no row: ${text}`);
  return row.id;
}

describeRealDb('compliance repository and owner RLS isolation (Real DB)', (realDb) => {
  describeOwnerIsolation(realDb, [
    {
      table: 'compliance_data_requests',
      seedRow: (admin, ownerId) =>
        insertReturningId(
          admin,
          `INSERT INTO compliance_data_requests (user_id, type, status, format)
           VALUES ($1, 'export', 'pending', 'json') RETURNING id`,
          [ownerId],
        ),
    },
    {
      table: 'compliance_age_assurance_checks',
      seedRow: (admin, ownerId) =>
        insertReturningId(
          admin,
          `INSERT INTO compliance_age_assurance_checks (user_id, provider, method, threshold, result_over_threshold, assurance_level)
           VALUES ($1, 'attestation', 'attestation', 18, true, 'self_attested') RETURNING id`,
          [ownerId],
        ),
    },
  ]);

  it('enforces append-only semantics on compliance_consents and tracks active legal holds', async () => {
    const alice = randomUUID();
    await realDb.database.adminDb.execute({
      text: `INSERT INTO identity_users (id, email, canonical_email)
             VALUES ($1, $2, $2)`,
      values: [alice, `alice-${alice}@compliance-rls.test`],
    });

    const asAlice = realDb.database.appDb.withSession({ userId: alice, role: 'user' });
    const consent = await complianceRepository(asAlice).recordConsent({
      userId: alice,
      consentType: 'analytics',
      granted: true,
    });
    expect(consent.granted).toBe(true);

    await expect(
      asAlice.execute({
        text: `UPDATE compliance_consents SET granted = false WHERE id = $1`,
        values: [consent.id],
      }),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      asAlice.execute({
        text: `DELETE FROM compliance_consents WHERE id = $1`,
        values: [consent.id],
      }),
    ).rejects.toThrow(/permission denied/i);

    await realDb.database.db.transaction(async (tx) => {
      const repo = complianceRepository(tx);
      expect(await repo.hasActiveLegalHold('user', alice)).toBe(false);
      const hold = await repo.insertLegalHold({
        subjectType: 'user',
        subjectId: alice,
        reason: 'Preserve records',
      });
      expect(await repo.hasActiveLegalHold('user', alice)).toBe(true);
      await repo.releaseLegalHold(hold.id, null);
      expect(await repo.hasActiveLegalHold('user', alice)).toBe(false);
    });
  });
});
