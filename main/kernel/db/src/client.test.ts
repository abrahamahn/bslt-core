// main/kernel/db/src/client.test.ts
import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest';

import {
  buildMigrationConnectionString,
  buildWorkerConnectionString,
  createDbClient,
  createRawDb,
  DEFAULT_TRANSACTION_RETRY,
  isRetryableTransactionError,
  timeoutSettingsQuery,
  toSafeNumber,
  transactionRetryDelay,
} from './client';

// Mock @bslt/protocols/pg pool factory
vi.mock('@bslt/protocols/pg', () => {
  return {
    createPgPool: vi.fn().mockImplementation(() => {
      const tx = {
        unsafe: vi.fn().mockResolvedValue([]),
      };

      return {
        unsafe: vi.fn().mockResolvedValue([]),
        end: vi.fn().mockResolvedValue(undefined),
        begin: vi
          .fn()
          .mockImplementation(async (_isolation: string, cb: (tx: unknown) => unknown) => {
            return await cb(tx);
          }),
      };
    }),
  };
});

const { createPgPool: postgres } = await import('@bslt/protocols/pg');
const postgresMock = postgres as unknown as Mock;
type Tx = { unsafe: ReturnType<typeof vi.fn> };

describe('Database Client', () => {
  const mockConnectionString = 'postgresql://user:pass@localhost:5432/testdb';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createRawDb', () => {
    test('should create a database client with connection string', () => {
      const client = createRawDb(mockConnectionString);

      expect(client).toBeDefined();
      expect(postgres).toHaveBeenCalledWith(mockConnectionString, expect.any(Object));
    });

    test('should configure postgres with appropriate options', () => {
      createRawDb(mockConnectionString);

      expect(postgres).toHaveBeenCalledWith(mockConnectionString, {
        max: 10,
        // Seconds, the driver's unit: 30 s idle, 10 s to connect.
        ['idle_timeout']: 30,
        ['connect_timeout']: 10,
        ssl: undefined,
        types: { bigint: expect.any(Object) as unknown },
      });
    });

    test('idleTimeout and connectTimeout are milliseconds, handed to the driver in seconds', () => {
      createRawDb({
        connectionString: mockConnectionString,
        idleTimeout: 60_000,
        connectTimeout: 2_500,
      });

      expect(postgres).toHaveBeenCalledWith(
        mockConnectionString,
        expect.objectContaining({ ['idle_timeout']: 60, ['connect_timeout']: 2.5 }),
      );
    });

    test('every pool decodes int8 as a bigint, exactly', () => {
      createRawDb(mockConnectionString);

      const [, options] = postgresMock.mock.calls[0] as [
        string,
        {
          types: {
            bigint: {
              to: number;
              from: number[];
              parse: (text: string) => unknown;
              serialize: (value: bigint) => string;
            };
          };
        },
      ];
      const int8 = options.types.bigint;

      // OID 20 is int8; the driver derives int8[] from it.
      expect([int8.to, int8.from]).toEqual([20, [20]]);
      // 2^53 + 1, which a number cannot hold, and the ends of the range.
      expect(int8.parse('9007199254740993')).toBe(9_007_199_254_740_993n);
      expect(int8.parse('-9223372036854775808')).toBe(-9_223_372_036_854_775_808n);
      expect(int8.parse('7')).toBe(7n);
      expect(int8.serialize(9_223_372_036_854_775_807n)).toBe('9223372036854775807');
    });

    describe('toSafeNumber', () => {
      test('returns the number of a bigint, a number or a decimal string that is exact', () => {
        expect(toSafeNumber(4096n)).toBe(4096);
        expect(toSafeNumber(-3n)).toBe(-3);
        expect(toSafeNumber(12)).toBe(12);
        expect(toSafeNumber('1024')).toBe(1024);
        expect(toSafeNumber(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
        expect(toSafeNumber(BigInt(Number.MIN_SAFE_INTEGER))).toBe(Number.MIN_SAFE_INTEGER);
      });

      test('refuses a value a number cannot hold exactly, instead of rounding it', () => {
        expect(() => toSafeNumber(9_007_199_254_740_993n)).toThrow(RangeError);
        expect(() => toSafeNumber('9007199254740993')).toThrow(
          '9007199254740993 does not fit a JavaScript number exactly',
        );
        expect(() => toSafeNumber(-9_223_372_036_854_775_808n)).toThrow(RangeError);
        expect(() => toSafeNumber(2 ** 53)).toThrow(RangeError);
      });

      test('refuses what is not an integer', () => {
        expect(() => toSafeNumber('1.5')).toThrow(RangeError);
        expect(() => toSafeNumber(1.5)).toThrow(RangeError);
        expect(() => toSafeNumber('abc')).toThrow(RangeError);
        expect(() => toSafeNumber('')).toThrow(RangeError);
        expect(() => toSafeNumber(Number.NaN)).toThrow(RangeError);
      });
    });

    test('should pass explicit SSL options to postgres', () => {
      createRawDb({
        connectionString: mockConnectionString,
        ssl: true,
      });

      expect(postgres).toHaveBeenCalledWith(
        mockConnectionString,
        expect.objectContaining({ ssl: true }),
      );
    });

    test('should handle different connection strings', () => {
      const differentConnectionString = 'postgresql://admin:secret@prod-server:5432/proddb';

      const client = createRawDb(differentConnectionString);

      expect(client).toBeDefined();
      expect(postgres).toHaveBeenCalledWith(differentConnectionString, expect.any(Object));
    });

    test('should return client with required methods', () => {
      const client = createRawDb(mockConnectionString);

      expect(typeof client.execute).toBe('function');
      expect(typeof client.query).toBe('function');
      expect(typeof client.queryOne).toBe('function');
      expect(typeof client.raw).toBe('function');
      expect(typeof client.transaction).toBe('function');
    });

    test('should handle connection errors gracefully', () => {
      postgresMock.mockImplementation(() => {
        throw new Error('Connection failed');
      });

      expect(() => createRawDb(mockConnectionString)).toThrow('Connection failed');
    });
  });

  describe('DbClient interface', () => {
    // Helper to create a mock and client together
    function createMockedClient(mockUnsafe: Mock) {
      postgresMock.mockImplementation(() => ({
        unsafe: mockUnsafe,
        end: vi.fn().mockResolvedValue(undefined),
        begin: vi
          .fn()
          .mockImplementation(async (_isolation: string, cb: (tx: unknown) => unknown) => {
            const tx = { unsafe: vi.fn().mockResolvedValue([]) };
            return await cb(tx);
          }),
      }));
      return createRawDb(mockConnectionString);
    }

    describe('execute', () => {
      test('should execute a query with parameters', async () => {
        const mockResult = { count: 1 };
        const mockUnsafe = vi.fn().mockResolvedValue(mockResult);
        const dbClient = createMockedClient(mockUnsafe);

        const query = { text: 'SELECT * FROM users WHERE id = $1', values: [1] };
        const result = await dbClient.execute(query);

        expect(result).toEqual(1);
        expect(mockUnsafe).toHaveBeenCalledWith(query.text, query.values);
      });

      test('should handle execute with empty result', async () => {
        const mockUnsafe = vi.fn().mockResolvedValue({ count: 0 });
        const dbClient = createMockedClient(mockUnsafe);

        const query = { text: 'SELECT * FROM users WHERE id = $1', values: [999] };
        const result = await dbClient.execute(query);

        expect(result).toEqual(0);
      });

      test('should handle execute errors', async () => {
        const error = new Error('Query failed');
        const mockUnsafe = vi.fn().mockRejectedValue(error);
        const dbClient = createMockedClient(mockUnsafe);

        const query = { text: 'INVALID SQL', values: [] };

        await expect(dbClient.execute(query)).rejects.toThrow('Query failed');
      });

      test('should handle execute with complex query', async () => {
        const complexResult = { count: 2 };
        const mockUnsafe = vi.fn().mockResolvedValue(complexResult);
        const dbClient = createMockedClient(mockUnsafe);

        const query = {
          text: 'SELECT id, name, created_at, active FROM users WHERE active = $1 ORDER BY created_at DESC LIMIT $2',
          values: [true, 10],
        };
        const result = await dbClient.execute(query);

        expect(result).toEqual(2);
      });
    });

    describe('query', () => {
      test('should execute a select query and return results', async () => {
        const mockResults = [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ];
        const mockUnsafe = vi.fn().mockResolvedValue(mockResults);
        const dbClient = createMockedClient(mockUnsafe);

        const result = await dbClient.query({ text: 'SELECT * FROM users', values: [] });

        expect(result).toEqual(mockResults);
        expect(mockUnsafe).toHaveBeenCalledWith('SELECT * FROM users', []);
      });

      test('should handle query with parameters', async () => {
        const mockResults = [{ id: 1, name: 'Alice' }];
        const mockUnsafe = vi.fn().mockResolvedValue(mockResults);
        const dbClient = createMockedClient(mockUnsafe);

        const result = await dbClient.query({
          text: 'SELECT * FROM users WHERE id = $1',
          values: [1],
        });

        expect(result).toEqual(mockResults);
        expect(mockUnsafe).toHaveBeenCalledWith('SELECT * FROM users WHERE id = $1', [1]);
      });

      test('should handle empty query results', async () => {
        const mockUnsafe = vi.fn().mockResolvedValue([]);
        const dbClient = createMockedClient(mockUnsafe);

        const result = await dbClient.query({
          text: 'SELECT * FROM users WHERE id = $1',
          values: [999],
        });

        expect(result).toEqual([]);
      });

      test('should handle query errors', async () => {
        const error = new Error('Invalid query');
        const mockUnsafe = vi.fn().mockRejectedValue(error);
        const dbClient = createMockedClient(mockUnsafe);

        await expect(dbClient.query({ text: 'INVALID QUERY', values: [] })).rejects.toThrow(
          'Invalid query',
        );
      });

      test('should handle complex query with multiple parameters', async () => {
        const mockResults = [
          { id: 1, name: 'Alice', email: 'alice@example.com', ['created_at']: new Date() },
        ];
        const mockUnsafe = vi.fn().mockResolvedValue(mockResults);
        const dbClient = createMockedClient(mockUnsafe);

        const result = await dbClient.query({
          text: 'SELECT * FROM users WHERE name = $1 AND email LIKE $2 AND created_at > $3',
          values: ['Alice', '%@example.com', '2023-01-01'],
        });

        expect(result).toEqual(mockResults);
      });
    });

    describe('queryOne', () => {
      test('should return first result from query', async () => {
        const mockResults = [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ];
        const mockUnsafe = vi.fn().mockResolvedValue(mockResults);
        const dbClient = createMockedClient(mockUnsafe);

        const result = await dbClient.queryOne({
          text: 'SELECT * FROM users WHERE name = $1',
          values: ['Alice'],
        });

        expect(result).toEqual({ id: 1, name: 'Alice' });
        expect(mockUnsafe).toHaveBeenCalledWith('SELECT * FROM users WHERE name = $1', ['Alice']);
      });

      test('should return null for empty results', async () => {
        const mockUnsafe = vi.fn().mockResolvedValue([]);
        const dbClient = createMockedClient(mockUnsafe);

        const result = await dbClient.queryOne({
          text: 'SELECT * FROM users WHERE id = $1',
          values: [999],
        });

        expect(result).toBeNull();
      });

      test('should handle queryOne errors', async () => {
        const error = new Error('Query failed');
        const mockUnsafe = vi.fn().mockRejectedValue(error);
        const dbClient = createMockedClient(mockUnsafe);

        await expect(dbClient.queryOne({ text: 'INVALID QUERY', values: [] })).rejects.toThrow(
          'Query failed',
        );
      });

      test('should handle queryOne with no parameters', async () => {
        const mockResult = { id: 1, name: 'Alice' };
        const mockUnsafe = vi.fn().mockResolvedValue([mockResult]);
        const dbClient = createMockedClient(mockUnsafe);

        const result = await dbClient.queryOne({ text: 'SELECT * FROM users LIMIT 1', values: [] });

        expect(result).toEqual(mockResult);
      });

      test('should handle queryOne with complex result', async () => {
        const complexResult = {
          id: 1,
          name: 'Alice',
          profile: { bio: 'Software engineer', skills: ['TypeScript', 'React'] },
          settings: { theme: 'dark', notifications: true },
        };
        const mockUnsafe = vi.fn().mockResolvedValue([complexResult]);
        const dbClient = createMockedClient(mockUnsafe);

        const result = await dbClient.queryOne({
          text: 'SELECT * FROM users WHERE id = $1',
          values: [1],
        });

        expect(result).toEqual(complexResult);
      });
    });

    describe('raw', () => {
      test('should execute raw SQL query', async () => {
        const mockResult = [
          { column1: 'value1', column2: 'value2' },
          { column1: 'value3', column2: 'value4' },
        ];
        const mockUnsafe = vi.fn().mockResolvedValue(mockResult);
        const dbClient = createMockedClient(mockUnsafe);

        const result = await dbClient.raw('SELECT column1, column2 FROM some_table');

        expect(result).toEqual(mockResult);
        expect(mockUnsafe).toHaveBeenCalledWith('SELECT column1, column2 FROM some_table', []);
      });

      test('should handle raw query with parameters', async () => {
        const mockResult = [{ id: 1, name: 'Test' }];
        const mockUnsafe = vi.fn().mockResolvedValue(mockResult);
        const dbClient = createMockedClient(mockUnsafe);

        const result = await dbClient.raw('SELECT * FROM users WHERE id = $1', [1]);

        expect(result).toEqual(mockResult);
        expect(mockUnsafe).toHaveBeenCalledWith('SELECT * FROM users WHERE id = $1', [1]);
      });

      test('should handle raw query with no results', async () => {
        const mockUnsafe = vi.fn().mockResolvedValue([]);
        const dbClient = createMockedClient(mockUnsafe);

        const result = await dbClient.raw('SELECT * FROM empty_table');

        expect(result).toEqual([]);
      });

      test('should handle raw query errors', async () => {
        const error = new Error('Raw query failed');
        const mockUnsafe = vi.fn().mockRejectedValue(error);
        const dbClient = createMockedClient(mockUnsafe);

        await expect(dbClient.raw('INVALID RAW QUERY')).rejects.toThrow('Raw query failed');
      });

      test('should handle raw query with complex SQL', async () => {
        const mockResult = [{ ['user_id']: 1, ['total_orders']: 5, ['avg_amount']: 99.99 }];
        const mockUnsafe = vi.fn().mockResolvedValue(mockResult);
        const dbClient = createMockedClient(mockUnsafe);

        const sql = `
          SELECT
            u.id as user_id,
            COUNT(o.id) as total_orders,
            AVG(o.amount) as avg_amount
          FROM users u
          LEFT JOIN orders o ON u.id = o.user_id
          WHERE u.active = true
          GROUP BY u.id
          HAVING COUNT(o.id) > 0
          ORDER BY avg_amount DESC
        `;

        const result = await dbClient.raw(sql);

        expect(result).toEqual(mockResult);
      });
    });

    describe('transaction support', () => {
      test('should support transaction blocks', async () => {
        const beginSpy = vi
          .fn()
          .mockImplementation(async (_isolation: string, cb: (tx: Tx) => unknown) => {
            const tx = { unsafe: vi.fn().mockResolvedValue([]) };
            return await cb(tx);
          });

        postgresMock.mockImplementation(() => ({
          unsafe: vi.fn().mockResolvedValue([]),
          end: vi.fn().mockResolvedValue(undefined),
          begin: beginSpy,
        }));

        const client = createRawDb(mockConnectionString);
        const result = await client.transaction(() => Promise.resolve('committed'));

        expect(result).toBe('committed');
        expect(beginSpy).toHaveBeenCalledWith(
          'isolation level read committed',
          expect.any(Function),
        );
      });

      test('should apply transaction options', async () => {
        const txUnsafe = vi.fn().mockResolvedValue([]);
        const beginSpy = vi
          .fn()
          .mockImplementation(async (_isolation: string, cb: (tx: Tx) => unknown) => {
            const tx = { unsafe: txUnsafe };
            return await cb(tx);
          });

        postgresMock.mockImplementation(() => ({
          unsafe: vi.fn().mockResolvedValue([]),
          end: vi.fn().mockResolvedValue(undefined),
          begin: beginSpy,
        }));

        const client = createRawDb(mockConnectionString);
        await client.transaction(() => Promise.resolve('ok'), { readOnly: true, deferrable: true });

        expect(txUnsafe).toHaveBeenCalledWith('SET TRANSACTION READ ONLY DEFERRABLE');
      });

      test('should fall back to savepoint when begin is unavailable', async () => {
        const savepointSpy = vi
          .fn()
          .mockImplementation(async (cb: (tx: { unsafe: () => Promise<unknown[]> }) => unknown) => {
            const tx = { unsafe: vi.fn().mockResolvedValue([]) };
            return await cb(tx);
          });

        postgresMock.mockImplementation(() => ({
          unsafe: vi.fn().mockResolvedValue([]),
          end: vi.fn().mockResolvedValue(undefined),
          savepoint: savepointSpy,
        }));

        const client = createRawDb(mockConnectionString);
        const result = await client.transaction(() => Promise.resolve('nested'));

        expect(result).toBe('nested');
        expect(savepointSpy).toHaveBeenCalled();
      });
    });

    describe('transaction retry', () => {
      const pgError = (code: string): Error => Object.assign(new Error(`pg ${code}`), { code });
      const noWait = { baseDelayMs: 0, maxDelayMs: 0 };

      /** A pool whose `begin` fails with `failures` in order, then runs the callback. */
      const poolFailing = (failures: unknown[]): { begin: Mock } => {
        const remaining = [...failures];
        const begin = vi
          .fn()
          .mockImplementation(async (_isolation: string, cb: (tx: Tx) => unknown) => {
            const failure = remaining.shift();
            // The callback runs first: the failure is raised by a statement or by COMMIT.
            const result = await cb({ unsafe: vi.fn().mockResolvedValue([]) });
            if (failure !== undefined) throw failure;
            return result;
          });
        postgresMock.mockImplementation(() => ({
          unsafe: vi.fn().mockResolvedValue([]),
          end: vi.fn().mockResolvedValue(undefined),
          begin,
        }));
        return { begin };
      };

      test.each(['40001', '40P01'])(
        'runs the whole transaction again after SQLSTATE %s',
        async (code) => {
          const { begin } = poolFailing([pgError(code)]);
          const callback = vi.fn().mockResolvedValue('done');

          const client = createRawDb({
            connectionString: mockConnectionString,
            transactionRetry: noWait,
          });
          const result = await client.transaction(callback);

          expect(result).toBe('done');
          expect(begin).toHaveBeenCalledTimes(2);
          expect(callback).toHaveBeenCalledTimes(2);
        },
      );

      test('recognises the failure when the callback wrapped it as a cause', async () => {
        const wrapped = new Error('could not save', { cause: pgError('40001') });
        const { begin } = poolFailing([wrapped]);

        const client = createRawDb({
          connectionString: mockConnectionString,
          transactionRetry: noWait,
        });
        await client.transaction(() => Promise.resolve('ok'));

        expect(begin).toHaveBeenCalledTimes(2);
      });

      test('gives up after maxAttempts and rejects with the last failure', async () => {
        const last = pgError('40001');
        const { begin } = poolFailing([pgError('40001'), pgError('40P01'), last, pgError('40001')]);

        const client = createRawDb({
          connectionString: mockConnectionString,
          transactionRetry: noWait,
        });

        await expect(client.transaction(() => Promise.resolve('never'))).rejects.toBe(last);
        expect(begin).toHaveBeenCalledTimes(DEFAULT_TRANSACTION_RETRY.maxAttempts);
      });

      test('does not retry any other failure', async () => {
        const unique = pgError('23505');
        const { begin } = poolFailing([unique]);

        const client = createRawDb({
          connectionString: mockConnectionString,
          transactionRetry: noWait,
        });

        await expect(client.transaction(() => Promise.resolve('x'))).rejects.toBe(unique);
        expect(begin).toHaveBeenCalledTimes(1);
      });

      test('retry: false on the call turns it off', async () => {
        const failure = pgError('40001');
        const { begin } = poolFailing([failure]);

        const client = createRawDb({
          connectionString: mockConnectionString,
          transactionRetry: noWait,
        });

        await expect(client.transaction(() => Promise.resolve('x'), { retry: false })).rejects.toBe(
          failure,
        );
        expect(begin).toHaveBeenCalledTimes(1);
      });

      test('transactionRetry: false on the pool turns it off, and a call can turn it on', async () => {
        const failure = pgError('40P01');
        const { begin } = poolFailing([failure, pgError('40P01')]);

        const client = createRawDb({
          connectionString: mockConnectionString,
          transactionRetry: false,
        });

        await expect(client.transaction(() => Promise.resolve('x'))).rejects.toBe(failure);
        expect(begin).toHaveBeenCalledTimes(1);

        const result = await client.transaction(() => Promise.resolve('y'), {
          retry: { maxAttempts: 2, ...noWait },
        });
        expect(result).toBe('y');
        expect(begin).toHaveBeenCalledTimes(3);
      });

      test('reports each retry and waits the computed delay', async () => {
        const failure = pgError('40001');
        poolFailing([failure]);
        const onRetry = vi.fn();

        const client = createRawDb({
          connectionString: mockConnectionString,
          transactionRetry: { baseDelayMs: 1, maxDelayMs: 1, onRetry },
        });
        await client.transaction(() => Promise.resolve('ok'));

        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(onRetry).toHaveBeenCalledWith({
          attempt: 1,
          maxAttempts: DEFAULT_TRANSACTION_RETRY.maxAttempts,
          delayMs: expect.any(Number) as number,
          error: failure,
        });
      });

      test('a nested transaction (savepoint) is not retried on its own', async () => {
        const failure = pgError('40001');
        const savepoint = vi.fn().mockRejectedValue(failure);
        const callbackRuns = vi.fn();
        const begin = vi
          .fn()
          .mockImplementation(async (_isolation: string, cb: (tx: unknown) => unknown) => {
            return await cb({ unsafe: vi.fn().mockResolvedValue([]), savepoint });
          });
        postgresMock.mockImplementation(() => ({
          unsafe: vi.fn().mockResolvedValue([]),
          end: vi.fn().mockResolvedValue(undefined),
          begin,
        }));

        const client = createRawDb({
          connectionString: mockConnectionString,
          transactionRetry: { maxAttempts: 2, ...noWait },
        });

        await expect(
          client.transaction(async (tx) => {
            callbackRuns();
            // The failure aborts the outer transaction: only the outer one can run again.
            return await tx.transaction(() => Promise.resolve('inner'));
          }),
        ).rejects.toBe(failure);

        // One savepoint per run of the outer callback: the inner call never looped.
        expect(callbackRuns).toHaveBeenCalledTimes(2);
        expect(savepoint).toHaveBeenCalledTimes(2);
        expect(begin).toHaveBeenCalledTimes(2);
      });

      test('a nested transaction keeps the mode of the one around it', async () => {
        const savepoint = vi
          .fn()
          .mockImplementation(async (cb: (tx: unknown) => unknown) =>
            cb({ unsafe: vi.fn().mockResolvedValue([]) }),
          );
        // The driver gives a transaction scope both begin() and savepoint().
        const nestedBegin = vi.fn();
        const begin = vi
          .fn()
          .mockImplementation(async (_isolation: string, cb: (tx: unknown) => unknown) => {
            return await cb({
              unsafe: vi.fn().mockResolvedValue([]),
              savepoint,
              begin: nestedBegin,
            });
          });
        postgresMock.mockImplementation(() => ({
          unsafe: vi.fn().mockResolvedValue([]),
          end: vi.fn().mockResolvedValue(undefined),
          begin,
        }));
        const client = createRawDb(mockConnectionString);

        const same = await client.transaction(
          (tx) =>
            tx.transaction(() => Promise.resolve('inner'), { isolationLevel: 'serializable' }),
          { isolationLevel: 'serializable' },
        );
        expect(same).toBe('inner');
        expect(savepoint).toHaveBeenCalledTimes(1);
        expect(nestedBegin).not.toHaveBeenCalled();

        await expect(
          client.transaction((tx) =>
            tx.transaction(() => Promise.resolve('inner'), {
              isolationLevel: 'serializable',
              readOnly: true,
            }),
          ),
        ).rejects.toThrow(
          'A nested transaction is a savepoint of the transaction around it and cannot change its isolationLevel, readOnly',
        );
        expect(savepoint).toHaveBeenCalledTimes(1);
      });

      test('a session client inside a transaction is not retried on its own either', async () => {
        const failure = pgError('40P01');
        const savepoint = vi.fn().mockRejectedValue(failure);
        const begin = vi
          .fn()
          .mockImplementation(async (_isolation: string, cb: (tx: unknown) => unknown) => {
            return await cb({ unsafe: vi.fn().mockResolvedValue([]), savepoint });
          });
        postgresMock.mockImplementation(() => ({
          unsafe: vi.fn().mockResolvedValue([]),
          end: vi.fn().mockResolvedValue(undefined),
          begin,
        }));

        const client = createRawDb({
          connectionString: mockConnectionString,
          transactionRetry: false,
        });

        await expect(
          client.transaction((tx) =>
            tx.withSession({ orgId: 't1' }).transaction(() => Promise.resolve('inner'), {
              retry: { maxAttempts: 5, ...noWait },
            }),
          ),
        ).rejects.toBe(failure);
        expect(savepoint).toHaveBeenCalledTimes(1);
      });
    });

    describe('isRetryableTransactionError', () => {
      test('is true for serialization_failure and deadlock_detected only', () => {
        expect(isRetryableTransactionError({ code: '40001' })).toBe(true);
        expect(isRetryableTransactionError({ code: '40P01' })).toBe(true);
        expect(isRetryableTransactionError({ code: '40002' })).toBe(false);
        expect(isRetryableTransactionError({ code: '57014' })).toBe(false);
        expect(isRetryableTransactionError(new Error('40001'))).toBe(false);
        expect(isRetryableTransactionError(null)).toBe(false);
        expect(isRetryableTransactionError('40001')).toBe(false);
      });

      test('follows the cause chain, and stops on a cycle', () => {
        const cycle: { cause?: unknown } = {};
        cycle.cause = cycle;

        expect(isRetryableTransactionError({ cause: { cause: { code: '40P01' } } })).toBe(true);
        expect(isRetryableTransactionError(cycle)).toBe(false);
      });
    });

    describe('transactionRetryDelay', () => {
      const policy = { maxAttempts: 5, baseDelayMs: 20, maxDelayMs: 100 };

      test('doubles per attempt and is capped at maxDelayMs', () => {
        const top = (): number => 1;

        expect(transactionRetryDelay(1, policy, top)).toBe(20);
        expect(transactionRetryDelay(2, policy, top)).toBe(40);
        expect(transactionRetryDelay(3, policy, top)).toBe(80);
        expect(transactionRetryDelay(4, policy, top)).toBe(100);
        expect(transactionRetryDelay(30, policy, top)).toBe(100);
      });

      test('jitters down to half the step, never below', () => {
        expect(transactionRetryDelay(2, policy, () => 0)).toBe(20);
        expect(transactionRetryDelay(2, policy, () => 0.5)).toBe(30);
      });
    });

    describe('timeouts', () => {
      const timeouts = {
        statementTimeoutMs: 30_000,
        lockTimeoutMs: 10_000,
        idleInTransactionTimeoutMs: 60_000,
      };
      const LIMITS_SQL =
        "SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $2, true), set_config('idle_in_transaction_session_timeout', $3, true)";
      const LIMITS_VALUES = ['30000', '10000', '60000'];

      /** A pool whose statements and scopes are recorded in the order they are made. */
      const recordingPool = (
        rows: unknown = [],
      ): { log: string[]; batch: Mock; unsafe: Mock; begin: Mock } => {
        const log: string[] = [];
        const scope = (name: string): Record<string, unknown> => ({
          unsafe: vi.fn().mockImplementation((text: string) => {
            log.push(`${name}: ${text}`);
            return Promise.resolve(rows);
          }),
          savepoint: vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => {
            log.push(`${name}: SAVEPOINT`);
            return await cb(scope(`${name}/savepoint`));
          }),
        });
        const unsafe = vi.fn().mockImplementation((text: string, values: unknown[]) => ({
          text,
          values,
        }));
        // The driver resolves a batch with the results of its queries, in order.
        const batch = vi.fn().mockImplementation((queries: Array<{ text: string }>) => {
          log.push(`batch: ${queries.map((query) => query.text).join(' | ')}`);
          return Promise.resolve([[], rows]);
        });
        type Callback = (tx: unknown) => unknown;
        // begin(mode, cb), or begin(cb) as the session wrapper calls it.
        const begin = vi.fn().mockImplementation(async (mode: string | Callback, cb?: Callback) => {
          log.push(typeof mode === 'string' ? `BEGIN ${mode}` : 'BEGIN');
          const callback = typeof mode === 'string' ? cb : mode;
          return await callback?.(scope('tx'));
        });
        postgresMock.mockImplementation(() => ({
          unsafe,
          batch,
          begin,
          end: vi.fn().mockResolvedValue(undefined),
        }));
        return { log, batch, unsafe, begin };
      };

      test('timeoutSettingsQuery binds each limit to its setting, local to the transaction', () => {
        expect(timeoutSettingsQuery(timeouts)).toEqual({ text: LIMITS_SQL, values: LIMITS_VALUES });
        expect(timeoutSettingsQuery({ lockTimeoutMs: 0 })).toEqual({
          text: "SELECT set_config('lock_timeout', $1, true)",
          values: ['0'],
        });
      });

      test('timeoutSettingsQuery is undefined when no limit is set', () => {
        expect(timeoutSettingsQuery(undefined)).toBeUndefined();
        expect(timeoutSettingsQuery({})).toBeUndefined();
      });

      test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
        'a limit of %s is refused before the pool is created',
        (ms) => {
          expect(() =>
            createRawDb({
              connectionString: mockConnectionString,
              timeouts: { statementTimeoutMs: ms },
            }),
          ).toThrow(
            'Database timeout statementTimeoutMs must be a whole number of milliseconds, 0 or more',
          );
          expect(postgres).not.toHaveBeenCalled();
        },
      );

      test('a pool without timeouts sends nothing but the statement (the migration owner connection)', async () => {
        const { log, batch } = recordingPool();
        const client = createRawDb({ connectionString: mockConnectionString, maxConnections: 1 });

        await client.raw('CREATE INDEX slow ON big (x)');
        await client.transaction((tx) => tx.raw('ALTER TABLE big ADD COLUMN y int'));

        expect(batch).not.toHaveBeenCalled();
        expect(log).toEqual([
          'BEGIN isolation level read committed',
          'tx: ALTER TABLE big ADD COLUMN y int',
        ]);
      });

      test('a single statement travels in one batch with its limits', async () => {
        const rows = Object.assign([{ id: 1 }], { count: 1 });
        const { log, batch, unsafe } = recordingPool(rows);
        const client = createRawDb({ connectionString: mockConnectionString, timeouts });
        const query = { text: 'UPDATE users SET name = $1', values: ['Ada'] };

        // The second result of the batch: the statement's, not the limits'.
        expect(await client.query(query)).toBe(rows);
        expect(await client.queryOne(query)).toEqual({ id: 1 });
        expect(await client.execute(query)).toBe(1);
        expect(await client.raw('SELECT 1')).toBe(rows);

        expect(batch).toHaveBeenCalledTimes(4);
        expect(unsafe).toHaveBeenNthCalledWith(1, LIMITS_SQL, LIMITS_VALUES);
        expect(unsafe).toHaveBeenNthCalledWith(2, query.text, query.values);
        expect(log[0]).toBe(`batch: ${LIMITS_SQL} | ${query.text}`);
        expect(log[3]).toBe(`batch: ${LIMITS_SQL} | SELECT 1`);
      });

      test('a transaction sets its limits once, after its mode, and its statements run plain', async () => {
        const { log, batch } = recordingPool();
        const client = createRawDb({ connectionString: mockConnectionString, timeouts });

        await client.transaction(
          async (tx) => {
            await tx.raw('SELECT 1');
            await tx.transaction((inner) => inner.raw('SELECT 2'));
          },
          { isolationLevel: 'serializable', readOnly: true },
        );

        expect(batch).not.toHaveBeenCalled();
        expect(log).toEqual([
          'BEGIN isolation level serializable',
          'tx: SET TRANSACTION READ ONLY',
          `tx: ${LIMITS_SQL}`,
          'tx: SELECT 1',
          'tx: SAVEPOINT',
          'tx/savepoint: SELECT 2',
        ]);
      });

      test('a session statement travels in one batch with ONE statement for its session and the limits', async () => {
        const { log, batch, unsafe, begin } = recordingPool();
        const client = createRawDb({ connectionString: mockConnectionString, timeouts });

        await client.withSession({ orgId: 't1' }).raw('SELECT 1');

        const settings =
          "SELECT set_config('app.org_id', $1, true), set_config('statement_timeout', $2, true), set_config('lock_timeout', $3, true), set_config('idle_in_transaction_session_timeout', $4, true)";
        expect(begin).not.toHaveBeenCalled();
        expect(batch).toHaveBeenCalledTimes(1);
        expect(log).toEqual([`batch: ${settings} | SELECT 1`]);
        expect(unsafe).toHaveBeenNthCalledWith(1, settings, ['t1', ...LIMITS_VALUES]);
      });

      test('QueryOptions.timeout gives the statement its own deadline', async () => {
        const signal = vi.fn().mockImplementation(function (this: unknown) {
          return this;
        });
        const pending = Object.assign(Promise.resolve(Object.assign([], { count: 0 })), { signal });
        const unsafe = vi.fn().mockReturnValue(pending);
        postgresMock.mockImplementation(() => ({
          unsafe,
          end: vi.fn().mockResolvedValue(undefined),
        }));
        const client = createRawDb(mockConnectionString);
        const query = { text: 'SELECT 1', values: [] };

        await client.query(query);
        await client.execute(query, { timeout: 0 });
        expect(signal).not.toHaveBeenCalled();

        await client.query(query, { timeout: 250 });
        await client.queryOne(query, { timeout: 250 });
        await client.execute(query, { timeout: 250 });

        expect(signal).toHaveBeenCalledTimes(3);
        expect(signal.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
      });
    });

    describe('connection management', () => {
      test('should handle client closing', async () => {
        const mockClose = vi.fn().mockResolvedValue(undefined);
        postgresMock.mockImplementation(() => ({
          unsafe: vi.fn().mockResolvedValue([]),
          end: mockClose,
          begin: vi.fn(),
        }));

        const client = createRawDb(mockConnectionString);
        await client.close();
        expect(mockClose).toHaveBeenCalled();
      });
    });

    describe('health checks', () => {
      test('should handle health check queries', async () => {
        const healthResult = [{ ok: 1 }];
        const mockUnsafe = vi.fn().mockResolvedValue(healthResult);
        postgresMock.mockImplementation(() => ({
          unsafe: mockUnsafe,
          end: vi.fn().mockResolvedValue(undefined),
          begin: vi
            .fn()
            .mockImplementation(
              async (_isolation: string, cb: (tx: Tx) => unknown) => await cb({ unsafe: vi.fn() }),
            ),
        }));

        const dbClient = createRawDb(mockConnectionString);
        const result = await dbClient.query({ text: 'SELECT 1 as health_check', values: [] });

        expect(result).toEqual(healthResult);
        expect(Array.isArray(result)).toBe(true);
        if (result.length > 0) {
          expect(result[0]).toHaveProperty('ok');
        }
      });

      test('should handle ping-style queries', async () => {
        const pingResult = [{ now: new Date() }];
        const mockUnsafe = vi.fn().mockResolvedValue(pingResult);
        postgresMock.mockImplementation(() => ({
          unsafe: mockUnsafe,
          end: vi.fn().mockResolvedValue(undefined),
          begin: vi
            .fn()
            .mockImplementation(
              async (_isolation: string, cb: (tx: Tx) => unknown) => await cb({ unsafe: vi.fn() }),
            ),
        }));

        const dbClient = createRawDb(mockConnectionString);
        const result = await dbClient.query({ text: 'SELECT NOW() as now', values: [] });

        expect(result).toEqual(pingResult);
        expect(result[0]).toHaveProperty('now');
      });
    });

    describe('concurrent operations', () => {
      test('should handle multiple concurrent queries', async () => {
        const mockResults = [
          { id: 1, name: 'User 1' },
          { id: 2, name: 'User 2' },
          { id: 3, name: 'User 3' },
        ];

        const mockUnsafe = vi.fn().mockImplementation((sql: string) => {
          if (sql.includes('WHERE id = 1')) return Promise.resolve([mockResults[0]]);
          if (sql.includes('WHERE id = 2')) return Promise.resolve([mockResults[1]]);
          return Promise.resolve([mockResults[2]]);
        });

        postgresMock.mockImplementation(() => ({
          unsafe: mockUnsafe,
          end: vi.fn(),
          begin: vi.fn(),
        }));

        const dbClient = createRawDb(mockConnectionString);
        const [result1, result2, result3] = await Promise.all([
          dbClient.query({ text: 'SELECT * FROM users WHERE id = 1', values: [] }),
          dbClient.query({ text: 'SELECT * FROM users WHERE id = 2', values: [] }),
          dbClient.query({ text: 'SELECT * FROM users WHERE id = 3', values: [] }),
        ]);

        expect(result1).toEqual([mockResults[0]]);
        expect(result2).toEqual([mockResults[1]]);
        expect(result3).toEqual([mockResults[2]]);
      });

      test('should handle concurrent execute operations', async () => {
        const mockExecuteResult = { count: 1 };
        const mockUnsafe = vi.fn().mockResolvedValue(mockExecuteResult);
        postgresMock.mockImplementation(() => ({
          unsafe: mockUnsafe,
          end: vi.fn(),
          begin: vi.fn(),
        }));

        const dbClient = createRawDb(mockConnectionString);
        const queries = [
          { text: 'UPDATE users SET name = $1 WHERE id = $2', values: ['New Name 1', 1] },
          { text: 'UPDATE users SET name = $1 WHERE id = $2', values: ['New Name 2', 2] },
          { text: 'UPDATE users SET name = $1 WHERE id = $2', values: ['New Name 3', 3] },
        ];

        const results = await Promise.all(queries.map((query) => dbClient.execute(query)));

        expect(results).toHaveLength(3);
        expect(results.every((r) => r === 1)).toBe(true);
      });
    });

    describe('error handling', () => {
      test('should handle connection errors', () => {
        const connectionError = new Error('Connection refused');
        postgresMock.mockImplementation(() => {
          throw connectionError;
        });

        expect(() => createRawDb('invalid://connection')).toThrow('Connection refused');
      });

      test('should handle query syntax errors', async () => {
        const syntaxError = new Error('Syntax error in SQL');
        const mockUnsafe = vi.fn().mockRejectedValue(syntaxError);
        postgresMock.mockImplementation(() => ({
          unsafe: mockUnsafe,
          end: vi.fn(),
          begin: vi.fn(),
        }));

        const dbClient = createRawDb(mockConnectionString);
        await expect(dbClient.query({ text: 'INVALID SQL SYNTAX', values: [] })).rejects.toThrow(
          'Syntax error in SQL',
        );
      });

      test('should handle constraint violation errors', async () => {
        const constraintError = new Error('Unique constraint violation');
        const mockUnsafe = vi.fn().mockRejectedValue(constraintError);
        postgresMock.mockImplementation(() => ({
          unsafe: mockUnsafe,
          end: vi.fn(),
          begin: vi.fn(),
        }));

        const dbClient = createRawDb(mockConnectionString);
        await expect(
          dbClient.execute({
            text: 'INSERT INTO users (email) VALUES ($1)',
            values: ['duplicate@example.com'],
          }),
        ).rejects.toThrow('Unique constraint violation');
      });
    });
  });

  describe('configuration options', () => {
    test('should accept custom configuration options', () => {
      const client = createRawDb({
        connectionString: mockConnectionString,
        maxConnections: 20,
        idleTimeout: 60000,
        connectTimeout: 20000,
      });

      // Verify that the client was created with expected defaults
      expect(client).toBeDefined();
    });

    test('createDbClient should accept full runtime configuration', () => {
      const originalNodeEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'production';

      try {
        const client = createDbClient({
          connectionString: mockConnectionString,
          maxConnections: 5,
          ssl: true,
        });

        expect(client).toBeDefined();
        expect(postgres).toHaveBeenCalledWith(
          mockConnectionString,
          expect.objectContaining({ max: 5, ssl: true }),
        );
      } finally {
        process.env['NODE_ENV'] = originalNodeEnv;
      }
    });

    test('createDbClient keeps one pool per connection string (app and worker never share)', () => {
      const originalNodeEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'development';

      try {
        const app = createDbClient('postgresql://bslt_app:a@localhost:5432/pool_split_db');
        const worker = createDbClient('postgresql://bslt_worker:w@localhost:5432/pool_split_db');
        const appAgain = createDbClient('postgresql://bslt_app:a@localhost:5432/pool_split_db');

        expect(worker).not.toBe(app);
        expect(appAgain).toBe(app);
      } finally {
        process.env['NODE_ENV'] = originalNodeEnv;
      }
    });

    test('createDbClient evicts a closed pool so a subsequent call opens a fresh one', async () => {
      const originalNodeEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'test';

      try {
        const dsn = 'postgresql://bslt_app:a@localhost:5432/pool_evict_after_close_db';
        const first = createDbClient(dsn);
        expect(createDbClient(dsn)).toBe(first);

        await first.close();

        const reopened = createDbClient(dsn);
        expect(reopened).not.toBe(first);
      } finally {
        process.env['NODE_ENV'] = originalNodeEnv;
      }
    });
  });
});

