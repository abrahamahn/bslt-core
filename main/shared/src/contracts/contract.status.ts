// main/shared/src/contracts/contract.status.ts
/**
 * Status Contracts
 *
 * Public status-page endpoint. Exposes component-level health (database,
 * cache, queue, storage, email) as bare up/down/unknown states plus an
 * incident timeline auto-recorded from health probes. Deliberately omits
 * internal details (provider names, latencies, hostnames) — this response is
 * safe for unauthenticated consumption.
 *
 * @module Contracts/Status
 */

import { errorResponseSchema } from '../modules/system';
import { createSchema, parseNumber, parseString } from '../schema';

import { STATUS_COMPONENTS } from './contract.health';

import type { StatusComponentName, StatusComponentState } from './contract.health';
import type { Contract } from '../api/api';
import type { OverallStatus } from '../modules/system';
import type { Schema } from '../schema';

// ============================================================================
// Types
// ============================================================================

/** A single auto-recorded incident (a component observed down by a probe). */
export interface StatusIncident {
  /** Component that went down. */
  component: StatusComponentName;
  /** ISO 8601 timestamp of the probe that first observed the outage. */
  startedAt: string;
  /** ISO 8601 timestamp of the probe that observed recovery, or null while ongoing. */
  resolvedAt: string | null;
}

/** Public status summary returned by `GET /api/status`. */
export interface StatusSummaryResponse {
  /** Overall system status derived from component states. */
  status: OverallStatus;
  /** ISO 8601 timestamp of this probe. */
  timestamp: string;
  /** Server process uptime in seconds. */
  uptimeSeconds: number;
  /** Per-component state. */
  components: Record<StatusComponentName, StatusComponentState>;
  /** Incident timeline (newest first), recorded in-process from health probes. */
  incidents: StatusIncident[];
}

// ============================================================================
// Schemas
// ============================================================================

const overallStatusValues: readonly OverallStatus[] = ['healthy', 'degraded', 'down'];
const componentStateValues: readonly StatusComponentState[] = ['up', 'down', 'unknown'];

function parseComponentName(value: unknown, field: string): StatusComponentName {
  const name = parseString(value, field);
  if (!STATUS_COMPONENTS.includes(name as StatusComponentName)) {
    throw new Error(`${field} must be one of: ${STATUS_COMPONENTS.join(', ')}`);
  }
  return name as StatusComponentName;
}

function parseIncident(data: unknown, field: string): StatusIncident {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    component: parseComponentName(obj['component'], `${field}.component`),
    startedAt: parseString(obj['startedAt'], `${field}.startedAt`),
    resolvedAt: typeof obj['resolvedAt'] === 'string' ? obj['resolvedAt'] : null,
  };
}

/** Schema for {@link StatusSummaryResponse}. */
export const statusSummaryResponseSchema: Schema<StatusSummaryResponse> = createSchema(
  (data: unknown): StatusSummaryResponse => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    const status = parseString(obj['status'], 'status');
    if (!overallStatusValues.includes(status as OverallStatus)) {
      throw new Error(`status must be one of: ${overallStatusValues.join(', ')}`);
    }

    const rawComponents = (
      obj['components'] !== null && typeof obj['components'] === 'object' ? obj['components'] : {}
    ) as Record<string, unknown>;
    const components = {} as Record<StatusComponentName, StatusComponentState>;
    for (const name of STATUS_COMPONENTS) {
      const state = parseString(rawComponents[name], `components.${name}`);
      if (!componentStateValues.includes(state as StatusComponentState)) {
        throw new Error(`components.${name} must be one of: ${componentStateValues.join(', ')}`);
      }
      components[name] = state as StatusComponentState;
    }

    const rawIncidents = Array.isArray(obj['incidents']) ? obj['incidents'] : [];

    return {
      status: status as OverallStatus,
      timestamp: parseString(obj['timestamp'], 'timestamp'),
      uptimeSeconds: parseNumber(obj['uptimeSeconds'], 'uptimeSeconds'),
      components,
      incidents: rawIncidents.map((entry, index) =>
        parseIncident(entry, `incidents[${String(index)}]`),
      ),
    };
  },
);

// ============================================================================
// Contract
// ============================================================================

export const statusContract = {
  getSummary: {
    method: 'GET' as const,
    path: '/api/status',
    responses: {
      200: statusSummaryResponseSchema,
      500: errorResponseSchema,
    },
    summary: 'Public component status summary (unauthenticated)',
  },
} satisfies Contract;
