// main/apps/server/src/bootstrap/system.ts
/**
 * Server bootstrap facade.
 *
 * Orchestrates phased startup/shutdown while keeping `runtime.ts` focused on
 * process lifecycle concerns (signals, failure handling).
 */

import { isServerCapabilityEnabled } from './generated/profile.generated';
import {
  bootstrapCommsPhase,
  createFallbackCommsState,
  stopCommsPhase,
  type CommsPhaseState,
} from './phases/comms';
import { bootstrapDataPhase, stopDataPhase, type DataPhaseState } from './phases/data';
import { initHttpPhase, startHttpPhase, stopHttpPhase, type HttpPhaseState } from './phases/http';
import { bootstrapInfraPhase, stopInfraPhase, type InfraPhaseState } from './phases/infra';
import { startRetentionSweeps } from './phases/retention';

import type { App } from './app';
import type { InfraContext } from './context';
import type { WorkersPhaseState } from './phases/workers';
import type { AppConfig } from '@bslt/shared/system/config';

export interface ServerBootstrapState {
  infra: InfraPhaseState;
  data: DataPhaseState;
  comms: CommsPhaseState;
  http: HttpPhaseState;
  workers: WorkersPhaseState;
}

function createDisabledWorkersState(context: InfraContext): WorkersPhaseState {
  // Without the workers capability nothing else executes the retention
  // promises the API makes (hard-ban anonymization, hard-delete, expired-token
  // and unverified-user cleanup) — run them on an in-process daily interval.
  const stopSweeps = startRetentionSweeps({
    db: context.db,
    repos: context.repos,
    log: context.log,
  });
  return {
    logStartupSummary: async () => {},
    stop: stopSweeps,
  };
}

async function startEnabledWorkersPhase(
  config: AppConfig,
  context: InfraContext,
  app: App,
): Promise<WorkersPhaseState> {
  const { startWorkersPhase } = await import('./phases/workers');
  return startWorkersPhase(config, context, app);
}

async function stopEnabledWorkersPhase(state: WorkersPhaseState | undefined): Promise<void> {
  if (state === undefined) return;
  if (!isServerCapabilityEnabled('workers')) {
    // Disabled-workers state carries the retention-sweep stop function.
    state.stop?.();
    return;
  }
  const { stopWorkersPhase } = await import('./phases/workers');
  stopWorkersPhase(state);
}

export async function bootstrapServerSystem(config: AppConfig): Promise<ServerBootstrapState> {
  const infra = await bootstrapInfraPhase(config);
  const data = await bootstrapDataPhase(config, infra.platform);
  const comms = isServerCapabilityEnabled('comms')
    ? await bootstrapCommsPhase(config, data.context)
    : createFallbackCommsState(config, data);
  const http = await initHttpPhase(config, comms.context);
  const workers = isServerCapabilityEnabled('workers')
    ? await startEnabledWorkersPhase(config, comms.context, http.app)
    : createDisabledWorkersState(comms.context);
  const port = await startHttpPhase(config, http.app);
  http.port = port;
  await workers.logStartupSummary(config, comms.context, http.app, port);

  return { infra, data, comms, http, workers };
}

export async function stopServerSystem(state: Partial<ServerBootstrapState>): Promise<void> {
  await stopEnabledWorkersPhase(state.workers);
  await stopHttpPhase(state.http);
  await stopCommsPhase(state.comms);
  await stopDataPhase(state.data);
  await stopInfraPhase(state.infra);
}
