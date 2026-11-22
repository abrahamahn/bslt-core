// main/testing/src/seed.ts
/**
 * Test Seed Helpers
 *
 * Provides functions to seed isolated test databases with required data.
 */

import { complianceRepository } from '@bslt/compliance/server';
import { canonicalizeEmail } from '@bslt/contract';
import { createRawDb } from '@bslt/db';
import { hashPassword } from '@bslt/identity/server';

/**
 * Seed a test user into the provided database.
 *
 * The user is seeded in the state a registered user is in: verified, and having
 * accepted the Terms of Service that are published at that moment (the
 * migrations publish v1; registration records the acceptance). Suites run the
 * production guard chain, whose ToS gate refuses every protected route to a
 * user who has not accepted. A suite that tests the gate publishes its own
 * document after seeding, which this user has then not accepted.
 *
 * @param connectionString - Worker-role connection of the isolated database.
 * @param overrides - Email, and optionally password and platform role.
 */
export async function seedTestUser(
  connectionString: string,
  overrides: { email: string; password?: string; role?: string },
): Promise<void> {
  const db = createRawDb({ connectionString });
  const { email, password = 'TestPassword123!', role = 'user' } = overrides;

  try {
    const passwordHash = await hashPassword(password);
    const canonical = canonicalizeEmail(email);
    const username = email.split('@')[0];

    const user = await db.queryOne<{ id: string }>({
      text: `
        INSERT INTO identity_users (email, canonical_email, username, role, email_verified, email_verified_at)
        VALUES ($1, $2, $3, $4, true, NOW())
        RETURNING id
      `,
      values: [email, canonical, username, role],
    });
    if (user === null) {
      throw new Error(`seedTestUser: inserting ${email} returned no row`);
    }
    await db.execute({
      text: `INSERT INTO identity_credentials (user_id, password_hash) VALUES ($1, $2)`,
      values: [user.id, passwordHash],
    });
    await db.execute({
      text: `INSERT INTO identity_profiles (user_id) VALUES ($1)`,
      values: [user.id],
    });
    await db.execute({
      text: `INSERT INTO identity_lockouts (user_id) VALUES ($1)`,
      values: [user.id],
    });

    // Record acceptance of the latest published ToS if not yet accepted.
    const compliance = complianceRepository(db);
    const latestTos = await compliance.findLatestLegalDocumentByType('terms_of_service');
    if (latestTos !== null) {
      const existing = await compliance.findAgreementByUserAndDocument(user.id, latestTos.id);
      if (existing === null) {
        await compliance.recordAgreement({ userId: user.id, documentId: latestTos.id });
      }
    }
  } finally {
    await db.close();
  }
}
