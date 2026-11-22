// main/kernel/protocols/src/pg.ts
/**
 * Owned PostgreSQL wire protocol v3.0 driver and connection pool over `node:net`
 * and `node:tls` (`@bslt/protocols/pg`, Restructure Plan §13 C3).
 *
 * Capabilities:
 * - DSN / URL parsing (`postgres://` & `postgresql://`) and `SSLRequest` TLS upgrade.
 * - `StartupMessage` with `AuthenticationOk`, cleartext, MD5, and mutual
 *   `SCRAM-SHA-256` (`SASLInitialResponse` / `SASLContinue` / `SASLFinal`).
 * - Simple Query (`Q`) for zero-parameter & multi-statement DDL scripts.
 * - Extended Query (`Parse` / `Bind` / `Describe` / `Execute` / `Sync`) and
 *   pipelined `batch()` within a single `Sync` implicit transaction.
 * - Wire `CancelRequest` (`80877102` + backend PID + secret key) on `AbortSignal`.
 * - Connection pool with `connect_timeout` (`CONNECT_TIMEOUT`), `idle_timeout`,
 *   transaction rollback recovery, `begin()` + `savepoint()`, and dedicated
 *   asynchronous `LISTEN` / `NOTIFY`.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { connect as connectTcp, type Socket } from 'node:net';
import { connect as connectTls, type TLSSocket } from 'node:tls';

// ============================================================================
// Public Types
// ============================================================================

interface PgCustomType {
  readonly to: number;
  readonly from: readonly number[];
  readonly serialize: (value: never) => string;
  readonly parse: (text: string) => unknown;
}

export interface PgOptions {
  /** Maximum pooled connections (default: 10). */
  readonly max?: number | undefined;
  /** Idle connection timeout in seconds (`0` disables expiry; default: 30). */
  readonly idle_timeout?: number | undefined;
  /** Connection + startup handshake timeout in seconds (default: 10). */
  readonly connect_timeout?: number | undefined;
  /** TLS mode (`false`, `true`, `'require'`, `'prefer'`). */
  readonly ssl?: boolean | 'require' | 'prefer' | undefined;
  /** Custom OID serializers/parsers (e.g. `int8 -> bigint`). */
  readonly types?: Readonly<Record<string, PgCustomType>> | undefined;
  /** Wire statement hook `(connectionId, query, parameters)`. */
  readonly debug?:
    ((connectionId: number, query: string, parameters: readonly unknown[]) => void) | undefined;
  /** Fired when a connection closes unexpectedly (not via `.end()`). */
  readonly onclose?: (() => void) | undefined;
}

type PgResult<TRow> = TRow extends readonly (infer U)[]
  ? U[] & { readonly count: number }
  : TRow[] & { readonly count: number };

export interface PgPendingQuery<TRow = Record<string, unknown>[]> extends PromiseLike<
  PgResult<TRow>
> {
  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<PgResult<TRow> | TResult>;
  finally(onfinally?: (() => void) | null): Promise<PgResult<TRow>>;
  signal(abortSignal: AbortSignal): PgPendingQuery<TRow>;
}

interface PgCommonSql {
  <TRow = Record<string, unknown>[]>(
    strings: TemplateStringsArray,
    ...values: readonly unknown[]
  ): PgPendingQuery<TRow>;
  unsafe<TRow = Record<string, unknown>[]>(
    text: string,
    values?: readonly unknown[],
  ): PgPendingQuery<TRow>;
}

export interface PgTransactionSql extends PgCommonSql {
  savepoint<T>(callback: (tx: PgTransactionSql) => Promise<T>): Promise<T>;
}

export interface PgSql extends PgCommonSql {
  batch<T extends readonly PgPendingQuery<unknown>[]>(
    queries: [...T],
  ): Promise<{ [K in keyof T]: T[K] extends PgPendingQuery<infer R> ? PgResult<R> : never }>;
  begin<T>(callback: (tx: PgTransactionSql) => Promise<T>): Promise<T>;
  begin<T>(options: string, callback: (tx: PgTransactionSql) => Promise<T>): Promise<T>;
  listen(
    channel: string,
    onNotify: (payload: string) => void,
  ): Promise<{ readonly unlisten: () => Promise<void> }>;
  notify(channel: string, payload: string): Promise<void>;
  end(options?: { readonly timeout?: number }): Promise<void>;
}

// ============================================================================
// Constants & OID Tables
// ============================================================================

const PG_PROTOCOL_V3 = 0x00030000;
const PG_SSL_REQUEST_CODE = 80877103; // 0x04d2162f
const PG_CANCEL_REQUEST_CODE = 80877102; // 0x04d2162e
const MAX_PARAM_OID_CACHE = 256;

const OID_BOOL = 16;
const OID_BYTEA = 17;
const OID_INT8 = 20;
const OID_INT2 = 21;
const OID_INT4 = 23;
const OID_TEXT = 25;
const OID_OID = 26;
const OID_JSON = 114;
const OID_FLOAT4 = 700;
const OID_FLOAT8 = 701;
const OID_DATE = 1082;
const OID_TIMESTAMP = 1114;
const OID_TIMESTAMPTZ = 1184;
const OID_NUMERIC = 1700;
const OID_JSONB = 3802;

/** Maps PostgreSQL 1D/ND array OIDs to their scalar element OIDs. */
const ARRAY_ELEMENT_OIDS: ReadonlyMap<number, number> = new Map<number, number>([
  [1000, OID_BOOL], // _bool
  [1001, OID_BYTEA], // _bytea
  [1002, 18], // _char
  [1003, 19], // _name
  [1005, OID_INT2], // _int2
  [1007, OID_INT4], // _int4
  [1009, OID_TEXT], // _text
  [1014, 1042], // _bpchar
  [1015, 1043], // _varchar
  [1016, OID_INT8], // _int8
  [1021, OID_FLOAT4], // _float4
  [1022, OID_FLOAT8], // _float8
  [1028, OID_OID], // _oid
  [1182, OID_DATE], // _date
  [1115, OID_TIMESTAMP], // _timestamp
  [1185, OID_TIMESTAMPTZ], // _timestamptz
  [1231, OID_NUMERIC], // _numeric
  [2951, 2950], // _uuid
  [199, OID_JSON], // _json
  [3807, OID_JSONB], // _jsonb
]);

// ============================================================================
// DSN Parser & Error Helpers
// ============================================================================

type ResolvedSslMode = 'disable' | 'prefer' | 'require' | 'verify-full';

interface ParsedDsn {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly sslMode: ResolvedSslMode;
}

function parseConnectionString(connectionString: string, sslOption: PgOptions['ssl']): ParsedDsn {
  if (connectionString.trim() === '') {
    throw new TypeError('PostgreSQL connection string must not be empty');
  }
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new TypeError('Invalid PostgreSQL connection string URL');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new TypeError(`Unsupported PostgreSQL connection protocol scheme: ${parsed.protocol}`);
  }

  const rawHost = parsed.searchParams.get('host') ?? parsed.hostname;
  const host =
    rawHost.startsWith('[') && rawHost.endsWith(']')
      ? rawHost.slice(1, -1)
      : rawHost || 'localhost';
  const port = parsed.port !== '' ? Number.parseInt(parsed.port, 10) : 5432;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new TypeError(`Invalid PostgreSQL port: ${parsed.port}`);
  }

  const user = parsed.username !== '' ? decodeURIComponent(parsed.username) : 'postgres';
  const password = parsed.password !== '' ? decodeURIComponent(parsed.password) : '';
  const pathDb = decodeURIComponent(parsed.pathname.replace(/^\/+/u, ''));
  const database = pathDb !== '' ? pathDb : user;

  let sslMode: ResolvedSslMode = 'disable';
  if (sslOption === false) {
    sslMode = 'disable';
  } else if (sslOption === true || sslOption === 'require') {
    sslMode = 'require';
  } else if (sslOption === 'prefer') {
    sslMode = 'prefer';
  } else {
    const querySsl = parsed.searchParams.get('sslmode');
    if (querySsl === 'prefer' || querySsl === 'allow') {
      sslMode = 'prefer';
    } else if (querySsl === 'require') {
      sslMode = 'require';
    } else if (querySsl === 'verify-ca' || querySsl === 'verify-full') {
      sslMode = 'verify-full';
    }
  }

  return { host, port, user, password, database, sslMode };
}

