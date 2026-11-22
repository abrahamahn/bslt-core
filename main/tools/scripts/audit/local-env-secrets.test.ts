// main/tools/scripts/audit/local-env-secrets.test.ts

import { describe, expect, it } from 'vitest';

import { auditLocalEnvSecretContent } from './local-env-secrets';

describe('local env secrets audit', () => {
  it('allows documented local placeholders', () => {
    const issues = auditLocalEnvSecretContent(
      [
        'JWT_SECRET=localJwtSigningKeyMinimum32Characters',
        'COOKIE_SECRET=localCookieSigningKeyMinimum32Characters',
        'POSTGRES_PASSWORD=development',
        'GOOGLE_CLIENT_SECRET=',
      ].join('\n'),
      'config/env/.env.development',
    );

    expect(issues).toEqual([]);
  });

  it('rejects provider credentials in ignored local env files without exposing values', () => {
    const issues = auditLocalEnvSecretContent(
      ['APP_NAME=Demo', 'GOOGLE_CLIENT_SECRET=super-secret-value'].join('\n'),
      'config/env/.env.local',
    );

    expect(issues).toEqual([
      {
        file: 'config/env/.env.local',
        key: 'GOOGLE_CLIENT_SECRET',
        line: 2,
        message:
          'GOOGLE_CLIENT_SECRET must be blank in ignored local env files before template release.',
      },
    ]);
    expect(JSON.stringify(issues)).not.toContain('super-secret-value');
  });

  it('rejects production credential values in ignored production env files', () => {
    const issues = auditLocalEnvSecretContent(
      [
        'JWT_SECRET=production-looking-secret',
        'POSTGRES_PASSWORD=production-password',
        'SMTP_USER=ops@example.com',
      ].join('\n'),
      'config/env/.env.production',
    );

    expect(issues.map((issue) => `${issue.line}:${issue.key}`)).toEqual([
      '1:JWT_SECRET',
      '2:POSTGRES_PASSWORD',
      '3:SMTP_USER',
    ]);
  });
});
