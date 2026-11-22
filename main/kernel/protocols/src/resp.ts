// main/kernel/protocols/src/resp.ts
/**
 * Owned RESP2 wire encoder, streaming parser, pipelined command client, and
 * pub/sub subscriber over `node:net` and `node:tls` (restructure plan §13 B3).
 */
import { createConnection, isIP, type Socket } from 'node:net';
import { connect as tlsConnect, type ConnectionOptions as TlsConnectionOptions } from 'node:tls';

export type RespValue = string | number | null | RespReplyError | RespValue[];

export class RespProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RespProtocolError';
  }
}

export class RespReplyError extends Error {
  readonly code: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'RespReplyError';
    const firstToken = message.trim().split(/\s+/u)[0] ?? 'ERR';
    this.code = code ?? firstToken;
  }
}

interface RespParserOptions {
  /** Maximum bulk string byte length (default: 64 MiB). */
  readonly maxBulkLength?: number;
  /** Maximum array element count (default: 1,048,576). */
  readonly maxArrayLength?: number;
}

const DEFAULT_MAX_BULK_LENGTH = 64 * 1024 * 1024;
const DEFAULT_MAX_ARRAY_LENGTH = 1_048_576;
const CRLF = Buffer.from('\r\n', 'ascii');
const INTEGER_PATTERN = /^-?(?:0|[1-9][0-9]*)$/u;

/** Encode a RESP2 command array (`*<N>\r\n$<byteLen>\r\n<bytes>\r\n...`). */
export function encodeRespCommand(args: readonly (string | number | Uint8Array)[]): Buffer {
  if (args.length === 0) {
    throw new TypeError('RESP command must contain at least one argument');
  }
  const parts: Buffer[] = [Buffer.from(`*${String(args.length)}\r\n`, 'ascii')];
  for (const arg of args) {
    let payload: Buffer;
    if (typeof arg === 'string') {
      payload = Buffer.from(arg, 'utf8');
    } else if (typeof arg === 'number') {
      if (!Number.isFinite(arg)) {
        throw new TypeError('RESP numeric argument must be finite');
      }
      payload = Buffer.from(String(arg), 'ascii');
    } else {
      payload = Buffer.from(arg);
    }
    parts.push(Buffer.from(`$${String(payload.byteLength)}\r\n`, 'ascii'), payload, CRLF);
  }
  return Buffer.concat(parts);
}

interface ParseStep {
  readonly value: RespValue;
  readonly nextOffset: number;
}

/** Streaming RESP2 parser handling arbitrary TCP chunk boundaries. */
export class RespParser {
  private buffer: Buffer = Buffer.alloc(0);
  private readonly maxBulkLength: number;
  private readonly maxArrayLength: number;

  constructor(options: RespParserOptions = {}) {
    this.maxBulkLength = options.maxBulkLength ?? DEFAULT_MAX_BULK_LENGTH;
    this.maxArrayLength = options.maxArrayLength ?? DEFAULT_MAX_ARRAY_LENGTH;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }

  feed(chunk: Uint8Array): RespValue[] {
    if (chunk.byteLength === 0) return [];
    this.buffer =
      this.buffer.byteLength === 0
        ? Buffer.from(chunk)
        : Buffer.concat([this.buffer, Buffer.from(chunk)]);

    const values: RespValue[] = [];
    let offset = 0;
    try {
      while (offset < this.buffer.byteLength) {
        const parsed = this.parseAt(this.buffer, offset);
        if (parsed === null) break;
        values.push(parsed.value);
        offset = parsed.nextOffset;
      }
    } catch (error) {
      this.buffer = Buffer.alloc(0);
      throw error;
    }

    if (offset > 0) {
      this.buffer =
        offset === this.buffer.byteLength
          ? Buffer.alloc(0)
          : Buffer.from(this.buffer.subarray(offset));
    }
    return values;
  }

  private readLine(buf: Buffer, start: number): { line: string; nextOffset: number } | null {
    for (let i = start; i + 1 < buf.byteLength; i += 1) {
      if (buf[i] === 0x0d && buf[i + 1] === 0x0a) {
        return {
          line: buf.subarray(start, i).toString('utf8'),
          nextOffset: i + 2,
        };
      }
    }
    return null;
  }