interface PgErrorShape extends Error {
  code?: string;
  severity?: string;
  detail?: string;
  hint?: string;
  position?: string;
  schema?: string;
  schema_name?: string;
  table?: string;
  table_name?: string;
  column?: string;
  column_name?: string;
  constraint?: string;
  constraint_name?: string;
  routine?: string;
}

function createPgError(fields: Readonly<Record<string, string>>): PgErrorShape {
  const message = fields['M'] ?? 'PostgreSQL database error';
  const err: PgErrorShape = new Error(message);
  err.name = 'PostgresError';
  if (fields['C'] !== undefined) err.code = fields['C'];
  const sev = fields['S'] ?? fields['V'];
  if (sev !== undefined) err.severity = sev;
  if (fields['D'] !== undefined) err.detail = fields['D'];
  if (fields['H'] !== undefined) err.hint = fields['H'];
  if (fields['P'] !== undefined) err.position = fields['P'];
  if (fields['s'] !== undefined) {
    err.schema = fields['s'];
    err.schema_name = fields['s'];
  }
  if (fields['t'] !== undefined) {
    err.table = fields['t'];
    err.table_name = fields['t'];
  }
  if (fields['c'] !== undefined) {
    err.column = fields['c'];
    err.column_name = fields['c'];
  }
  if (fields['n'] !== undefined) {
    err.constraint = fields['n'];
    err.constraint_name = fields['n'];
  }
  if (fields['R'] !== undefined) err.routine = fields['R'];
  return err;
}

function parseErrorFields(payload: Buffer): PgErrorShape {
  const fields: Record<string, string> = {};
  let pos = 0;
  while (pos < payload.byteLength) {
    const codeByte = payload[pos] ?? 0;
    pos += 1;
    if (codeByte === 0) break;
    const nul = payload.indexOf(0, pos);
    const end = nul === -1 ? payload.byteLength : nul;
    fields[String.fromCharCode(codeByte)] = payload.toString('utf8', pos, end);
    pos = end + 1;
  }
  return createPgError(fields);
}

// ============================================================================
// Codec: Text Decoding & Parameter Serialization
// ============================================================================

function parsePgTimestamp(text: string, hasTimezone: boolean): Date {
  if (text === 'infinity') return new Date(8640000000000000);
  if (text === '-infinity') return new Date(-8640000000000000);

  let iso = text.replace(' ', 'T');
  if (!hasTimezone) {
    return new Date(`${iso}Z`);
  }
  // Normalize +00 / -05 / +0930 offsets into ISO-8601 +HH:MM for V8 Date.parse
  iso = iso.replace(/([+-]\d{2})$/u, '$1:00').replace(/([+-]\d{2})(\d{2})$/u, '$1:$2');
  return new Date(iso);
}

function parsePgArrayLiterals(text: string): readonly (string | null | readonly unknown[])[] {
  // Strip optional '[low:high]=' dimension prefix emitted on non-1-based PG arrays
  const eqIdx = text.indexOf('=');
  const body = text.startsWith('[') && eqIdx !== -1 ? text.slice(eqIdx + 1) : text;
  if (body === '{}') return [];

  let pos = 0;
  const parseGroup = (): (string | null | readonly unknown[])[] => {
    pos += 1; // skip '{'
    const items: (string | null | readonly unknown[])[] = [];
    while (pos < body.length) {
      const ch = body[pos];
      if (ch === '}') {
        pos += 1;
        break;
      }
      if (ch === ',') {
        pos += 1;
        continue;
      }
      if (ch === '{') {
        items.push(parseGroup());
      } else if (ch === '"') {
        pos += 1;
        let str = '';
        while (pos < body.length) {
          const c = body[pos] ?? '';
          pos += 1;
          if (c === '\\') {
            str += body[pos] ?? '';
            pos += 1;
          } else if (c === '"') {
            break;
          } else {
            str += c;
          }
        }
        items.push(str);
      } else {
        let end = pos;
        while (end < body.length && body[end] !== ',' && body[end] !== '}') {
          end += 1;
        }
        const rawToken = body.slice(pos, end);
        pos = end;
        items.push(rawToken === 'NULL' ? null : rawToken);
      }
    }
    return items;
  };

  return parseGroup();
}

function decodeArrayElements(
  parsed: readonly (string | null | readonly unknown[])[],
  elemOid: number,
  customParsers: ReadonlyMap<number, (text: string) => unknown>,
): unknown[] {
  return parsed.map((entry) => {
    if (entry === null) return null;
    if (Array.isArray(entry)) {
      return decodeArrayElements(
        entry as readonly (string | null | readonly unknown[])[],
        elemOid,
        customParsers,
      );
    }
    return decodeTextColumn(entry as string, elemOid, customParsers);
  });
}

function decodeTextColumn(
  text: string,
  oid: number,
  customParsers: ReadonlyMap<number, (text: string) => unknown>,
): unknown {
  const custom = customParsers.get(oid);
  if (custom !== undefined) {
    return custom(text);
  }

  const elemOid = ARRAY_ELEMENT_OIDS.get(oid);
  if (elemOid !== undefined) {
    return decodeArrayElements(parsePgArrayLiterals(text), elemOid, customParsers);
  }

  switch (oid) {
    case OID_BOOL:
      return text === 't' || text === 'true';
    case OID_INT2:
    case OID_INT4:
    case OID_OID:
      return Number.parseInt(text, 10);
    case OID_FLOAT4:
    case OID_FLOAT8:
      return Number.parseFloat(text);
    case OID_JSON:
    case OID_JSONB:
      return JSON.parse(text) as unknown;
    case OID_BYTEA:
      return text.startsWith('\\x') ? Buffer.from(text.slice(2), 'hex') : Buffer.from(text, 'utf8');
    case OID_TIMESTAMP:
      return parsePgTimestamp(text, false);
    case OID_TIMESTAMPTZ:
      return parsePgTimestamp(text, true);
    case OID_DATE:
      return new Date(`${text}T00:00:00.000Z`);
    default:
      // OID 1700 (numeric), OID 25 (text), UUID, enums, etc. stay exact strings
      return text;
  }
}

function isByteArray(value: unknown): value is Uint8Array {
  return (
    value instanceof Uint8Array ||
    Buffer.isBuffer(value) ||
    Object.prototype.toString.call(value) === '[object Uint8Array]'
  );
}

function isDateInstance(value: unknown): value is Date {
  return value instanceof Date || Object.prototype.toString.call(value) === '[object Date]';
}

function encodePgArrayLiteral(
  items: readonly unknown[],
  customSerializers: ReadonlyMap<number, (val: never) => string>,
): string {
  const parts = items.map((item): string => {
    if (item === null || item === undefined) return 'NULL';
    if (Array.isArray(item)) return encodePgArrayLiteral(item, customSerializers);
    const str = serializeScalarParam(item, undefined, customSerializers) ?? 'NULL';
    const escaped = str.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
    return `"${escaped}"`;
  });
  return `{${parts.join(',')}}`;
}

