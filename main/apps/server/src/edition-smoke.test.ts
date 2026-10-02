// Distribution tests run against this edition's real source and installed dependencies.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import Fastify from 'fastify';
import {
  createAccessToken,
  createAuthGuard,
  hashPassword,
  verifyPassword,
  verifyToken,
} from '@bslt/core/auth';
import { createAppRouteModuleRegistrations } from './http/route-modules';
import type { HttpReply, HttpRequest } from '@bslt/server-system/http';

const secret = 'edition-test-secret-with-at-least-32-characters';
const { edition } = JSON.parse(
  readFileSync(new URL('../../../../edition.json', import.meta.url), 'utf8'),
) as { edition: string };

test('auth/account routes survive edition composition and paid routes match the edition', async () => {
  const registrations = await createAppRouteModuleRegistrations(['local']);
  const modules = registrations.map((entry) => entry.module);
  for (const module of ['auth', 'users', 'api-keys', 'legal', 'consent', 'data-export', 'system'])
    assert.ok(modules.includes(module), module);
  for (const module of ['admin', 'tasks', 'files', 'analytics', 'tenants'])
    assert.equal(modules.includes(module), edition === 'pro', module);
  const auth = registrations.find((entry) => entry.module === 'auth');
  assert.ok(auth?.routes.has('auth/login'));
  assert.ok(auth?.routes.has('auth/register'));
  assert.ok(auth?.routes.has('auth/refresh'));
});

test('real HTTP guard rejects anonymous and tampered tokens and accepts a valid token', async () => {
  const app = Fastify();
  const guard = createAuthGuard(secret);
  app.get(
    '/protected',
    {
      preHandler: async (request, reply) => {
        await guard(request as unknown as HttpRequest, reply as unknown as HttpReply);
      },
    },
    () => ({ ok: true }),
  );
  try {
    const token = createAccessToken('edition-user', 'edition@example.test', 'user', secret);
    assert.equal((await app.inject('/protected')).statusCode, 401);
    assert.equal(
      (
        await app.inject({
          url: '/protected',
          headers: { authorization: `Bearer ${token}broken` },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          url: '/protected',
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
      200,
    );
    assert.equal(verifyToken(token, secret).userId, 'edition-user');
  } finally {
    await app.close();
  }
});

test('native password hashing works in a clean installation', async () => {
  const hash = await hashPassword('edition-test-password');
  assert.equal(await verifyPassword('edition-test-password', hash), true);
  assert.equal(await verifyPassword('incorrect', hash), false);
});

const databaseUrl = process.env['EDITION_TEST_DATABASE_URL'];
test(
  'migrations and register → verify email → login → protected account work on PostgreSQL',
  {
    skip: databaseUrl === undefined,
    timeout: 60_000,
  },
  async () => {
    assert.ok(databaseUrl);
    const { fileURLToPath } = await import('node:url');
    const { randomUUID } = await import('node:crypto');
    const { runSqlMigrations } = await import('@bslt/db');
    const { load } = await import('@bslt/server-system/config');
    const { bootstrapInfraPhase, stopInfraPhase } = await import('./bootstrap/phases/infra');
    const { bootstrapDataPhase, stopDataPhase } = await import('./bootstrap/phases/data');
    const { bootstrapCommsPhase } = await import('./bootstrap/phases/comms');
    const { App } = await import('./bootstrap/app');
    await runSqlMigrations({
      connectionString: databaseUrl,
      migrationsDir: fileURLToPath(new URL('../../../server/db/migrations', import.meta.url)),
      logger: { log() {} },
    });
    const config = load({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      JWT_SECRET: secret,
      API_HOST: '127.0.0.1',
      LOG_LEVEL: 'error',
      EMAIL_PROVIDER: 'console',
      DB_SSL: 'false',
    });
    const infra = await bootstrapInfraPhase(config);
    const data = await bootstrapDataPhase(config, infra.platform);
    let app: InstanceType<typeof App> | undefined;
    try {
      const comms = await bootstrapCommsPhase(config, data.context);
      const messages: string[] = [];
      const context = {
        ...comms.context,
        email: {
          async healthCheck() {
            return true;
          },
          async send(options: import('@bslt/shared/contracts').EmailOptions) {
            messages.push(options.text ?? options.html ?? '');
            return { success: true, messageId: 'edition-test' };
          },
        },
      };
      app = new App(config, context);
      await app.init();
      const username = `edition_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
      const email = `${username}@example.test`;
      const password = 'EditionTest#LongPass9!';
      const registration = await app.server.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email,
          username,
          firstName: 'Edition',
          lastName: 'Test',
          password,
          tosAccepted: true,
          eligibilityAttested: true,
        },
      });
      assert.equal(registration.statusCode, 200, registration.body);
      const token = messages.join('\n').match(/[?&]token=([^\s"<]+)/)?.[1];
      assert.ok(token, 'registration must send a verification token');
      const verification = await app.server.inject({
        method: 'POST',
        url: '/api/auth/verify-email',
        payload: { token },
      });
      assert.equal(verification.statusCode, 200, verification.body);
      const login = await app.server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: email, password },
      });
      assert.equal(login.statusCode, 200, login.body);
      const refreshCookie = login.cookies.find((cookie) => cookie.name === 'refreshToken');
      assert.ok(refreshCookie?.httpOnly, 'login must set an HTTP-only refresh cookie');
      const csrf = await app.server.inject('/api/csrf-token');
      const csrfToken = csrf.json<{ token: string }>().token;
      const refresh = await app.server.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        payload: {},
        headers: { 'x-csrf-token': csrfToken },
        cookies: Object.fromEntries(
          [...login.cookies, ...csrf.cookies].map((cookie) => [cookie.name, cookie.value]),
        ),
      });
      assert.equal(refresh.statusCode, 200, refresh.body);
      const response = refresh.json<{ data?: { token?: string }; token?: string }>();
      const accessToken = response.data?.token ?? response.token;
      assert.ok(accessToken, 'the refresh exchange must issue an access token');
      assert.equal((await app.server.inject('/api/users/me')).statusCode, 401);
      const account = await app.server.inject({
        url: '/api/users/me',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      assert.equal(account.statusCode, 200, account.body);
      const featureEndpoint = process.env['EDITION_TEST_FEATURE_ENDPOINT'];
      if (featureEndpoint !== undefined) {
        assert.ok(featureEndpoint.startsWith('/api/extensions/'));
        assert.equal((await app.server.inject(featureEndpoint)).statusCode, 401);
        const feature = await app.server.inject({
          url: featureEndpoint,
          headers: { authorization: `Bearer ${accessToken}` },
        });
        assert.equal(feature.statusCode, 200, feature.body);
      }
      if (edition === 'core')
        assert.equal((await app.server.inject('/api/admin/health')).statusCode, 404);
    } finally {
      await app?.stop();
      await stopDataPhase(data);
      await stopInfraPhase(infra);
    }
  },
);
