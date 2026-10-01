// main/apps/web/vite.config.ts
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import createSharedVitestAliases from '../../tools/scripts/audit/shared-vitest-aliases';

const repoRoot = path.resolve(__dirname, '../../');
const webRoot = path.join(repoRoot, 'apps/web');
const webConfigDir = path.dirname(fileURLToPath(import.meta.url));

// Load VITE_* env vars from the shared config/env directory (where .env.local
// lives) rather than the app root, so client flags resolve reliably.
const envConfigDir = path.resolve(repoRoot, '../config/env');

/**
 * SSR mode: set by the `build:server` script.
 *
 * `vite build`               → dist/client — the site that ships.
 * `VITE_SSR=true vite build` → dist/server — build tooling, never shipped.
 *
 * There is no SSR server. dist/server/entry-server.js exists so that the build
 * can render the public pages once, at build time: `pnpm --filter @bslt/web build`
 * runs both, then scripts/prerender.ts imports the SSR bundle,
 * renders each live site-map path against dist/client/index.html, and writes
 * `<path>/index.html` back into dist/client.
 */
const isSsrBuild = process.env['VITE_SSR'] === 'true';

/**
 * Resolves alias paths relative to repo root
 */
function resolveAlias(relativePath: string): string {
  return path.join(repoRoot, relativePath);
}

const DEFAULT_API_PROXY_TARGET = 'http://127.0.0.1:8080';
const DEFAULT_WS_PROXY_TARGET = 'ws://127.0.0.1:8080';
const API_PROXY_TIMEOUT_MS = 30_000;

function normalizeProxyTarget(rawTarget: string, fallbackProtocol: 'http:' | 'ws:'): string {
  try {
    const normalizedInput = rawTarget.includes('://')
      ? rawTarget
      : `${fallbackProtocol}//${rawTarget}`;
    const url = new URL(normalizedInput);
    const isLocalHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.port === '' && isLocalHost) {
      url.port = '8080';
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return rawTarget;
  }
}

const apiProxyTarget = normalizeProxyTarget(
  process.env['VITE_PROXY_TARGET'] ?? DEFAULT_API_PROXY_TARGET,
  'http:',
);
const wsProxyTarget = normalizeProxyTarget(
  process.env['VITE_PROXY_WS_TARGET'] ?? DEFAULT_WS_PROXY_TARGET,
  'ws:',
);
const verboseProxyLogs = process.env['VITE_PROXY_VERBOSE'] === '1';

logStdout(`[vite-proxy] resolved api target: ${apiProxyTarget}`);
logStdout(`[vite-proxy] resolved ws target: ${wsProxyTarget}`);

function setProxyRequestHeader(proxyReq: unknown, name: string, value: string): void {
  if (proxyReq === null || typeof proxyReq !== 'object' || !('setHeader' in proxyReq)) {
    return;
  }

  const setHeader = (proxyReq as { setHeader?: unknown }).setHeader;
  if (typeof setHeader !== 'function') {
    return;
  }

  setHeader.call(proxyReq, name, value);
}

