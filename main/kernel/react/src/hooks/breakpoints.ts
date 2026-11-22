// main/kernel/react/src/hooks/breakpoints.ts
const BREAKPOINTS = {
  sm: '30rem',
  md: '48rem',
  lg: '64rem',
  xl: '80rem',
  ['2xl']: '96rem',
} as const;

export type BreakpointKey = keyof typeof BREAKPOINTS;

export const BREAKPOINT_ORDER: readonly BreakpointKey[] = ['sm', 'md', 'lg', 'xl', '2xl'];

export const MOBILE_BREAKPOINT: BreakpointKey = 'md';

export function breakpointUp(key: BreakpointKey): string {
  return `(min-width: ${BREAKPOINTS[key]})`;
}

export function breakpointDown(key: BreakpointKey): string {
  return `(max-width: ${BREAKPOINTS[key]})`;
}