  private parseSafeInt(raw: string, label: string): number {
    if (!INTEGER_PATTERN.test(raw)) {
      throw new RespProtocolError(`Invalid RESP ${label}: "${raw}"`);
    }
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed)) {
      throw new RespProtocolError(`RESP ${label} out of safe integer range: "${raw}"`);
    }
    return parsed;
  }

  private parseAt(buf: Buffer, offset: number): ParseStep | null {
    if (offset >= buf.byteLength) return null;
    const prefix = buf[offset];
    if (
      prefix !== 0x2b && // +
      prefix !== 0x2d && // -
      prefix !== 0x3a && // :
      prefix !== 0x24 && // $
      prefix !== 0x2a // *
    ) {
      throw new RespProtocolError(`Unexpected RESP prefix byte: 0x${(prefix ?? 0).toString(16)}`);
    }

    const header = this.readLine(buf, offset + 1);
    if (header === null) return null;

    switch (prefix) {
      case 0x2b: // + Simple String
        return { value: header.line, nextOffset: header.nextOffset };
      case 0x2d: // - Error
        return { value: new RespReplyError(header.line), nextOffset: header.nextOffset };
      case 0x3a: // : Integer
        return {
          value: this.parseSafeInt(header.line, 'integer'),
          nextOffset: header.nextOffset,
        };
      case 0x24: {
        // $ Bulk String
        const byteLen = this.parseSafeInt(header.line, 'bulk length');
        if (byteLen === -1) {
          return { value: null, nextOffset: header.nextOffset };
        }
        if (byteLen < -1) {
          throw new RespProtocolError(`Negative RESP bulk length: ${String(byteLen)}`);
        }
        if (byteLen > this.maxBulkLength) {
          throw new RespProtocolError(
            `RESP bulk length ${String(byteLen)} exceeds maximum ${String(this.maxBulkLength)}`,
          );
        }
        const endOfFrame = header.nextOffset + byteLen + 2;
        if (buf.byteLength < endOfFrame) {
          return null;
        }
        if (
          buf[header.nextOffset + byteLen] !== 0x0d ||
          buf[header.nextOffset + byteLen + 1] !== 0x0a
        ) {
          throw new RespProtocolError('Missing CRLF terminator after RESP bulk payload');
        }
        const value = buf.subarray(header.nextOffset, header.nextOffset + byteLen).toString('utf8');
        return { value, nextOffset: endOfFrame };
      }
      case 0x2a: {
        // * Array
        const count = this.parseSafeInt(header.line, 'array length');
        if (count === -1) {
          return { value: null, nextOffset: header.nextOffset };
        }
        if (count < -1) {
          throw new RespProtocolError(`Negative RESP array length: ${String(count)}`);
        }
        if (count > this.maxArrayLength) {
          throw new RespProtocolError(
            `RESP array length ${String(count)} exceeds maximum ${String(this.maxArrayLength)}`,
          );
        }
        const items: RespValue[] = [];
        let cursor = header.nextOffset;
        for (let i = 0; i < count; i += 1) {
          const elem = this.parseAt(buf, cursor);
          if (elem === null) return null;
          items.push(elem.value);
          cursor = elem.nextOffset;
        }
        return { value: items, nextOffset: cursor };
      }
    }
  }
}

interface RespSetOptions {
  readonly ex?: number;
  readonly px?: number;
  readonly nx?: boolean;
  readonly xx?: boolean;
}

type RespMessageListener = (message: string, channel: string) => void;

interface RespClientEvents {
  connect: () => void;
  close: () => void;
  reconnecting: (delayMs: number, attempt: number) => void;
  error: (error: Error) => void;
}

interface RespClientOptions {
  readonly host: string;
  readonly port: number;
  readonly username?: string;
  readonly password?: string;
  readonly db?: number;
  readonly tls?: boolean | TlsConnectionOptions;
  readonly keyPrefix?: string;
  readonly connectTimeoutMs?: number;
  readonly commandTimeoutMs?: number;
  readonly lazyConnect?: boolean;
  readonly retryStrategy?: (attempt: number) => number | null;
}

