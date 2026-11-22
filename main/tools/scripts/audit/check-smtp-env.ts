// main/tools/scripts/audit/check-smtp-env.ts
/**
 * SMTP env sanity check: prints the SMTP settings the server would load, never
 * the password itself.
 *
 * Run with:
 *   ENV_FILE=config/env/.env.local pnpm bslt report check-smtp-env
 */

import { initEnv } from '@bslt/server-system/config';

export async function run(): Promise<void> {
  await initEnv();
  const env = process.env;

  const passLength = (env['SMTP_PASS'] ?? '').length;

  // Do not print SMTP_PASS itself.
  console.log('SMTP_HOST=', env['SMTP_HOST'] ?? '');
  console.log('SMTP_PORT=', env['SMTP_PORT'] ?? '');
  console.log('SMTP_SECURE=', env['SMTP_SECURE'] ?? '');
  console.log('SMTP_USER=', env['SMTP_USER'] ?? '');
  console.log('SMTP_PASS length=', passLength);
}