function serializeScalarParam(
  value: unknown,
  targetOid: number | undefined,
  customSerializers: ReadonlyMap<number, (val: never) => string>,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'bigint') {
    const custom = customSerializers.get(OID_INT8);
    return custom !== undefined ? custom(value as never) : value.toString();
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (isDateInstance(value)) {
    return value.toISOString();
  }
  if (isByteArray(value)) {
    return `\\x${Buffer.from(value).toString('hex')}`;
  }
  if (Array.isArray(value)) {
    if (targetOid === OID_JSON || targetOid === OID_JSONB) {
      return JSON.stringify(value);
    }
    // If array contains plain objects and targetOid wasn't resolved, treat as JSONB
    if (
      targetOid === undefined &&
      value.some(
        (el) =>
          el !== null &&
          typeof el === 'object' &&
          !Array.isArray(el) &&
          !isDateInstance(el) &&
          !isByteArray(el),
      )
    ) {
      return JSON.stringify(value);
    }
    return encodePgArrayLiteral(value, customSerializers);
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  throw new TypeError(`Unsupported PostgreSQL parameter type: ${typeof value}`);
}

// ============================================================================
// Wire Frame Builders
// ============================================================================

function buildFrontendFrame(typeChar: string, payload: Buffer): Buffer {
  const frame = Buffer.allocUnsafe(5 + payload.byteLength);
  frame[0] = typeChar.charCodeAt(0);
  frame.writeInt32BE(4 + payload.byteLength, 1);
  payload.copy(frame, 5);
  return frame;
}

function buildStartupMessage(user: string, database: string): Buffer {
  const params = [
    'user',
    user,
    'database',
    database,
    'client_encoding',
    'UTF8',
    'DateStyle',
    'ISO, MDY',
  ];
  const bodyParts: Buffer[] = [];
  for (const token of params) {
    bodyParts.push(Buffer.from(`${token}\0`, 'utf8'));
  }
  bodyParts.push(Buffer.from([0]));
  const body = Buffer.concat(bodyParts);
  const msg = Buffer.allocUnsafe(8 + body.byteLength);
  msg.writeInt32BE(8 + body.byteLength, 0);
  msg.writeInt32BE(PG_PROTOCOL_V3, 4);
  body.copy(msg, 8);
  return msg;
}

function buildSimpleQueryMessage(sqlText: string): Buffer {
  return buildFrontendFrame('Q', Buffer.from(`${sqlText}\0`, 'utf8'));
}

function buildParseMessage(sqlText: string): Buffer {
  const sqlBytes = Buffer.from(`${sqlText}\0`, 'utf8');
  const payload = Buffer.allocUnsafe(1 + sqlBytes.byteLength + 2);
  payload[0] = 0; // unnamed prepared statement ""
  sqlBytes.copy(payload, 1);
  payload.writeInt16BE(0, 1 + sqlBytes.byteLength); // 0 pre-specified param OIDs
  return buildFrontendFrame('P', payload);
}

function buildDescribeMessage(target: 'S' | 'P'): Buffer {
  return buildFrontendFrame('D', Buffer.from([target.charCodeAt(0), 0]));
}

function buildBindMessage(serializedParams: readonly (string | null)[]): Buffer {
  const chunks: Buffer[] = [
    Buffer.from([0, 0]), // portal "", statement ""
  ];
  // Parameter format codes: 0 (all text)
  const fmtHeader = Buffer.allocUnsafe(4);
  fmtHeader.writeInt16BE(0, 0);
  fmtHeader.writeInt16BE(serializedParams.length, 2);
  chunks.push(fmtHeader);

  for (const param of serializedParams) {
    if (param === null) {
      const nullLen = Buffer.allocUnsafe(4);
      nullLen.writeInt32BE(-1, 0);
      chunks.push(nullLen);
    } else {
      const valBytes = Buffer.from(param, 'utf8');
      const lenBuf = Buffer.allocUnsafe(4);
      lenBuf.writeInt32BE(valBytes.byteLength, 0);
      chunks.push(lenBuf, valBytes);
    }
  }

  // Result format codes: 1 format code = 0 (all text)
  const resFmt = Buffer.allocUnsafe(4);
  resFmt.writeInt16BE(1, 0);
  resFmt.writeInt16BE(0, 2);
  chunks.push(resFmt);

  return buildFrontendFrame('B', Buffer.concat(chunks));
}

const EXECUTE_UNNAMED_MESSAGE = (() => {
  const payload = Buffer.alloc(5, 0); // portal "" + maxRows 0 (unlimited)
  return buildFrontendFrame('E', payload);
})();

const SYNC_MESSAGE = buildFrontendFrame('S', Buffer.alloc(0));
const TERMINATE_MESSAGE = buildFrontendFrame('X', Buffer.alloc(0));

function extractCommandCount(tag: string): number {
  const parts = tag.trim().split(/\s+/u);
  const verb = parts[0] ?? '';
  if (verb === 'INSERT' && parts.length >= 3) {
    const parsed = Number.parseInt(parts[2] ?? '0', 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (
    (verb === 'UPDATE' ||
      verb === 'DELETE' ||
      verb === 'SELECT' ||
      verb === 'MOVE' ||
      verb === 'FETCH' ||
      verb === 'COPY' ||
      verb === 'MERGE') &&
    parts.length >= 2
  ) {
    const parsed = Number.parseInt(parts[1] ?? '0', 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function attachResultCount<TRow>(rows: unknown[], count: number): PgResult<TRow> {
  Object.defineProperty(rows, 'count', {
    value: count,
    writable: false,
    enumerable: false,
    configurable: true,
  });
  return rows as PgResult<TRow>;
}

function quotePgIdentifier(ident: string): string {
  return `"${ident.replace(/"/gu, '""')}"`;
}

// ============================================================================
// SCRAM-SHA-256 & MD5 Helpers
// ============================================================================

function hmacSha256(key: Buffer, data: string | Buffer): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function sha256(data: Buffer): Buffer {
  return createHash('sha256').update(data).digest();
}

function md5Hex(data: string | Buffer): string {
  return createHash('md5').update(data).digest('hex');
}

function parseScramAttributes(message: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const segment of message.split(',')) {
    const eq = segment.indexOf('=');
    if (eq > 0) {
      attrs.set(segment.slice(0, eq), segment.slice(eq + 1));
    }
  }
  return attrs;
}

// ============================================================================
// Wire Connection State Machine
// ============================================================================

interface ColumnDesc {
  readonly name: string;
  readonly typeOid: number;
}

function parseRowDescription(payload: Buffer): ColumnDesc[] {
  const count = payload.readInt16BE(0);
  const cols: ColumnDesc[] = [];
  let pos = 2;
  for (let i = 0; i < count; i += 1) {
    const nul = payload.indexOf(0, pos);
    const name = payload.toString('utf8', pos, nul);
    pos = nul + 1;
    const typeOid = payload.readInt32BE(pos + 6);
    pos += 18;
    cols.push({ name, typeOid });
  }
  return cols;
}

function parseDataRow(
  payload: Buffer,
  columns: readonly ColumnDesc[],
  customParsers: ReadonlyMap<number, (text: string) => unknown>,
): Record<string, unknown> {
  const count = payload.readInt16BE(0);
  const row: Record<string, unknown> = {};
  let pos = 2;
  for (let i = 0; i < count; i += 1) {
    const colLen = payload.readInt32BE(pos);
    pos += 4;
    const col = columns[i];
    const colName = col?.name ?? `?column${String(i)}?`;
    if (colLen === -1) {
      row[colName] = null;
    } else {
      const text = payload.toString('utf8', pos, pos + colLen);
      pos += colLen;
      row[colName] = decodeTextColumn(text, col?.typeOid ?? OID_TEXT, customParsers);
    }
  }
  return row;
}

function sendWireCancelRequest(dsn: ParsedDsn, processId: number, secretKey: number): void {
  if (processId === 0) return;
  const packet = Buffer.allocUnsafe(16);
  packet.writeInt32BE(16, 0);
  packet.writeInt32BE(PG_CANCEL_REQUEST_CODE, 4);
  packet.writeInt32BE(processId, 8);
  packet.writeInt32BE(secretKey, 12);

  const rawSocket = connectTcp({ host: dsn.host, port: dsn.port });
  rawSocket.setTimeout(2000, () => rawSocket.destroy());
  rawSocket.on('error', () => undefined);

  rawSocket.once('connect', () => {
    if (dsn.sslMode === 'disable') {
      rawSocket.write(packet, () => rawSocket.end());
      return;
    }
    const sslReq = Buffer.allocUnsafe(8);
    sslReq.writeInt32BE(8, 0);
    sslReq.writeInt32BE(PG_SSL_REQUEST_CODE, 4);
    rawSocket.write(sslReq);
    rawSocket.once('data', (resp: Buffer) => {
      if (resp[0] === 0x53) {
        const tlsSock = connectTls({
          socket: rawSocket,
          servername: dsn.host,
          rejectUnauthorized: dsn.sslMode === 'verify-full',
        });
        tlsSock.on('error', () => undefined);
        tlsSock.once('secureConnect', () => {
          tlsSock.write(packet, () => tlsSock.end());
        });
      } else if (dsn.sslMode === 'prefer') {
        rawSocket.write(packet, () => rawSocket.end());
      } else {
        rawSocket.destroy();
      }
    });
  });
}

type FrameHandler = (typeChar: string, payload: Buffer) => void;

class PgConnection {
  readonly id: number;
  processId = 0;
  secretKey = 0;
  txStatus: 'I' | 'T' | 'E' = 'I';
  isAlive = false;
  idleTimer: ReturnType<typeof setTimeout> | null = null;
  readonly paramOidCache = new Map<string, readonly number[]>();
  readonly notifyListeners = new Map<string, Set<(payload: string) => void>>();

  private socket: Socket | TLSSocket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private activeHandler: FrameHandler | null = null;
  private activeReject: ((err: Error) => void) | null = null;
  private fatalError: PgErrorShape | null = null;
  private readonly opQueue: (() => void)[] = [];
  private opBusy = false;
  private intentionalClose = false;

  constructor(
    id: number,
    private readonly dsn: ParsedDsn,
    private readonly customParsers: ReadonlyMap<number, (text: string) => unknown>,
    private readonly customSerializers: ReadonlyMap<number, (val: never) => string>,
    private readonly onUnexpectedClose: (conn: PgConnection) => void,
  ) {
    this.id = id;
  }

  async connect(connectTimeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const failConnect = (err: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.destroy();
        reject(err);
      };

      const timer = setTimeout(() => {
        const timeoutErr: PgErrorShape = new Error(
          `Connection to ${this.dsn.host}:${String(this.dsn.port)} timed out`,
        );
        timeoutErr.code = 'CONNECT_TIMEOUT';
        failConnect(timeoutErr);
      }, connectTimeoutMs);

      const tcp = connectTcp({ host: this.dsn.host, port: this.dsn.port });
      this.socket = tcp;

      const onInitialError = (err: Error): void => {
        failConnect(err);
      };
      const onInitialClose = (): void => {
        failConnect(new Error('PostgreSQL connection closed during startup handshake'));
      };
      tcp.once('error', onInitialError);
      tcp.once('close', onInitialClose);

      const beginStartupOnSocket = (wireSocket: Socket | TLSSocket): void => {
        this.socket = wireSocket;
        let clientNonce = '';
        let clientFirstBare = '';
        let expectedServerSig: Buffer | null = null;

        wireSocket.on('data', (chunk: Buffer) => {
          this.appendChunk(chunk);
        });
        wireSocket.on('error', (err: Error) => {
          if (!settled) {
            failConnect(err);
            return;
          }
          this.handleDisconnect(err);
        });
        wireSocket.on('close', () => {
          if (!settled) {
            failConnect(new Error('PostgreSQL socket closed before ReadyForQuery'));
            return;
          }
          this.handleDisconnect(new Error('PostgreSQL connection closed unexpectedly'));
        });

        this.activeReject = failConnect;
        this.activeHandler = (typeChar: string, payload: Buffer): void => {
          if (typeChar === 'R') {
            const authType = payload.readInt32BE(0);
            if (authType === 0) {
              return; // AuthenticationOk
            }
            if (authType === 3) {
              wireSocket.write(
                buildFrontendFrame('p', Buffer.from(`${this.dsn.password}\0`, 'utf8')),
              );
              return;
            }
            if (authType === 5) {
              const salt = payload.subarray(4, 8);
              const inner = md5Hex(`${this.dsn.password}${this.dsn.user}`);
              const digest = `md5${md5Hex(Buffer.concat([Buffer.from(inner, 'ascii'), salt]))}`;
              wireSocket.write(buildFrontendFrame('p', Buffer.from(`${digest}\0`, 'utf8')));
              return;
            }
            if (authType === 10) {
              const mechs = payload.subarray(4).toString('utf8').split('\0').filter(Boolean);
              if (!mechs.includes('SCRAM-SHA-256')) {
                failConnect(
                  new Error(`Unsupported SASL authentication mechanisms: ${mechs.join(', ')}`),
                );
                return;
              }
              clientNonce = randomBytes(18).toString('base64');
              clientFirstBare = `n=,r=${clientNonce}`;
              const clientFirstMsg = Buffer.from(`n,,${clientFirstBare}`, 'utf8');
              const mechHeader = Buffer.from('SCRAM-SHA-256\0', 'utf8');
              const lenBuf = Buffer.allocUnsafe(4);
              lenBuf.writeInt32BE(clientFirstMsg.byteLength, 0);
              wireSocket.write(
                buildFrontendFrame('p', Buffer.concat([mechHeader, lenBuf, clientFirstMsg])),
              );
              return;
            }
            if (authType === 11) {
              const serverFirst = payload.subarray(4).toString('utf8');
              const attrs = parseScramAttributes(serverFirst);
              const combinedNonce = attrs.get('r') ?? '';
              const saltB64 = attrs.get('s') ?? '';
              const iterations = Number.parseInt(attrs.get('i') ?? '0', 10);
              if (!combinedNonce.startsWith(clientNonce) || saltB64 === '' || iterations < 1) {
                failConnect(new Error('Invalid SCRAM-SHA-256 server-first-message challenge'));
                return;
              }
              const saltBytes = Buffer.from(saltB64, 'base64');
              const saltedPw = pbkdf2Sync(
                Buffer.from(this.dsn.password, 'utf8'),
                saltBytes,
                iterations,
                32,
                'sha256',
              );
              const clientKey = hmacSha256(saltedPw, 'Client Key');
              const storedKey = sha256(clientKey);
              const clientFinalWithoutProof = `c=biws,r=${combinedNonce}`;
              const authMessage = `${clientFirstBare},${serverFirst},${clientFinalWithoutProof}`;
              const clientSig = hmacSha256(storedKey, authMessage);
              const proof = Buffer.allocUnsafe(clientKey.byteLength);
              for (let i = 0; i < clientKey.byteLength; i += 1) {
                proof[i] = (clientKey[i] ?? 0) ^ (clientSig[i] ?? 0);
              }
              const serverKey = hmacSha256(saltedPw, 'Server Key');
              expectedServerSig = hmacSha256(serverKey, authMessage);
              const clientFinal = `${clientFinalWithoutProof},p=${proof.toString('base64')}`;
              wireSocket.write(buildFrontendFrame('p', Buffer.from(clientFinal, 'utf8')));
              return;
            }
            if (authType === 12) {
              const serverFinal = payload.subarray(4).toString('utf8');
              const attrs = parseScramAttributes(serverFinal);
              const vB64 = attrs.get('v') ?? '';
              const receivedSig = Buffer.from(vB64, 'base64');
              if (
                expectedServerSig === null ||
                receivedSig.byteLength !== expectedServerSig.byteLength ||
                !timingSafeEqual(receivedSig, expectedServerSig)
              ) {
                failConnect(new Error('SCRAM-SHA-256 server signature verification failed'));
              }
              return;
            }
            failConnect(
              new Error(`Unsupported PostgreSQL authentication type ${String(authType)}`),
            );
            return;
          }

          if (typeChar === 'K') {
            this.processId = payload.readInt32BE(0);
            this.secretKey = payload.readInt32BE(4);
            return;
          }
          if (typeChar === 'S' || typeChar === 'N') {
            return;
          }
          if (typeChar === 'E') {
            failConnect(parseErrorFields(payload));
            return;
          }
          if (typeChar === 'Z') {
            this.txStatus = String.fromCharCode(payload[0] ?? 0x49) as 'I' | 'T' | 'E';
            this.isAlive = true;
            this.activeHandler = null;
            this.activeReject = null;
            settled = true;
            clearTimeout(timer);
            resolve();
          }
        };

        wireSocket.write(buildStartupMessage(this.dsn.user, this.dsn.database));
      };

      tcp.once('connect', () => {
        tcp.setNoDelay(true);
        if (this.dsn.sslMode === 'disable') {
          tcp.removeListener('error', onInitialError);
          tcp.removeListener('close', onInitialClose);
          beginStartupOnSocket(tcp);
          return;
        }

        const sslReq = Buffer.allocUnsafe(8);
        sslReq.writeInt32BE(8, 0);
        sslReq.writeInt32BE(PG_SSL_REQUEST_CODE, 4);
        tcp.write(sslReq);

        tcp.once('data', (resp: Buffer) => {
          const replyByte = resp[0];
          if (replyByte === 0x53) {
            // 'S': upgrade to TLS
            tcp.removeListener('error', onInitialError);
            tcp.removeListener('close', onInitialClose);
            const tlsSocket = connectTls({
              socket: tcp,
              servername: this.dsn.host,
              rejectUnauthorized: this.dsn.sslMode === 'verify-full',
            });
            const onTlsHandshakeError = (err: Error): void => {
              failConnect(err);
            };
            tlsSocket.once('error', onTlsHandshakeError);
            tlsSocket.once('secureConnect', () => {
              tlsSocket.removeListener('error', onTlsHandshakeError);
              beginStartupOnSocket(tlsSocket);
            });
          } else if (replyByte === 0x4e && this.dsn.sslMode === 'prefer') {
            // 'N' with ssl='prefer': fallback to plaintext
            tcp.removeListener('error', onInitialError);
            tcp.removeListener('close', onInitialClose);
            beginStartupOnSocket(tcp);
            if (resp.byteLength > 1) {
              this.appendChunk(resp.subarray(1));
            }
          } else {
            failConnect(new Error('PostgreSQL server does not support SSL/TLS connections'));
          }
        });
      });
    });
  }

  private appendChunk(chunk: Buffer): void {
    this.buffer = this.buffer.byteLength === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    while (this.buffer.byteLength >= 5) {
      const msgType = String.fromCharCode(this.buffer[0] ?? 0);
      const length = this.buffer.readInt32BE(1);
      if (this.buffer.byteLength < 1 + length) {
        return;
      }
      const payload = this.buffer.subarray(5, 1 + length);
      this.buffer = this.buffer.subarray(1 + length);

      if (msgType === 'A') {
        this.dispatchNotification(payload);
      } else if (msgType === 'N' || msgType === 'S') {
        // Ignore asynchronous NoticeResponse and runtime ParameterStatus updates
      } else if (this.activeHandler !== null) {
        this.activeHandler(msgType, payload);
      } else if (msgType === 'E') {
        // Unsolicited server-initiated FATAL (e.g. 25P03 idle_in_transaction_session_timeout)
        this.fatalError = parseErrorFields(payload);
      }
    }
  }

  private dispatchNotification(payload: Buffer): void {
    // [int32 pid][cstring channel][cstring payload]
    const chEnd = payload.indexOf(0, 4);
    if (chEnd === -1) return;
    const channel = payload.toString('utf8', 4, chEnd);
    const bodyEnd = payload.indexOf(0, chEnd + 1);
    const body = payload.toString('utf8', chEnd + 1, bodyEnd === -1 ? payload.byteLength : bodyEnd);
    const listeners = this.notifyListeners.get(channel);
    if (listeners !== undefined) {
      for (const cb of listeners) {
        cb(body);
      }
    }
  }

  private handleDisconnect(error: Error): void {
    const wasAlive = this.isAlive;
    this.isAlive = false;
    this.clearIdleTimer();
    const pendingReject = this.activeReject;
    this.activeHandler = null;
    this.activeReject = null;
    if (pendingReject !== null) {
      pendingReject(error);
    }
    if (wasAlive && !this.intentionalClose) {
      this.onUnexpectedClose(this);
    }
  }

  clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  async closeGracefully(): Promise<void> {
    this.intentionalClose = true;
    this.clearIdleTimer();
    if (!this.isAlive || this.socket === null) {
      this.destroy();
      return;
    }
    this.isAlive = false;
    const sock = this.socket;
    await new Promise<void>((resolve) => {
      const safety = setTimeout(() => {
        sock.destroy();
        resolve();
      }, 500);
      safety.unref();
      sock.end(TERMINATE_MESSAGE, () => {
        clearTimeout(safety);
        resolve();
      });
    });
  }

  destroy(): void {
    this.intentionalClose = true;
    this.isAlive = false;
    this.clearIdleTimer();
    if (this.socket !== null) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  private wireAbortCancellation(
    abortSignal: AbortSignal | undefined,
    rejectPending: (err: Error) => void,
  ): () => void {
    if (abortSignal === undefined) {
      return (): void => {};
    }
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    const onAbort = (): void => {
      sendWireCancelRequest(this.dsn, this.processId, this.secretKey);
      fallbackTimer = setTimeout(() => {
        this.destroy();
        rejectPending(createPgError({ C: '57014', M: 'canceling statement due to user request' }));
      }, 1500);
      fallbackTimer.unref();
    };
    if (abortSignal.aborted) {
      onAbort();
    } else {
      abortSignal.addEventListener('abort', onAbort, { once: true });
    }
    return (): void => {
      abortSignal.removeEventListener('abort', onAbort);
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer);
      }
    };
  }

  private async enqueueOp<T>(task: () => Promise<T>): Promise<T> {
    if (this.opBusy) {
      await new Promise<void>((resolve) => {
        this.opQueue.push(resolve);
      });
    }
    this.opBusy = true;
    try {
      return await task();
    } finally {
      const next = this.opQueue.shift();
      if (next !== undefined) {
        next();
      } else {
        this.opBusy = false;
      }
    }
  }

  runSimpleQuery<TRow>(sqlText: string, abortSignal?: AbortSignal): Promise<PgResult<TRow>> {
    return this.enqueueOp(() => this.runSimpleQueryNow<TRow>(sqlText, abortSignal));
  }

  private async runSimpleQueryNow<TRow>(
    sqlText: string,
    abortSignal?: AbortSignal,
  ): Promise<PgResult<TRow>> {
    if (abortSignal !== undefined && (abortSignal as { readonly aborted: boolean }).aborted) {
      throw createPgError({ C: '57014', M: 'canceling statement due to user request' });
    }
    const sock = this.socket;
    if (!this.isAlive || sock === null) {
      throw this.fatalError ?? new Error('PostgreSQL connection is closed');
    }

    return new Promise<PgResult<TRow>>((resolve, reject) => {
      const cleanupAbort = this.wireAbortCancellation(abortSignal, reject);
      let currentCols: ColumnDesc[] = [];
      let currentRows: Record<string, unknown>[] = [];
      let lastRows: Record<string, unknown>[] = [];
      let lastCount = 0;
      let firstError: PgErrorShape | null = null;

      this.activeReject = (err: Error): void => {
        cleanupAbort();
        reject(firstError ?? this.fatalError ?? err);
      };

      this.activeHandler = (typeChar: string, payload: Buffer): void => {
        if (typeChar === 'T') {
          currentCols = parseRowDescription(payload);
          currentRows = [];
        } else if (typeChar === 'D') {
          currentRows.push(parseDataRow(payload, currentCols, this.customParsers));
        } else if (typeChar === 'C') {
          const tag = payload.toString('utf8', 0, payload.byteLength - 1);
          lastRows = currentRows;
          lastCount = extractCommandCount(tag);
          currentCols = [];
          currentRows = [];
        } else if (typeChar === 'I') {
          // EmptyQueryResponse
          lastRows = [];
          lastCount = 0;
        } else if (typeChar === 'E') {
          const parsedErr = parseErrorFields(payload);
          firstError ??= parsedErr;
          if (parsedErr.severity === 'FATAL' || parsedErr.severity === 'PANIC') {
            this.fatalError = parsedErr;
          }
        } else if (typeChar === 'Z') {
          this.txStatus = String.fromCharCode(payload[0] ?? 0x49) as 'I' | 'T' | 'E';
          this.activeHandler = null;
          this.activeReject = null;
          cleanupAbort();
          if (firstError !== null) {
            reject(firstError);
          } else {
            resolve(attachResultCount<TRow>(lastRows, lastCount));
          }
        }
      };

      sock.write(buildSimpleQueryMessage(sqlText));
    });
  }

  private async describeParamOids(sqlText: string): Promise<readonly number[]> {
    const cached = this.paramOidCache.get(sqlText);
    if (cached !== undefined) return cached;

    const sock = this.socket;
    if (!this.isAlive || sock === null) {
      throw this.fatalError ?? new Error('PostgreSQL connection is closed');
    }

    const oids = await new Promise<readonly number[]>((resolve, reject) => {
      let resolvedOids: number[] = [];
      let firstError: PgErrorShape | null = null;

      this.activeReject = (err: Error): void => {
        reject(firstError ?? this.fatalError ?? err);
      };
      this.activeHandler = (typeChar: string, payload: Buffer): void => {
        if (typeChar === 't') {
          const count = payload.readInt16BE(0);
          const list: number[] = [];
          for (let i = 0; i < count; i += 1) {
            list.push(payload.readInt32BE(2 + i * 4));
          }
          resolvedOids = list;
        } else if (typeChar === 'E') {
          const parsedErr = parseErrorFields(payload);
          firstError ??= parsedErr;
          if (parsedErr.severity === 'FATAL' || parsedErr.severity === 'PANIC') {
            this.fatalError = parsedErr;
          }
        } else if (typeChar === 'Z') {
          this.txStatus = String.fromCharCode(payload[0] ?? 0x49) as 'I' | 'T' | 'E';
          this.activeHandler = null;
          this.activeReject = null;
          if (firstError !== null) {
            reject(firstError);
          } else {
            resolve(resolvedOids);
          }
        }
      };

      sock.write(
        Buffer.concat([buildParseMessage(sqlText), buildDescribeMessage('S'), SYNC_MESSAGE]),
      );
    });

    if (this.paramOidCache.size >= MAX_PARAM_OID_CACHE) {
      const oldest = this.paramOidCache.keys().next().value;
      if (oldest !== undefined) {
        this.paramOidCache.delete(oldest);
      }
    }
    this.paramOidCache.set(sqlText, oids);
    return oids;
  }

  runExtendedPipeline(
    items: readonly { readonly text: string; readonly values: readonly unknown[] }[],
    abortSignal?: AbortSignal,
  ): Promise<PgResult<unknown>[]> {
    return this.enqueueOp(() => this.runExtendedPipelineNow(items, abortSignal));
  }

  private async runExtendedPipelineNow(
    items: readonly { readonly text: string; readonly values: readonly unknown[] }[],
    abortSignal?: AbortSignal,
  ): Promise<PgResult<unknown>[]> {
    if (abortSignal !== undefined && (abortSignal as { readonly aborted: boolean }).aborted) {
      throw createPgError({ C: '57014', M: 'canceling statement due to user request' });
    }
    const sock = this.socket;
    if (!this.isAlive || sock === null) {
      throw this.fatalError ?? new Error('PostgreSQL connection is closed');
    }

    // Pre-fetch parameter OIDs only when an item binds a JS Array (disambiguating `jsonb` vs `T[]`)
    const itemParamOids: (readonly number[] | undefined)[] = [];
    for (const item of items) {
      if (item.values.some(Array.isArray)) {
        itemParamOids.push(await this.describeParamOids(item.text));
      } else {
        itemParamOids.push(undefined);
      }
    }

    if (abortSignal !== undefined && (abortSignal as { readonly aborted: boolean }).aborted) {
      throw createPgError({ C: '57014', M: 'canceling statement due to user request' });
    }

    const wireParts: Buffer[] = [];
    for (let idx = 0; idx < items.length; idx += 1) {
      const item = items[idx];
      if (item === undefined) continue;
      const oids = itemParamOids[idx];
      const serialized = item.values.map((val, pIdx) =>
        serializeScalarParam(val, oids?.[pIdx], this.customSerializers),
      );
      wireParts.push(
        buildParseMessage(item.text),
        buildBindMessage(serialized),
        buildDescribeMessage('P'),
        EXECUTE_UNNAMED_MESSAGE,
      );
    }
    wireParts.push(SYNC_MESSAGE);

    return new Promise<PgResult<unknown>[]>((resolve, reject) => {
      const cleanupAbort = this.wireAbortCancellation(abortSignal, reject);
      const results: PgResult<unknown>[] = [];
      let currentCols: ColumnDesc[] = [];
      let currentRows: Record<string, unknown>[] = [];
      let firstError: PgErrorShape | null = null;

      this.activeReject = (err: Error): void => {
        cleanupAbort();
        reject(firstError ?? this.fatalError ?? err);
      };

      this.activeHandler = (typeChar: string, payload: Buffer): void => {
        if (typeChar === '1' || typeChar === '2' || typeChar === 'n') {
          // ParseComplete, BindComplete, NoData
        } else if (typeChar === 'T') {
          currentCols = parseRowDescription(payload);
          currentRows = [];
        } else if (typeChar === 'D') {
          currentRows.push(parseDataRow(payload, currentCols, this.customParsers));
        } else if (typeChar === 'C') {
          const tag = payload.toString('utf8', 0, payload.byteLength - 1);
          results.push(attachResultCount(currentRows, extractCommandCount(tag)));
          currentCols = [];
          currentRows = [];
        } else if (typeChar === 'I') {
          results.push(attachResultCount([], 0));
          currentCols = [];
          currentRows = [];
        } else if (typeChar === 'E') {
          const parsedErr = parseErrorFields(payload);
          firstError ??= parsedErr;
          if (parsedErr.severity === 'FATAL' || parsedErr.severity === 'PANIC') {
            this.fatalError = parsedErr;
          }
        } else if (typeChar === 'Z') {
          this.txStatus = String.fromCharCode(payload[0] ?? 0x49) as 'I' | 'T' | 'E';
          this.activeHandler = null;
          this.activeReject = null;
          cleanupAbort();
          if (firstError !== null) {
            reject(firstError);
          } else {
            resolve(results);
          }
        }
      };

      sock.write(Buffer.concat(wireParts));
    });
  }
}

// ============================================================================
// Lazy Pending Query & Connection Pool
// ============================================================================

interface PendingQueryInternal<TRow> extends PgPendingQuery<TRow> {
  readonly __pgSpec: {
    readonly text: string;
    readonly values: readonly unknown[];
    abortSignal: AbortSignal | undefined;
    claimedByBatch: boolean;
  };
}

function createPendingQuery<TRow>(
  text: string,
  values: readonly unknown[],
  executor: (
    text: string,
    values: readonly unknown[],
    abortSignal: AbortSignal | undefined,
  ) => Promise<PgResult<TRow>>,
): PendingQueryInternal<TRow> {
  const spec: PendingQueryInternal<TRow>['__pgSpec'] = {
    text,
    values,
    abortSignal: undefined,
    claimedByBatch: false,
  };
  let startedPromise: Promise<PgResult<TRow>> | null = null;

  const ensureStarted = (): Promise<PgResult<TRow>> => {
    startedPromise ??= executor(spec.text, spec.values, spec.abortSignal);
    return startedPromise;
  };

  const pending: PendingQueryInternal<TRow> = {
    __pgSpec: spec,
    signal(abortSignal: AbortSignal): PgPendingQuery<TRow> {
      spec.abortSignal = abortSignal;
      return pending;
    },
    then<TResult1 = PgResult<TRow>, TResult2 = never>(
      onfulfilled?: ((value: PgResult<TRow>) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      return ensureStarted().then(onfulfilled, onrejected);
    },
    catch<TResult = never>(
      onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
    ): Promise<PgResult<TRow> | TResult> {
      return ensureStarted().catch(onrejected);
    },
    finally(onfinally?: (() => void) | null): Promise<PgResult<TRow>> {
      return ensureStarted().finally(onfinally);
    },
  };
  return pending;
}

function mergeAbortSignals(signals: readonly (AbortSignal | undefined)[]): AbortSignal | undefined {
  const defined = signals.filter((s): s is AbortSignal => s !== undefined);
  if (defined.length === 0) return undefined;
  if (defined.length === 1) return defined[0];
  return AbortSignal.any(defined);
}

function buildTemplateSql(
  strings: TemplateStringsArray,
  values: readonly unknown[],
): { readonly text: string; readonly params: readonly unknown[] } {
  if (values.length === 0) {
    return { text: strings[0] ?? '', params: [] };
  }
  let text = strings[0] ?? '';
  for (let i = 0; i < values.length; i += 1) {
    text += `$${String(i + 1)}${strings[i + 1] ?? ''}`;
  }
  return { text, params: values };
}

/**
 * Create a PostgreSQL connection pool speaking wire protocol v3.0.
 */
export function createPgPool(connectionString: string, options: PgOptions = {}): PgSql {
  const dsn = parseConnectionString(connectionString, options.ssl);
  const maxConnections = Math.max(1, options.max ?? 10);
  const idleTimeoutMs = (options.idle_timeout ?? 30) * 1000;
  const connectTimeoutMs = Math.max(1, (options.connect_timeout ?? 10) * 1000);
  const debug = options.debug;
  const onclose = options.onclose;

  const customParsers = new Map<number, (text: string) => unknown>();
  const customSerializers = new Map<number, (val: never) => string>();
  if (options.types !== undefined) {
    for (const def of Object.values(options.types)) {
      for (const oid of def.from) {
        customParsers.set(oid, def.parse);
      }
      customSerializers.set(def.to, def.serialize);
    }
  }

  let nextConnId = 0;
  let activeCount = 0;
  let closing = false;
  const idleConnections: PgConnection[] = [];
  const allLiveConnections = new Set<PgConnection>();
  let listenConnection: PgConnection | null = null;

  interface PoolWaiter {
    readonly resolve: (conn: PgConnection) => void;
    readonly reject: (err: Error) => void;
    readonly cleanupAbort: () => void;
  }
  const waiters: PoolWaiter[] = [];

  const handleUnexpectedClose = (conn: PgConnection): void => {
    allLiveConnections.delete(conn);
    const idleIdx = idleConnections.indexOf(conn);
    if (idleIdx !== -1) {
      idleConnections.splice(idleIdx, 1);
    }
    if (listenConnection === conn) {
      listenConnection = null;
    }
    onclose?.();
  };

  const openFreshConnection = async (): Promise<PgConnection> => {
    nextConnId += 1;
    const conn = new PgConnection(
      nextConnId,
      dsn,
      customParsers,
      customSerializers,
      handleUnexpectedClose,
    );
    await conn.connect(connectTimeoutMs);
    allLiveConnections.add(conn);
    return conn;
  };

  const armIdleExpiry = (conn: PgConnection): void => {
    conn.clearIdleTimer();
    if (idleTimeoutMs <= 0) return;
    conn.idleTimer = setTimeout(() => {
      const idx = idleConnections.indexOf(conn);
      if (idx !== -1) {
        idleConnections.splice(idx, 1);
      }
      allLiveConnections.delete(conn);
      void conn.closeGracefully();
    }, idleTimeoutMs);
    conn.idleTimer.unref();
  };

  const acquireConnection = async (abortSignal?: AbortSignal): Promise<PgConnection> => {
    if (closing) {
      throw new Error('PostgreSQL pool is closed');
    }
    if (abortSignal !== undefined && (abortSignal as { readonly aborted: boolean }).aborted) {
      throw createPgError({ C: '57014', M: 'canceling statement due to user request' });
    }

    while (idleConnections.length > 0) {
      const conn = idleConnections.pop();
      if (conn !== undefined && conn.isAlive) {
        conn.clearIdleTimer();
        activeCount += 1;
        return conn;
      }
    }

    if (activeCount < maxConnections) {
      activeCount += 1;
      try {
        return await openFreshConnection();
      } catch (err) {
        activeCount -= 1;
        pumpWaiters();
        throw err;
      }
    }

    return new Promise<PgConnection>((resolve, reject) => {
      const waiter: PoolWaiter = {
        resolve,
        reject,
        cleanupAbort: () => {
          if (abortSignal !== undefined) {
            abortSignal.removeEventListener('abort', onWaitAbort);
          }
        },
      };
      const onWaitAbort = (): void => {
        const idx = waiters.indexOf(waiter);
        if (idx !== -1) {
          waiters.splice(idx, 1);
        }
        reject(createPgError({ C: '57014', M: 'canceling statement due to user request' }));
      };
      if (abortSignal !== undefined) {
        abortSignal.addEventListener('abort', onWaitAbort, { once: true });
      }
      waiters.push(waiter);
    });
  };

  const pumpWaiters = (): void => {
    if (closing || waiters.length === 0) return;
    while (waiters.length > 0 && idleConnections.length > 0) {
      const conn = idleConnections.pop();
      if (conn === undefined || !conn.isAlive) continue;
      const waiter = waiters.shift();
      if (waiter === undefined) {
        idleConnections.push(conn);
        break;
      }
      waiter.cleanupAbort();
      conn.clearIdleTimer();
      activeCount += 1;
      waiter.resolve(conn);
    }
    while (waiters.length > 0 && activeCount < maxConnections) {
      const waiter = waiters.shift();
      if (waiter === undefined) break;
      waiter.cleanupAbort();
      activeCount += 1;
      openFreshConnection().then(
        (conn) => {
          waiter.resolve(conn);
        },
        (err: unknown) => {
          activeCount -= 1;
          waiter.reject(err instanceof Error ? err : new Error(String(err)));
          pumpWaiters();
        },
      );
    }
  };

  const releaseConnection = async (conn: PgConnection): Promise<void> => {
    if (closing || !conn.isAlive) {
      allLiveConnections.delete(conn);
      conn.destroy();
      activeCount -= 1;
      pumpWaiters();
      return;
    }

    if (conn.txStatus !== 'I') {
      try {
        await conn.runSimpleQuery('ROLLBACK');
      } catch {
        allLiveConnections.delete(conn);
        conn.destroy();
        activeCount -= 1;
        pumpWaiters();
        return;
      }
    }

    activeCount -= 1;
    const nextWaiter = waiters.shift();
    if (nextWaiter !== undefined) {
      nextWaiter.cleanupAbort();
      activeCount += 1;
      nextWaiter.resolve(conn);
      return;
    }

    idleConnections.push(conn);
    armIdleExpiry(conn);
  };

  const executeOnConnection = async <TRow>(
    conn: PgConnection,
    text: string,
    values: readonly unknown[],
    abortSignal: AbortSignal | undefined,
  ): Promise<PgResult<TRow>> => {
    debug?.(conn.id, text, values);
    if (values.length === 0) {
      return conn.runSimpleQuery<TRow>(text, abortSignal);
    }
    const [res] = await conn.runExtendedPipeline([{ text, values }], abortSignal);
    return (res ?? attachResultCount<TRow>([], 0)) as PgResult<TRow>;
  };

  const createTxClient = (
    conn: PgConnection,
    spCounterRef: { value: number },
  ): PgTransactionSql => {
    const runTxStatement = <TRow>(
      text: string,
      values: readonly unknown[],
      abortSignal: AbortSignal | undefined,
    ): Promise<PgResult<TRow>> => executeOnConnection<TRow>(conn, text, values, abortSignal);

    const txFn = <TRow = Record<string, unknown>[]>(
      strings: TemplateStringsArray,
      ...values: readonly unknown[]
    ): PgPendingQuery<TRow> => {
      const built = buildTemplateSql(strings, values);
      return createPendingQuery<TRow>(built.text, built.params, runTxStatement);
    };

    const unsafe = <TRow = Record<string, unknown>[]>(
      text: string,
      values: readonly unknown[] = [],
    ): PgPendingQuery<TRow> => createPendingQuery<TRow>(text, values, runTxStatement);

    const savepoint = async <T>(callback: (spTx: PgTransactionSql) => Promise<T>): Promise<T> => {
      spCounterRef.value += 1;
      const spName = `sp_${String(spCounterRef.value)}`;
      await executeOnConnection(conn, `SAVEPOINT ${spName}`, [], undefined);
      try {
        const out = await callback(txClient);
        await executeOnConnection(conn, `RELEASE SAVEPOINT ${spName}`, [], undefined);
        return out;
      } catch (err) {
        if (conn.isAlive) {
          try {
            await executeOnConnection(conn, `ROLLBACK TO SAVEPOINT ${spName}`, [], undefined);
            await executeOnConnection(conn, `RELEASE SAVEPOINT ${spName}`, [], undefined);
          } catch {
            conn.destroy();
          }
        }
        throw err;
      }
    };

    const txClient: PgTransactionSql = Object.assign(txFn, { unsafe, savepoint });
    return txClient;
  };

  const runPoolStatement = async <TRow>(
    text: string,
    values: readonly unknown[],
    abortSignal: AbortSignal | undefined,
  ): Promise<PgResult<TRow>> => {
    const conn = await acquireConnection(abortSignal);
    try {
      return await executeOnConnection<TRow>(conn, text, values, abortSignal);
    } finally {
      await releaseConnection(conn);
    }
  };

  const sqlTag = <TRow = Record<string, unknown>[]>(
    strings: TemplateStringsArray,
    ...values: readonly unknown[]
  ): PgPendingQuery<TRow> => {
    const built = buildTemplateSql(strings, values);
    return createPendingQuery<TRow>(built.text, built.params, runPoolStatement);
  };

  const unsafe = <TRow = Record<string, unknown>[]>(
    text: string,
    values: readonly unknown[] = [],
  ): PgPendingQuery<TRow> => createPendingQuery<TRow>(text, values, runPoolStatement);

  const batch: PgSql['batch'] = async <T extends readonly PgPendingQuery<unknown>[]>(
    queries: [...T],
  ): Promise<{ [K in keyof T]: T[K] extends PgPendingQuery<infer R> ? PgResult<R> : never }> => {
    if (queries.length === 0) {
      return [] as unknown as {
        [K in keyof T]: T[K] extends PgPendingQuery<infer R> ? PgResult<R> : never;
      };
    }

    const specs = queries.map((q) => {
      const internal = q as PendingQueryInternal<unknown>;
      internal.__pgSpec.claimedByBatch = true;
      return internal.__pgSpec;
    });
    const combinedAbort = mergeAbortSignals(specs.map((s) => s.abortSignal));

    const conn = await acquireConnection(combinedAbort);
    try {
      for (const spec of specs) {
        debug?.(conn.id, spec.text, spec.values);
      }
      const results = await conn.runExtendedPipeline(
        specs.map((s) => ({ text: s.text, values: s.values })),
        combinedAbort,
      );
      return results as unknown as {
        [K in keyof T]: T[K] extends PgPendingQuery<infer R> ? PgResult<R> : never;
      };
    } finally {
      await releaseConnection(conn);
    }
  };

  const begin = async <T>(
    optionsOrCb: string | ((tx: PgTransactionSql) => Promise<T>),
    maybeCb?: (tx: PgTransactionSql) => Promise<T>,
  ): Promise<T> => {
    const beginOptions = typeof optionsOrCb === 'string' ? optionsOrCb.trim() : '';
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
    if (callback === undefined) {
      throw new TypeError('begin() requires a transaction callback');
    }

    const conn = await acquireConnection();
    const beginSql = beginOptions !== '' ? `BEGIN ${beginOptions}` : 'BEGIN';
    try {
      await executeOnConnection(conn, beginSql, [], undefined);
      const txClient = createTxClient(conn, { value: 0 });
      try {
        const result = await callback(txClient);
        await executeOnConnection(conn, 'COMMIT', [], undefined);
        return result;
      } catch (err) {
        if (conn.isAlive) {
          try {
            await executeOnConnection(conn, 'ROLLBACK', [], undefined);
          } catch {
            conn.destroy();
          }
        }
        throw err;
      }
    } finally {
      await releaseConnection(conn);
    }
  };

  const listen: PgSql['listen'] = async (
    channel: string,
    onNotify: (payload: string) => void,
  ): Promise<{ readonly unlisten: () => Promise<void> }> => {
    if (closing) {
      throw new Error('PostgreSQL pool is closed');
    }
    if (listenConnection === null || !listenConnection.isAlive) {
      listenConnection = await openFreshConnection();
    }
    const conn = listenConnection;
    let channelSet = conn.notifyListeners.get(channel);
    const isFirstForChannel = channelSet === undefined || channelSet.size === 0;
    if (channelSet === undefined) {
      channelSet = new Set();
      conn.notifyListeners.set(channel, channelSet);
    }
    channelSet.add(onNotify);

    if (isFirstForChannel) {
      await executeOnConnection(conn, `LISTEN ${quotePgIdentifier(channel)}`, [], undefined);
    }

    return {
      unlisten: async (): Promise<void> => {
        channelSet.delete(onNotify);
        if (channelSet.size === 0 && conn.isAlive) {
          await executeOnConnection(conn, `UNLISTEN ${quotePgIdentifier(channel)}`, [], undefined);
        }
      },
    };
  };

  const notify: PgSql['notify'] = async (channel: string, payload: string): Promise<void> => {
    await unsafe('SELECT pg_notify($1, $2)', [channel, payload]);
  };

  const end: PgSql['end'] = async (): Promise<void> => {
    if (closing) return;
    closing = true;

    while (waiters.length > 0) {
      const waiter = waiters.shift();
      if (waiter !== undefined) {
        waiter.cleanupAbort();
        waiter.reject(new Error('PostgreSQL pool closed'));
      }
    }

    const toClose = [...allLiveConnections];
    allLiveConnections.clear();
    idleConnections.length = 0;
    listenConnection = null;

    await Promise.all(toClose.map((conn) => conn.closeGracefully()));
  };

  return Object.assign(sqlTag, {
    unsafe,
    batch,
    begin,
    listen,
    notify,
    end,
  });
}