describe('role-specific connection strings', () => {
  const app = 'postgresql://bslt_app:a@db:5432/app';
  const owner = 'postgresql://bslt_owner:o@db:5432/app';
  const worker = 'postgresql://bslt_worker:w@db:5432/app';

  test('migrations use MIGRATION_DATABASE_URL (the owner role) when set', () => {
    expect(
      buildMigrationConnectionString({
        NODE_ENV: 'production',
        DATABASE_URL: app,
        MIGRATION_DATABASE_URL: owner,
      }),
    ).toBe(owner);
  });

  test('system work uses WORKER_DATABASE_URL (the worker role) when set', () => {
    expect(
      buildWorkerConnectionString({
        NODE_ENV: 'production',
        DATABASE_URL: app,
        WORKER_DATABASE_URL: worker,
      }),
    ).toBe(worker);
  });

  test.each(['development', 'test', undefined])(
    'falls back to the single legacy connection in NODE_ENV=%s',
    (nodeEnv) => {
      const env = { NODE_ENV: nodeEnv, DATABASE_URL: app };
      expect(buildMigrationConnectionString(env)).toBe(app);
      expect(buildWorkerConnectionString(env)).toBe(app);
    },
  );

  test('production refuses to migrate through the app connection', () => {
    expect(() =>
      buildMigrationConnectionString({ NODE_ENV: 'production', DATABASE_URL: app }),
    ).toThrow(/MIGRATION_DATABASE_URL is required in production/);
  });

  test('production refuses to run system work through the app connection', () => {
    expect(() =>
      buildWorkerConnectionString({
        NODE_ENV: 'production',
        DATABASE_URL: app,
        WORKER_DATABASE_URL: '',
      }),
    ).toThrow(/WORKER_DATABASE_URL is required in production/);
  });

  test('the production error never echoes a connection string', () => {
    const error = (() => {
      try {
        buildMigrationConnectionString({ NODE_ENV: 'production', DATABASE_URL: app });
        return '';
      } catch (e) {
        return String(e);
      }
    })();
    expect(error).not.toContain('bslt_app:a@');
  });
});
