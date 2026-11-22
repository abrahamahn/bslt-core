// main/kernel/server/src/module/sealed.ts
/**
 * Outbox `sealed(schema)` AES-256-GCM encryption and decryption (Plan §7.4, §8.1).
 *
 * Secret fields marked with `sealed(schema)` are redacted (`[REDACTED]`) in
 * `sys_outbox.payload` and `sys_jobs.args`, encrypted with AES-256-GCM into
 * `sys_outbox.sealed` (bound to `${eventName}:v${version}` via AAD), and
 * decrypted only inside subscriber invocation.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

import {
  describe as describeSchema,
  redactSealed,
  type Schema,
  type SchemaNode,
} from '@bslt/schema';

const SEAL_VERSION = 0x01;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES;
const KEY_CONTEXT = 'bslt-outbox-sealed-v1';

export class OutboxSealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboxSealError';
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function escapePointerToken(token: string): string {
  return token.replaceAll('~', '~0').replaceAll('/', '~1');
}

function unescapePointerToken(token: string): string {
  return token.replaceAll('~1', '/').replaceAll('~0', '~');
}

function deriveKey(secret: string): Buffer {
  if (secret.length === 0) {
    throw new OutboxSealError('Outbox seal secret must be a non-empty string');
  }
  return createHmac('sha256', secret).update(KEY_CONTEXT).digest();
}

function collectSealedEntries(
  node: SchemaNode,
  value: unknown,
  pointer: string,
  out: Map<string, unknown>,
): void {
  if (value === undefined) return;

  switch (node.kind) {
    case 'sealed':
      out.set(pointer, value);
      return;
    case 'optional':
    case 'brand':
    case 'refine':
      collectSealedEntries(node.inner, value, pointer, out);
      return;
    case 'nullable':
      if (value === null) return;
      collectSealedEntries(node.inner, value, pointer, out);
      return;
    case 'array':
      if (!Array.isArray(value)) return;
      for (let i = 0; i < value.length; i++) {
        collectSealedEntries(node.items, value[i], `${pointer}/${String(i)}`, out);
      }
      return;
    case 'record':
      if (!isPlainRecord(value)) return;
      for (const key of Object.keys(value)) {
        collectSealedEntries(node.values, value[key], `${pointer}/${escapePointerToken(key)}`, out);
      }
      return;
    case 'object':
      if (!isPlainRecord(value)) return;
      for (const key of Object.keys(value)) {
        const propNode = node.properties[key];
        if (propNode !== undefined) {
          collectSealedEntries(propNode, value[key], `${pointer}/${escapePointerToken(key)}`, out);
        }
      }
      return;
    case 'discriminated': {
      if (!isPlainRecord(value)) return;
      const tag = value[node.discriminator];
      if (typeof tag === 'string') {
        const variant = node.mapping[tag];
        if (variant !== undefined) {
          collectSealedEntries(variant, value, pointer, out);
        }
      }
      return;
    }
    case 'union':
      for (const branch of node.anyOf) {
        if (branch.kind === 'sealed') {
          out.set(pointer, value);
          return;
        }
      }
      return;
    case 'opaque':
    case 'json':
    case 'string':
    case 'number':
    case 'boolean':
    case 'literal':
    case 'enum':
    case 'bigintString':
      return;
  }
}

function deepCloneValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => deepCloneValue(item));
  }
  if (isPlainRecord(value)) {
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      Object.defineProperty(copy, key, {
        value: deepCloneValue(value[key]),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return copy;
  }
  return value;
}

function setAtPointer(root: unknown, pointer: string, secretValue: unknown): unknown {
  if (pointer === '') {
    return secretValue;
  }
  if (!pointer.startsWith('/')) {
    throw new OutboxSealError(`Malformed sealed field pointer: ${pointer}`);
  }
  const tokens = pointer
    .slice(1)
    .split('/')
    .map((t) => unescapePointerToken(t));

  let current: unknown = root;
  for (let i = 0; i < tokens.length - 1; i++) {
    const tok = tokens[i] ?? '';
    if (Array.isArray(current)) {
      const idx = Number(tok);
      if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) {
        throw new OutboxSealError(`Out-of-bounds array index in sealed pointer: ${pointer}`);
      }
      current = current[idx];
    } else if (isPlainRecord(current) && Object.hasOwn(current, tok)) {
      current = current[tok];
    } else {
      throw new OutboxSealError(`Cannot traverse sealed pointer: ${pointer}`);
    }
  }

  const leaf = tokens[tokens.length - 1] ?? '';
  if (Array.isArray(current)) {
    const idx = Number(leaf);
    if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) {
      throw new OutboxSealError(`Out-of-bounds leaf array index in sealed pointer: ${pointer}`);
    }
    current[idx] = secretValue;
    return root;
  }
  if (isPlainRecord(current)) {
    Object.defineProperty(current, leaf, {
      value: secretValue,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    return root;
  }
  throw new OutboxSealError(`Invalid target container at sealed pointer: ${pointer}`);
}

function encryptSealedMap(
  entries: ReadonlyMap<string, unknown>,
  secret: string,
  aad: string,
): Buffer {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));

  const obj: Record<string, unknown> = {};
  for (const [ptr, val] of entries) {
    Object.defineProperty(obj, ptr, {
      value: val,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([SEAL_VERSION]), iv, authTag, ciphertext]);
}

function decryptSealedMap(
  sealedBytes: Buffer,
  secret: string,
  aad: string,
): ReadonlyMap<string, unknown> {
  const key = deriveKey(secret);
  if (sealedBytes.length < HEADER_BYTES + 2) {
    throw new OutboxSealError('Sealed outbox buffer is truncated');
  }
  if (sealedBytes[0] !== SEAL_VERSION) {
    throw new OutboxSealError(
      `Unsupported sealed outbox format version: ${String(sealedBytes[0])}`,
    );
  }

  const iv = sealedBytes.subarray(1, 1 + IV_BYTES);
  const authTag = sealedBytes.subarray(1 + IV_BYTES, HEADER_BYTES);
  const ciphertext = sealedBytes.subarray(HEADER_BYTES);

  let plaintext: Buffer;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(authTag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new OutboxSealError('Failed to authenticate or decrypt sealed outbox payload');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext.toString('utf8')) as unknown;
  } catch {
    throw new OutboxSealError('Decrypted sealed outbox payload is not valid JSON');
  }

  if (!isPlainRecord(parsed)) {
    throw new OutboxSealError('Decrypted sealed outbox payload must be a plain object map');
  }

  const out = new Map<string, unknown>();
  for (const ptr of Object.keys(parsed)) {
    out.set(ptr, parsed[ptr]);
  }
  return out;
}

export function sealEventPayload<T>(
  schema: Schema<T>,
  payload: T,
  secret: string,
  aad: string,
): { readonly payload: unknown; readonly sealed: Buffer | null } {
  deriveKey(secret);
  const parsed = schema.parse(payload);
  const entries = new Map<string, unknown>();
  collectSealedEntries(describeSchema(schema), parsed, '', entries);
  if (entries.size === 0) {
    return { payload: parsed, sealed: null };
  }
  const redacted = redactSealed(schema, parsed);
  const sealed = encryptSealedMap(entries, secret, aad);
  return { payload: redacted, sealed };
}

export function unsealEventPayload<T>(
  schema: Schema<T>,
  redactedPayload: unknown,
  sealedBytes: Buffer | null,
  secret: string,
  aad: string,
): T {
  deriveKey(secret);
  const expectedEntries = new Map<string, unknown>();
  collectSealedEntries(describeSchema(schema), redactedPayload, '', expectedEntries);

  if (sealedBytes === null) {
    if (expectedEntries.size > 0) {
      throw new OutboxSealError(
        'Event schema expects sealed secret fields, but outbox row carries no sealed bytes',
      );
    }
    return schema.parse(redactedPayload);
  }

  const decrypted = decryptSealedMap(sealedBytes, secret, aad);
  let hydrated = deepCloneValue(redactedPayload);
  for (const [ptr, val] of decrypted) {
    hydrated = setAtPointer(hydrated, ptr, val);
  }
  return schema.parse(hydrated);
}
