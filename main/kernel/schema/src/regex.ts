// main/kernel/schema/src/regex.ts
/**
 * Pure isomorphic regular expressions and URL validation for `@bslt/schema`.
 * Zero dependencies; no Node or DOM globals.
 */

/** Standard HTML5-compliant email pattern. */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/** Generic HTTP/HTTPS URL pattern. */
export const URL_REGEX = /^https?:\/\/.+/u;

/** UUID v1–v5 pattern (case-insensitive). */
export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** IPv4 dotted-quad pattern. */
export const IP_V4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/u;

/** IPv6 colon-hex pattern. */
export const IP_V6_REGEX = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/u;

const SCHEME_REGEX = /^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/su;
const SPECIAL_SCHEMES = new Set(['http', 'https', 'ws', 'wss', 'ftp']);
const WHITESPACE_REGEX = /\s/u;

function hasForbiddenUrlChar(value: string): boolean {
  if (WHITESPACE_REGEX.test(value)) return true;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function hasValidAuthority(remainder: string): boolean {
  if (!remainder.startsWith('//')) return false;
  const afterSlashes = remainder.slice(2);
  const authorityEnd = afterSlashes.search(/[/?#]/u);
  const authority = authorityEnd === -1 ? afterSlashes : afterSlashes.slice(0, authorityEnd);
  if (authority.length === 0) return false;

  const atIndex = authority.lastIndexOf('@');
  const hostPort = atIndex === -1 ? authority : authority.slice(atIndex + 1);
  if (hostPort.length === 0) return false;

  if (hostPort.startsWith('[')) {
    const closeBracket = hostPort.indexOf(']');
    if (closeBracket <= 1) return false;
    const portSuffix = hostPort.slice(closeBracket + 1);
    if (portSuffix.length === 0) return true;
    if (!portSuffix.startsWith(':')) return false;
    return isValidPort(portSuffix.slice(1));
  }

  const colonIndex = hostPort.indexOf(':');
  if (colonIndex === -1) return true;
  const host = hostPort.slice(0, colonIndex);
  const port = hostPort.slice(colonIndex + 1);
  if (host.length === 0) return false;
  return isValidPort(port);
}

function isValidPort(port: string): boolean {
  if (port.length === 0) return true;
  if (!/^\d+$/u.test(port)) return false;
  const num = Number(port);
  return Number.isInteger(num) && num >= 0 && num <= 65535;
}

/**
 * Pure ES2023 RFC 3986 / WHATWG-compatible absolute URL check without DOM or Node `URL`.
 */
export function isValidAbsoluteUrl(url: string): boolean {
  if (url.length === 0 || hasForbiddenUrlChar(url)) return false;
  const match = SCHEME_REGEX.exec(url);
  if (match === null) return false;
  const scheme = (match[1] ?? '').toLowerCase();
  const remainder = match[2] ?? '';
  if (SPECIAL_SCHEMES.has(scheme)) {
    return hasValidAuthority(remainder);
  }
  if (scheme === 'file') {
    return remainder.startsWith('//');
  }
  if (remainder.startsWith('//')) {
    return hasValidAuthority(remainder);
  }
  return remainder.length > 0;
}
