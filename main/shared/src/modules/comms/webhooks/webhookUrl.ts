// main/shared/src/modules/comms/webhooks/webhookUrl.ts
/**
 * Where a webhook is allowed to point.
 *
 * A webhook URL is attacker-supplied and the server fetches it. That is the
 * definition of SSRF: an authenticated user picks an address, and our machine —
 * inside the private network, holding the cloud credentials — makes the request
 * on their behalf. Schema validation alone (`new URL()`) happily accepts
 * `http://localhost:8080/hook`.
 *
 * THE ONE THAT MATTERS MOST: `169.254.169.254`. On a cloud VM that is the
 * metadata endpoint, and it serves instance credentials to anything that can
 * reach it. A webhook pointed there turns "post JSON to my server" into "read
 * me your infrastructure secrets" — which is why the metadata check is exposed
 * separately (`isCloudMetadataWebhookUrl`) and enforced even when a self-hosted
 * deployment opts in to private targets.
 *
 * WHAT THIS DOES NOT DO, stated plainly rather than implied by omission: it
 * cannot stop DNS rebinding. `evil.com` may resolve to a public address now and
 * to 127.0.0.1 when the delivery actually fires. Closing that needs a check at
 * connection time, against the resolved address, in the delivery path — not in
 * a URL parser. This raises the floor; it is not the whole building.
 */

/** Only these two schemes. `file:`, `gopher:` and friends are SSRF classics. */
const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

/** Hostnames that always mean "this machine", however they are spelled. */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  'ip6-localhost',
  'ip6-loopback',
]);

/** Well-known metadata hostnames that bypass the IP-literal checks. */
const METADATA_HOSTNAMES: ReadonlySet<string> = new Set(['metadata.google.internal']);

/** Decimal dotted-quad → its four octets, or undefined when it is not one. */
function ipv4Octets(hostname: string): readonly number[] | undefined {
  const parts = hostname.split('.');
  if (parts.length !== 4) return undefined;

  const octets: number[] = [];
  for (const part of parts) {
    // Reject '', '01', '1e2', '+1' — anything that is not a plain decimal byte.
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const value = Number(part);
    if (value > 255) return undefined;
    octets.push(value);
  }
  return octets;
}

/**
 * Whether an IPv4 address is one nobody outside this network should reach.
 *
 * @complexity O(1)
 */
function isPrivateIpv4(octets: readonly number[]): boolean {
  const [a = 0, b = 0] = octets;

  if (a === 0) return true; // 0.0.0.0/8 — "this network", and 0.0.0.0 itself
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // 127/8 loopback — the whole range, not just .1
  if (a === 169 && b === 254) return true; // 169.254/16 link-local — CLOUD METADATA
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 carrier NAT
  if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24 special-use
  if (a >= 224) return true; // multicast, and 240/4 reserved

  return false;
}

/** 169.254/16 — the link-local range every cloud metadata service lives in. */
function isMetadataIpv4(octets: readonly number[]): boolean {
  const [a = 0, b = 0] = octets;
  return a === 169 && b === 254;
}

/** Bracket-stripped, zone-stripped, lower-cased IPv6 literal, or ''. */
function normalizeIpv6(hostname: string): string {
  return (
    hostname
      .replace(/^\[|\]$/g, '')
      .split('%')[0]
      ?.toLowerCase() ?? ''
  );
}

/** IPv4-mapped IPv6 (`::ffff:…`) → the embedded IPv4 octets, in both spellings. */
function mappedIpv4Octets(address: string): readonly number[] | undefined {
  // ::ffff:127.0.0.1 — an IPv4 address wearing an IPv6 costume.
  //
  // Both spellings, because the URL parser rewrites one into the other:
  // `new URL('http://[::ffff:127.0.0.1]/')` reports its hostname as
  // `[::ffff:7f00:1]`. A guard that only knew the dotted form would pass the
  // very input it was written to block.
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (dotted?.[1] !== undefined) return ipv4Octets(dotted[1]);

  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
  if (hex?.[1] !== undefined && hex[2] !== undefined) {
    const high = Number.parseInt(hex[1], 16);
    const low = Number.parseInt(hex[2], 16);
    return [high >> 8, high & 0xff, low >> 8, low & 0xff];
  }

  return undefined;
}

/**
 * Whether an IPv6 literal is loopback, unspecified, unique-local or link-local.
 *
 * This is deliberately coarse: it is a deny-list of the ranges that reach
 * inward, not a full IPv6 parser.
 *
 * @complexity O(1)
 */
function isPrivateIpv6(hostname: string): boolean {
  const address = normalizeIpv6(hostname);

  if (address === '::1' || address === '::') return true;
  // fc00::/7 unique-local, fe80::/10 link-local.
  if (/^f[cd][0-9a-f]{0,2}:/.test(address)) return true;
  if (/^fe[89ab][0-9a-f]?:/.test(address)) return true;

  const mapped = mappedIpv4Octets(address);
  if (mapped !== undefined) return isPrivateIpv4(mapped);
  // A malformed ::ffff: form we could not decode is rejected, not guessed at.
  if (address.startsWith('::ffff:')) return true;

  return false;
}

/**
 * Whether this URL is safe to hand to a server-side fetch.
 *
 * @param raw - The candidate webhook URL
 * @returns True when it parses, uses http(s), and does not point inward
 * @complexity O(1)
 */
export function isPubliclyRoutableWebhookUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return false;

  // Credentials in the URL are their own smell, and they leak into logs.
  if (url.username !== '' || url.password !== '') return false;

  const hostname = url.hostname.toLowerCase();
  if (hostname === '') return false;
  if (LOOPBACK_HOSTNAMES.has(hostname)) return false;
  if (METADATA_HOSTNAMES.has(hostname)) return false;
  // `foo.localhost` resolves to loopback on most systems.
  if (hostname.endsWith('.localhost')) return false;

  const octets = ipv4Octets(hostname);
  if (octets !== undefined) return !isPrivateIpv4(octets);

  if (hostname.includes(':') || hostname.startsWith('[')) return !isPrivateIpv6(hostname);

  return true;
}

/**
 * Whether this URL points at a cloud metadata service (169.254/16 in any
 * spelling, or a well-known metadata hostname).
 *
 * Kept separate from {@link isPubliclyRoutableWebhookUrl} because it is the one
 * check that must hold EVEN when a self-hosted deployment legitimately targets
 * internal hosts: no deployment, hosted or not, has a reason to webhook the
 * endpoint that serves its infrastructure credentials.
 *
 * @param raw - The candidate webhook URL
 * @complexity O(1)
 */
export function isCloudMetadataWebhookUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  const hostname = url.hostname.toLowerCase();
  if (METADATA_HOSTNAMES.has(hostname)) return true;

  const octets = ipv4Octets(hostname);
  if (octets !== undefined) return isMetadataIpv4(octets);

  if (hostname.includes(':') || hostname.startsWith('[')) {
    const address = normalizeIpv6(hostname);
    if (/^fe[89ab][0-9a-f]?:/.test(address)) return true; // v6 link-local
    const mapped = mappedIpv4Octets(address);
    return mapped !== undefined && isMetadataIpv4(mapped);
  }

  return false;
}

/** Why a URL was refused — one message, so every caller says the same thing. */
export const WEBHOOK_URL_REJECTION =
  'Webhook URL must be a public http(s) address. Internal, loopback and link-local addresses are not allowed.';

/** The metadata endpoint is refused unconditionally, so its message says why. */
export const WEBHOOK_METADATA_REJECTION = 'Webhook URL must not target a cloud metadata endpoint.';
