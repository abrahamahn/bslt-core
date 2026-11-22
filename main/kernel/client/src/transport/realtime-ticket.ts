// main/kernel/client/src/transport/realtime-ticket.ts
/**
 * Browser/client helper for requesting single-use WebSocket tickets and
 * server-signed channel grants from `POST /api/realtime/ticket` (§8.6).
 */
import { boolean, nullable, number, object, record, string, type Infer } from '@bslt/schema';

import { createTransport, type TransportConfig } from './transport';

const realtimeTicketResponseSchema = object({
  ticket: nullable(string({ min: 1 })),
  grants: record(string({ min: 1 })),
  expiresAt: number(),
  anonymous: boolean(),
});

type RealtimeTicketClientResponse = Infer<typeof realtimeTicketResponseSchema>;

interface RequestRealtimeTicketOptions extends TransportConfig {
  readonly channels?: readonly string[] | undefined;
}

export async function requestRealtimeTicket(
  options: RequestRealtimeTicketOptions,
): Promise<RealtimeTicketClientResponse> {
  const { channels, ...transportConfig } = options;
  const transport = createTransport(transportConfig);
  return transport.request('/realtime/ticket', {
    method: 'POST',
    requiresAuth: transportConfig.getToken !== undefined,
    body: JSON.stringify({
      ...(channels !== undefined ? { channels } : {}),
    }),
    responseSchema: realtimeTicketResponseSchema,
  });
}
