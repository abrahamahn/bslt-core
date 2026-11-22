// tests/integration/api/signup-consent.real-db.test.ts
/**
 * Signup Consent API Integration Tests (Real DB)
 *
 * bslt has five paths that create a user row: password register, magic link,
 * email OTP, OAuth, and the admin invite. This suite drives the consent
 * chokepoint (`insertConsentedUser`) through isolated Postgres with published
 * ToS + Privacy Policy fixtures and asserts the property the unit tests cannot:
 * real `compliance_consents` rows are born with the user row — or nothing is.
 *
 * The regression tests that matter most: a missing-consent refusal on the
 * magic-link and OTP paths must leave the one-time token redeemable (a second
 * attempt with consent succeeds), and must not charge the OTP attempt budget —
 * a wrong code still must.
 *
 * Requires a reachable Postgres; mandatory in CI via REQUIRE_REAL_DB.
 */

import { SIGNUP_AGREEMENT_DOCUMENT_TYPES } from '@bslt/compliance/contract';
import { complianceRepository } from '@bslt/compliance/server';
import {
  ConsentedUserRefusalError,
  adminCreateInvitedUser,
  createConsentedUserInRepo,
  identityRepository,
} from '@bslt/identity/server';
import { buildTestApp, parseJsonResponse, type TestApp } from '@bslt/testing';
import { describeRealDb, type TestDatabase } from '@bslt/testing/real-db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

interface ErrorBody {
  code?: string;
  error?: { code?: string };
}

/** The error code regardless of which envelope the error mapper used. */
function errorCode(body: unknown): string | undefined {
  const parsed = body as ErrorBody;
  return parsed.code ?? parsed.error?.code;
}