interface RespPipeline {
  call(...args: (string | number | Uint8Array)[]): RespPipeline;
  get(key: string): RespPipeline;
  set(key: string, value: string, options?: RespSetOptions): RespPipeline;
  psetex(key: string, ttlMs: number, value: string): RespPipeline;
  incr(key: string): RespPipeline;
  expire(key: string, seconds: number): RespPipeline;
  del(...keys: string[]): RespPipeline;
  sadd(key: string, ...members: string[]): RespPipeline;
  exec(): Promise<RespValue[]>;
}

export interface RespClient {
  on<K extends keyof RespClientEvents>(event: K, listener: RespClientEvents[K]): RespClient;
  connect(): Promise<void>;
  call(...args: (string | number | Uint8Array)[]): Promise<RespValue>;
  ping(): Promise<string>;
  get(key: string): Promise<string | null>;
  mget(...keys: string[]): Promise<Array<string | null>>;
  set(key: string, value: string, options?: RespSetOptions): Promise<string | null>;
  psetex(key: string, ttlMs: number, value: string): Promise<string>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  pexpire(key: string, ttlMs: number): Promise<number>;
  del(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  flushdb(): Promise<string>;
  eval(
    script: string,
    keys: readonly string[],
    args: readonly (string | number)[],
  ): Promise<RespValue>;
  evalsha(
    sha1: string,
    keys: readonly string[],
    args: readonly (string | number)[],
  ): Promise<RespValue>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, listener: RespMessageListener): Promise<void>;
  unsubscribe(channel: string, listener?: RespMessageListener): Promise<void>;
  pipeline(): RespPipeline;
  quit(): Promise<void>;
  close(): Promise<void>;
}

interface PendingCommand {
  readonly encoded: Buffer;
  readonly resolve: (value: RespValue) => void;
  readonly reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

const SUBSCRIBER_ALLOWED_COMMANDS = new Set([
  'SUBSCRIBE',
  'UNSUBSCRIBE',
  'PSUBSCRIBE',
  'PUNSUBSCRIBE',
  'PING',
  'QUIT',
]);

function defaultRetryStrategy(attempt: number): number | null {
  if (attempt > 5) return null;
  return Math.min(attempt * 200, 2000);
}

class OwnedRespClient implements RespClient {
  private readonly options: RespClientOptions;
  private readonly prefix: string;
  private readonly connectTimeoutMs: number;
  private readonly commandTimeoutMs: number;
  private readonly retryStrategy: (attempt: number) => number | null;

  private socket: Socket | null = null;
  private parser = new RespParser();
  private state: 'idle' | 'connecting' | 'ready' | 'closed' = 'idle';
  private connectPromise: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;

  private readonly offlineQueue: PendingCommand[] = [];
  private readonly inFlight: PendingCommand[] = [];
  private readonly subscriptions = new Map<string, Set<RespMessageListener>>();

  private readonly listeners: {
    [K in keyof RespClientEvents]: Set<RespClientEvents[K]>;
  } = {
    connect: new Set(),
    close: new Set(),
    reconnecting: new Set(),
    error: new Set(),
  };

  constructor(options: RespClientOptions) {
    this.options = options;
    this.prefix = options.keyPrefix ?? '';
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5000;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 3000;
    this.retryStrategy = options.retryStrategy ?? defaultRetryStrategy;

    if (options.lazyConnect !== true) {
      this.connect().catch((err: unknown) => {
        this.emitError(err instanceof Error ? err : new Error(String(err)));
      });
    }
  }

  on<K extends keyof RespClientEvents>(event: K, listener: RespClientEvents[K]): RespClient {
    this.listeners[event].add(listener);
    return this;
  }

  private emitError(error: Error): void {
    for (const fn of this.listeners.error) {
      fn(error);
    }
  }

  private prefixKey(key: string): string {
    return this.prefix === '' ? key : `${this.prefix}${key}`;
  }

