// main/kernel/realtime/src/routes.ts
/**
 * Realtime Routes
 *
 * Route definitions for the realtime package:
 * - POST realtime/ticket     — Issue a single-use WS ticket + server-signed channel grants
 * - POST realtime/write      — Apply write transaction with optimistic locking
 * - POST realtime/getRecords — Fetch records by table and ID pointers
 */

import { array, object, optional, string, type Infer } from '@bslt/schema';
import {
  createRouteMap,
  createScopedRouteHelpers,
  publicRoute,
  type HttpReply,
  type HttpRequest,
  type RouteMap,
} from '@bslt/server-system/http';

import { defaultChannelRegistry, type ChannelRegistry, type ChannelViewer } from './channels';
import { handleGetRecords, handleWrite } from './handlers';
import {
  getRecordsRequestSchema,
  transactionSchema,
  type GetRecordsRequest,
  type RealtimeTransaction,
} from './operations';
import { signChannelGrant, type WsTicketStore } from './tickets';
import { defaultGatewayTicketStore } from './websocket/lifecycle';

import type { RealtimeModuleDeps, RealtimeRequest } from './types';

const realtimeTicketRequestSchema = object({
  channels: optional(array(string({ min: 1, max: 256 }), { max: 64 })),
});

type RealtimeTicketRequest = Infer<typeof realtimeTicketRequestSchema>;

type RealtimeTicketResponse = {
  readonly ticket: string | null;
  readonly grants: Readonly<Record<string, string>>;
  readonly expiresAt: number;
  readonly anonymous: boolean;
};

const CHANNEL_GRANT_TTL_MS = 5 * 60_000;

async function handleIssueRealtimeTicket(
  ctx: Pick<RealtimeModuleDeps, 'config'> & {
    readonly ticketStore?: WsTicketStore;
    readonly channelRegistry?: ChannelRegistry;
  },
  body: RealtimeTicketRequest,
  req: RealtimeRequest,
): Promise<RealtimeTicketResponse> {
  const nowMs = Date.now();
  const secret = ctx.config.auth.jwt.secret;
  const ticketStore = ctx.ticketStore ?? defaultGatewayTicketStore;
  const channelRegistry = ctx.channelRegistry ?? defaultChannelRegistry;

  const user = req.user;
  const viewer: ChannelViewer | null =
    user?.userId !== undefined && user.userId !== ''
      ? {
          userId: user.userId,
          role: typeof user.role === 'string' && user.role !== '' ? user.role : 'user',
          orgId: null,
        }
      : null;

  const grants: Record<string, string> = {};
  const viewerKey = viewer !== null ? `user:${viewer.userId}` : 'anonymous';
  const grantExpiresAtMs = nowMs + CHANNEL_GRANT_TTL_MS;

  for (const ch of body.channels ?? []) {
    const decision = await channelRegistry.authorize(viewer, ch);
    if (decision.allowed) {
      grants[ch] = signChannelGrant(secret, {
        viewerKey,
        channel: ch,
        expiresAtMs: grantExpiresAtMs,
      });
    }
  }

  if (viewer === null) {
    return {
      ticket: null,
      grants,
      expiresAt: grantExpiresAtMs,
      anonymous: true,
    };
  }

  const issued = ticketStore.issueTicket(
    secret,
    {
      userId: viewer.userId,
      role: viewer.role,
      sessionId: null,
      orgId: viewer.orgId ?? null,
    },
    nowMs,
  );

  return {
    ticket: issued.ticket,
    grants,
    expiresAt: issued.expiresAt,
    anonymous: false,
  };
}

/**
 * Build the `/api/realtime/ticket` route map mounted on the composed server.
 * Accepts an optional viewer authenticator so signed-in users get a single-use
 * ticket + user grants while anonymous callers can request `anonymous-read` grants.
 */
export function buildRealtimeTicketRouteMap(options?: {
  readonly authenticateOptional?:
    ((req: HttpRequest, reply: HttpReply) => Promise<void>) | undefined;
}): RouteMap {
  return createRouteMap([
    [
      'realtime/ticket',
      publicRoute(
        'POST',
        async (ctx, body, req, reply) => {
          if (options?.authenticateOptional !== undefined) {
            await options.authenticateOptional(req, reply);
          }
          return handleIssueRealtimeTicket(
            ctx as unknown as RealtimeModuleDeps,
            body as RealtimeTicketRequest,
            req as unknown as RealtimeRequest,
          );
        },
        realtimeTicketRequestSchema,
      ),
    ],
  ]);
}

const realtimeRouteHelpers = createScopedRouteHelpers<
  RealtimeModuleDeps,
  RealtimeRequest & HttpRequest
>(
  (ctx) => ctx as RealtimeModuleDeps,
  (request) => request as unknown as RealtimeRequest & HttpRequest,
);

export const realtimeRoutes: RouteMap = createRouteMap([
  [
    'realtime/ticket',
    realtimeRouteHelpers.protectedRoute<RealtimeTicketRequest>(
      'POST',
      async (
        ctx: RealtimeModuleDeps,
        body: RealtimeTicketRequest,
        req: RealtimeRequest & HttpRequest,
        _reply: HttpReply,
      ) => {
        return handleIssueRealtimeTicket(ctx, body, req);
      },
      'user',
      realtimeTicketRequestSchema,
    ),
  ],

  [
    'realtime/write',
    realtimeRouteHelpers.protectedRoute<RealtimeTransaction>(
      'POST',
      async (
        ctx: RealtimeModuleDeps,
        body: RealtimeTransaction,
        req: RealtimeRequest & HttpRequest,
        _reply: HttpReply,
      ) => {
        return handleWrite(ctx, body, req);
      },
      'user',
      transactionSchema,
    ),
  ],

  [
    'realtime/getRecords',
    realtimeRouteHelpers.protectedRoute<GetRecordsRequest>(
      'POST',
      async (
        ctx: RealtimeModuleDeps,
        body: GetRecordsRequest,
        req: RealtimeRequest & HttpRequest,
        _reply: HttpReply,
      ) => {
        return handleGetRecords(ctx, body, req);
      },
      'user',
      getRecordsRequestSchema,
    ),
  ],
]);
