// main/tools/scripts/db/backfill-totp-secrets.ts
/**
 * Encrypt any TOTP seed still stored in plaintext.
 *
 * `users.totp_secret` used to hold the raw base32 seed. It is encrypted now, and
 * a legacy row is upgraded the first time its owner verifies a code — but that
 * only reaches people who still log in. An account dormant for six months keeps
 * a plaintext seed in every backup until someone runs this.
 *
 * Safe to run repeatedly, and safe to run against a database that has already
 * been fully migrated: it only touches rows that are still plaintext, and it
 * writes each one with a compare-and-set on the exact value it read, so a
 * concurrent re-setup or disable is never clobbered.
 *
 * The key comes from `loadConfig()` — the same loader the server uses — rather
 * than being re-derived from env here. That is the whole point: encrypting with
 * a key the server will not decrypt with would lock every 2FA user out of their
 * own account, and a second copy of `OAUTH_TOKEN_ENCRYPTION_KEY ?? COOKIE_SECRET
 * ?? jwtSecret` is exactly how that happens.
 *
 * Usage: pnpm bslt db backfill-totp        (add --dry-run to report without writing)
 */

import { buildWorkerConnectionString, createDbClient } from '@bslt/db';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  isLegacyPlaintextSecret,
} from '@bslt/identity/server';
import { initEnv, loadConfig } from '@bslt/server-system/config';

/** This script's output channel. `console` would trip no-console. */
function report(message: string): void {
  process.stdout.write(`${message}\n`);
}

interface LegacyRow {
  id: string;
  totp_secret: string;
}

export async function backfillTotpSecrets(dryRun: boolean): Promise<number> {
  await initEnv();
  const config = await loadConfig();
  const encryptionKey = config.auth.oauthTokenEncryptionKey;

  const db = createDbClient(buildWorkerConnectionString());

  try {
    const rows = await db.query<LegacyRow>({
      text: `SELECT user_id AS id, totp_secret FROM identity_credentials
             WHERE totp_secret IS NOT NULL AND totp_secret NOT LIKE '%:%'`,
      values: [],
    });

    const legacy = rows.filter((row) => isLegacyPlaintextSecret(row.totp_secret));

    if (legacy.length === 0) {
      report('No plaintext TOTP secrets found. Nothing to do.');
      return 0;
    }

    report(
      `${String(legacy.length)} plaintext TOTP secret(s) found${dryRun ? ' (dry run — nothing will be written)' : ''}.`,
    );

    if (dryRun) return legacy.length;

    let updated = 0;

    for (const row of legacy) {
      const ciphertext = encryptTotpSecret(row.totp_secret, encryptionKey);

      // Prove the round-trip BEFORE writing. If this key cannot recover the seed
      // it just encrypted, writing would replace a working secret with an
      // unrecoverable one and lock the user out of their own account — so stop,
      // loudly, having changed nothing.
      if (decryptTotpSecret(ciphertext, encryptionKey) !== row.totp_secret) {
        throw new Error(
          `Refusing to write: the encrypted seed for user ${row.id} did not decrypt back to itself.`,
        );
      }

      // Compare-and-set on the exact value read.
      const changed = await db.execute({
        text: `UPDATE identity_credentials
               SET totp_secret = $1, updated_at = now()
               WHERE user_id = $2 AND totp_secret = $3`,
        values: [ciphertext, row.id, row.totp_secret],
      });

      if (changed > 0) updated += 1;
    }

    const skipped = legacy.length - updated;
    report(
      `Encrypted ${String(updated)} TOTP secret(s)` +
        (skipped > 0 ? `; ${String(skipped)} changed underneath us and were left alone.` : '.'),
    );

    return updated;
  } finally {
    await db.close();
  }
}
