// main/kernel/server/src/module/server-module.test.ts
import {
  defineConfig,
  defineErrors,
  defineModule,
  endpoint,
  job,
  mergeCapabilityContributions,
} from '@bslt/contract';
import { enumOf, number, object, optional, string } from '@bslt/schema';
import { describe, expect, it } from 'vitest';

import {
  collectModuleActions,
  collectModuleNotificationKinds,
  collectModulePrivacy,
  createKernelActionsService,
  createKernelEventsService,
  createKernelJobsService,
  createKernelPrivacyService,
  implementServer,
  type AnyServerModule,
  type Clock,
  type DepApis,
  type InstantiatedServerModule,
  type KernelServices,
  type RequestContext,
  type ServerImpls,
  type ServerModule,
  type Tx,
} from './server-module';

import type { Logger } from '../logger/types';
import type { DbClient } from '@bslt/db';

const modErrors = defineErrors('notes', { NOTE_NOT_FOUND: 404 });

const identityShell = defineModule({
  id: 'identity',
  summary: 'Identity shell',
  status: 'stable',
  dependsOn: [],
  endpoints: {},
  events: {},
  jobs: {},
  tables: [],
  web: false,
});

const notesModule = defineModule({
  id: 'notes',
  summary: 'Notes module',
  status: 'stable',
  dependsOn: [identityShell],
  endpoints: {
    get: endpoint({
      method: 'GET',
      path: '/api/notes/:id',
      auth: 'user',
      params: object({ id: string({ min: 1 }) }),
      response: object({ id: string({ min: 1 }), text: string({ min: 1 }) }),
      errors: [modErrors.NOTE_NOT_FOUND],
      summary: 'Get note',
    }),
  },
  events: {},
  jobs: {},
  tables: ['notes'],
});

const silentLogger: Logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => silentLogger,
};

function makeKernel(): KernelServices {
  const clock: Clock = { now: () => new Date('2026-11-14T00:00:00.000Z') };
  const fakeTx = {} as Tx;
  return {
    db: {
      system: <T>(fn: (tx: DbClient) => Promise<T>): Promise<T> => fn(fakeTx),
    },
    jobs: createKernelJobsService(clock),
    events: createKernelEventsService({ sealSecret: 'test-seal-secret', clock }),
    log: silentLogger,
    clock,
  };
}