describeRealDb('Signup Consent API Integration (Real DB)', (realDb) => {
  let testServer: TestApp;
  let dbHarness: TestDatabase;

  // Captures the one-time secrets off the outgoing "emails".
  const otpTemplateSpy = vi
    .fn()
    .mockReturnValue({ subject: 'Your code', html: 'code', text: 'code' });
  const magicLinkTemplateSpy = vi
    .fn()
    .mockReturnValue({ subject: 'Your link', html: 'link', text: 'link' });

  let tosDocumentId: string;
  let privacyDocumentId: string;

  async function publishDocument(type: string, version: number): Promise<string> {
    // Publishing is a platform-admin write (the compliance baseline): seed through the superuser.
    const rows = await dbHarness.adminDb.raw<{ id: string }>(
      `INSERT INTO compliance_legal_documents (type, title, content, version, effective_at)
       VALUES ($1, $2, 'The text.', $3, NOW())
       RETURNING id`,
      [type, `${type} v${String(version)}`, version],
    );
    return String(rows[0]?.id);
  }

  async function findUserId(email: string): Promise<string | null> {
    const rows = await dbHarness.db.raw<{ id: string }>(
      `SELECT id FROM identity_users WHERE canonical_email = $1`,
      [email],
    );
    return rows[0]?.id ?? null;
  }

  async function consentDocumentIds(email: string): Promise<string[]> {
    const rows = await dbHarness.db.raw<{ document_id: string }>(
      `SELECT c.document_id FROM compliance_consents c
       JOIN identity_users u ON u.id = c.user_id
       WHERE u.canonical_email = $1 AND c.record_type = 'legal_document'`,
      [email],
    );
    return rows.map((row) => String(row.document_id)).sort();
  }

  function expectedConsentIds(): string[] {
    return [tosDocumentId, privacyDocumentId].sort();
  }

  async function requestOtpCode(email: string): Promise<string> {
    otpTemplateSpy.mockClear();
    const response = await testServer.inject({
      method: 'POST',
      url: '/api/auth/otp/request',
      payload: { email },
    });
    expect(response.statusCode).toBe(200);
    const code = otpTemplateSpy.mock.calls.at(-1)?.[0] as string | undefined;
    expect(code).toMatch(/^\d{6}$/);
    return String(code);
  }

  async function requestMagicLinkToken(email: string): Promise<string> {
    magicLinkTemplateSpy.mockClear();
    const response = await testServer.inject({
      method: 'POST',
      url: '/api/auth/magic-link/request',
      payload: { email },
    });
    expect(response.statusCode).toBe(200);
    const url = magicLinkTemplateSpy.mock.calls.at(-1)?.[0] as string | undefined;
    const token = url === undefined ? undefined : new URL(url).searchParams.get('token');
    expect(token).toBeTruthy();
    return String(token);
  }

  beforeAll(async () => {
    dbHarness = realDb.database;

    testServer = await buildTestApp({
      database: dbHarness,
      config: {
        auth: {
          // Enable the 'magic' strategy so the magic-link and email-OTP routes
          // (which share that capability gate) are reachable.
          strategies: ['local', 'magic'],
        },
      },
      ports: {
        emailTemplates: {
          emailVerification: vi.fn().mockReturnValue({ subject: 'test', html: 'test', to: 'test' }),
          passwordReset: vi.fn().mockReturnValue({ subject: 'test', html: 'test', to: 'test' }),
          passwordChangedAlert: vi
            .fn()
            .mockReturnValue({ subject: 'test', html: 'test', to: 'test' }),
          emailOtp: otpTemplateSpy,
          magicLink: magicLinkTemplateSpy,
        },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await testServer?.close();
  });

  beforeEach(async () => {
    try {
      await dbHarness.truncate(
        'identity_users, compliance_legal_documents, identity_auth_tokens CASCADE',
      );
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await dbHarness.truncate(
        'identity_users, compliance_legal_documents, identity_auth_tokens CASCADE',
      );
    }
    tosDocumentId = await publishDocument('terms_of_service', 1);
    privacyDocumentId = await publishDocument('privacy_policy', 1);
  });

  // ==========================================================================
  // Password register
  // ==========================================================================

  describe('password register', () => {
    const payload = {
      email: 'consent-pw@example.com',
      username: 'consentpw',
      firstName: 'Ada',
      lastName: 'Lovelace',
      password: 'Str0ng!Passphrase2026',
      eligibilityAttested: true,
    };

    it('records one consent row per published agreement on signup', async () => {
      const response = await testServer.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { ...payload, tosAccepted: true },
      });

      expect(response.statusCode).toBeLessThan(300);
      await expect(consentDocumentIds(payload.email)).resolves.toEqual(expectedConsentIds());
    });

    it('refuses with SIGNUP_CONSENT_REQUIRED and creates nothing without consent', async () => {
      const response = await testServer.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { ...payload, tosAccepted: false },
      });

      expect(response.statusCode).toBe(403);
      expect(errorCode(parseJsonResponse(response))).toBe('identity.SIGNUP_CONSENT_REQUIRED');
      await expect(findUserId(payload.email)).resolves.toBeNull();
    });
  });

  // ==========================================================================
  // Magic link — THE regression: the one-time link must survive the refusal
  // ==========================================================================

  describe('magic link', () => {
    const email = 'consent-magic@example.com';

    it('refuses without consent, leaves the link redeemable, then succeeds with consent', async () => {
      const token = await requestMagicLinkToken(email);

      const refused = await testServer.inject({
        method: 'POST',
        url: '/api/auth/magic-link/verify',
        payload: { token, eligibilityAttested: true },
      });
      expect(refused.statusCode).toBe(403);
      expect(errorCode(parseJsonResponse(refused))).toBe('identity.SIGNUP_CONSENT_REQUIRED');
      await expect(findUserId(email)).resolves.toBeNull();

      // The SAME token, re-submitted with consent, completes the signup.
      const accepted = await testServer.inject({
        method: 'POST',
        url: '/api/auth/magic-link/verify',
        payload: { token, eligibilityAttested: true, tosAccepted: true },
      });
      expect(accepted.statusCode).toBe(200);
      const body = parseJsonResponse(accepted) as { user: { email: string } };
      expect(body.user.email).toBe(email);
      await expect(consentDocumentIds(email)).resolves.toEqual(expectedConsentIds());
    });

    it('never demands consent from an existing user signing in', async () => {
      // First redemption creates the account (with consent).
      const first = await requestMagicLinkToken(email);
      const created = await testServer.inject({
        method: 'POST',
        url: '/api/auth/magic-link/verify',
        payload: { token: first, eligibilityAttested: true, tosAccepted: true },
      });
      expect(created.statusCode).toBe(200);

      // A returning user redeems a fresh link with no flags at all.
      const second = await requestMagicLinkToken(email);
      const returning = await testServer.inject({
        method: 'POST',
        url: '/api/auth/magic-link/verify',
        payload: { token: second },
      });
      expect(returning.statusCode).toBe(200);
      // Still exactly one consent row per agreement — signup consent is not re-recorded.
      await expect(consentDocumentIds(email)).resolves.toEqual(expectedConsentIds());
    });
  });

  // ==========================================================================
  // Email OTP — refusal must not consume the code nor charge the attempt budget
  // ==========================================================================

  describe('email OTP', () => {
    it('refuses without consent, then the SAME code succeeds with consent', async () => {
      const email = 'consent-otp@example.com';
      const code = await requestOtpCode(email);

      const refused = await testServer.inject({
        method: 'POST',
        url: '/api/auth/otp/verify',
        payload: { email, code, eligibilityAttested: true },
      });
      expect(refused.statusCode).toBe(403);
      expect(errorCode(parseJsonResponse(refused))).toBe('identity.SIGNUP_CONSENT_REQUIRED');
      await expect(findUserId(email)).resolves.toBeNull();

      const accepted = await testServer.inject({
        method: 'POST',
        url: '/api/auth/otp/verify',
        payload: { email, code, eligibilityAttested: true, tosAccepted: true },
      });
      expect(accepted.statusCode).toBe(200);
      await expect(consentDocumentIds(email)).resolves.toEqual(expectedConsentIds());
    });

    it('missing consent does not charge the attempt budget; the code stays live past 5 refusals', async () => {
      const email = 'consent-otp-budget@example.com';
      const code = await requestOtpCode(email);

      // Five missing-consent refusals — one more than the wrong-code budget.
      for (let i = 0; i < 5; i++) {
        const refused = await testServer.inject({
          method: 'POST',
          url: '/api/auth/otp/verify',
          payload: { email, code, eligibilityAttested: true },
        });
        expect(refused.statusCode).toBe(403);
      }

      // If the refusals had counted, the code would now be invalidated.
      const accepted = await testServer.inject({
        method: 'POST',
        url: '/api/auth/otp/verify',
        payload: { email, code, eligibilityAttested: true, tosAccepted: true },
      });
      expect(accepted.statusCode).toBe(200);
    });

    it('a wrong code still charges the attempt budget (missing consent is not a loophole)', async () => {
      const email = 'consent-otp-lockout@example.com';
      const code = await requestOtpCode(email);
      const wrongCode = code === '000000' ? '111111' : '000000';

      for (let i = 0; i < 5; i++) {
        const attempt = await testServer.inject({
          method: 'POST',
          url: '/api/auth/otp/verify',
          payload: { email, code: wrongCode, eligibilityAttested: true, tosAccepted: true },
        });
        expect(attempt.statusCode).toBe(401);
      }

      // The correct code — with full consent — is dead: the budget was spent.
      const verify = await testServer.inject({
        method: 'POST',
        url: '/api/auth/otp/verify',
        payload: { email, code, eligibilityAttested: true, tosAccepted: true },
      });
      expect(verify.statusCode).toBe(401);
    });
  });

  // ==========================================================================
  // OAuth-shaped creation — the chokepoint against real FK constraints
  // ==========================================================================

  // The OAuth HTTP flow needs a live provider, so the wire plumbing (flag sealed
  // into the encrypted state) is covered by oauth/service.test.ts. What the unit
  // tests cannot prove is that the chokepoint's consent rows satisfy the real
  // schema (FK to compliance_legal_documents, record_type CHECK) — that is proved here.
  describe('OAuth-shaped creation through the chokepoint', () => {
    const values = {
      email: 'consent-oauth@example.com',
      canonicalEmail: 'consent-oauth@example.com',
      username: 'consentoauth',
      firstName: 'Ada',
      lastName: 'Lovelace',
      passwordHash: 'oauth:google:deadbeef',
      role: 'user' as const,
      emailVerified: true,
      emailVerifiedAt: new Date(),
    };

    const complianceHooks = {
      peekAgreements: async (tx: Parameters<typeof complianceRepository>[0]) => {
        const latest = await complianceRepository(tx).findAllLatestLegalDocuments();
        return latest
          .filter((doc) => SIGNUP_AGREEMENT_DOCUMENT_TYPES.has(doc.type))
          .map((doc) => ({ id: doc.id }));
      },
      recordConsents: async (
        tx: Parameters<typeof complianceRepository>[0],
        data: {
          readonly userId: string;
          readonly documentIds: readonly string[];
          readonly ipAddress?: string | null | undefined;
          readonly userAgent?: string | null | undefined;
        },
      ) => {
        const repo = complianceRepository(tx);
        for (const documentId of data.documentIds) {
          await repo.recordAgreement({
            userId: data.userId,
            documentId,
            ipAddress: data.ipAddress ?? null,
            userAgent: data.userAgent ?? null,
          });
        }
      },
    };

    it('creates the user with one consent row per agreement', async () => {
      await dbHarness.db.transaction((tx) =>
        createConsentedUserInRepo(
          identityRepository(tx),
          values,
          {
            agreed: true,
            attested: true,
            ipAddress: '203.0.113.7',
          },
          complianceHooks,
          tx,
        ),
      );

      await expect(consentDocumentIds(values.email)).resolves.toEqual(expectedConsentIds());
    });

    it('refuses without consent and writes no rows at all', async () => {
      await expect(
        dbHarness.db.transaction((tx) =>
          createConsentedUserInRepo(
            identityRepository(tx),
            values,
            { agreed: false, attested: true },
            complianceHooks,
            tx,
          ),
        ),
      ).rejects.toBeInstanceOf(ConsentedUserRefusalError);

      await expect(findUserId(values.email)).resolves.toBeNull();
    });
  });

  // ==========================================================================
  // Admin invite — DELIBERATELY ungated: an admin cannot consent for the user
  // ==========================================================================

  describe('admin invite', () => {
    it('creates the user with ZERO consent rows', async () => {
      const created = await adminCreateInvitedUser(identityRepository(dbHarness.db), {
        email: 'consent-invited@example.com',
        firstName: 'Invited',
        lastName: 'User',
      });

      expect(created.ok).toBe(true);
      if (created.ok) {
        expect(created.value.email).toBe('consent-invited@example.com');
      }
      await expect(consentDocumentIds('consent-invited@example.com')).resolves.toEqual([]);
    });
  });
});
