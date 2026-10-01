// main/server/core/src/auth/security/events/core.ts

import { insert } from '@bslt/db/builder';
import { SECURITY_EVENTS_TABLE } from '@bslt/db/schema';

import type { LogSecurityEventParams } from './types';

export async function logSecurityEvent(params: LogSecurityEventParams): Promise<void> {
  const { db, userId, email, eventType, severity, ipAddress, userAgent, metadata } = params;

  await db.execute(
    insert(SECURITY_EVENTS_TABLE)
      .values({
        user_id: userId != null && userId !== '' ? userId : null,
        email: email != null && email !== '' ? email : null,
        event_type: eventType,
        severity,
        ip_address: ipAddress != null && ipAddress !== '' ? ipAddress : null,
        user_agent: userAgent != null && userAgent !== '' ? userAgent : null,
        metadata: metadata != null ? JSON.stringify(metadata) : null,
      })
      .toSql(),
  );
}
