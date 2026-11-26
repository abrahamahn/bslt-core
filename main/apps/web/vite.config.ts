// main/apps/web/vite.config.ts
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

import { defineViteConfig } from '@bslt/build-config/vite';

const repoRoot = path.resolve(__dirname, '../../');
const webRoot = path.join(repoRoot, 'apps/web');
const openApiSpecPath = path.resolve(repoRoot, '../docs/reference/openapi.json');

function serveDevOpenApiSpec(): Plugin {
  return {
    name: 'bslt-dev-openapi',
    configureServer(server) {
      server.middlewares.use('/openapi.json', (_req, res, next) => {
        if (!existsSync(openApiSpecPath)) {
          next();
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(readFileSync(openApiSpecPath, 'utf8'));
      });
    },
  };
}

// Load VITE_* env vars from the shared config/env directory (where .env.local
// lives) rather than the app root, so client flags resolve reliably.
const envConfigDir = path.resolve(repoRoot, '../config/env');

/**
 * SSR mode: set by the `build:server` script.
 *
 * `vite build`               → dist/client — SPA + lean entry-public bundles + .vite/manifest.json.
 * `VITE_SSR=true vite build` → dist/server/serve.js — PROCESS_ROLE=web runtime SSR server + build-time prerender export.
 */
const isSsrBuild = process.env['VITE_SSR'] === 'true';

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
          if ('destroy' in serverRes && typeof serverRes.destroy === 'function') {
            serverRes.destroy();
          }
          return;
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

  // Workspace packages resolve to source through their `source` export condition
  // (client and SSR builds alike), app-internal modules through package.json
  // `imports` (`#app/*`).
  return defineViteConfig({
    cacheDir: path.join(repoRoot, 'node_modules/.cache/vite-bslt-web'),
    envDir: envConfigDir,
    plugins: [react(), serveDevOpenApiSpec()],
    publicDir: `${webRoot}/public`,
    ...(isSsrBuild ? { ssr: { noExternal: true } } : {}),
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
              input: `${webRoot}/src/server/serve.ts`,
              output: {
                format: 'esm',
                entryFileNames: 'serve.js',
              },
            },
          }
        : {
            manifest: true,
            rollupOptions: {
              input: {
                main: `${webRoot}/index.html`,
                public: `${webRoot}/src/entry-public.tsx`,
              },
              output: {
                // Function form: the object form only matched the bare package
                // entry, so react-dom (and everything else) stayed in the entry
                // chunk (603 kB). Match by module path instead and split the
                // heavyweights: react runtime, data layer, and the generated
                // API client (admin surface included) out of the first load.
                manualChunks: (id: string): string | undefined => {
                  if (!id.includes('node_modules')) {
                    return undefined;
                  }
                  if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
                    return 'vendor-react';
                  }
                  if (id.includes('node_modules/@tanstack/')) {
                    return 'vendor-query';
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
  });
});
