// main/tools/scripts/dev/appName.ts
/**
 * Resolve the display app name for the dev startup banner.
 *
 * Mirrors `resolveAppName` in the server config factory so the `pnpm dev`
 * banner shows the same name as `config.app.name` (the API banner) instead of
 * the hardcoded 'Your App' default. Returns `undefined` when nothing is
 * configured, letting the banner fall back to its own default.
 */
export function resolveDevAppName(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const configured = env['APP_NAME'] ?? env['VITE_APP_NAME'] ?? env['EMAIL_FROM_NAME'];
  return configured !== undefined && configured.trim().length > 0 ? configured.trim() : undefined;
}
