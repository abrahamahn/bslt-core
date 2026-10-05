// main/tools/features/ui.ts
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { readArchiveBytes, type FeatureArchive } from './archive';
import { applyFeature, checkFeatures, coreVersion, listFeatures, type State } from './install';
import { destination } from './manifest';

const MAX_UPLOAD = 8 * 1024 * 1024;
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BSLT · Module installer</title><link rel="stylesheet" href="/styles.css"><script src="/app.js" defer></script></head>
<body><main><header><span class="brand">BSLT</span><span class="local">LOCAL INSTALLER</span></header>
<p class="eyebrow">YOUR PROJECT. YOUR MODULES.</p><h1>Module installer</h1><p class="lead">Choose a downloaded BSLT module. Review its changes, then install it into this Core project.</p>
<noscript><p class="notice">Enable JavaScript to use this installer, or use the Core command: pnpm features:add ./module.tar.gz</p></noscript>
<section aria-labelledby="choose-title"><div class="step">01</div><h2 id="choose-title">Choose your module</h2><label for="archive">Module archive (.tar.gz, up to 8 MiB)</label><input id="archive" type="file" accept=".tar.gz,.tgz,application/gzip" aria-describedby="archive-help" disabled><p id="archive-help" class="muted">Use module packs from a source you trust. Modules contain application code. Full Core and Pro archives cannot be installed here.</p></section>
<section id="preview" aria-labelledby="preview-title" hidden><div class="step">02</div><h2 id="preview-title" tabindex="-1">Review module</h2><dl><dt>Name</dt><dd id="module-name"></dd><dt>Version</dt><dd id="module-version"></dd><dt>Core release</dt><dd id="core-version"></dd><dt>Action</dt><dd id="action"></dd></dl><details><summary>Files to install</summary><ul id="files"></ul></details><details id="removals" hidden><summary>Files to remove</summary><ul id="removed-files"></ul></details><p class="muted">The installer checks compatibility and existing files before applying changes.</p><button id="install" type="button" disabled>Install module</button></section>
<section id="success" aria-labelledby="success-title" hidden><div class="step">03</div><h2 id="success-title" tabindex="-1">Module installed</h2><p>Your module is registered in this Core project.</p><div id="routes"></div><p>Before using it, verify and build your project:</p><pre><code>pnpm type-check &amp;&amp; pnpm build</code></pre><p>Restart the app after the build. Open the module page after signing in. Modules with an API use the route shown above.</p><p class="muted">Module-specific setup, such as billing provider credentials, may still be required. Follow the module's setup guide.</p></section>
<p id="status" role="status" aria-live="polite" aria-atomic="true"></p><footer>This installer runs only on your computer. Keep this terminal open while installing. Press Ctrl+C in the terminal to close it.</footer></main></body></html>`;
const CSS = `:root{--ink:#171717;--background:#fafafa;--surface:#fff;--border:#d9d9d9;--control-border:#bbb;--muted:#666;--focus:#555;--code-background:#f4f4f4;color-scheme:light;font-family:Inter,Arial,sans-serif;color:var(--ink);background:var(--background);font-synthesis:none}*{box-sizing:border-box}body{margin:0}main{max-width:47.5rem;margin:0 auto;padding:2rem 1.5rem 4rem}header{display:flex;justify-content:space-between;align-items:center;padding-bottom:2.5rem;border-bottom:1px solid var(--border)}.brand{font-size:1.5rem;font-weight:800;letter-spacing:-0.0625rem}.local,.eyebrow,.step{font:0.6875rem/1.5 monospace;letter-spacing:0.0875rem}.local{color:var(--muted)}.eyebrow{margin-top:2.75rem;color:var(--muted)}h1{font-size:clamp(2rem,7vw,3rem);letter-spacing:-0.125rem;line-height:1.1;margin:1rem 0}h2{font-size:1.3125rem;letter-spacing:-0.03125rem;margin:0.5rem 0 1.375rem}.lead{font-size:1.0625rem;line-height:1.6;color:var(--focus);max-width:37.5rem}section{background:var(--surface);border:1px solid var(--border);padding:1.5rem;margin:1.5rem 0}.step{color:var(--muted)}label{display:block;font-size:0.875rem;font-weight:600;margin-bottom:0.625rem}input{max-width:100%;width:100%;font:inherit;border:1px solid var(--control-border);padding:0.75rem;background:var(--background)}input::file-selector-button{background:var(--surface);border:1px solid var(--border);padding:0.5rem 0.75rem;margin-right:0.75rem;border-radius:0.25rem;color:var(--ink);font:inherit;cursor:pointer}p,li,dd{line-height:1.6}.muted,footer{color:var(--muted);font-size:0.8125rem}.muted{margin-bottom:0}dl{display:grid;grid-template-columns:6.875rem 1fr;gap:0.625rem;font-size:0.875rem}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}details{font-size:0.8125rem;margin:1.5rem 0}summary{cursor:pointer}ul{padding-left:1.25rem}li{overflow-wrap:anywhere;font-family:monospace}button{background:var(--ink);color:var(--surface);border:1px solid var(--ink);border-radius:0.3125rem;padding:0.75rem 1.375rem;font:600 0.875rem/1.4 Arial,sans-serif;cursor:pointer;margin-top:1.25rem}button:disabled{opacity:.5;cursor:wait}:focus-visible{outline:0.1875rem solid var(--focus);outline-offset:0.25rem}pre{padding:1rem;background:var(--code-background);white-space:pre-wrap;overflow-wrap:anywhere;font-size:0.8125rem}code{overflow-wrap:anywhere}#status:not(:empty),.notice{border:1px solid var(--control-border);background:var(--surface);padding:1rem;font-size:0.875rem;overflow-wrap:anywhere}footer{border-top:1px solid var(--border);padding-top:1.5rem;margin-top:2rem;line-height:1.6}[hidden]{display:none!important}@media(max-width:26.25rem){main{padding:1.5rem 1rem 2.5rem}section{padding:1.125rem}dl{grid-template-columns:5.625rem 1fr}.local{font-size:0.5625rem}}`;
const SCRIPT = String.raw`'use strict';
const token = location.hash.slice(1);
history.replaceState(null, '', '/');
const $ = (id) => document.getElementById(id);
const archive = $('archive');
const install = $('install');
const status = $('status');
let previewId = null;
function message(text) { status.textContent = text; }
async function request(route, body, type) {
  const response = await fetch(route, { method: 'POST', headers: { 'Content-Type': type, Authorization: 'Bearer ' + token }, body });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The installer could not complete this request.');
  return result;
}
if (token) { archive.disabled = false; }
else { message('Open the complete installer URL printed in your terminal to begin a secure session.'); }
archive.addEventListener('change', async () => {
  previewId = null;
  install.disabled = true;
  $('preview').hidden = true;
  $('success').hidden = true;
  const file = archive.files[0];
  if (!file) { message('Choose a module archive to begin.'); return; }
  if (file.size > 8 * 1024 * 1024) { message('Choose an archive no larger than 8 MiB.'); return; }
  archive.disabled = true;
  message('Checking module compatibility and files…');
  try {
    const result = await request('/api/preview', file, 'application/gzip');
    previewId = result.previewId;
    $('module-name').textContent = result.name;
    $('module-version').textContent = result.previousVersion ? result.previousVersion + ' → ' + result.version : result.version;
    $('core-version').textContent = result.coreVersion;
    $('action').textContent = result.action;
    $('files').replaceChildren(...result.files.map((file) => { const item = document.createElement('li'); item.textContent = file; return item; }));
    $('removed-files').replaceChildren(...result.removedFiles.map((file) => { const item = document.createElement('li'); item.textContent = file; return item; }));
    $('removals').hidden = result.removedFiles.length === 0;
    $('preview').hidden = false;
    install.disabled = false;
    install.textContent = result.action === 'Update' ? 'Update module' : 'Install module';
    message('Ready to install. No project files have changed.');
    $('preview-title').focus();
  } catch (error) { archive.value = ''; message(error instanceof Error ? error.message : 'Could not preview this module.'); }
  finally { archive.disabled = false; }
});
install.addEventListener('click', async () => {
  if (!previewId) return;
  const selected = previewId;
  previewId = null;
  archive.disabled = true;
  install.disabled = true;
  message('Installing module…');
  try {
    const result = await request('/api/install', JSON.stringify({ previewId: selected }), 'application/json');
    $('routes').replaceChildren();
    for (const [label, route] of [['Module page', result.page], ['API route', result.api]]) {
      if (!route) continue;
      const paragraph = document.createElement('p');
      paragraph.append(label + ': ');
      const code = document.createElement('code');
      code.textContent = route;
      paragraph.append(code);
      $('routes').append(paragraph);
    }
    $('preview').hidden = true;
    $('success').hidden = false;
    $('success-title').focus();
    message('Installation complete. Build and restart your app to use the module.');
  } catch (error) { message((error instanceof Error ? error.message : 'Could not install this module.') + ' Choose the archive again to create a fresh preview.'); }
  finally { archive.disabled = false; archive.value = ''; }
});`;

class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
function send(
  response: ServerResponse,
  status: number,
  value: string | object,
  type = 'application/json',
): void {
  response.writeHead(status, {
    'Content-Type': `${type}; charset=utf-8`,
    'Content-Security-Policy': CSP,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    Connection: 'close',
  });
  response.end(typeof value === 'string' ? value : JSON.stringify(value));
}
function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const length = request.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > limit))
    throw new RequestError(
      413,
      `Request exceeds ${limit === MAX_UPLOAD ? '8 MiB' : 'installation request limit'}.`,
    );
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    request.on('data', (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        request.pause();
        reject(new RequestError(413, 'Request exceeds the upload limit.'));
      } else chunks.push(chunk);
    });
    request.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    request.on('aborted', () =>
      reject(new RequestError(400, 'Upload interrupted. Choose the archive again.')),
    );
    request.on('error', reject);
  });
}
function authenticated(header: string | undefined, token: string): boolean {
  const actual = Buffer.from(header ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function routes(pack: FeatureArchive): { page?: string; api?: string } {
  return {
    ...(pack.files.has('web/index.tsx') ? { page: `/extensions/${pack.manifest.id}` } : {}),
    ...(pack.files.has('server/index.ts') ? { api: `/api/extensions/${pack.manifest.id}` } : {}),
  };
}
function installationId(input: Buffer): string {
  let value: unknown;
  try {
    value = JSON.parse(input.toString('utf8'));
  } catch {
    throw new RequestError(400, 'Expected a JSON installation request.');
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !('previewId' in value) ||
    typeof value.previewId !== 'string' ||
    !/^[A-Za-z0-9_-]{32}$/.test(value.previewId)
  )
    throw new RequestError(400, 'Expected only the preview identifier.');
  return value.previewId;
}
export interface FeatureInstaller {
  origin: string;
  /** A local capability URL. Its fragment is never sent in an HTTP request or served asset. */
  url: string;
  close(): Promise<void>;
}
/** Start a local installer for a single validated Core checkout; never accepts a project path over HTTP. */
export async function startFeatureInstaller(directory: string): Promise<FeatureInstaller> {
  coreVersion(directory);
  const root = realpathSync(directory);
  checkFeatures(root, false);
  const token = randomBytes(32).toString('base64url');
  let origin = '';
  let host = '';
  let busy = false;
  let closing = false;
  let pending: { id: string; pack: FeatureArchive; update: boolean; state: State } | undefined;
  const tasks = new Set<Promise<void>>();
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let acquired = false;
    try {
      const requestOrigin = request.headers.origin;
      if (
        request.headers.host !== host ||
        (requestOrigin !== undefined && requestOrigin !== origin) ||
        request.headers['sec-fetch-site'] === 'cross-site'
      )
        throw new RequestError(403, 'Only this local installer session may access this endpoint.');
      if (closing) throw new RequestError(503, 'The installer is closing.');
      const route = request.url;
      if (request.method === 'GET') {
        if (route === '/') send(response, 200, HTML, 'text/html');
        else if (route === '/app.js') send(response, 200, SCRIPT, 'text/javascript');
        else if (route === '/styles.css') send(response, 200, CSS, 'text/css');
        else send(response, 404, { error: 'Not found.' });
        return;
      }
      if (
        request.method !== 'POST' ||
        requestOrigin !== origin ||
        !authenticated(request.headers.authorization, token)
      )
        throw new RequestError(403, 'Open the complete installer URL printed in your terminal.');
      if (route !== '/api/preview' && route !== '/api/install')
        throw new RequestError(404, 'Not found.');
      const expectedType = route === '/api/preview' ? 'application/gzip' : 'application/json';
      if (
        request.headers['content-type'] !== expectedType ||
        (request.headers['content-encoding'] !== undefined &&
          request.headers['content-encoding'] !== 'identity')
      )
        throw new RequestError(415, `Expected ${expectedType} without content encoding.`);
      if (busy) throw new RequestError(409, 'Another installer operation is in progress.');
      busy = true;
      acquired = true;
      if (route === '/api/preview') {
        pending = undefined;
        const bytes = await readBody(request, MAX_UPLOAD);
        const pack = await readArchiveBytes(bytes);
        const state = listFeatures(root);
        const previous = state.features.find((feature) => feature.id === pack.manifest.id);
        const update = previous !== undefined;
        await applyFeature(root, pack, { update, dryRun: true, expectedState: state });
        if (closing) throw new RequestError(503, 'The installer is closing.');
        const id = randomBytes(24).toString('base64url');
        pending = { id, pack, update, state };
        send(response, 200, {
          previewId: id,
          name: pack.manifest.name,
          version: pack.manifest.version,
          coreVersion: pack.manifest.coreVersion,
          action: update ? 'Update' : 'Install',
          previousVersion: previous?.version,
          removedFiles: Object.keys(previous?.files ?? {})
            .filter((file) => !pack.files.has(file))
            .map((file) => destination(pack.manifest.id, file)),
          files: [...pack.files.keys()].map((file) => destination(pack.manifest.id, file)),
          sha256: pack.digest,
          ...routes(pack),
        });
      } else {
        const id = installationId(await readBody(request, 1024));
        const selected = pending;
        if (!selected || selected.id !== id)
          throw new RequestError(409, 'This preview has expired. Choose the archive again.');
        pending = undefined;
        if (closing) throw new RequestError(503, 'The installer is closing.');
        await applyFeature(root, selected.pack, {
          update: selected.update,
          expectedState: selected.state,
        });
        send(response, 200, { installed: true, ...routes(selected.pack) });
      }
    } catch (error) {
      if (!response.destroyed && !response.headersSent)
        send(response, error instanceof RequestError ? error.status : 422, {
          error:
            error instanceof Error ? error.message.slice(0, 600) : 'Unable to process this module.',
        });
    } finally {
      if (acquired) busy = false;
    }
  }
  const server = createServer({ maxHeaderSize: 16 * 1024 }, (request, response) => {
    const task = handle(request, response);
    tasks.add(task);
    void task.finally(() => tasks.delete(task));
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 1000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Unable to start the local installer.');
  host = `127.0.0.1:${address.port}`;
  origin = `http://${host}`;
  let stopped: Promise<void> | undefined;
  return {
    origin,
    url: `${origin}/#${token}`,
    close() {
      stopped ??= (async () => {
        closing = true;
        pending = undefined;
        const closed = new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        server.closeAllConnections();
        await closed;
        await Promise.allSettled([...tasks]);
      })();
      return stopped;
    },
  };
}
function openBrowser(url: string): void {
  const command =
    process.platform === 'win32'
      ? 'rundll32.exe'
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, {
    stdio: 'ignore',
    detached: true,
    shell: false,
  });
  child.once('error', () => {
    console.log('Open the installer URL above in your browser.');
  });
  child.unref();
}
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(
      'Run pnpm features:ui from your BSLT Core project. Add --no-open to print the URL without opening a browser. Press Ctrl+C to close.',
    );
    return;
  }
  if (args.some((argument) => argument !== '--no-open'))
    throw new Error('Usage: pnpm features:ui [--no-open]');
  const installer = await startFeatureInstaller(process.cwd());
  console.log(
    `BSLT module installer\n${installer.url}\nKeep this terminal open. Press Ctrl+C to close.`,
  );
  const shutdown = (): void => {
    void installer.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  if (!args.includes('--no-open')) openBrowser(installer.url);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
