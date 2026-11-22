// main/kernel/contract/src/event.test.ts
import { object, string } from '@bslt/schema';
import { describe, expect, it } from 'vitest';

import { event, type EventDef, type NotifyMeta } from './event';

const payloadSchema = object({ taskId: string({ min: 1 }), userId: string({ min: 1 }) });

describe('event definitions', () => {
  it('constructs valid <id>.<noun>.<verb> event definitions with projection metadata', () => {
    const notify: NotifyMeta<{ readonly taskId: string; readonly userId: string }> = {
      kind: 'tasks.assigned',
      recipients: (p) => [p.userId],
      level: 'info',
      category: 'tasks',
      channels: ['in_app'],
      title: 'tasks.notify.assigned',
    };
    const created: EventDef<'tasks.task.created', typeof payloadSchema> = event(
      'tasks.task.created',
      payloadSchema,
      {
        version: 1,
        audit: { category: 'data', severity: 'info' },
        activity: true,
        webhook: true,
        notify,
        realtime: (p) => ({ channel: `user:${p.userId}`, invalidate: ['list'] }),
        analytics: 'task_created',
      },
    );
    expect(created.name).toBe('tasks.task.created');
    expect(created.webhook).toBe(true);
    expect(created.notify?.recipients({ taskId: '1', userId: 'u-1' })).toEqual(['u-1']);

    const kycAccess = event('compliance.kyc_record.viewed', payloadSchema, {
      audit: { category: 'kyc_access', severity: 'warn' },
    });
    const trustSafety = event('moderation.case.decided', payloadSchema, {
      audit: { category: 'trust_safety', severity: 'critical' },
    });
    expect(kycAccess.audit?.category).toBe('kyc_access');
    expect(trustSafety.audit?.category).toBe('trust_safety');
  });

  it('rejects event names that do not follow <moduleId>.<noun>.<verb>', () => {
    expect(() => event('tasks.created', payloadSchema)).toThrow(/<id>\.<noun>\.<verb>/i);
    expect(() => event('tasks.task.sub.created', payloadSchema)).toThrow(/<id>\.<noun>\.<verb>/i);
    expect(() => event('Tasks.task.created', payloadSchema)).toThrow(/<id>\.<noun>\.<verb>/i);
    expect(() => event('tasks.task.Created', payloadSchema)).toThrow(/<id>\.<noun>\.<verb>/i);
    expect(() => event('', payloadSchema)).toThrow(/<id>\.<noun>\.<verb>/i);
  });

  it('rejects invalid version numbers and mismatched notify.kind prefixes', () => {
    expect(() => event('tasks.task.created', payloadSchema, { version: 0 })).toThrow(/version/i);
    expect(() => event('tasks.task.created', payloadSchema, { version: -1 })).toThrow(/version/i);
    expect(() => event('tasks.task.created', payloadSchema, { version: 1.5 })).toThrow(/version/i);

    expect(() =>
      event('tasks.task.created', payloadSchema, {
        notify: {
          kind: 'billing.invoice_due',
          recipients: () => [],
          level: 'info',
          category: 'tasks',
          channels: ['in_app'],
          title: 'tasks.notify',
        },
      }),
    ).toThrow(/notify\.kind/i);
  });
});