function createHttpProxyConfig(target: string) {
  return {
    target,
    changeOrigin: true,
    timeout: API_PROXY_TIMEOUT_MS,
    proxyTimeout: API_PROXY_TIMEOUT_MS,
    configure: (
      proxy: {
        on: (event: string, listener: (...args: unknown[]) => void) => void;
      },
      _options: unknown,
    ) => {
      proxy.on('proxyReq', (proxyReq, req) => {
        setProxyRequestHeader(proxyReq, 'accept-encoding', 'identity');

        if (!verboseProxyLogs) return;
        const method =
          req !== null && typeof req === 'object' && 'method' in req
            ? String((req as { method?: unknown }).method ?? '')
            : '';
        const url =
          req !== null && typeof req === 'object' && 'url' in req
            ? String((req as { url?: unknown }).url ?? '')
            : '';
        const upstream =
          proxyReq !== null &&
          typeof proxyReq === 'object' &&
          'protocol' in proxyReq &&
          'host' in proxyReq &&
          'path' in proxyReq
            ? `${String((proxyReq as { protocol?: unknown }).protocol ?? '')}//${String((proxyReq as { host?: unknown }).host ?? '')}${String((proxyReq as { path?: unknown }).path ?? '')}`
            : target;
        logStdout(`[vite-proxy] ${method} ${url} -> ${upstream}`);
      });

      proxy.on('proxyRes', (proxyRes, req) => {
        if (!verboseProxyLogs) return;
        const method =
          req !== null && typeof req === 'object' && 'method' in req
            ? String((req as { method?: unknown }).method ?? '')
            : '';
        const url =
          req !== null && typeof req === 'object' && 'url' in req
            ? String((req as { url?: unknown }).url ?? '')
            : '';
        const status =
          proxyRes !== null && typeof proxyRes === 'object' && 'statusCode' in proxyRes
            ? String((proxyRes as { statusCode?: unknown }).statusCode ?? '')
            : '';
        logStdout(`[vite-proxy] ${method} ${url} <- ${status}`);
      });

      proxy.on('error', (err, req, res) => {
        logStderr(
          `[vite-proxy] upstream error for ${
            req !== null && typeof req === 'object' && 'url' in req
              ? String((req as { url?: unknown }).url ?? '')
              : ''
          } to ${target}`,
          err instanceof Error ? err : new Error(String(err)),
        );

        const serverRes = res as
          | {
              headersSent?: boolean;
              writableEnded?: boolean;
              writeHead?: (statusCode: number, headers?: Record<string, string>) => void;
              end?: (body?: string) => void;
            }
          | undefined;

        // Some proxy failures do not provide a writable ServerResponse.
        // Never throw from this handler, or the browser sees ERR_EMPTY_RESPONSE.
        if (
          serverRes === undefined ||
          serverRes.headersSent === true ||
          serverRes.writableEnded === true ||
          typeof serverRes.writeHead !== 'function' ||
          typeof serverRes.end !== 'function'
        ) {
          return;
        }

        try {
          serverRes.writeHead(502, { 'Content-Type': 'application/json' });
          serverRes.end(
            JSON.stringify({
              message: `Proxy error to ${target}`,
              error: err instanceof Error ? err.message : String(err),
              path:
                req !== null && typeof req === 'object' && 'url' in req
                  ? String((req as { url?: unknown }).url ?? '')
                  : '',
            }),
          );
        } catch {
          // Ignore write failures; connection is already broken.
        }
      });
    },
  };
}

/** Shared proxy rules for dev server and preview server */
const proxyConfig = {
  '/api': createHttpProxyConfig(apiProxyTarget),
  '/health': createHttpProxyConfig(apiProxyTarget),
  '/uploads': createHttpProxyConfig(apiProxyTarget),
  '/ws': {
    target: wsProxyTarget,
    ws: true,
  },
};

function logStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

function logStderr(message: string, error?: unknown): void {
  const detail = error instanceof Error ? ` ${error.stack ?? error.message}` : '';
  process.stderr.write(`${message}${detail}\n`);
}

