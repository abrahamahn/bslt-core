// main/apps/server/src/bootstrap/build-app.ts
/**
 * `buildApp`: the server's one composition function.
 *
 * It runs the bootstrap phases (infra, data, comms, HTTP) for a config and a
 * process role and returns the composed app: the container, the Fastify server
 * with every route registered, and the background runtimes ready to start.
 * Nothing listens and nothing is scheduled until `start()`.
 *
 * `main.ts` (through `ServerRuntime`) and the tests (through `@bslt/testing`'s
 * `buildTestApp`) both call it, so a test boots what production boots. A caller
 * may replace external ports (`ports`) or add routes before the server is ready
 * (`extend`); production passes neither.
 */

import os from 'node:os';

import { getMetricsCollector } from '@bslt/server-system/observability';

import { bootstrapCommsPhase, stopCommsPhase, type CommsPhaseState } from './phases/comms';
import { bootstrapDataPhase, stopDataPhase, type DataPhaseState } from './phases/data';
import { initHttpPhase, startHttpPhase, stopHttpPhase } from './phases/http';
import { bootstrapInfraPhase, stopInfraPhase, type InfraPhaseState } from './phases/infra';
import {
  composeWorkersPhase,
  stopWorkersPhase,
  type ComposedWorkersPhase,
  type WorkersPhaseState,
} from './phases/workers';

import type { App, AppRoute } from './app';
import type { AppContext, AppPorts, InfraContext } from './context';
import type { AppConfig } from '@bslt/server-system/config';
import type { HttpServer } from '@bslt/server-system/http';
import type { AnyServerModule } from '@bslt/server-system/module';

export type { AppRoute } from './app';
export type { AppPorts } from './context';

// ============================================================================
// Process role
// ============================================================================

/**
 * The process roles this server image can run (restructure plan §10.2).
 * - `api`          — HTTP product endpoints, no WS gateway or background workers
 * - `realtime`     — WebSocket gateway + HTTP health/metrics probes
 * - `worker`       — `default` QueueServer + outbox dispatcher + leader cron + HTTP probes
 * - `media-worker` — `media` QueueServer + HTTP probes
 * - `all`          — single-process dev/starter default running every runtime
 * (`web` belongs to the web static/SSR server image and is rejected here.)
 */
export const PROCESS_ROLES = ['api', 'realtime', 'worker', 'media-worker', 'all'] as const;

export type ProcessRole = (typeof PROCESS_ROLES)[number];

function isProcessRole(value: string): value is ProcessRole {
  return (PROCESS_ROLES as readonly string[]).includes(value);
}

/**
 * Read `PROCESS_ROLE`. Unset or blank means `all`.
 *
 * @throws {Error} For a role this server cannot run: a process that silently
 *   ran everything under the name `worker` would be worse than one that stops.
 */
export function parseProcessRole(value: string | undefined): ProcessRole {
  const role = value?.trim() ?? '';
  if (role === '') return 'all';
  if (isProcessRole(role)) return role;
  throw new Error(
    `Unsupported PROCESS_ROLE "${role}". This server supports: ${PROCESS_ROLES.join(', ')}.`,
  );
}

// ============================================================================
// Types
// ============================================================================

export interface BuildAppOptions {
  /** Which runtimes this process runs. Default: `all`. */
  readonly role?: ProcessRole;
  /**
   * External ports to use in place of the ones the infra and comms phases
   * compose (a test's fake email service, a silent logger). A key that is
   * present wins, `undefined` included.
   */
  readonly ports?: AppPorts;
  /**
   * Compose the HTTP layer over this context and skip the infra, data and comms
   * phases: no connection is opened, and `stop()` closes none. For callers that
   * need the composed router without a database (route snapshots).
   */
  readonly context?: InfraContext;
  /** Installed server modules (`installedServerModules` from `bslt sync modules`). */
  readonly modules?: readonly AnyServerModule[];
  /** Optional environment map passed to module `env` schemas (defaults to `process.env`). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Runs after the routes are registered and before the server is ready. */
  readonly extend?: (app: App) => void | Promise<void>;
}

