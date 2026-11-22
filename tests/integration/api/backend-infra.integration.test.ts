// tests/integration/api/backend-infra.integration.test.ts
/**
 * Backend Infrastructure Integration Tests
 *
 * Covers:
 * - Kernel cron schedules enqueue onto QueueStore and execute retention handlers
 * - IP blocklist middleware rejects blocked addresses and honors allowlist exceptions
 */

import { createMemoryQueueStore, type DbClient } from '@bslt/db';
import {
  createKernelCrons,
  KERNEL_CRON_JOB_NAMES,
  type CronHandler,
} from '@bslt/server-system/cron';
import { createHttpServer, type HttpReply, type HttpRequest } from '@bslt/server-system/http';
import { createIpBlocklistMiddleware } from '@bslt/server-system/security';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('backend infrastructure integration', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('registers kernel cron schedules, enqueues due jobs onto QueueStore, and propagates handler DB errors', async () => {
    const execute = vi.fn().mockResolvedValue(2);
    const db = { execute } as unknown as DbClient;
    const queueStore = createMemoryQueueStore();
    const handlers = new Map<string, CronHandler>();

    const kernelCrons = createKernelCrons({
      db,
      queueStore,
      clock: { now: () => new Date('2026-11-19T12:00:00.000Z') },
    });
    kernelCrons.registerSchedules({
      register: (name, _expression, handler) => {
        handlers.set(name, handler);
      },
    });

    expect(handlers.has(KERNEL_CRON_JOB_NAMES.outboxRetention)).toBe(true);
    expect(handlers.has(KERNEL_CRON_JOB_NAMES.jobsRetention)).toBe(true);

    await handlers.get(KERNEL_CRON_JOB_NAMES.outboxRetention)!({
      cron: KERNEL_CRON_JOB_NAMES.outboxRetention,
      scheduledFor: '2026-11-19T12:00:00.000Z',
    });
    const dequeued = await queueStore.dequeue('2026-11-19T12:00:01.000Z');
    expect(dequeued?.name).toBe(KERNEL_CRON_JOB_NAMES.outboxRetention);

    await kernelCrons.handlers[KERNEL_CRON_JOB_NAMES.outboxRetention]!({});
    expect(execute).toHaveBeenCalledTimes(1);

    execute.mockRejectedValueOnce(new Error('outbox retention db down'));
    await expect(kernelCrons.handlers[KERNEL_CRON_JOB_NAMES.outboxRetention]!({})).rejects.toThrow(
      'outbox retention db down',
    );
  });

  it('rejects blocked IPs and honors exact-IP and CIDR allowlist exceptions', async () => {
    const app = createHttpServer();
    const ipBlocklist = createIpBlocklistMiddleware({
      globalBlocklist: ['198.51.100.23', '203.0.113.0/24', '10.0.0.0/8'],
      allowlist: ['203.0.113.10', '10.12.0.0/16'],
    });
    app.addHook('onRequest', async (request, reply) => {
      await ipBlocklist(request as unknown as HttpRequest, reply as unknown as HttpReply);
    });
    app.get('/', () => ({ allowed: true }));

    try {
      for (const ip of ['198.51.100.23', '203.0.113.11', '10.13.8.42']) {
        const response = await app.inject({ method: 'GET', url: '/', remoteAddress: ip });
        expect(response.statusCode).toBe(403);
        expect(response.json()).toEqual({ error: 'Forbidden' });
      }
      for (const ip of ['203.0.113.10', '10.12.8.42', '192.0.2.1']) {
        const response = await app.inject({ method: 'GET', url: '/', remoteAddress: ip });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ allowed: true });
      }
    } finally {
      await app.close();
    }
  });
});
