// main/kernel/protocols/src/ws.ts
/**
 * Owned RFC 6455 WebSocket handshake, framing, masking, fragmentation,
 * ping/pong, close-code validation, strict UTF-8 decoding, and backpressure
 * over Node built-ins (`node:crypto`, `node:http`, `node:stream`, `node:util`).
 */
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

export const WS_OPCODES = {
  CONTINUATION: 0x00,
  TEXT: 0x01,
  BINARY: 0x02,
  CLOSE: 0x08,
  PING: 0x09,
  PONG: 0x0a,
} as const;

export const WS_READY_STATES = {
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

type WsReadyState = (typeof WS_READY_STATES)[keyof typeof WS_READY_STATES];

interface WsSocketLike {
  readonly writableLength?: number;
  write(chunk: string | Uint8Array): boolean;
  end?(): unknown;
  destroy(): void;
  on(event: 'data', listener: (chunk: Buffer) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
}

interface WsConnectionOptions {
  readonly maxPayloadBytes?: number;
  readonly protocol?: string | null;
}

interface UpgradeWebSocketOptions {
  readonly maxPayloadBytes?: number;
  readonly head?: Uint8Array;
  readonly selectProtocol?: (protocols: readonly string[]) => string | null;
}

interface EncodeWsFrameOptions {
  readonly fin?: boolean;
  readonly maskKey?: Uint8Array;
}

interface WsEvents {
  message: (data: string | Buffer, isBinary: boolean) => void;
  ping: (payload: Buffer) => void;
  pong: (payload: Buffer) => void;
  close: (code: number, reason: string) => void;
  error: (error: Error) => void;
}

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const BASE64_16_BYTE_KEY_PATTERN = /^[A-Za-z0-9+/]{22}==$/u;
const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_CONTROL_PAYLOAD_BYTES = 125;
const fatalUtf8Decoder = new TextDecoder('utf-8', { fatal: true });

function decodeStrictUtf8(bytes: Uint8Array): string | null {
  try {
    return fatalUtf8Decoder.decode(bytes);
  } catch {
    return null;
  }
}

/** RFC 6455 §7.4 valid wire close codes. */
function isValidWireCloseCode(code: number): boolean {
  if (code < 1000) return false;
  if (code >= 1000 && code <= 1003) return true;
  if (code >= 1007 && code <= 1014) return true;
  if (code >= 3000 && code <= 4999) return true;
  return false;
}

/** Compute the RFC 6455 §4.2.2 `Sec-WebSocket-Accept` digest for a 16-byte base64 key. */
export function computeWebSocketAccept(secWebSocketKey: string): string {
  const trimmed = secWebSocketKey.trim();
  if (!BASE64_16_BYTE_KEY_PATTERN.test(trimmed)) {
    throw new TypeError('Sec-WebSocket-Key must be a base64-encoded 16-byte value');
  }
  const decoded = Buffer.from(trimmed, 'base64');
  if (decoded.byteLength !== 16) {
    throw new TypeError('Sec-WebSocket-Key must decode to 16 bytes');
  }
  return createHash('sha1').update(`${trimmed}${WS_GUID}`, 'ascii').digest('base64');
}

/** Encode a single RFC 6455 WebSocket frame (server unmasked by default, or client masked). */
export function encodeWsFrame(
  opcode: number,
  payload: Uint8Array = Buffer.alloc(0),
  options: EncodeWsFrameOptions = {},
): Buffer {
  const finBit = options.fin === false ? 0x00 : 0x80;
  const maskKey = options.maskKey;
  if (maskKey !== undefined && maskKey.byteLength !== 4) {
    throw new TypeError('WebSocket maskKey must be 4 bytes');
  }
  const maskBit = maskKey !== undefined ? 0x80 : 0x00;
  const len = payload.byteLength;

  let headerLen = 2;
  if (len >= 126 && len <= 0xffff) {
    headerLen = 4;
  } else if (len > 0xffff) {
    headerLen = 10;
  }

  const maskLen = maskKey !== undefined ? 4 : 0;
  const frame = Buffer.allocUnsafe(headerLen + maskLen + len);
  frame[0] = finBit | (opcode & 0x0f);

  if (len < 126) {
    frame[1] = maskBit | len;
  } else if (len <= 0xffff) {
    frame[1] = maskBit | 126;
    frame.writeUInt16BE(len, 2);
  } else {
    frame[1] = maskBit | 127;
    frame.writeBigUInt64BE(BigInt(len), 2);
  }

  if (maskKey !== undefined) {
    Buffer.from(maskKey).copy(frame, headerLen);
    const bodyStart = headerLen + 4;
    for (let i = 0; i < len; i += 1) {
      frame[bodyStart + i] = (payload[i] ?? 0) ^ (maskKey[i & 3] ?? 0);
    }
  } else if (len > 0) {
    Buffer.from(payload).copy(frame, headerLen);
  }

  return frame;
}

/** Server-side RFC 6455 WebSocket connection over a Node stream/socket. */
export class WsConnection {
  readonly protocol: string | null;
  private state: WsReadyState = WS_READY_STATES.OPEN;
  private readonly socket: WsSocketLike;
  private readonly maxPayloadBytes: number;
  private buffer: Buffer = Buffer.alloc(0);

  private fragmentOpcode: number | null = null;
  private fragmentChunks: Buffer[] = [];
  private fragmentBytes = 0;
  private closeEmitted = false;

  private readonly listeners: {
    [K in keyof WsEvents]: Set<WsEvents[K]>;
  } = {
    message: new Set(),
    ping: new Set(),
    pong: new Set(),
    close: new Set(),
    error: new Set(),
  };

  constructor(socket: WsSocketLike, options: WsConnectionOptions = {}) {
    this.socket = socket;
    this.maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
    this.protocol = options.protocol ?? null;

    socket.on('data', (chunk: Buffer) => {
      this.onData(chunk);
    });
    socket.on('close', () => {
      this.state = WS_READY_STATES.CLOSED;
      this.emitCloseOnce(1006, '');
    });
    socket.on('error', (err: Error) => {
      for (const fn of this.listeners.error) {
        fn(err);
      }
      this.terminate();
    });
  }

  get readyState(): WsReadyState {
    return this.state;
  }

  get bufferedAmount(): number {
    return this.socket.writableLength ?? 0;
  }

  on<K extends keyof WsEvents>(event: K, listener: WsEvents[K]): this {
    this.listeners[event].add(listener);
    return this;
  }

  once<K extends keyof WsEvents>(event: K, listener: WsEvents[K]): this {
    const wrapper = ((...args: Parameters<WsEvents[K]>) => {
      this.listeners[event].delete(wrapper);
      (listener as (...a: Parameters<WsEvents[K]>) => void)(...args);
    }) as WsEvents[K];
    this.listeners[event].add(wrapper);
    return this;
  }

  send(data: string | Uint8Array): void {
    if (this.state !== WS_READY_STATES.OPEN) return;
    if (typeof data === 'string') {
      this.socket.write(encodeWsFrame(WS_OPCODES.TEXT, Buffer.from(data, 'utf8')));
    } else {
      this.socket.write(encodeWsFrame(WS_OPCODES.BINARY, data));
    }
  }

  ping(payload: Uint8Array = Buffer.alloc(0)): void {
    if (this.state !== WS_READY_STATES.OPEN) return;
    if (payload.byteLength > MAX_CONTROL_PAYLOAD_BYTES) {
      throw new RangeError('WebSocket PING payload cannot exceed 125 bytes');
    }
    this.socket.write(encodeWsFrame(WS_OPCODES.PING, payload));
  }

  pong(payload: Uint8Array = Buffer.alloc(0)): void {
    if (this.state !== WS_READY_STATES.OPEN) return;
    if (payload.byteLength > MAX_CONTROL_PAYLOAD_BYTES) {
      throw new RangeError('WebSocket PONG payload cannot exceed 125 bytes');
    }
    this.socket.write(encodeWsFrame(WS_OPCODES.PONG, payload));
  }

  close(code = 1000, reason = ''): void {
    if (this.state === WS_READY_STATES.CLOSED || this.state === WS_READY_STATES.CLOSING) {
      return;
    }
    this.state = WS_READY_STATES.CLOSING;

    const reasonBuf = Buffer.from(reason, 'utf8').subarray(0, 123);
    const payload = Buffer.allocUnsafe(2 + reasonBuf.byteLength);
    payload.writeUInt16BE(isValidWireCloseCode(code) ? code : 1000, 0);
    reasonBuf.copy(payload, 2);

    const frame = encodeWsFrame(WS_OPCODES.CLOSE, payload);
    try {
      this.socket.write(frame);
      if (typeof this.socket.end === 'function') {
        this.socket.end();
      } else {
        this.socket.destroy();
      }
    } catch {
      this.socket.destroy();
    }
    this.state = WS_READY_STATES.CLOSED;
    this.emitCloseOnce(code, reason);
  }

  terminate(): void {
    this.state = WS_READY_STATES.CLOSED;
    this.socket.destroy();
    this.emitCloseOnce(1006, '');
  }

  feedInitialHead(head: Uint8Array): void {
    if (head.byteLength > 0) {
      this.onData(Buffer.from(head));
    }
  }

  private emitCloseOnce(code: number, reason: string): void {
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    for (const fn of this.listeners.close) {
      fn(code, reason);
    }
  }

  private failProtocol(code: number, reason: string): void {
    this.buffer = Buffer.alloc(0);
    this.fragmentOpcode = null;
    this.fragmentChunks = [];
    this.fragmentBytes = 0;
    this.close(code, reason);
  }

  private onData(chunk: Buffer): void {
    if (this.state === WS_READY_STATES.CLOSED || chunk.byteLength === 0) return;

    this.buffer =
      this.buffer.byteLength === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk]);

    let offset = 0;
    while (this.readyState !== WS_READY_STATES.CLOSED && offset + 2 <= this.buffer.byteLength) {
      const b0 = this.buffer[offset] ?? 0;
      const b1 = this.buffer[offset + 1] ?? 0;

      const fin = (b0 & 0x80) !== 0;
      const rsv = b0 & 0x70;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;

      if (rsv !== 0) {
        this.failProtocol(1002, 'RSV bits must be 0');
        return;
      }
      if (!masked) {
        this.failProtocol(1002, 'Client frames must be masked');
        return;
      }

      const isControl = (opcode & 0x08) !== 0;
      if (
        opcode !== WS_OPCODES.CONTINUATION &&
        opcode !== WS_OPCODES.TEXT &&
        opcode !== WS_OPCODES.BINARY &&
        opcode !== WS_OPCODES.CLOSE &&
        opcode !== WS_OPCODES.PING &&
        opcode !== WS_OPCODES.PONG
      ) {
        this.failProtocol(1002, 'Unsupported opcode');
        return;
      }

      if (isControl) {
        if (!fin) {
          this.failProtocol(1002, 'Control frames must not be fragmented');
          return;
        }
        if (payloadLen > MAX_CONTROL_PAYLOAD_BYTES) {
          this.failProtocol(1002, 'Control frame payload exceeds 125 bytes');
          return;
        }
      }

      let headerLen = 2;
      if (payloadLen === 126) {
        if (offset + 4 > this.buffer.byteLength) break;
        payloadLen = this.buffer.readUInt16BE(offset + 2);
        headerLen = 4;
      } else if (payloadLen === 127) {
        if (offset + 10 > this.buffer.byteLength) break;
        const bigLen = this.buffer.readBigUInt64BE(offset + 2);
        if ((bigLen & (1n << 63n)) !== 0n) {
          this.failProtocol(1002, 'Invalid 64-bit payload length MSB');
          return;
        }
        if (bigLen > BigInt(this.maxPayloadBytes)) {
          this.failProtocol(1009, 'Message too big');
          return;
        }
        payloadLen = Number(bigLen);
        headerLen = 10;
      }

      if (!isControl) {
        const projectedTotal =
          opcode === WS_OPCODES.CONTINUATION ? this.fragmentBytes + payloadLen : payloadLen;
        if (projectedTotal > this.maxPayloadBytes) {
          this.failProtocol(1009, 'Message too big');
          return;
        }
      }

      const frameTotalBytes = headerLen + 4 + payloadLen;
      if (offset + frameTotalBytes > this.buffer.byteLength) {
        break;
      }

      const maskStart = offset + headerLen;
      const m0 = this.buffer[maskStart] ?? 0;
      const m1 = this.buffer[maskStart + 1] ?? 0;
      const m2 = this.buffer[maskStart + 2] ?? 0;
      const m3 = this.buffer[maskStart + 3] ?? 0;
      const maskBytes = [m0, m1, m2, m3];

      const payloadStart = maskStart + 4;
      const unmasked = Buffer.allocUnsafe(payloadLen);
      for (let i = 0; i < payloadLen; i += 1) {
        unmasked[i] = (this.buffer[payloadStart + i] ?? 0) ^ (maskBytes[i & 3] ?? 0);
      }

      offset += frameTotalBytes;
      this.dispatchFrame(fin, opcode, unmasked);
    }

    if (offset > 0 && this.buffer.byteLength > 0) {
      this.buffer =
        offset >= this.buffer.byteLength
          ? Buffer.alloc(0)
          : Buffer.from(this.buffer.subarray(offset));
    }
  }

  private dispatchFrame(fin: boolean, opcode: number, payload: Buffer): void {
    switch (opcode) {
      case WS_OPCODES.PING: {
        if (this.state === WS_READY_STATES.OPEN) {
          this.pong(payload);
        }
        for (const fn of this.listeners.ping) {
          fn(payload);
        }
        return;
      }
      case WS_OPCODES.PONG: {
        for (const fn of this.listeners.pong) {
          fn(payload);
        }
        return;
      }
      case WS_OPCODES.CLOSE: {
        if (payload.byteLength === 1) {
          this.failProtocol(1002, 'Invalid 1-byte close payload');
          return;
        }
        let code = 1005;
        let reason = '';
        if (payload.byteLength >= 2) {
          code = payload.readUInt16BE(0);
          if (!isValidWireCloseCode(code)) {
            this.failProtocol(1002, 'Invalid close code');
            return;
          }
          const decoded = decodeStrictUtf8(payload.subarray(2));
          if (decoded === null) {
            this.failProtocol(1007, 'Invalid UTF-8 in close reason');
            return;
          }
          reason = decoded;
        }
        if (this.state === WS_READY_STATES.OPEN) {
          this.close(code === 1005 ? 1000 : code, reason);
        } else {
          this.state = WS_READY_STATES.CLOSED;
          this.socket.destroy();
          this.emitCloseOnce(code, reason);
        }
        return;
      }
      case WS_OPCODES.CONTINUATION: {
        if (this.fragmentOpcode === null) {
          this.failProtocol(1002, 'Unexpected continuation frame');
          return;
        }
        this.fragmentChunks.push(payload);
        this.fragmentBytes += payload.byteLength;
        if (fin) {
          const full = Buffer.concat(this.fragmentChunks, this.fragmentBytes);
          const messageOpcode = this.fragmentOpcode;
          this.fragmentOpcode = null;
          this.fragmentChunks = [];
          this.fragmentBytes = 0;
          this.deliverDataMessage(messageOpcode, full);
        }
        return;
      }
      case WS_OPCODES.TEXT:
      case WS_OPCODES.BINARY: {
        if (this.fragmentOpcode !== null) {
          this.failProtocol(1002, 'Data opcode received before fragmented message completed');
          return;
        }
        if (fin) {
          this.deliverDataMessage(opcode, payload);
        } else {
          this.fragmentOpcode = opcode;
          this.fragmentChunks = [payload];
          this.fragmentBytes = payload.byteLength;
        }
        return;
      }
    }
  }

  private deliverDataMessage(opcode: number, payload: Buffer): void {
    if (opcode === WS_OPCODES.TEXT) {
      const text = decodeStrictUtf8(payload);
      if (text === null) {
        this.failProtocol(1007, 'Invalid UTF-8 in text message');
        return;
      }
      for (const fn of this.listeners.message) {
        fn(text, false);
      }
    } else {
      for (const fn of this.listeners.message) {
        fn(payload, true);
      }
    }
  }
}

