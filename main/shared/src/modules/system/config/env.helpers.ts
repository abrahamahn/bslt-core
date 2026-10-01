// main/shared/src/modules/system/config/env.helpers.ts
/**
 * Returns an explicit environment map for schema validation.
 * shared/config stays runtime-agnostic, so there is no implicit runtime-global fallback.
 */
export function getRawEnv(
  override?: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return override ?? {};
}
