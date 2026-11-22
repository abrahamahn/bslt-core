// main/kernel/realtime/src/tickets.ts
/**
 * Single-use WebSocket upgrade tickets and server-signed channel grants
 * replacing the legacy JWT-in-Sec-WebSocket-Protocol workaround (plan §8.6).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

type WsTicketClaims = {
  readonly userId: string;
  readonly role: string;
  readonly sessionId: string | null;
  readonly orgId: string | null;
};

interface WireTicketPayload {
  readonly u: string;
  readonly r: string;
  readonly s: string | null;
  readonly o: string | null;
  readonly n: string;
  readonly exp: number;
}

interface WireChannelGrantPayload {
  readonly v: string;
  readonly c: string;
  readonly exp: number;
}

type IssuedWsTicket = {
  readonly ticket: string;
  readonly expiresAt: number;
};

export interface WsTicketStore {
  issueTicket(secret: string, claims: WsTicketClaims, nowMs?: number): IssuedWsTicket;
  redeemTicket(secret: string, ticket: string, nowMs?: number): WsTicketClaims | null;
}

const DEFAULT_TICKET_TTL_MS = 30_000;
const DEFAULT_MAX_REDEEMED = 50_000;

function hmacSha256B64Url(secret: string, input: string): Buffer {
  return createHmac('sha256', secret).update(input, 'ascii').digest();
}

function constantTimeVerify(secret: string, encodedPayload: string, encodedSig: string): boolean {
  if (secret === '' || encodedPayload === '' || encodedSig === '') return false;
  let actualSig: Buffer;
  try {
    actualSig = Buffer.from(encodedSig, 'base64url');
  } catch {
    return false;
  }
  const expectedSig = hmacSha256B64Url(secret, encodedPayload);
  if (actualSig.byteLength !== expectedSig.byteLength) return false;
  return timingSafeEqual(actualSig, expectedSig);
}

export function createTicketStore(
  options: { readonly ttlMs?: number; readonly maxRedeemed?: number } = {},
): WsTicketStore {
  const ttlMs = options.ttlMs ?? DEFAULT_TICKET_TTL_MS;
  const maxRedeemed = options.maxRedeemed ?? DEFAULT_MAX_REDEEMED;
  // Map of nonce -> exp timestamp so expired nonces are pruned lazily in O(1) amortized time.
  const redeemedNonces = new Map<string, number>();

  function pruneExpired(nowMs: number): void {
    for (const [nonce, exp] of redeemedNonces) {
      if (exp < nowMs) {
        redeemedNonces.delete(nonce);
      } else {
        break;
      }
    }
    while (redeemedNonces.size > maxRedeemed) {
      const oldest = redeemedNonces.keys().next().value;
      if (oldest === undefined) break;
      redeemedNonces.delete(oldest);
    }
  }

  return {
    issueTicket(
      secret: string,
      claims: WsTicketClaims,
      nowMs: number = Date.now(),
    ): IssuedWsTicket {
      const expiresAt = nowMs + ttlMs;
      const wire: WireTicketPayload = {
        u: claims.userId,
        r: claims.role,
        s: claims.sessionId,
        o: claims.orgId,
        n: randomBytes(16).toString('base64url'),
        exp: expiresAt,
      };
      const encodedPayload = Buffer.from(JSON.stringify(wire), 'utf8').toString('base64url');
      const sig = hmacSha256B64Url(secret, encodedPayload).toString('base64url');
      return {
        ticket: `${encodedPayload}.${sig}`,
        expiresAt,
      };
    },

    redeemTicket(
      secret: string,
      ticket: string,
      nowMs: number = Date.now(),
    ): WsTicketClaims | null {
      const dotIdx = ticket.indexOf('.');
      if (dotIdx <= 0 || dotIdx !== ticket.lastIndexOf('.')) {
        return null;
      }
      const encodedPayload = ticket.slice(0, dotIdx);
      const encodedSig = ticket.slice(dotIdx + 1);
      if (!constantTimeVerify(secret, encodedPayload, encodedSig)) {
        return null;
      }

      let parsed: WireTicketPayload;
      try {
        parsed = JSON.parse(
          Buffer.from(encodedPayload, 'base64url').toString('utf8'),
        ) as WireTicketPayload;
      } catch {
        return null;
      }

      if (
        typeof parsed.u !== 'string' ||
        parsed.u === '' ||
        typeof parsed.r !== 'string' ||
        parsed.r === '' ||
        typeof parsed.n !== 'string' ||
        parsed.n === '' ||
        typeof parsed.exp !== 'number' ||
        parsed.exp < nowMs
      ) {
        return null;
      }

      pruneExpired(nowMs);
      if (redeemedNonces.has(parsed.n)) {
        return null;
      }
      redeemedNonces.set(parsed.n, parsed.exp);

      return {
        userId: parsed.u,
        role: parsed.r,
        sessionId: typeof parsed.s === 'string' ? parsed.s : null,
        orgId: typeof parsed.o === 'string' ? parsed.o : null,
      };
    },
  };
}

export function signChannelGrant(
  secret: string,
  params: {
    readonly viewerKey: string;
    readonly channel: string;
    readonly expiresAtMs: number;
  },
): string {
  const wire: WireChannelGrantPayload = {
    v: params.viewerKey,
    c: params.channel,
    exp: params.expiresAtMs,
  };
  const encodedPayload = Buffer.from(JSON.stringify(wire), 'utf8').toString('base64url');
  const sig = hmacSha256B64Url(secret, `grant:${encodedPayload}`).toString('base64url');
  return `${encodedPayload}.${sig}`;
}

export function verifyChannelGrant(
  secret: string,
  grant: string,
  expected: {
    readonly viewerKey: string;
    readonly channel: string;
    readonly nowMs?: number;
  },
): boolean {
  const dotIdx = grant.indexOf('.');
  if (dotIdx <= 0 || dotIdx !== grant.lastIndexOf('.')) {
    return false;
  }
  const encodedPayload = grant.slice(0, dotIdx);
  const encodedSig = grant.slice(dotIdx + 1);
  if (!constantTimeVerify(secret, `grant:${encodedPayload}`, encodedSig)) {
    return false;
  }

  let parsed: WireChannelGrantPayload;
  try {
    parsed = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as WireChannelGrantPayload;
  } catch {
    return false;
  }

  const nowMs = expected.nowMs ?? Date.now();
  return (
    parsed.v === expected.viewerKey &&
    parsed.c === expected.channel &&
    typeof parsed.exp === 'number' &&
    parsed.exp >= nowMs
  );
}
