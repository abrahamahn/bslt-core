// tests/integration/api/tos.real-db.test.ts
/**
 * Terms-of-Service Gating API Integration Tests (Real DB)
 *
 * The mock-backed tos.integration.test.ts stubs the legal-document and consent
 * repositories, so it cannot verify the acceptance state machine against real
 * rows. This suite drives it through isolated Postgres:
 * - with a current ToS document and no acceptance, status reports not-accepted
 * - accepting records a compliance_consents row and flips status to accepted
 * - publishing a newer ToS version re-requires acceptance
 * - with no ToS document at all, status reports accepted (nothing to enforce)
 *
 * Requires a reachable Postgres; mandatory in CI via REQUIRE_REAL_DB.
 */

import { buildTestApp, parseJsonResponse, seedTestUser, type TestApp } from '@bslt/testing';
import { describeRealDb, type TestDatabase } from '@bslt/testing/real-db';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

function extractRefreshToken(setCookie: string | string[] | undefined): string {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie !== undefined ? [setCookie] : [];
  const token = cookies
    .find((cookie) => cookie.startsWith('refreshToken='))
    ?.split(';')[0]
    ?.split('=')[1];
  expect(token).toBeDefined();
  return String(token);
}

interface TosStatus {
  accepted: boolean;
  requiredVersion: number | null;
  documentId: string | null;
}

describeRealDb('ToS Gating API Integration (Real DB)', (realDb) => {
  let testServer: TestApp;
  let dbHarness: TestDatabase;

  const email = 'tos-user@example.com';
  const password = 'TestPassword123!';

  async function login(): Promise<string> {
    const loginResponse = await testServer.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: email, password },
    });
    expect(loginResponse.statusCode).toBe(200);
    const refreshToken = extractRefreshToken(loginResponse.headers['set-cookie']);

    const refresh = await testServer.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: `refreshToken=${refreshToken}` },
    });
    expect(refresh.statusCode).toBe(200);
    return String((parseJsonResponse(refresh) as { token: unknown }).token);
  }

  async function publishTos(version: number): Promise<string> {
    // Publishing is a platform-admin write (the compliance baseline): seed through the superuser.
    const rows = await dbHarness.adminDb.raw<{ id: string }>(
      `INSERT INTO compliance_legal_documents (type, title, content, version, effective_at)
       VALUES ('terms_of_service', $1, 'The terms.', $2, NOW())
       RETURNING id`,
      [`Terms v${String(version)}`, version],
    );
    return String(rows[0]?.id);
  }

  async function getStatus(token: string): Promise<TosStatus> {
    const response = await testServer.inject({
      method: 'GET',
      url: '/api/auth/tos/status',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    return parseJsonResponse(response) as TosStatus;
  }

  async function acceptTos(token: string, documentId: string): Promise<number> {
    const response = await testServer.inject({
      method: 'POST',
      url: '/api/auth/tos/accept',
      headers: { authorization: `Bearer ${token}` },
      payload: { documentId },
    });
    return response.statusCode;
  }

  async function consentRowCount(documentId: string): Promise<number> {
    const rows = await dbHarness.db.raw<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM compliance_consents c
       JOIN identity_users u ON u.id = c.user_id
       WHERE u.canonical_email = $1 AND c.document_id = $2`,
      [email, documentId],
    );
    return Number(rows[0]?.count);
  }

  beforeAll(async () => {
    dbHarness = realDb.database;

    testServer = await buildTestApp({
      database: dbHarness,
      ports: {
        emailTemplates: {
          emailVerification: vi.fn().mockReturnValue({ subject: 'test', html: 'test', to: 'test' }),
          passwordReset: vi.fn().mockReturnValue({ subject: 'test', html: 'test', to: 'test' }),
          passwordChangedAlert: vi
            .fn()
            .mockReturnValue({ subject: 'test', html: 'test', to: 'test' }),
        },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await testServer?.close();
  });

  beforeEach(async () => {
    try {
      await dbHarness.truncate('identity_users, compliance_legal_documents CASCADE');
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await dbHarness.truncate('identity_users, compliance_legal_documents CASCADE');
    }
    await seedTestUser(dbHarness.connectionString, { email, password });
  });

  it('reports accepted when no ToS document exists', async () => {
    const token = await login();
    const status = await getStatus(token);
    expect(status.accepted).toBe(true);
    expect(status.documentId).toBeNull();
  });

  it('reports not-accepted, then accepts and records a consent row', async () => {
    const documentId = await publishTos(1);
    const token = await login();

    const before = await getStatus(token);
    expect(before.accepted).toBe(false);
    expect(before.requiredVersion).toBe(1);
    expect(before.documentId).toBe(documentId);

    expect(await acceptTos(token, documentId)).toBe(200);
    expect(await consentRowCount(documentId)).toBe(1);

    const after = await getStatus(token);
    expect(after.accepted).toBe(true);
  });

  it('re-requires acceptance when a newer ToS version is published', async () => {
    const v1 = await publishTos(1);
    const token = await login();
    expect(await acceptTos(token, v1)).toBe(200);
    expect((await getStatus(token)).accepted).toBe(true);

    const v2 = await publishTos(2);
    const status = await getStatus(token);
    expect(status.accepted).toBe(false);
    expect(status.requiredVersion).toBe(2);
    expect(status.documentId).toBe(v2);
  });
});
