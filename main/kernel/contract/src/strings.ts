// main/kernel/contract/src/strings.ts

interface CryptoLike {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

function getCrypto(): CryptoLike {
  const c = (globalThis as Record<string, unknown>)['crypto'] as CryptoLike | undefined;
  if (c !== undefined && typeof c.getRandomValues === 'function') {
    return c;
  }
  throw new Error(
    'Crypto API not available. This package requires Node.js 24+ or a modern browser.',
  );
}

export function camelToSnake(str: string): string {
  if (str === str.toUpperCase()) {
    return str.toLowerCase();
  }
  if (str === '') return '';

  let out = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i] as string;
    const code = str.charCodeAt(i);
    const prevCode = i > 0 ? str.charCodeAt(i - 1) : 0;
    const nextCode = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;

    if (ch === '-') {
      out += '_';
      continue;
    }

    const isUpper = code >= 65 && code <= 90;
    const prevIsLowerOrDigitOrUnderscore =
      (prevCode >= 97 && prevCode <= 122) || (prevCode >= 48 && prevCode <= 57) || prevCode === 95;
    const prevIsUpper = prevCode >= 65 && prevCode <= 90;
    const nextIsLower = nextCode >= 97 && nextCode <= 122;
    const needsBoundary =
      i > 0 && isUpper && (prevIsLowerOrDigitOrUnderscore || (prevIsUpper && nextIsLower));

    if (needsBoundary && out[out.length - 1] !== '_') {
      out += '_';
    }
    out += isUpper ? ch.toLowerCase() : ch;
  }

  return out;
}

export function snakeToCamel(str: string): string {
  const input = str === str.toUpperCase() ? str.toLowerCase() : str;

  return input
    .replace(/[-_]+(.)?/g, (_, c: string | undefined) =>
      c !== undefined && c !== '' ? c.toUpperCase() : '',
    )
    .replace(/^(.)/, (c: string) => c.toLowerCase());
}

function mapKeys(
  obj: unknown,
  mapper: (key: string) => string,
  seen = new WeakMap<object, unknown>(),
): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }
  if (obj instanceof Date || obj instanceof RegExp || ArrayBuffer.isView(obj)) {
    return obj;
  }
  if (seen.has(obj)) {
    return seen.get(obj);
  }
  if (Array.isArray(obj)) {
    const result: unknown[] = [];
    seen.set(obj, result);
    obj.forEach((v) => result.push(mapKeys(v, mapper, seen)));
    return result;
  }
  const result: Record<string | symbol, unknown> = {};
  seen.set(obj, result);

  const o = obj as Record<string, unknown>;
  for (const key in o) {
    if (Object.prototype.hasOwnProperty.call(o, key)) {
      const newKey = mapper(key);
      result[newKey] = mapKeys(o[key], mapper, seen);
    }
  }
  const symKeys = Object.getOwnPropertySymbols(o);
  for (const sym of symKeys) {
    result[sym] = (o as Record<symbol, unknown>)[sym];
  }
  return result;
}

export function snakeifyKeys(obj: unknown): unknown {
  return mapKeys(obj, camelToSnake);
}

export function camelizeKeys(obj: unknown): unknown {
  return mapKeys(obj, snakeToCamel);
}

export function capitalize(str: string): string {
  if (str === '') return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export function canonicalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const atIndex = normalized.indexOf('@');
  if (atIndex === -1) return normalized;

  let localPart = normalized.substring(0, atIndex);
  const domain = normalized.substring(atIndex + 1);

  const plusIndex = localPart.indexOf('+');
  if (plusIndex !== -1) {
    localPart = localPart.substring(0, plusIndex);
  }

  const gmailDomains = ['gmail.com', 'googlemail.com'];
  if (gmailDomains.includes(domain)) {
    localPart = localPart.replace(/\./g, '');
  }

  return `${localPart}@${domain}`;
}

export function trimTrailingSlashes(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end--;
  }
  return value.slice(0, end);
}

export function escapeHtml(str: string): string {
  if (str === '') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export function generateSecureId(length = 16): string {
  if (length <= 0) return '';
  const crypto = getCrypto();
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const charCount = chars.length;
  const maxUnbiased = Math.floor(256 / charCount) * charCount;

  const result: string[] = [];
  const batchSize = Math.ceil(length * 1.05) + 8;

  while (result.length < length) {
    const batch = new Uint8Array(batchSize);
    crypto.getRandomValues(batch);

    for (let i = 0; i < batch.length && result.length < length; i++) {
      const val = batch[i] ?? 0;
      if (val < maxUnbiased) {
        result.push(chars[val % charCount] ?? '');
      }
    }
  }

  return result.join('');
}

export function delay(ms: number): Promise<void> {
  const timer = (
    globalThis as unknown as { setTimeout: (callback: () => void, timeoutMs: number) => unknown }
  ).setTimeout;
  return new Promise((resolve) => {
    timer(resolve, ms);
  });
}