function writeHttpRejection(
  socket: Duplex,
  status: number,
  statusText: string,
  extraHeaders: readonly string[] = [],
): void {
  const lines = [
    `HTTP/1.1 ${String(status)} ${statusText}`,
    'Connection: close',
    'Content-Type: text/plain; charset=utf-8',
    `Content-Length: ${String(Buffer.byteLength(statusText))}`,
    ...extraHeaders,
    '',
    statusText,
  ];
  socket.write(lines.join('\r\n'));
  socket.destroy();
}

function headerFirstString(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join(', ');
  return '';
}

/** Perform an RFC 6455 HTTP/1.1 upgrade handshake on a raw `node:http` `upgrade` socket. */
export function upgradeWebSocket(
  request: IncomingMessage,
  socket: Duplex,
  head: Uint8Array = Buffer.alloc(0),
  options: UpgradeWebSocketOptions = {},
): WsConnection | null {
  if (request.method !== 'GET') {
    writeHttpRejection(socket, 400, 'Bad Request');
    return null;
  }

  const upgradeHeader = headerFirstString(request.headers.upgrade).toLowerCase();
  const connectionHeader = headerFirstString(request.headers.connection).toLowerCase();
  if (upgradeHeader !== 'websocket' || !connectionHeader.includes('upgrade')) {
    writeHttpRejection(socket, 400, 'Bad Request');
    return null;
  }

  const versionHeader = headerFirstString(request.headers['sec-websocket-version']).trim();
  if (versionHeader !== '13') {
    writeHttpRejection(socket, 426, 'Upgrade Required', ['Sec-WebSocket-Version: 13']);
    return null;
  }

  const rawKey = headerFirstString(request.headers['sec-websocket-key']);
  let acceptDigest: string;
  try {
    acceptDigest = computeWebSocketAccept(rawKey);
  } catch {
    writeHttpRejection(socket, 400, 'Bad Request');
    return null;
  }

  const rawProtocols = headerFirstString(request.headers['sec-websocket-protocol']);
  const requestedProtocols =
    rawProtocols === ''
      ? []
      : rawProtocols
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0);

  const selectedProtocol =
    requestedProtocols.length > 0 && options.selectProtocol !== undefined
      ? options.selectProtocol(requestedProtocols)
      : null;

  const responseLines = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptDigest}`,
  ];
  if (selectedProtocol !== null) {
    responseLines.push(`Sec-WebSocket-Protocol: ${selectedProtocol}`);
  }
  responseLines.push('', '');

  socket.write(responseLines.join('\r\n'));

  const connection = new WsConnection(socket, {
    ...(options.maxPayloadBytes !== undefined ? { maxPayloadBytes: options.maxPayloadBytes } : {}),
    protocol: selectedProtocol,
  });
  connection.feedInitialHead(head);
  return connection;
}
