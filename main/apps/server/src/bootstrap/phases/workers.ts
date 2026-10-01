// Core edition runs account retention through bootstrap/phases/retention.ts.
import type { App } from '../app';
import type { InfraContext } from '../context';
import type { AppConfig } from '@bslt/shared/system/config';
export interface WorkersPhaseState {
  logStartupSummary(
    config: AppConfig,
    context: InfraContext,
    app: App,
    port: number,
  ): Promise<void>;
  stop?: (() => void) | undefined;
}
export async function startWorkersPhase(
  _config: AppConfig,
  _context: InfraContext,
  _app: App,
): Promise<WorkersPhaseState> {
  throw new Error('The workers extension is not included in the core edition.');
}
export function stopWorkersPhase(state: Partial<WorkersPhaseState> | undefined): void {
  state?.stop?.();
}
