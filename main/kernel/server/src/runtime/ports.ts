// main/kernel/server/src/runtime/ports.ts

/**
 * Returns unique, finite port values from a candidate list.
 */
export function uniquePorts(ports: Array<number | undefined>): number[] {
  return Array.from(new Set(ports.filter((port): port is number => Number.isFinite(port))));
}