  async connect(): Promise<void> {
    if (this.state === 'closed') {
      throw new Error('RESP client is closed');
    }
    if (this.state === 'ready') {
      return;
    }
    if (this.connectPromise !== null) {
      return this.connectPromise;
    }

    this.state = 'connecting';
    this.connectPromise = this.establishConnection();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async establishConnection(): Promise<void> {
    this.parser.reset();

    const socket = await new Promise<Socket>((resolve, reject) => {
      const useTls = this.options.tls !== undefined && this.options.tls !== false;
      const tlsOpts: TlsConnectionOptions =
        typeof this.options.tls === 'object' ? this.options.tls : {};

      const defaultServername = isIP(this.options.host) === 0 ? this.options.host : undefined;
      const sock: Socket = useTls
        ? tlsConnect({
            host: this.options.host,
            port: this.options.port,
            ...(defaultServername !== undefined ? { servername: defaultServername } : {}),
            ...tlsOpts,
          })
        : createConnection({
            host: this.options.host,
            port: this.options.port,
          });

      const readyEvent = useTls ? 'secureConnect' : 'connect';
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        sock.destroy();
        reject(new Error(`RESP connection timed out after ${String(this.connectTimeoutMs)}ms`));
      }, this.connectTimeoutMs);
      timer.unref();

      const onReady = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sock.removeListener('error', onError);
        resolve(sock);
      };

      const onError = (err: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sock.removeListener(readyEvent, onReady);
        sock.destroy();
        reject(err);
      };

      sock.once(readyEvent, onReady);
      sock.once('error', onError);
    }).catch((err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      this.handleDisconnect(error, true);
      throw error;
    });

    this.socket = socket;
    this.attachSocketListeners(socket);

    try {
      if (this.options.password !== undefined) {
        const authArgs =
          this.options.username !== undefined
            ? ['AUTH', this.options.username, this.options.password]
            : ['AUTH', this.options.password];
        await this.sendDirectOnSocket(socket, authArgs);
      }
      if (this.options.db !== undefined && this.options.db !== 0) {
        await this.sendDirectOnSocket(socket, ['SELECT', this.options.db]);
      }
      if (this.subscriptions.size > 0) {
        const channels = [...this.subscriptions.keys()];
        await this.sendSubscribeOnSocket(socket, 'SUBSCRIBE', channels);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      socket.destroy();
      this.socket = null;
      this.state = 'idle';
      this.rejectAllQueues(error);
      throw error;
    }

    this.reconnectAttempt = 0;
    this.state = 'ready';
    for (const fn of this.listeners.connect) {
      fn();
    }
    this.flushOfflineQueue();
  }

  private attachSocketListeners(socket: Socket): void {
    socket.on('data', (chunk: Buffer) => {
      let frames: RespValue[];
      try {
        frames = this.parser.feed(chunk);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.emitError(error);
        socket.destroy();
        return;
      }
      for (const frame of frames) {
        this.handleFrame(frame);
      }
    });

    socket.on('error', (err: Error) => {
      this.emitError(err);
    });

    socket.on('close', () => {
      if (this.socket === socket) {
        this.socket = null;
        this.handleDisconnect(new Error('RESP socket closed'), false);
      }
    });
  }

  private handleFrame(frame: RespValue): void {
    // Check for pub/sub push message: ['message', channel, payload]
    if (
      Array.isArray(frame) &&
      frame.length === 3 &&
      frame[0] === 'message' &&
      typeof frame[1] === 'string' &&
      typeof frame[2] === 'string'
    ) {
      const listeners = this.subscriptions.get(frame[1]);
      if (listeners !== undefined) {
        for (const fn of listeners) {
          fn(frame[2], frame[1]);
        }
      }
      return;
    }

    const pending = this.inFlight.shift();
    if (pending === undefined) {
      return;
    }
    if (pending.timer !== null) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
    if (frame instanceof RespReplyError) {
      pending.reject(frame);
    } else {
      pending.resolve(frame);
    }
  }

