// main/modules/audit/server/repository.real-db.test.ts
import { randomUUID } from 'node:crypto';

import { expect, it } from 'vitest';

import { describeOwnerIsolation, describeRealDb } from '@bslt/server-system/testing/real-db';

import { auditRepository } from './repository';

import type { DbClient, RawDb } from '@bslt/db';

async function insertReturningId(
  admin: DbClient,
  text: string,
  values: unknown[],
): Promise<string> {
  const row = await admin.queryOne<{ id: string }>({ text, values });
  if (row === null) throw new Error(`INSERT returned no row: ${text}`);
  return row.id;
}

describeRealDb('audit repository, append-only immutability, and RLS (Real DB)', (realDb) => {
  const asUser = <T>(userId: string, fn: (tx: RawDb) => Promise<T>): Promise<T> =>
    realDb.database.appDb.withSession({ userId, role: 'user' }).transaction(fn);

  const asAdmin = <T>(userId: string, fn: (tx: RawDb) => Promise<T>): Promise<T> =>
    realDb.database.appDb.withSession({ userId, role: 'admin' }).transaction(fn);

  const asSystem = <T>(fn: (tx: RawDb) => Promise<T>): Promise<T> =>
    realDb.database.db.transaction(fn);

  describeOwnerIsolation(realDb, [
    {
      table: 'audit_log',
      seedRow: (admin, ownerId) =>
        insertReturningId(
          admin,
          `INSERT INTO audit_log (actor_id, action, category, severity, resource)
           VALUES ($1, 'tasks.task.created', 'data', 'info', 'task') RETURNING id`,
          [ownerId],
        ),
    },
    {
      table: 'audit_activity',
      seedRow: (admin, ownerId) =>
        insertReturningId(
          admin,
          `INSERT INTO audit_activity (actor_id, actor_type, action, resource_type, resource_id)
           VALUES ($1, 'user', 'tasks.task.created', 'task', 'task-1') RETURNING id`,
          [ownerId],
        ),
    },
  ]);

  it('forbids bslt_app user sessions from inserting, updating, or deleting audit_log and audit_activity', async () => {
    const userId = randomUUID();
    await realDb.database.adminDb.execute({
      text: `INSERT INTO identity_users (id, email, canonical_email)
             VALUES ($1, $2, $2)`,
      values: [userId, `u-${userId}@audit-rls.test`],
    });

    await expect(
      asUser(userId, (tx) =>
        auditRepository(tx).appendLog({
          actorId: userId,
          action: 'tasks.task.created',
          category: 'data',
          severity: 'info',
          resource: 'task',
        }),
      ),
    ).rejects.toThrow(/permission denied/iu);

    await expect(
      asUser(userId, (tx) =>
        auditRepository(tx).appendActivity({
          actorId: userId,
          actorType: 'user',
          action: 'tasks.task.created',
          resourceType: 'task',
          resourceId: 'task-1',
        }),
      ),
    ).rejects.toThrow(/permission denied/iu);
  });

  it('enforces trg_audit_log_immutable against UPDATE and DELETE even on the superuser connection', async () => {
    const inserted = await asSystem((tx) =>
      auditRepository(tx).appendLog({
        action: 'moderation.case.decided',
        category: 'trust_safety',
        severity: 'warn',
        resource: 'case',
        resourceId: 'case-immutable',
        idempotencyKey: `immutable-${randomUUID()}`,
      }),
    );
    expect(inserted).not.toBeNull();
    const rowId = inserted?.id ?? '';

    await expect(
      realDb.database.adminDb.raw(`UPDATE audit_log SET severity = 'info' WHERE id = $1`, [rowId]),
    ).rejects.toThrow(/append-only/iu);

    await expect(
      realDb.database.adminDb.raw(`DELETE FROM audit_log WHERE id = $1`, [rowId]),
    ).rejects.toThrow(/append-only/iu);
  });

  it('allows platform admins verified in users table to read all audit_log rows and allows org members to read org audit_activity', async () => {
    const adminId = randomUUID();
    const aliceId = randomUUID();
    const memberId = randomUUID();
    const outsiderId = randomUUID();
    const orgId = randomUUID();

    await realDb.database.adminDb.execute({
      text: `INSERT INTO identity_users (id, email, canonical_email, role)
             VALUES ($1, $2, $2, 'admin'),
                    ($3, $4, $4, 'user'),
                    ($5, $6, $6, 'user'),
                    ($7, $8, $8, 'user')`,
      values: [
        adminId,
        `admin-${adminId}@audit-rls.test`,
        aliceId,
        `alice-${aliceId}@audit-rls.test`,
        memberId,
        `member-${memberId}@audit-rls.test`,
        outsiderId,
        `outsider-${outsiderId}@audit-rls.test`,
      ],
    });
    const [orgsReg] = await realDb.database.adminDb.raw<{ reg: string | null }>(
      `SELECT to_regclass('public.orgs')::text AS reg`,
    );
    const hasOrgs = orgsReg?.reg !== null;
    if (hasOrgs) {
      await realDb.database.adminDb.execute({
        text: `INSERT INTO orgs (id, name, slug, owner_id) VALUES ($1, $2, $2, $3)`,
        values: [orgId, `org-${orgId}`, aliceId],
      });
      await realDb.database.adminDb.execute({
        text: `INSERT INTO orgs_members (org_id, user_id, role)
               VALUES ($1, $2, 'owner'), ($1, $3, 'member')`,
        values: [orgId, aliceId, memberId],
      });
    }

    const logRow = await asSystem((tx) =>
      auditRepository(tx).appendLog({
        actorId: aliceId,
        orgId,
        action: 'orgs.member.added',
        category: 'admin',
        severity: 'info',
        resource: 'member',
        resourceId: memberId,
      }),
    );
    expect(logRow).not.toBeNull();

    await asSystem((tx) =>
      auditRepository(tx).appendActivity({
        actorId: aliceId,
        orgId,
        actorType: 'user',
        action: 'orgs.member.added',
        resourceType: 'member',
        resourceId: memberId,
      }),
    );

    const adminLogs = await asAdmin(adminId, (tx) =>
      auditRepository(tx).listLogs({ orgId, limit: 10 }),
    );
    expect(adminLogs.some((r) => r.id === logRow?.id)).toBe(true);

    const memberActivities = await asUser(memberId, (tx) =>
      auditRepository(tx).listActivities({ orgId, limit: 10 }),
    );
    expect(memberActivities).toHaveLength(hasOrgs ? 1 : 0);

    const aliceActivities = await asUser(aliceId, (tx) =>
      auditRepository(tx).listActivities({ orgId, limit: 10 }),
    );
    expect(aliceActivities).toHaveLength(1);

    const outsiderActivities = await asUser(outsiderId, (tx) =>
      auditRepository(tx).listActivities({ orgId, limit: 10 }),
    );
    expect(outsiderActivities).toHaveLength(0);
  });
});
