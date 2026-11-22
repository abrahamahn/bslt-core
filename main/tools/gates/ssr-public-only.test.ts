// main/tools/gates/ssr-public-only.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { auditSsrPublicOnly } from './ssr-public-only';

const tempDirs: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bslt-ssr-public-only-'));
  tempDirs.push(dir);
  return dir;
}

function writeFixtureFile(root: string, relPath: string, content: string): void {
  const fullPath = path.join(root, relPath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
}

function seedValidSsrWorkspace(root: string): void {
  writeFixtureFile(
    root,
    'main/modules/status/contract/endpoints.ts',
    `import { endpoint } from '@bslt/contract';
export const statusEndpoints = {
  getSummary: endpoint({
    method: 'GET',
    path: '/api/status',
    auth: 'public',
    cache: { public: 30 },
    response: {} as never,
    summary: 'Public cached status',
  }),
  pingUncached: endpoint({
    method: 'GET',
    path: '/api/status/ping',
    auth: 'public',
    response: {} as never,
    summary: 'Uncached public ping',
  }),
  secretAdmin: endpoint({
    method: 'GET',
    path: '/api/status/secret',
    auth: 'admin',
    response: {} as never,
    summary: 'Admin endpoint',
  }),
};
`,
  );

  writeFixtureFile(
    root,
    'main/modules/status/web/index.ts',
    `export const statusWeb = {
  routes: [
    { path: '/status', shell: 'public', auth: 'public' },
    { path: '/admin/status', shell: 'console', auth: 'admin' },
  ],
};
`,
  );

  writeFixtureFile(
    root,
    'main/apps/web/src/app/routes.tsx',
    `export const appFrameRoutes = [
  { slot: 'before-modules', shell: 'public', index: true },
  { slot: 'after-modules', shell: 'app', path: 'dashboard', protected: true },
];
`,
  );

  writeFixtureFile(
    root,
    'main/modules/status/web/public-routes.tsx',
    `import { definePublicRoute } from '@bslt/web-platform';
export const statusPublicRoutes = [
  definePublicRoute({
    path: '/status',
    cacheSeconds: 30,
    load: async ({ sdk }) => sdk.status.getSummary(),
    head: () => ({ title: 'Status' }),
    Component: () => null,
  }),
];
`,
  );

  writeFixtureFile(
    root,
    'main/apps/web/src/ssr/public-routes.tsx',
    `import { statusPublicRoutes } from '@bslt/status/web';
export const publicRoutes = [...statusPublicRoutes];
`,
  );

  writeFixtureFile(
    root,
    'main/apps/web/src/entry-public.tsx',
    `import { hydratePublic } from '@bslt/web-platform';
import { publicRoutes } from './ssr/public-routes';
const root = document.getElementById('root');
if (root !== null) hydratePublic(root, publicRoutes);
`,
  );

  writeFixtureFile(
    root,
    'main/apps/web/src/server/serve.ts',
    `import http from 'node:http';
import { renderPublic } from '@bslt/web-platform';
export const server = http.createServer();
void renderPublic;
`,
  );
}

describe('ssr-public-only gate', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes on a clean public-only SSR workspace', () => {
    const root = makeTempRoot();
    seedValidSsrWorkspace(root);
    expect(auditSsrPublicOnly(root)).toEqual([]);
  });

  it('fails when a PublicRoute calls an endpoint with auth !== "public"', () => {
    const root = makeTempRoot();
    seedValidSsrWorkspace(root);
    writeFixtureFile(
      root,
      'main/modules/status/web/public-routes.tsx',
      `import { definePublicRoute } from '@bslt/web-platform';
export const statusPublicRoutes = [
  definePublicRoute({
    path: '/status',
    cacheSeconds: 30,
    load: async ({ sdk }) => sdk.status.secretAdmin(),
    head: () => ({ title: 'Status' }),
    Component: () => null,
  }),
];
`,
    );

    const problems = auditSsrPublicOnly(root);
    expect(problems.some((p) => p.includes('status.secretAdmin') && p.includes('auth'))).toBe(true);
  });

  it('fails when a PublicRoute calls a public endpoint that lacks cache.public', () => {
    const root = makeTempRoot();
    seedValidSsrWorkspace(root);
    writeFixtureFile(
      root,
      'main/modules/status/web/public-routes.tsx',
      `import { definePublicRoute } from '@bslt/web-platform';
export const statusPublicRoutes = [
  definePublicRoute({
    path: '/status',
    cacheSeconds: 30,
    load: async ({ sdk }) => sdk.status.pingUncached(),
    head: () => ({ title: 'Status' }),
    Component: () => null,
  }),
];
`,
    );

    const problems = auditSsrPublicOnly(root);
    expect(
      problems.some((p) => p.includes('status.pingUncached') && p.includes('cache.public')),
    ).toBe(true);
  });

  it('fails when a PublicRoute path matches a logged-in or console WebRoute', () => {
    const root = makeTempRoot();
    seedValidSsrWorkspace(root);
    writeFixtureFile(
      root,
      'main/apps/web/src/ssr/public-routes.tsx',
      `import { definePublicRoute } from '@bslt/web-platform';
export const publicRoutes = [
  definePublicRoute({
    path: '/dashboard',
    cacheSeconds: 60,
    load: async () => ({}),
    head: () => ({ title: 'Dashboard' }),
    Component: () => null,
  }),
  definePublicRoute({
    path: '/admin/status',
    cacheSeconds: 60,
    load: async () => ({}),
    head: () => ({ title: 'Admin Status' }),
    Component: () => null,
  }),
];
`,
    );

    const problems = auditSsrPublicOnly(root);
    expect(problems.some((p) => p.includes('/dashboard'))).toBe(true);
    expect(problems.some((p) => p.includes('/admin/status'))).toBe(true);
  });

  it('fails when serve.ts or a PublicRoute reads cookies/authorization or uses credentials: "include"', () => {
    const root = makeTempRoot();
    seedValidSsrWorkspace(root);
    writeFixtureFile(
      root,
      'main/apps/web/src/server/serve.ts',
      `import http from 'node:http';
export const server = http.createServer((req) => {
  const sessionCookie = req.headers.cookie;
  void fetch('http://api:8080/api/status', { credentials: 'include', headers: { cookie: sessionCookie ?? '' } });
});
`,
    );

    const problems = auditSsrPublicOnly(root);
    expect(problems.some((p) => p.includes('cookie'))).toBe(true);
    expect(problems.some((p) => p.includes('credentials'))).toBe(true);
  });

  it('fails when entry-public.tsx imports AuthService, AppShell, or ConsoleShell', () => {
    const root = makeTempRoot();
    seedValidSsrWorkspace(root);
    writeFixtureFile(
      root,
      'main/apps/web/src/entry-public.tsx',
      `import { createAuthService } from '@bslt/identity/web';
import { AppShell, ConsoleShell } from './app/shells';
void createAuthService;
void AppShell;
void ConsoleShell;
`,
    );

    const problems = auditSsrPublicOnly(root);
    expect(problems.some((p) => p.includes('createAuthService'))).toBe(true);
    expect(problems.some((p) => p.includes('AppShell'))).toBe(true);
    expect(problems.some((p) => p.includes('ConsoleShell'))).toBe(true);
  });
});