export interface BuiltApp {
  readonly role: ProcessRole;
  readonly config: AppConfig;
  /** The service container. */
  readonly app: App;
  /** The composed HTTP server: plugins, middleware and every route. Not listening. */
  readonly server: HttpServer;
  /** The boot context (system pool) the routes were registered with. */
  readonly context: AppContext;
  /** Every route registered so far, in registration order. Complete once `ready()` has resolved. */
  routes(): readonly AppRoute[];
  /** Finish loading the server's plugins. `start()` does it too. */
  ready(): Promise<void>;
  /** Start background runtimes (QueueServer, outbox dispatcher, cron) without binding an HTTP port. */
  startWorkers(): Promise<void>;
  /** Start the background runtimes, then listen. Returns the bound port. */
  start(): Promise<number>;
  /** Stop what was started and close what was opened. Safe to call twice. */
  stop(): Promise<void>;
}

interface Phases {
  infra?: InfraPhaseState;
  data?: DataPhaseState;
  comms?: CommsPhaseState;
}

// ============================================================================
// Background runtimes
// ============================================================================

/** Compose the background work of the role; nothing runs until `start()`. */
async function composeBackgroundRuntimes(
  config: AppConfig,
  context: InfraContext,
  app: App,
  role: ProcessRole,
): Promise<ComposedWorkersPhase> {
  return composeWorkersPhase(config, context, app, role);
}

async function stopBackgroundRuntimes(state: WorkersPhaseState | undefined): Promise<void> {
  if (state === undefined) return;
  await stopWorkersPhase(state);
}

// ============================================================================
// buildApp
// ============================================================================

async function composeContext(
  config: AppConfig,
  ports: AppPorts | undefined,
  phases: Phases,
): Promise<InfraContext> {
  phases.infra = await bootstrapInfraPhase(config, ports);
  phases.data = await bootstrapDataPhase(config, phases.infra.platform);
  phases.comms = await bootstrapCommsPhase(config, phases.data.context, ports);
  return phases.comms.context;
}

/** Stop the phases this call started, in reverse; a phase that never started is left alone. */
async function stopPhases(phases: Phases): Promise<void> {
  if (phases.comms !== undefined) await stopCommsPhase(phases.comms);
  if (phases.data !== undefined) await stopDataPhase(phases.data);
  if (phases.infra !== undefined) await stopInfraPhase(phases.infra);
}

/**
 * Compose the server for `config` and a process role.
 *
 * @param config - The loaded application config.
 * @param options - Role, and the seams tests and tools use.
 * @returns The composed app. Call `start()` to run it and `stop()` to end it.
 * @throws {Error} For an unsupported role, or when a phase fails; the phases
 *   already started are stopped first.
 */
export async function buildApp(
  config: AppConfig,
  options: BuildAppOptions = {},
): Promise<BuiltApp> {
  const role = parseProcessRole(options.role);
  const envSource = options.env ?? process.env;
  const instance =
    envSource['INSTANCE_ID'] ?? envSource['HOSTNAME'] ?? `${os.hostname()}:${String(process.pid)}`;
  getMetricsCollector().setProcessIdentity({ role, instance });

  const phases: Phases = {};
  let app: App | undefined;

  let context: InfraContext;
  let runtimes: ComposedWorkersPhase;
  try {
    context = options.context ?? (await composeContext(config, options.ports, phases));
    const isProbesOnly = role === 'realtime' || role === 'worker' || role === 'media-worker';
    const hasExplicitRouteInputs =
      isProbesOnly || options.modules !== undefined || options.env !== undefined;
    ({ app } = hasExplicitRouteInputs
      ? await initHttpPhase(config, context, {
          ...(isProbesOnly ? { httpMode: 'probes-only' } : {}),
          ...(options.modules !== undefined ? { modules: options.modules } : {}),
          ...(options.env !== undefined ? { env: options.env } : {}),
        })
      : await initHttpPhase(config, context));
    runtimes = await composeBackgroundRuntimes(config, context, app, role);
    await options.extend?.(app);
  } catch (error) {
    if (app !== undefined) await stopHttpPhase({ app });
    await stopPhases(phases);
    throw error;
  }

  const composed = app;
  let workers: WorkersPhaseState | undefined;
  let stopped = false;

  return {
    role,
    config,
    app: composed,
    server: composed.server,
    context: composed.context,
    routes: () => composed.routes(),
    ready: async () => {
      await composed.server.ready();
    },
    startWorkers: async () => {
      workers ??= await runtimes.start();
    },
    start: async () => {
      workers ??= await runtimes.start();
      const port = await startHttpPhase(config, composed);
      await workers.logStartupSummary(config, context, composed, port);
      return port;
    },
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await stopBackgroundRuntimes(workers);
      await stopHttpPhase({ app: composed });
      await stopPhases(phases);
    },
  };
}
