// main/kernel/db/src/pubsub/postgres-listener.ts
/**
 * Dedicated PostgreSQL `LISTEN <channel>` session (`LISTEN_DATABASE_URL`).
 *
 * Keeps `@bslt/protocols/pg` encapsulated inside `@bslt/db` (Plan §13 C3) while
 * allowing kernel workers such as `sys.outbox.dispatch` to wake on `NOTIFY`.
 */
import { createPgPool, type PgOptions, type PgSql } from '@bslt/protocols/pg';

const CHANNEL_PATTERN = /^[a-z_][a-z0-9_]*$/;

interface PostgresChannelListenerOptions {
  readonly connectionString: string;
  readonly channel: string;
  readonly ssl?: boolean | 'require' | 'prefer' | undefined;
  readonly onNotify: (payload: string) => void;
  readonly onError?: ((error: Error) => void) | undefined;
}

export interface PostgresChannelListener {
  readonly isActive: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createPostgresChannelListener(
  options: PostgresChannelListenerOptions,
): PostgresChannelListener {
  if (options.connectionString.trim().length === 0) {
    throw new Error('Postgres channel listener requires a non-empty connectionString');
  }
  if (!CHANNEL_PATTERN.test(options.channel)) {
    throw new Error(`Unsafe Postgres LISTEN channel identifier: "${options.channel}"`);
  }

  let client: PgSql | null = null;
  let active = false;
  const onError = options.onError ?? ((): void => {});

  return {
    get isActive(): boolean {
      return active;
    },
    async start(): Promise<void> {
      if (active) return;

      const listenOpts: PgOptions = {
        max: 1,
        idle_timeout: 0,
        connect_timeout: 10,
        ssl: options.ssl,
        onclose: (): void => {
          onError(new Error(`Postgres LISTEN session on "${options.channel}" closed`));
        },
      };

      const sql = createPgPool(options.connectionString, listenOpts);
      try {
        await sql.listen(options.channel, (payload) => {
          options.onNotify(payload);
        });
        client = sql;
        active = true;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        onError(error);
        await sql.end({ timeout: 5 }).catch((closeErr: unknown) => {
          onError(closeErr instanceof Error ? closeErr : new Error(String(closeErr)));
        });
        throw error;
      }
    },
    async stop(): Promise<void> {
      if (!active) return;
      active = false;
      const toClose = client;
      client = null;
      if (toClose !== null) {
        try {
          await toClose.end({ timeout: 5 });
        } catch (err) {
          onError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    },
  };
}