describe('implementServer and ServerImpls', () => {
  it('instantiates typed service, exposes api port, and satisfies ServerImpls covariantly', async () => {
    const identityServer = implementServer(identityShell, {
      create: () => ({ realm: 'bslt' }),
      handlers: {},
      api: (s) => ({ getRealm: () => s.realm }),
    });

    interface NotesService {
      readonly prefix: string;
      find(id: string): { id: string; text: string } | null;
    }

    const notesServer: ServerModule<typeof notesModule, NotesService> = implementServer(
      notesModule,
      {
        migrations: new URL('./migrations/', import.meta.url),
        create: (_k, deps: DepApis<typeof notesModule.dependsOn>) => {
          const idApi = deps.identity as { getRealm(): string } | undefined;
          const prefix = idApi?.getRealm() ?? 'none';
          return {
            prefix,
            find: (id) => (id === '1' ? { id, text: `${prefix}:hello` } : null),
          };
        },
        handlers: {
          get: async (input, req, s) => {
            const found = s.find(input.params.id);
            if (found === null) {
              return req.fail('NOTE_NOT_FOUND');
            }
            return Promise.resolve(found);
          },
        },
      },
    );

    const cfg = defineConfig({
      name: 'BSLT',
      installedModules: [identityShell, notesModule],
      devOnly: [],
      locales: ['en-US'],
      brand: { accent: 'oklch(0.62 0.19 264)', logo: '/brand/logo.svg' },
    });
    expect(cfg.name).toBe('BSLT');

    const impls = [identityServer, notesServer] as const satisfies ServerImpls<typeof cfg>;
    const erased: readonly AnyServerModule[] = impls;
    expect(erased).toHaveLength(2);

    const kernel = makeKernel();
    const idInstance: InstantiatedServerModule<typeof identityShell> = identityServer.instantiate(
      kernel,
      {},
    );
    const notesInstance = notesServer.instantiate(kernel, { identity: idInstance.api });

    const fakeReq: RequestContext<readonly ['notes.NOTE_NOT_FOUND']> = {
      viewer: { userId: 'u-1', role: 'user' },
      caps: mergeCapabilityContributions({
        modules: [identityShell, notesModule],
        viewer: { userId: 'u-1', role: 'user' },
        contributions: [],
      }),
      tx: <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => fn({} as Tx),
      fail: (code): never => {
        throw new Error(`failed:${code}`);
      },
    };

    const result = await notesInstance.invokeHandler('get', { params: { id: '1' } }, fakeReq);
    expect(result).toEqual({ id: '1', text: 'bslt:hello' });
  });

  it('rejects invocation of an unknown endpoint name on an instantiated module', async () => {
    const identityServer = implementServer(identityShell, {
      create: () => ({}),
      handlers: {},
    });
    const inst = identityServer.instantiate(makeKernel(), {});
    const fakeReq: RequestContext = {
      viewer: null,
      caps: mergeCapabilityContributions({
        modules: [identityShell],
        viewer: null,
        contributions: [],
      }),
      tx: <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => fn({} as Tx),
      fail: (code): never => {
        throw new Error(code);
      },
    };

    await expect(inst.invokeHandler('missingEndpoint', {}, fakeReq)).rejects.toThrow(
      /unknown endpoint/i,
    );
  });

  it('propagates handler failures through req.fail without swallowing errors', async () => {
    const server = implementServer(notesModule, {
      create: () => ({}),
      handlers: {
        get: (_input, req) => Promise.resolve(req.fail('NOTE_NOT_FOUND')),
      },
    });
    const inst = server.instantiate(makeKernel(), {});
    const fakeReq: RequestContext = {
      viewer: { userId: 'u-1', role: 'user' },
      caps: mergeCapabilityContributions({
        modules: [notesModule],
        viewer: { userId: 'u-1', role: 'user' },
        contributions: [],
      }),
      tx: <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => fn({} as Tx),
      fail: (code): never => {
        throw new Error(`domain:${code}`);
      },
    };

    await expect(inst.invokeHandler('get', { params: { id: 'missing' } }, fakeReq)).rejects.toThrow(
      'domain:NOTE_NOT_FOUND',
    );
  });

  it('enforces exhaustive job handlers, validates job payloads on enqueue and execution, and rejects invalid job inputs', async () => {
    const deliverJob = job('notesjobs.deliver', object({ noteId: string({ min: 1 }) }), {
      queue: 'default',
      maxAttempts: 4,
      timeoutMs: 5_000,
    });
    const moduleWithJobs = defineModule({
      id: 'notesjobs',
      summary: 'Notes with jobs',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: { deliver: deliverJob },
      tables: [],
      web: false,
    });

    const received: string[] = [];
    const srv = implementServer(moduleWithJobs, {
      create: () => ({ tag: 'svc' }),
      handlers: {},
      jobs: {
        deliver: async (payload, s) => {
          received.push(`${s.tag}:${payload.noteId}`);
          await Promise.resolve();
        },
      },
    });

    const executedSql: Array<{ text: string; values: unknown[] }> = [];
    const fakeTx = {
      execute: (q: { text: string; values: unknown[] }) => {
        executedSql.push(q);
        return Promise.resolve(1);
      },
    } as unknown as Tx;

    const kernel = makeKernel();
    // Valid enqueue writes to sys_jobs in the caller's tx
    await kernel.jobs.enqueue(fakeTx, deliverJob, { noteId: 'n-42' }, { idempotencyKey: 'k-1' });
    expect(executedSql).toHaveLength(1);
    expect(executedSql[0]?.text).toContain('INSERT INTO sys_jobs');
    expect(executedSql[0]?.values).toContain('notesjobs.deliver');
    expect(executedSql[0]?.values).toContain('k-1');

    // Failure case 1: invalid payload on enqueue throws before touching tx
    await expect(kernel.jobs.enqueue(fakeTx, deliverJob, { noteId: '' })).rejects.toThrow();
    expect(executedSql).toHaveLength(1);

    const inst = srv.instantiate(kernel, {});
    await inst.invokeJob('deliver', { noteId: 'n-99' });
    expect(received).toEqual(['svc:n-99']);

    // Failure case 2: invalid payload on invokeJob throws without invoking handler
    await expect(inst.invokeJob('deliver', { noteId: '' })).rejects.toThrow();
    expect(received).toEqual(['svc:n-99']);

    // Failure case 3: unknown job key throws
    await expect(inst.invokeJob('unknownJob', { noteId: 'n-1' })).rejects.toThrow(/unknown job/i);
  });

  it('validates ServerModule cron entries against declared jobs, cron syntax, duplicates, and empty payload compatibility', () => {
    const tickJob = job('notescron.tick', object({}), {
      queue: 'default',
      maxAttempts: 2,
      timeoutMs: 1_000,
    });
    const requiredArgJob = job('notescron.required', object({ id: string({ min: 1 }) }), {
      queue: 'default',
      maxAttempts: 2,
      timeoutMs: 1_000,
    });
    const mod = defineModule({
      id: 'notescron',
      summary: 'Notes cron test',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: { tick: tickJob, required: requiredArgJob },
      tables: [],
      web: false,
    });

    const valid = implementServer(mod, {
      create: () => ({}),
      handlers: {},
      jobs: {
        tick: async () => {},
        required: async () => {},
      },
      cron: [{ job: 'tick', schedule: '*/5 * * * *', catchUp: false }],
    });
    const inst = valid.instantiate(makeKernel(), {});
    expect(inst.cron).toEqual([
      {
        name: 'notescron.tick',
        jobDef: tickJob,
        schedule: '*/5 * * * *',
        catchUp: false,
      },
    ]);

    // Failure 1: invalid cron expression
    expect(() =>
      implementServer(mod, {
        create: () => ({}),
        handlers: {},
        jobs: { tick: async () => {}, required: async () => {} },
        cron: [{ job: 'tick', schedule: '99 * * * *' }],
      }),
    ).toThrow(/cron/i);

    // Failure 2: duplicate cron job entry
    expect(() =>
      implementServer(mod, {
        create: () => ({}),
        handlers: {},
        jobs: { tick: async () => {}, required: async () => {} },
        cron: [
          { job: 'tick', schedule: '* * * * *' },
          { job: 'tick', schedule: '0 * * * *' },
        ],
      }),
    ).toThrow(/duplicate cron/i);

    // Failure 3: job whose payload requires fields (cron only enqueues `{}`)
    expect(() =>
      implementServer(mod, {
        create: () => ({}),
        handlers: {},
        jobs: { tick: async () => {}, required: async () => {} },
        cron: [{ job: 'required', schedule: '* * * * *' }],
      }),
    ).toThrow(/empty payload/i);

    // Failure 4: unknown job key cast past TS
    expect(() =>
      implementServer(mod, {
        create: () => ({}),
        handlers: {},
        jobs: { tick: async () => {}, required: async () => {} },
        cron: [{ job: 'ghost' as 'tick', schedule: '* * * * *' }],
      }),
    ).toThrow(/unknown job/i);
  });

  it('parses declared module env keys into typed k.env, ignores unrelated env keys, and fails fast on invalid module env', () => {
    const envMod = defineModule({
      id: 'envmod',
      summary: 'Module with env schema',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
      web: false,
      env: object({
        ENVMOD_TIMEOUT_MS: optional(number({ coerce: true, int: true, min: 1000, max: 60_000 })),
        ENVMOD_MODE: optional(enumOf(['true', 'false'])),
      }),
    });

    const envServer = implementServer(envMod, {
      create: (k) => ({
        timeoutMs: k.env.ENVMOD_TIMEOUT_MS ?? 10_000,
        allowInternal: k.env.ENVMOD_MODE === 'true',
      }),
      api: (s) => s,
      handlers: {},
    });

    const defaultsInst = envServer.instantiate(
      makeKernel(),
      {},
      { PATH: '/usr/bin', ENVMOD_TIMEOUT_MS: '' },
    );
    expect(defaultsInst.api).toEqual({ timeoutMs: 10_000, allowInternal: false });

    const configuredInst = envServer.instantiate(
      makeKernel(),
      {},
      {
        PATH: '/usr/bin',
        ENVMOD_TIMEOUT_MS: '5000',
        ENVMOD_MODE: 'true',
      },
    );
    expect(configuredInst.api).toEqual({ timeoutMs: 5000, allowInternal: true });

    expect(() => envServer.instantiate(makeKernel(), {}, { ENVMOD_TIMEOUT_MS: '50' })).toThrow(
      /ENVMOD_TIMEOUT_MS/,
    );

    expect(() => envServer.instantiate(makeKernel(), {}, { ENVMOD_MODE: 'yes' })).toThrow(
      /ENVMOD_MODE/,
    );
  });

  it('resolves module context contributions per viewer and propagates context slot rejections', async () => {
    const plain = implementServer(identityShell, {
      create: () => ({}),
      handlers: {},
    });
    expect(await plain.instantiate(makeKernel(), {}).resolveContext(null)).toEqual({});

    const withContext = implementServer(identityShell, {
      create: () => ({ strategies: ['password', 'passkey'] }),
      handlers: {},
      context: async (s, viewer) => {
        if (viewer?.userId === 'broken') {
          throw new Error('context store unreachable');
        }
        return Promise.resolve({
          authStrategies: s.strategies,
          eligibility: { emailVerified: viewer !== null },
        });
      },
    });
    const inst = withContext.instantiate(makeKernel(), {});
    expect(await inst.resolveContext(null)).toEqual({
      authStrategies: ['password', 'passkey'],
      eligibility: { emailVerified: false },
    });
    expect(await inst.resolveContext({ userId: 'u-1', role: 'user' })).toEqual({
      authStrategies: ['password', 'passkey'],
      eligibility: { emailVerified: true },
    });
    await expect(inst.resolveContext({ userId: 'broken', role: 'user' })).rejects.toThrow(
      'context store unreachable',
    );
  });

  it('scopes k.db.viewer to the supplied viewer session runner and refuses to run k.db.viewer without a host runner', async () => {
    const seenViewers: Array<unknown> = [];
    const viewerScoped = implementServer(identityShell, {
      create: (k) => ({
        runAsViewer: (viewer: Parameters<typeof k.db.viewer>[0]) =>
          k.db.viewer(viewer, async () => {
            if (viewer?.userId === 'denied') {
              throw new Error('rls denied');
            }
            return Promise.resolve(viewer?.userId ?? 'anon');
          }),
      }),
      handlers: {},
      context: async (s, viewer) => {
        const who = await s.runAsViewer(viewer);
        return { flags: { [`identity.${who}`]: true } };
      },
    });

    const baseKernel = makeKernel();
    const withViewerRunner = viewerScoped.instantiate(
      {
        ...baseKernel,
        db: {
          ...baseKernel.db,
          viewer: async (viewer, fn) => {
            seenViewers.push(viewer);
            return baseKernel.db.system(fn);
          },
        },
      },
      {},
    );

    expect(await withViewerRunner.resolveContext(null)).toEqual({
      flags: { 'identity.anon': true },
    });
    expect(
      await withViewerRunner.resolveContext({
        userId: 'u-99',
        role: 'user',
        actingOrg: { orgId: 'org-1', permissions: 3n },
      }),
    ).toEqual({
      flags: { 'identity.u-99': true },
    });
    expect(seenViewers).toEqual([
      null,
      { userId: 'u-99', role: 'user', actingOrg: { orgId: 'org-1', permissions: 3n } },
    ]);
    await expect(
      withViewerRunner.resolveContext({ userId: 'denied', role: 'user' }),
    ).rejects.toThrow('rls denied');

    const fallbackInst = viewerScoped.instantiate(baseKernel, {});
    await expect(fallbackInst.resolveContext(null)).rejects.toThrow(/viewer runner/);
    await expect(fallbackInst.resolveContext({ userId: 'u-99', role: 'user' })).rejects.toThrow(
      /viewer runner/,
    );
  });

  it('validates notificationKinds prefixes per module and collects templates across instances', () => {
    const modA = defineModule({
      id: 'orgs',
      summary: 'Orgs test',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
      web: false,
    });
    const modB = defineModule({
      id: 'tasks',
      summary: 'Tasks test',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
      web: false,
    });

    // Failure 1: foreign prefix rejected
    expect(() =>
      implementServer(modA, {
        create: () => ({}),
        handlers: {},
        notificationKinds: {
          'tasks.wrong_prefix': () => ({ message: 'nope' }),
        },
      }),
    ).toThrow(/must be prefixed with "orgs\."/);

    // Failure 2: empty suffix rejected
    expect(() =>
      implementServer(modA, {
        create: () => ({}),
        handlers: {},
        notificationKinds: {
          'orgs.': () => ({ message: 'nope' }),
        },
      }),
    ).toThrow(/must be prefixed with "orgs\."/);

    const srvA = implementServer(modA, {
      create: () => ({}),
      handlers: {},
      notificationKinds: {
        'orgs.invite_sent': (payload) => ({
          title: 'Invitation sent',
          message: `Invited ${String(payload['email'] ?? '')}`,
        }),
      },
    });
    const srvB = implementServer(modB, {
      create: () => ({}),
      handlers: {},
      notificationKinds: {
        'tasks.assigned': (payload) => ({
          message: `Assigned ${String(payload['taskId'] ?? '')}`,
        }),
      },
    });

    const kernel = makeKernel();
    const instA = srvA.instantiate(kernel, {});
    const instB = srvB.instantiate(kernel, {});

    // Failure 3: duplicate kind across instances rejected
    expect(() => collectModuleNotificationKinds([instA, instA])).toThrow(/duplicate/i);

    const map = collectModuleNotificationKinds([instA, instB]);
    expect(map.get('orgs.invite_sent')?.({ email: 'a@b.io' })).toEqual({
      title: 'Invitation sent',
      message: 'Invited a@b.io',
    });
    expect(map.get('tasks.assigned')?.({ taskId: 't-1' })).toEqual({
      message: 'Assigned t-1',
    });
    expect(map.get('missing.kind')).toBeUndefined();
  });

  it('validates actions prefixes per module, rejects duplicates and unknown actions, and invokes registered actions', async () => {
    const modFiles = defineModule({
      id: 'files',
      summary: 'Files test',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
      web: false,
    });

    // Failure 1: foreign prefix rejected
    expect(() =>
      implementServer(modFiles, {
        create: () => ({}),
        handlers: {},
        actions: {
          'moderation.wrong': async () => Promise.resolve(),
        },
      }),
    ).toThrow(/must be prefixed with "files\."/);

    // Failure 2: empty suffix rejected
    expect(() =>
      implementServer(modFiles, {
        create: () => ({}),
        handlers: {},
        actions: {
          'files.': async () => Promise.resolve(),
        },
      }),
    ).toThrow(/must be prefixed with "files\."/);

    const quarantinedIds: string[] = [];
    const srvFiles = implementServer(modFiles, {
      create: () => ({
        quarantine: async (id: string) => {
          quarantinedIds.push(id);
          await Promise.resolve();
        },
      }),
      handlers: {},
      actions: {
        'files.quarantine': async (s, _tx, input) => {
          const record = input as { readonly fileId?: unknown };
          if (typeof record?.fileId !== 'string' || record.fileId.length === 0) {
            throw new Error('fileId required');
          }
          await s.quarantine(record.fileId);
        },
      },
    });

    const kernel = makeKernel();
    const inst = srvFiles.instantiate(kernel, {});

    // Failure 3: duplicate action across instances rejected
    expect(() => collectModuleActions([inst, inst])).toThrow(/duplicate/i);

    // Failure 4: unknown action on instance rejected
    await expect(inst.invokeAction('files.missing', {} as Tx, {})).rejects.toThrow(
      /unknown action/i,
    );

    // Failure 5: invalid input rejected by action handler
    await expect(inst.invokeAction('files.quarantine', {} as Tx, {})).rejects.toThrow(
      /fileId required/,
    );

    const collected = collectModuleActions([inst]);
    expect(collected.has('files.quarantine')).toBe(true);
    await collected.get('files.quarantine')!({} as Tx, { fileId: 'f-1' });
    expect(quarantinedIds).toEqual(['f-1']);
  });

  it('returns typed results from k.actions.invoke and rejects unknown action keys or handler errors', async () => {
    const modBilling = defineModule({
      id: 'billing',
      summary: 'Billing test',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
      web: false,
    });
    const srvBilling = implementServer(modBilling, {
      create: () => ({}),
      handlers: {},
      actions: {
        'billing.cancelSubscriptionsForBannedUser': async (_s, _tx, input) => {
          const userId = (input as { readonly userId?: unknown } | null)?.userId;
          if (typeof userId !== 'string' || userId.trim().length === 0) {
            throw new Error('userId required');
          }
          return { cancelled: userId === 'user-with-sub' };
        },
      },
    });
    const inst = srvBilling.instantiate(makeKernel(), {});
    const actions = createKernelActionsService(() => [inst]);

    await expect(actions.invoke('billing.unknown', {} as Tx, {})).rejects.toThrow(
      /unknown action/i,
    );
    await expect(
      actions.invoke('billing.cancelSubscriptionsForBannedUser', {} as Tx, {}),
    ).rejects.toThrow(/userId required/);
    await expect(
      actions.invoke('billing.cancelSubscriptionsForBannedUser', {} as Tx, { userId: '   ' }),
    ).rejects.toThrow(/userId required/);
    await expect(
      actions.invoke<{ readonly cancelled: boolean }>(
        'billing.cancelSubscriptionsForBannedUser',
        {} as Tx,
        { userId: 'user-with-sub' },
      ),
    ).resolves.toEqual({ cancelled: true });
  });

  it('collects module privacy hooks, rejects malformed userIds/exports/duplicates, propagates erase failures, and erases in reverse install order', async () => {
    const modTasks = defineModule({
      id: 'tasks',
      summary: 'Tasks test',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
      web: false,
    });
    const modFiles = defineModule({
      id: 'files',
      summary: 'Files test',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
      web: false,
    });
    const modBad = defineModule({
      id: 'bad',
      summary: 'Bad export test',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
      web: false,
    });

    const eraseOrder: string[] = [];
    const srvTasks = implementServer(modTasks, {
      create: () => ({ tag: 'tasks-svc' }),
      handlers: {},
      privacy: {
        exportUser: async (s, userId) => Promise.resolve({ svc: s.tag, userId, count: 2 }),
        eraseUser: async (_s, _tx, userId) => {
          eraseOrder.push(`tasks:${userId}`);
          await Promise.resolve();
        },
      },
    });
    const srvFiles = implementServer(modFiles, {
      create: () => ({ tag: 'files-svc' }),
      handlers: {},
      privacy: {
        exportUser: async (s, userId) => Promise.resolve({ svc: s.tag, userId, files: ['f-1'] }),
        eraseUser: async (_s, _tx, userId) => {
          if (userId === 'fail-erase') {
            throw new Error('legal hold active');
          }
          eraseOrder.push(`files:${userId}`);
          await Promise.resolve();
        },
      },
    });
    const srvBad = implementServer(modBad, {
      create: () => ({}),
      handlers: {},
      privacy: {
        exportUser: async () => Promise.resolve([] as unknown as Record<string, unknown>),
        eraseUser: async () => Promise.resolve(),
      },
    });

    const kernel = makeKernel();
    const instTasks = srvTasks.instantiate(kernel, {});
    const instFiles = srvFiles.instantiate(kernel, {});
    const instBad = srvBad.instantiate(kernel, {});

    // Failure 1: duplicate module id rejected
    expect(() => collectModulePrivacy([instTasks, instTasks])).toThrow(/duplicate/i);

    const privacySvc = createKernelPrivacyService(() => [instTasks, instFiles]);

    // Failure 2: empty/whitespace userId on exportUser rejected fail-closed
    await expect(privacySvc.exportUser('   ')).rejects.toThrow(/userId/i);

    // Failure 3: empty/whitespace userId on eraseUser rejected fail-closed
    await expect(privacySvc.eraseUser({} as Tx, '')).rejects.toThrow(/userId/i);

    // Failure 4: non-plain-object returned from exportUser rejected fail-closed
    const badPrivacySvc = createKernelPrivacyService(() => [instBad]);
    await expect(badPrivacySvc.exportUser('u-1')).rejects.toThrow(/plain object/i);

    // Failure 5: eraseUser failure propagates so transaction rolls back
    await expect(privacySvc.eraseUser({} as Tx, 'fail-erase')).rejects.toThrow(/legal hold active/);

    // Success: enumerates modules, exports keyed by module id, and erases in reverse install order
    eraseOrder.length = 0;
    expect(privacySvc.modules()).toEqual(['tasks', 'files']);
    await expect(privacySvc.exportUser('u-42')).resolves.toEqual({
      tasks: { svc: 'tasks-svc', userId: 'u-42', count: 2 },
      files: { svc: 'files-svc', userId: 'u-42', files: ['f-1'] },
    });
    await privacySvc.eraseUser({} as Tx, 'u-42');
    expect(eraseOrder).toEqual(['files:u-42', 'tasks:u-42']);
  });
});