export default defineConfig(async ({ command, mode }) => {
  const isProd = mode === 'production';

  logStdout(`[vite] starting build in ${mode} mode (command: ${command})`);

  return {
    cacheDir: path.join(repoRoot, 'node_modules/.cache/vite-bslt-web'),
    envDir: envConfigDir,
    plugins: [react()],
    resolve: {
      conditions: ['source'],
      alias: [
        ...createSharedVitestAliases(webConfigDir),
        // Monorepo packages → source files
        { find: '@bslt/ui', replacement: resolveAlias('client/ui/src') },
        { find: '@bslt/api', replacement: resolveAlias('client/api/src') },
        { find: '@bslt/client-engine', replacement: resolveAlias('client/engine/src') },
        { find: '@bslt/react', replacement: resolveAlias('client/react/src') },
        { find: '@bslt/db', replacement: resolveAlias('server/db/src') },
        { find: '@bslt/media', replacement: resolveAlias('server/media/src') },

        // UI package internal aliases
        { find: '@components', replacement: resolveAlias('client/ui/src/components') },
        { find: '@containers', replacement: resolveAlias('client/ui/src/layouts/containers') },
        { find: '@elements', replacement: resolveAlias('client/ui/src/elements') },
        { find: '@hooks', replacement: resolveAlias('client/react/src/hooks') },
        { find: '@layers', replacement: resolveAlias('client/ui/src/layouts/layers') },
        { find: '@layouts', replacement: resolveAlias('client/ui/src/layouts') },
        { find: '@providers', replacement: resolveAlias('client/react/src/providers') },
        { find: '@router', replacement: resolveAlias('client/react/src/router') },
        { find: '@shells', replacement: resolveAlias('client/ui/src/layouts/shells') },
        { find: '@theme', replacement: resolveAlias('client/ui/src/theme') },
        { find: '@types', replacement: resolveAlias('client/ui/src/types') },
        { find: '@utils', replacement: resolveAlias('client/ui/src/utils') },

        // Core package internal aliases
        { find: '@domain', replacement: resolveAlias('shared/src/domain') },
        { find: '@shared', replacement: resolveAlias('shared/src') },

        // Web app aliases
        { find: '@', replacement: resolveAlias('apps/web/src') },
        { find: '@admin', replacement: resolveAlias('apps/web/src/features/admin') },
        { find: '@app', replacement: resolveAlias('apps/web/src/app') },
        { find: '@auth', replacement: resolveAlias('apps/web/src/features/auth') },
        { find: '@billing', replacement: resolveAlias('apps/web/src/features/billing') },
        {
          find: '@demo/ui-library/catalog',
          replacement: resolveAlias('apps/web/src/demo/ui-library/catalog'),
        },
        { find: '@config', replacement: resolveAlias('apps/web/src/config') },
        { find: '@dashboard', replacement: resolveAlias('apps/web/src/features/dashboard') },
        { find: '@demo', replacement: resolveAlias('apps/web/src/demo') },
        { find: '@demo/ui-library', replacement: resolveAlias('apps/web/src/demo/ui-library') },
        { find: '@features', replacement: resolveAlias('apps/web/src/features') },
        { find: '@demo/home', replacement: resolveAlias('apps/web/src/demo/home') },
        { find: '@pages', replacement: resolveAlias('apps/web/src/pages') },
        { find: '@settings', replacement: resolveAlias('apps/web/src/features/settings') },
      ],
    },
    publicDir: `${webRoot}/public`,
    build: {
      // dist/client is the deployable site (and what the prerenderer writes into);
      // dist/server holds the render function the prerenderer imports at build
      // time. Keeping them apart is what lets the image ship one and not the other.
      outDir: isSsrBuild ? `${webRoot}/dist/server` : `${webRoot}/dist/client`,
      emptyOutDir: true,
      // SSR server bundle: single ESM file, no CSS splitting, no chunking.
      // Client bundle: vendor splitting + CSS code splitting for performance.
      ...(isSsrBuild
        ? {
            ssr: true,
            rollupOptions: {
              input: `${webRoot}/src/entry-server.tsx`,
              output: { format: 'esm' },
            },
          }
        : {
            rollupOptions: {
              input: `${webRoot}/index.html`,
              output: {
                // Function form: the object form only matched the bare package
                // entry, so react-dom (and everything else) stayed in the entry
                // chunk (603 kB). Match by module path instead and split the
                // heavyweights: react runtime, data layer, and the generated
                // API client (admin surface included) out of the first load.
                manualChunks: (id: string): string | undefined => {
                  if (!id.includes('node_modules') && !id.includes('/generated/')) {
                    return undefined;
                  }
                  if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
                    return 'vendor-react';
                  }
                  if (id.includes('node_modules/@tanstack/')) {
                    return 'vendor-query';
                  }
                  if (id.includes('/client/api/src/generated/')) {
                    return 'api-generated';
                  }
                  return undefined;
                },
              },
            },
            chunkSizeWarningLimit: 300,
            cssCodeSplit: true,
            minify: 'esbuild',
            target: 'es2020',
          }),
    },
    server: {
      // The dev orchestrator pre-picks a free port and passes it via VITE_DEV_PORT.
      // strictPort is off so Vite self-increments if that port races shut between
      // the orchestrator's check and bind (e.g. another project's server reclaiming it).
      port: Number(process.env['VITE_DEV_PORT']) || 5173,
      strictPort: false,
      open: true,
      proxy: proxyConfig,
    },
    preview: {
      port: 4173,
      strictPort: true,
      proxy: proxyConfig,
    },
  };
});
