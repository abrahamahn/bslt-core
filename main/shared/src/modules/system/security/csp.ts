// main/shared/src/modules/system/security/csp.ts
/**
 * The single source of truth for Content-Security-Policy.
 *
 * ## Scripts live in files. Never inline.
 *
 * `script-src` is `'self'` — no `'unsafe-inline'`. An inline `<script>` in
 * `main/apps/web/index.html` is blocked **in production only**: dev sends no CSP
 * header at all, so it works perfectly on your machine and then silently does
 * nothing for every real user. A pre-paint theme resolver is the classic case.
 *
 * Put the script in a file instead (`main/apps/web/public/theme-init.js`) and
 * load it with `<script src="/theme-init.js">`. Do NOT "fix" a blocked script by
 * adding `'unsafe-inline'` — that directive is the entire reason the header is
 * worth sending, and enabling it re-opens every injected-script XSS the policy
 * exists to stop.
 *
 * An inline `<style>` IS permitted (`style-src` carries `'unsafe-inline'` for the
 * critical anti-flash CSS in index.html). Styles cannot execute code; scripts can.
 *
 * ## Why the policy is data, and why there is an audit
 *
 * The policy is enforced at layers that cannot import from one another: the
 * Fastify API (via `getProductionSecurityDefaults`) and every edge that serves
 * the SPA document — the Caddy proxy (`infra/runtime/caddy/Caddyfile`), the two
 * nginx configs (`infra/docker/nginx.conf`, `infra/docker/demo/nginx.conf`) and
 * the Cloudflare static path (`main/apps/web/public/_headers`) — all plain text,
 * not TypeScript. Hand-copied security headers drift, and the first two already
 * had. So the copies are *checked* instead of trusted: `pnpm audit:csp`
 * (`main/tools/scripts/audit/csp-sync.ts`) re-serializes `EDGE_CSP` from the data
 * below and fails the build unless every copy is byte-identical.
 *
 * Guards that keep this honest:
 * - `csp.test.ts` — pins `script-src` free of `'unsafe-inline'`/`'unsafe-eval'`.
 * - `main/tools/scripts/audit/csp-sync.ts` — every edge copy must match `EDGE_CSP`.
 * - `main/apps/web/src/index-html.test.ts` — no inline `<script>` in index.html.
 */

/** CSP directive names mapped to their source lists, in header order. */
export type CspDirectives = Readonly<Record<string, string>>;

/**
 * Same-origin script files only. The API ships this verbatim; the edge appends
 * the third-party origins below. `'self'` first is the invariant either way:
 * this is the directive the whole policy hinges on, so it has one definition.
 */
export const CSP_SCRIPT_SRC = "'self'";

// Third-party origins, one constant per feature so a fork that drops the
// feature can find and drop its origins. Every one is pinned https.

/** Stripe.js / Elements (billing checkout): the SDK script and the card iframes. */
const STRIPE_JS = 'https://js.stripe.com';
/** Stripe 3D Secure: the bank-challenge iframe during confirmPayment. */
const STRIPE_HOOKS = 'https://hooks.stripe.com';
/** Stripe.js telemetry + tokenization calls from the browser. */
const STRIPE_API = 'https://api.stripe.com';
/** Cloudflare Turnstile (VITE_CAPTCHA_ENABLED): api.js script and the challenge iframe. */
const TURNSTILE = 'https://challenges.cloudflare.com';
/** Sentry browser SDK (VITE_SENTRY_DSN): event ingest at o<org>.ingest[.region].sentry.io. */
const SENTRY_INGEST = 'https://*.sentry.io';

/**
 * `'unsafe-inline'` is required here, and only here: index.html carries critical
 * inline CSS to prevent a white flash before the stylesheet loads.
 */
export const CSP_STYLE_SRC = "'self' 'unsafe-inline'";

/** Serialize directives into a CSP header value. */
export function serializeCsp(directives: CspDirectives): string {
  return Object.entries(directives)
    .map(([name, value]) => `${name} ${value};`)
    .join(' ');
}

/**
 * The policy the edge sends with the SPA document. This is the CSP the browser
 * actually applies, so it is the one that decides whether an inline script runs.
 *
 * `connect-src wss:` is for the realtime socket; `img-src blob:` for canvas and
 * object-URL previews. Both are edge concerns — the API never serves a document.
 * The Stripe / Turnstile / Sentry origins cover the starter's whole third-party
 * surface; scripts loaded through `loadConsentedScript` are a fork's own — the
 * fork must add their origins here (never `'unsafe-inline'`) or they will not run.
 */
const EDGE_CSP_DIRECTIVES: CspDirectives = {
  'default-src': "'self'",
  'script-src': `${CSP_SCRIPT_SRC} ${STRIPE_JS} ${TURNSTILE}`,
  'style-src': CSP_STYLE_SRC,
  'img-src': "'self' data: blob:",
  'font-src': "'self'",
  'connect-src': `'self' wss: ${STRIPE_API} ${SENTRY_INGEST}`,
  'frame-src': `${STRIPE_JS} ${STRIPE_HOOKS} ${TURNSTILE}`,
  'object-src': "'none'",
  'base-uri': "'self'",
  'frame-ancestors': "'self'",
};

/**
 * Every document-serving prod path MUST send exactly this: the Caddyfile, both
 * nginx configs, and `main/apps/web/public/_headers` (the Cloudflare static
 * path). Enforced byte-for-byte by `pnpm audit:csp`.
 */
export const EDGE_CSP = serializeCsp(EDGE_CSP_DIRECTIVES);

/**
 * The policy the API sends. It serves JSON, never a document, so it is stricter:
 * nothing may frame it and it needs no socket or blob origins of its own.
 */
const API_CSP_DIRECTIVES: CspDirectives = {
  'default-src': "'self'",
  'script-src': CSP_SCRIPT_SRC,
  'style-src': CSP_STYLE_SRC,
  'img-src': "'self' data:",
  'font-src': "'self'",
  'frame-ancestors': "'none'",
  'object-src': "'none'",
};

/** Sent by `getProductionSecurityDefaults()` in production. */
export const API_CSP = serializeCsp(API_CSP_DIRECTIVES);

/** Split a CSP header value into its directives. Tolerates extra whitespace. */
export function parseCsp(header: string): Record<string, string> {
  const directives: Record<string, string> = {};

  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;

    const separator = trimmed.indexOf(' ');
    if (separator === -1) {
      directives[trimmed] = '';
      continue;
    }

    directives[trimmed.slice(0, separator)] = trimmed.slice(separator + 1).trim();
  }

  return directives;
}

/** Source expressions that let injected markup execute. Never valid in `script-src`. */
const EXECUTABLE_SOURCES = ["'unsafe-inline'", "'unsafe-eval'"] as const;

/**
 * Report every source expression in a CSP header that would let scripts execute
 * inline. Returned as messages so both the shared test and the Caddyfile audit can
 * assert on the same rule rather than each re-deriving it.
 *
 * A policy with no `script-src` is not a safe policy: CSP falls back to
 * `default-src` for scripts, so deleting the directive is a quieter way of
 * loosening it than editing it. Both are checked.
 */
export function findUnsafeScriptSources(header: string): string[] {
  const directives = parseCsp(header);
  const governing = directives['script-src'] === undefined ? 'default-src' : 'script-src';
  const sources = directives[governing];
  if (sources === undefined) return [];

  return EXECUTABLE_SOURCES.filter((source) => sources.includes(source)).map(
    (source) => `${governing} must not contain ${source} — scripts belong in files, not inline.`,
  );
}
