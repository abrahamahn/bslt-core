// main/shared/src/helpers/postgres-dsn.ts
/**
 * Build a Postgres connection string from discrete parts.
 *
 * There were two of these — `@bslt/db`'s `buildConnectionString` (which encoded
 * neither credential) and `@bslt/server-system`'s (which encoded the password
 * but not the user). That asymmetry is the whole reason this exists: a URL is
 * fiddly enough that two hand-rolled copies WILL drift, and the one on the deploy
 * path is the one that was wrong.
 */

export interface PostgresDsnParts {
  readonly user: string;
  /** Empty string means "no password" — the DSN then carries only the user. */
  readonly password: string;
  readonly host: string;
  readonly port: number | string;
  readonly database: string;
  /** Both are accepted by every Postgres client; kept only to preserve each caller's existing output. */
  readonly protocol?: 'postgres' | 'postgresql';
}

/**
 * Percent-encode the credentials, and only the credentials.
 *
 * A generated password routinely contains characters that are URL syntax. `/`
 * is the one that actually bites: it terminates the authority, so
 * `postgres://u:pa/ss@host:5432/db` parses with host `pa`, and the failure
 * surfaces as an authentication error against a host nobody typed. `#` starts a
 * fragment, `?` starts a query, and a bare `%` is an invalid escape that makes
 * `new URL()` throw outright.
 *
 * A bare `@` is NOT a problem, contrary to the obvious guess: the WHATWG URL
 * parser splits userinfo at the LAST `@`, so `postgres://u:p@ss@host/db`
 * resolves correctly. It is encoded here anyway because encoding it is free and
 * reasoning about which metacharacters are "safe enough" is exactly how the two
 * previous copies ended up disagreeing.
 *
 * Host, port and database are deliberately NOT encoded — percent-encoding a
 * bracketed IPv6 host (`[::1]`) would mangle it.
 */
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
