// main/modules/audit/server/index.ts
import { implementServer, onFlagged, type KernelServices } from '@bslt/server-system/module';

import { auditModule } from '../module';

import { auditRepository, type AuditRepository } from './repository';
import {
  exportSecurityEvents,
  getSecurityEvent,
  getSecurityMetrics,
  listAuditEvents,
  listSecurityEvents,
  listUserActivities,
  pruneOldActivities,
  recordFlaggedActivityEvent,
  recordFlaggedAuditEvent,
} from './service';

import type { AuditLogEntry } from '../contract';
import type { RawDb } from '@bslt/db';

export { auditRepository, type AuditRepository };

/**
 * Coexistence bridge for pre-Phase-15/16 GDPR user data export (`data-hygiene` / `data-export`).
 */
export async function listActorAuditTrailForExport(
  db: RawDb,
  actorId: string,
  limit = 1000,
): Promise<AuditLogEntry[]> {
  const result = await listAuditEvents(auditRepository(db), {
    actorId,
    limit: Math.min(limit, 500),
  });
  return result.events;
}

type AuditService = { readonly kernel: KernelServices };

export const auditServer = implementServer(auditModule, {
  migrations: new URL('./migrations/', import.meta.url),
  create: (k): AuditService => ({ kernel: k }),
  privacy: {
    exportUser: async (s, userId) =>
      s.kernel.db.system(async (tx) => {
        const activities = await auditRepository(tx).listActivities({
          actorId: userId,
          limit: 500,
        });
        return {
          activities: activities.map((a) => ({
            action: a.action,
            resource: a.resourceType,
            createdAt: a.createdAt.toISOString(),
          })),
        };
      }),
    eraseUser: async (_s, tx, userId) => {
      await auditRepository(tx).deleteActivitiesByActorId(userId);
    },
  },
  handlers: {
    listActivities: async (input, req) => {
      const viewerId = req.viewer.userId;
      return req.tx((tx) => listUserActivities(auditRepository(tx), viewerId, input.query));
    },
    listAuditEvents: async (input, req, s) => {
      const result = await req.tx((tx) => listAuditEvents(auditRepository(tx), input.query));
      s.kernel.log.info(
        {
          adminId: req.viewer.userId,
          resultCount: result.events.length,
          truncated: result.truncated,
        },
        'Admin listed audit events',
      );
      return result;
    },
    listSecurityEvents: async (input, req, s) => {
      const result = await req.tx((tx) => listSecurityEvents(auditRepository(tx), input.body));
      s.kernel.log.info(
        { adminId: req.viewer.userId, eventCount: result.data.length },
        'Admin listed security events',
      );
      return result;
    },
    getSecurityEvent: async (input, req, s) => {
      const event = await req.tx((tx) => getSecurityEvent(auditRepository(tx), input.params.id));
      if (event === null) {
        return req.fail('SECURITY_EVENT_NOT_FOUND', 'Security event not found');
      }
      s.kernel.log.info(
        { adminId: req.viewer.userId, eventId: input.params.id },
        'Admin viewed security event',
      );
      return event;
    },
    getSecurityMetrics: async (input, req, s) => {
      const period = input.query.period ?? 'day';
      const now = s.kernel.clock.now();
      const metrics = await req.tx((tx) => getSecurityMetrics(auditRepository(tx), period, now));
      s.kernel.log.info({ adminId: req.viewer.userId, period }, 'Admin viewed security metrics');
      return metrics;
    },
    exportSecurityEvents: async (input, req, s) => {
      const now = s.kernel.clock.now();
      const result = await req.tx((tx) =>
        exportSecurityEvents(auditRepository(tx), input.body, now),
      );
      s.kernel.log.info(
        { adminId: req.viewer.userId, format: input.body.format },
        'Admin exported security events',
      );
      return result;
    },
  },
  jobs: {
    activityRetention: async (_payload, s) => {
      const now = s.kernel.clock.now();
      await s.kernel.db.system(async (tx) => {
        const deleted = await pruneOldActivities(auditRepository(tx), now);
        s.kernel.log.info({ deleted }, 'Audit activity retention sweep completed');
      });
    },
  },
  subscribers: [
    onFlagged<AuditService>('audit', {
      id: 'log',
      handle: async (event, s) => {
        await s.kernel.db.system(async (tx) => {
          await recordFlaggedAuditEvent(auditRepository(tx), event);
        });
      },
    }),
    onFlagged<AuditService>('activity', {
      id: 'feed',
      handle: async (event, s) => {
        await s.kernel.db.system(async (tx) => {
          await recordFlaggedActivityEvent(auditRepository(tx), event);
        });
      },
    }),
  ],
  cron: [{ job: 'activityRetention', schedule: '0 3 * * *', catchUp: false }],
});
