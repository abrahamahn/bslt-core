// main/kernel/db/src/utils/postgres-dsn.ts
/**
 * Build a Postgres connection string from discrete parts.
 *
 * Percent-encodes credentials (and only credentials) so URL metacharacters
 * (`/`, `#`, `?`, `%`, `@`) in generated passwords or usernames never corrupt
 * the host, port, or database name.
 */

export interface PostgresDsnParts {
  readonly user: string;
  /** Empty string means "no password" — the DSN then carries only the user. */
  readonly password: string;
  readonly host: string;
  readonly port: number | string;
  readonly database: string;
  /** Both are accepted by every Postgres client; kept to preserve each caller's existing output. */
  readonly protocol?: 'postgres' | 'postgresql';
}

export function buildPostgresDsn({
  user,
  password,
  host,
  port,
  database,
  protocol = 'postgres',
}: PostgresDsnParts): string {
  const auth =
    password !== ''
      ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
      : encodeURIComponent(user);

  return `${protocol}://${auth}@${host}:${String(port)}/${database}`;
}
