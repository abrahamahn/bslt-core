// main/modules/devtools/server/index.test.ts
import { describe, expect, it, vi } from 'vitest';

import { clearCapturedDevEmails, recordCapturedDevEmail } from '@bslt/contract';
import { createKernelEventsService, createKernelJobsService } from '@bslt/server-system/module';

import { devtoolsServer } from './index';

import type { KernelServices, RequestContext } from '@bslt/server-system/module';

function makeKernel(): KernelServices {
  const clock = { now: () => new Date('2026-01-01T00:00:00.000Z') };
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
    level: 'info',
  };
  log.child.mockReturnValue(log);
  return {
    db: { system: vi.fn() },
    jobs: createKernelJobsService(clock),
    events: createKernelEventsService({ sealSecret: 'x'.repeat(32), clock }),
    log: log as unknown as KernelServices['log'],
    clock,
  };
}

function makeAdminReq(): RequestContext {
  return {
    viewer: { userId: '00000000-0000-4000-8000-000000000001', role: 'admin' },
    caps: {
      modules: new Set(['devtools']),
      flags: {},
      entitlements: new Set(),
      eligibility: {
        tosAccepted: true,
        emailVerified: true,
        ageVerifiedFor: null,
        jurisdiction: null,
      },
      viewer: null,
      actingAs: { kind: 'user' },
      maxAudience: 2,
      authStrategies: ['password'],
    },
    tx: vi.fn(),
    fail: (code: string, message?: string): never => {
      throw new Error(`${code}:${message ?? ''}`);
    },
  };
}

describe('devtoolsServer', () => {
  it('invokes getRouteManifest and returns schema-valid manifest', async () => {
    const inst = devtoolsServer.instantiate(makeKernel(), {});
    const res = (await inst.invokeHandler('getRouteManifest', {}, makeAdminReq())) as {
      routes: unknown[];
      count: number;
    };
    expect(Array.isArray(res.routes)).toBe(true);
    expect(res.count).toBe(res.routes.length);
  });

  it('rejects unknown endpoint invocation on devtoolsServer', async () => {
    const inst = devtoolsServer.instantiate(makeKernel(), {});
    await expect(inst.invokeHandler('nonExistentEndpoint', {}, makeAdminReq())).rejects.toThrow(
      /Unknown endpoint/,
    );
  });

  it('rejects unknown job invocation on devtoolsServer', async () => {
    const inst = devtoolsServer.instantiate(makeKernel(), {});
    await expect(inst.invokeJob('nonExistentJob', {})).rejects.toThrow(/Unknown job/);
  });

  it('lists and clears captured dev emails while returning empty in production', async () => {
    clearCapturedDevEmails();
    recordCapturedDevEmail({
      id: 'dev-1',
      to: 'dev@acme.test',
      subject: 'Magic Link',
      text: 'Open https://localhost:5173/magic?token=xyz',
    });

    const inst = devtoolsServer.instantiate(makeKernel(), {}, { NODE_ENV: 'development' });
    const listed = (await inst.invokeHandler('listDevEmails', {}, makeAdminReq())) as {
      emails: { id: string }[];
      count: number;
    };
    expect(listed.count).toBe(1);
    expect(listed.emails[0]?.id).toBe('dev-1');

    const prodInst = devtoolsServer.instantiate(makeKernel(), {}, { NODE_ENV: 'production' });
    expect(await prodInst.invokeHandler('listDevEmails', {}, makeAdminReq())).toEqual({
      emails: [],
      count: 0,
    });
    expect(await prodInst.invokeHandler('clearDevEmails', { body: {} }, makeAdminReq())).toEqual({
      cleared: 0,
    });

    expect(await inst.invokeHandler('clearDevEmails', { body: {} }, makeAdminReq())).toEqual({
      cleared: 1,
    });
    expect(await inst.invokeHandler('listDevEmails', {}, makeAdminReq())).toEqual({
      emails: [],
      count: 0,
    });
  });
});
