// main/shared/src/modules/system/runtime/runtime.ts
/**
 * Shared runtime helpers that are environment-agnostic.
 */

/**
 * Returns unique, finite port values from a candidate list.
 */
export function uniquePorts(ports: Array<number | undefined>): number[] {
  return Array.from(new Set(ports.filter((port): port is number => Number.isFinite(port))));
}