  private handleDisconnect(error: Error, fromConnectFailure: boolean): void {
    if (this.state === 'closed') return;

    while (this.inFlight.length > 0) {
      const cmd = this.inFlight.shift();
      if (cmd !== undefined) {
        if (cmd.timer !== null) clearTimeout(cmd.timer);
        cmd.reject(error);
      }
    }

    for (const fn of this.listeners.close) {
      fn();
    }

    this.state = 'idle';
    this.reconnectAttempt += 1;
    const delayMs = this.retryStrategy(this.reconnectAttempt);
    if (delayMs === null) {
      this.rejectAllQueues(error);
      return;
    }

    if (fromConnectFailure && this.offlineQueue.length === 0 && this.subscriptions.size === 0) {
      return;
    }

    if (this.reconnectTimer === null) {
      for (const fn of this.listeners.reconnecting) {
        fn(delayMs, this.reconnectAttempt);
      }
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (this.state === 'closed') return;
        this.connect().catch((err: unknown) => {
          this.emitError(err instanceof Error ? err : new Error(String(err)));
        });
      }, delayMs);
      this.reconnectTimer.unref();
    }
  }

  private rejectAllQueues(error: Error): void {
    while (this.inFlight.length > 0) {
      const cmd = this.inFlight.shift();
      if (cmd !== undefined) {
        if (cmd.timer !== null) clearTimeout(cmd.timer);
        cmd.reject(error);
      }
    }
    while (this.offlineQueue.length > 0) {
      const cmd = this.offlineQueue.shift();
      if (cmd !== undefined) {
        if (cmd.timer !== null) clearTimeout(cmd.timer);
        cmd.reject(error);
      }
    }
  }

  private sendDirectOnSocket(
    socket: Socket,
    args: readonly (string | number | Uint8Array)[],
  ): Promise<RespValue> {
    const encoded = encodeRespCommand(args);
    return new Promise<RespValue>((resolve, reject) => {
      const pending: PendingCommand = { encoded, resolve, reject, timer: null };
      this.armCommandTimer(pending);
      this.inFlight.push(pending);
      socket.write(encoded);
    });
  }

  private async sendSubscribeOnSocket(
    socket: Socket,
    verb: 'SUBSCRIBE' | 'UNSUBSCRIBE',
    channels: readonly string[],
  ): Promise<void> {
    if (channels.length === 0) return;
    const encoded = encodeRespCommand([verb, ...channels]);
    const waits: Array<Promise<RespValue>> = [];
    for (let i = 0; i < channels.length; i += 1) {
      waits.push(
        new Promise<RespValue>((resolve, reject) => {
          const pending: PendingCommand = {
            encoded: i === 0 ? encoded : Buffer.alloc(0),
            resolve,
            reject,
            timer: null,
          };
          this.armCommandTimer(pending);
          this.inFlight.push(pending);
        }),
      );
    }
    socket.write(encoded);
    await Promise.all(waits);
  }

  private armCommandTimer(pending: PendingCommand): void {
    if (this.commandTimeoutMs <= 0) return;
    pending.timer = setTimeout(() => {
      const idx = this.inFlight.indexOf(pending);
      if (idx !== -1) {
        this.inFlight.splice(idx, 1);
      }
      const qIdx = this.offlineQueue.indexOf(pending);
      if (qIdx !== -1) {
        this.offlineQueue.splice(qIdx, 1);
      }
      pending.reject(new Error(`RESP command timed out after ${String(this.commandTimeoutMs)}ms`));
      this.socket?.destroy();
    }, this.commandTimeoutMs);
    pending.timer.unref();
  }

  private flushOfflineQueue(): void {
    if (this.state !== 'ready' || this.socket === null || this.offlineQueue.length === 0) {
      return;
    }
    const chunks: Buffer[] = [];
    while (this.offlineQueue.length > 0) {
      const pending = this.offlineQueue.shift();
      if (pending !== undefined) {
        this.armCommandTimer(pending);
        this.inFlight.push(pending);
        chunks.push(pending.encoded);
      }
    }
    if (chunks.length > 0) {
      this.socket.write(
        chunks.length === 1 ? (chunks[0] ?? Buffer.alloc(0)) : Buffer.concat(chunks),
      );
    }
  }

  async call(...args: (string | number | Uint8Array)[]): Promise<RespValue> {
    if (this.state === 'closed') {
      throw new Error('RESP client is closed');
    }
    const firstArg = args[0];
    const cmdName =
      typeof firstArg === 'string'
        ? firstArg.toUpperCase()
        : Buffer.from(String(firstArg ?? ''))
            .toString('utf8')
            .toUpperCase();

    if (this.subscriptions.size > 0 && !SUBSCRIBER_ALLOWED_COMMANDS.has(cmdName)) {
      throw new Error(`Cannot execute "${cmdName}" while RESP connection is in subscriber mode`);
    }

    const encoded = encodeRespCommand(args);

    if (this.state === 'ready' && this.socket !== null) {
      const sock = this.socket;
      return new Promise<RespValue>((resolve, reject) => {
        const pending: PendingCommand = { encoded, resolve, reject, timer: null };
        this.armCommandTimer(pending);
        this.inFlight.push(pending);
        sock.write(encoded);
      });
    }

    const queuedPromise = new Promise<RespValue>((resolve, reject) => {
      const pending: PendingCommand = { encoded, resolve, reject, timer: null };
      this.offlineQueue.push(pending);
    });

    if (this.state === 'idle' && this.reconnectTimer === null) {
      this.connect().catch((err: unknown) => {
        this.emitError(err instanceof Error ? err : new Error(String(err)));
      });
    }

    return queuedPromise;
  }

  async ping(): Promise<string> {
    const reply = await this.call('PING');
    return typeof reply === 'string' ? reply : 'PONG';
  }

  async get(key: string): Promise<string | null> {
    const reply = await this.call('GET', this.prefixKey(key));
    return typeof reply === 'string' ? reply : null;
  }

  async mget(...keys: string[]): Promise<Array<string | null>> {
    if (keys.length === 0) return [];
    const reply = await this.call('MGET', ...keys.map((k) => this.prefixKey(k)));
    if (!Array.isArray(reply)) return keys.map(() => null);
    return reply.map((item) => (typeof item === 'string' ? item : null));
  }

  async set(key: string, value: string, options?: RespSetOptions): Promise<string | null> {
    const args: Array<string | number> = ['SET', this.prefixKey(key), value];
    if (options?.ex !== undefined) args.push('EX', options.ex);
    if (options?.px !== undefined) args.push('PX', options.px);
    if (options?.nx === true) args.push('NX');
    if (options?.xx === true) args.push('XX');
    const reply = await this.call(...args);
    return typeof reply === 'string' ? reply : null;
  }

  async psetex(key: string, ttlMs: number, value: string): Promise<string> {
    const reply = await this.call('PSETEX', this.prefixKey(key), ttlMs, value);
    return typeof reply === 'string' ? reply : 'OK';
  }

  async incr(key: string): Promise<number> {
    const reply = await this.call('INCR', this.prefixKey(key));
    return typeof reply === 'number' ? reply : Number(reply ?? 0);
  }

  async expire(key: string, seconds: number): Promise<number> {
    const reply = await this.call('EXPIRE', this.prefixKey(key), seconds);
    return typeof reply === 'number' ? reply : Number(reply ?? 0);
  }

  async pexpire(key: string, ttlMs: number): Promise<number> {
    const reply = await this.call('PEXPIRE', this.prefixKey(key), ttlMs);
    return typeof reply === 'number' ? reply : Number(reply ?? 0);
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    const reply = await this.call('DEL', ...keys.map((k) => this.prefixKey(k)));
    return typeof reply === 'number' ? reply : Number(reply ?? 0);
  }

  async exists(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    const reply = await this.call('EXISTS', ...keys.map((k) => this.prefixKey(k)));
    return typeof reply === 'number' ? reply : Number(reply ?? 0);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    const reply = await this.call('SADD', this.prefixKey(key), ...members);
    return typeof reply === 'number' ? reply : Number(reply ?? 0);
  }

  async smembers(key: string): Promise<string[]> {
    const reply = await this.call('SMEMBERS', this.prefixKey(key));
    if (!Array.isArray(reply)) return [];
    return reply.filter((item): item is string => typeof item === 'string');
  }

  async flushdb(): Promise<string> {
    const reply = await this.call('FLUSHDB');
    return typeof reply === 'string' ? reply : 'OK';
  }

  async eval(
    script: string,
    keys: readonly string[],
    args: readonly (string | number)[],
  ): Promise<RespValue> {
    return this.call('EVAL', script, keys.length, ...keys.map((k) => this.prefixKey(k)), ...args);
  }

  async evalsha(
    sha1: string,
    keys: readonly string[],
    args: readonly (string | number)[],
  ): Promise<RespValue> {
    return this.call('EVALSHA', sha1, keys.length, ...keys.map((k) => this.prefixKey(k)), ...args);
  }

  async publish(channel: string, message: string): Promise<number> {
    const reply = await this.call('PUBLISH', channel, message);
    return typeof reply === 'number' ? reply : Number(reply ?? 0);
  }

  async subscribe(channel: string, listener: RespMessageListener): Promise<void> {
    if (this.state === 'closed') {
      throw new Error('RESP client is closed');
    }
    let set = this.subscriptions.get(channel);
    const isNewChannel = set === undefined;
    if (set === undefined) {
      set = new Set();
      this.subscriptions.set(channel, set);
    }
    set.add(listener);

    if (this.state !== 'ready') {
      await this.connect();
      return;
    }

    if (isNewChannel && this.socket !== null) {
      await this.sendSubscribeOnSocket(this.socket, 'SUBSCRIBE', [channel]);
    }
  }

  async unsubscribe(channel: string, listener?: RespMessageListener): Promise<void> {
    const set = this.subscriptions.get(channel);
    if (set === undefined) return;
    if (listener !== undefined) {
      set.delete(listener);
      if (set.size > 0) return;
    }
    this.subscriptions.delete(channel);
    if (this.state === 'ready' && this.socket !== null) {
      await this.sendSubscribeOnSocket(this.socket, 'UNSUBSCRIBE', [channel]);
    }
  }

  pipeline(): RespPipeline {
    const commands: Array<readonly (string | number | Uint8Array)[]> = [];
    const pipe: RespPipeline = {
      call: (...args) => {
        commands.push(args);
        return pipe;
      },
      get: (key) => {
        commands.push(['GET', this.prefixKey(key)]);
        return pipe;
      },
      set: (key, value, options) => {
        const args: Array<string | number> = ['SET', this.prefixKey(key), value];
        if (options?.ex !== undefined) args.push('EX', options.ex);
        if (options?.px !== undefined) args.push('PX', options.px);
        if (options?.nx === true) args.push('NX');
        if (options?.xx === true) args.push('XX');
        commands.push(args);
        return pipe;
      },
      psetex: (key, ttlMs, value) => {
        commands.push(['PSETEX', this.prefixKey(key), ttlMs, value]);
        return pipe;
      },
      incr: (key) => {
        commands.push(['INCR', this.prefixKey(key)]);
        return pipe;
      },
      expire: (key, seconds) => {
        commands.push(['EXPIRE', this.prefixKey(key), seconds]);
        return pipe;
      },
      del: (...keys) => {
        if (keys.length > 0) {
          commands.push(['DEL', ...keys.map((k) => this.prefixKey(k))]);
        }
        return pipe;
      },
      sadd: (key, ...members) => {
        if (members.length > 0) {
          commands.push(['SADD', this.prefixKey(key), ...members]);
        }
        return pipe;
      },
      exec: async (): Promise<RespValue[]> => {
        if (commands.length === 0) return [];
        if (this.state === 'closed') {
          throw new Error('RESP client is closed');
        }
        if (this.subscriptions.size > 0) {
          throw new Error('Cannot execute pipeline while RESP connection is in subscriber mode');
        }
        if (this.state !== 'ready') {
          await this.connect();
        }
        const sock = this.socket;
        if (sock === null) {
          throw new Error('RESP socket is not connected');
        }
        const encodedBuffers = commands.map((cmd) => encodeRespCommand(cmd));
        const combined = Buffer.concat(encodedBuffers);
        const promises = encodedBuffers.map(
          (encoded) =>
            new Promise<RespValue>((resolve, reject) => {
              const pending: PendingCommand = { encoded, resolve, reject, timer: null };
              this.armCommandTimer(pending);
              this.inFlight.push(pending);
            }),
        );
        sock.write(combined);
        return Promise.all(promises);
      },
    };
    return pipe;
  }

  async quit(): Promise<void> {
    if (this.state === 'closed') return;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.state === 'ready' && this.socket !== null) {
      await this.call('QUIT').catch((err: unknown) => {
        this.emitError(err instanceof Error ? err : new Error(String(err)));
      });
    }
    await this.close();
  }

  close(): Promise<void> {
    if (this.state === 'closed') return Promise.resolve();
    this.state = 'closed';
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.subscriptions.clear();
    this.rejectAllQueues(new Error('RESP client closed'));
    if (this.socket !== null) {
      const sock = this.socket;
      this.socket = null;
      sock.destroy();
    }
    return Promise.resolve();
  }
}

export function createRespClient(options: RespClientOptions): RespClient {
  return new OwnedRespClient(options);
}
