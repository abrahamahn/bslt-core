// main/kernel/db/src/utils/postgres-dsn.test.ts
import { describe, expect, it } from 'vitest';

import { buildPostgresDsn } from './postgres-dsn';

function parseLikeDriver(dsn: string): {
  user: string;
  password: string;
  host: string;
  port: string;
  database: string;
} {
  const url = new URL(dsn);
  return {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    host: url.hostname,
    port: url.port,
    database: url.pathname.slice(1),
  };
}

const BASE = { user: 'postgres', host: 'pgbouncer', port: 5432, database: 'abe_prod' } as const;

describe('buildPostgresDsn', () => {
  it('round-trips an ordinary password', () => {
    const dsn = buildPostgresDsn({ ...BASE, password: 'hunter2' });
    expect(parseLikeDriver(dsn)).toMatchObject({ password: 'hunter2', host: 'pgbouncer' });
  });

  it.each([
    ['a slash, which terminates the authority', 'aB3+x/y=='],
    ['a hash, which starts a fragment', 'pa#ss'],
    ['a question mark, which starts a query', 'pa?ss'],
    ['a bare percent, which is an invalid escape', 'pa%ss'],
    ['an at sign', 'pa@ss'],
    ['several at once', 'p/a#s?s%w@rd'],
  ])('survives %s', (_label, password) => {
    const parsed = parseLikeDriver(buildPostgresDsn({ ...BASE, password }));

    expect(parsed.password).toBe(password);
    expect(parsed.host).toBe('pgbouncer');
    expect(parsed.port).toBe('5432');
    expect(parsed.database).toBe('abe_prod');
  });

  it('encodes the user too, not just the password', () => {
    const parsed = parseLikeDriver(buildPostgresDsn({ ...BASE, user: 'read/only', password: 'x' }));
    expect(parsed.user).toBe('read/only');
    expect(parsed.host).toBe('pgbouncer');
  });

  it('omits the password section entirely when there is no password', () => {
    const dsn = buildPostgresDsn({ ...BASE, password: '' });
    expect(dsn).toBe('postgres://postgres@pgbouncer:5432/abe_prod');
    expect(parseLikeDriver(dsn).password).toBe('');
  });

  it('leaves a bracketed IPv6 host alone', () => {
    const dsn = buildPostgresDsn({ ...BASE, host: '[::1]', password: 'x' });
    expect(parseLikeDriver(dsn).host).toBe('[::1]');
  });

  it('honours the protocol each caller already emitted', () => {
    expect(buildPostgresDsn({ ...BASE, password: 'x' })).toMatch(/^postgres:\/\//u);
    expect(buildPostgresDsn({ ...BASE, password: 'x', protocol: 'postgresql' })).toMatch(
      /^postgresql:\/\//u,
    );
  });
});
