// main/tools/scripts/dev/appName.test.ts
import { describe, expect, it } from 'vitest';

import { resolveDevAppName } from './appName';

describe('resolveDevAppName', () => {
  it('prefers APP_NAME', () => {
    expect(resolveDevAppName({ APP_NAME: 'Acme', VITE_APP_NAME: 'Other' })).toBe('Acme');
  });

  it('falls back to VITE_APP_NAME then EMAIL_FROM_NAME', () => {
    expect(resolveDevAppName({ VITE_APP_NAME: 'Vite Name' })).toBe('Vite Name');
    expect(resolveDevAppName({ EMAIL_FROM_NAME: 'Mailer' })).toBe('Mailer');
  });

  it('trims surrounding whitespace', () => {
    expect(resolveDevAppName({ APP_NAME: '  Spaced  ' })).toBe('Spaced');
  });

  it('returns undefined when nothing is configured (banner uses its default)', () => {
    expect(resolveDevAppName({})).toBeUndefined();
    expect(resolveDevAppName({ APP_NAME: '   ' })).toBeUndefined();
  });
});
