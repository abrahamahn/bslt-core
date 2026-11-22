// main/tools/lib/phase.ts
/**
 * The restructure phase in progress (docs/architecture/restructure/restructure-plan.md,
 * section 17). The one place the tools read it from.
 *
 * Raise it in the first commit of a phase. The `deps-allowlist` gate then fails
 * on every runtime dependency that was due out by an earlier phase, and
 * `phase.test.ts` requires the restructure README to report the same phase.
 */
export const CURRENT_PHASE = 20;
