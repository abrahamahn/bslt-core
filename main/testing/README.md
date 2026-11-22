# @bslt/testing

The testing kit. Dev tooling only: it runs from source under Vitest and is never built.

| Export                                | From                     | What it is                                                                                                                                                                                      |
| ------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildTestApp`                        | `@bslt/testing`          | The production `buildApp()` on a test database: same phases, pools (`bslt_app` for user sessions, `bslt_worker` for system work), routes, guard chain and middleware. External ports are fakes. |
| `buildTestServer`                     | `@bslt/testing`          | The production `createServer()` over mock services, for suites that drive one route map without a database. Register route maps with `registerTestRouteMap`.                                    |
| `describeRealDb`                      | `@bslt/testing/real-db`  | A suite on its own database, built by the real migration runner, with the production role split. Required in CI and under `REQUIRE_REAL_DB=1`; skipped only when no Postgres is reachable.      |
| `describeOwnerIsolation`              | `@bslt/testing/real-db`  | The cross-owner denial tests of a user-owned table, generated per table.                                                                                                                        |
| `createTestDatabase`                  | `@bslt/testing/database` | The database lifecycle `describeRealDb` uses, without Vitest: create, migrate as `bslt_owner`, drop. For tooling (`pnpm bslt db catalog` ); a suite uses `describeRealDb`.                      |
| `createTestConfig`                    | `@bslt/testing`          | The loader's config for a fixed test environment, with the values tests rely on pinned and a suite's overrides merged in.                                                                       |
| `createMockLogger`                    | `@bslt/testing`          | The one mock logger.                                                                                                                                                                            |
| `createFake*`                         | `@bslt/testing`          | Fakes for the external ports: email, SMS, storage (in memory), push, error tracker, cache stats.                                                                                                |
| `createMockDb`, `createMock*`         | `@bslt/testing`          | Mock doubles for the suites without a database.                                                                                                                                                 |
| `seedTestUser`, `createTestJwt`, HTTP | `@bslt/testing`          | A seeded, verified user; tokens signed with the test secret; `parseJsonResponse`, cookies, `buildAuthenticatedRequest`.                                                                         |

`@bslt/testing/real-db` resolves the database connection when it is first imported (before the test
setup files put their fake defaults over the environment) and probes it. The package root does not
load it, so a suite without a database never touches one.

## A real-DB suite

```ts
import { buildTestApp, seedTestUser, type TestApp } from '@bslt/testing';
import { describeRealDb } from '@bslt/testing/real-db';
import { afterAll, beforeAll, expect, it } from 'vitest';

describeRealDb('Sessions (Real DB)', (realDb) => {
  let app: TestApp;

  beforeAll(async () => {
    app = await buildTestApp({ database: realDb.database });
  });

  afterAll(async () => {
    await app.close();
  });

  it('logs in', async () => {
    await seedTestUser(realDb.database.connectionString, { email: 'a@example.com' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: 'a@example.com', password: 'TestPassword123!' },
    });
    expect(response.statusCode).toBe(200);
    expect(app.email.send).not.toHaveBeenCalled();
  });
});
```

- `realDb.database` is created in a `beforeAll` hook that runs before the suite's own. Read it in a
  hook or a test, not in the suite body. It is dropped after the suite's `afterAll` hooks.
- `buildTestApp({ database, config, ports, extraRoutes, csrf })`. `config` is merged into the test
  config (`{ auth: { strategies: ['local', 'magic'] } }`). `ports` replaces a fake with the suite's
  double; a key set to `undefined` runs the app without that port. `extraRoutes` adds route maps
  (probes) with the production guard.
- `inject` sends a state-changing request with the CSRF token and cookie a browser would send
  (`csrf: 'auto'`, the default). A suite that tests CSRF passes `csrf: 'manual'`.
- The app's fakes are on the result: `app.email`, `app.sms`, `app.storage`, `app.log`,
  `app.notifications`, `app.errorTracker`. `app.ctx` is the boot context (system pool).
- `TEST_LOG=1` writes what the server logs at warn and above to stderr: a 500 is then visible without
  editing the suite.

## The routes of the composed app

`buildTestApp(...)` returns `routes()`, the list `buildApp()` recorded: every route Fastify
registered, plugin routes included, as `{ method, url }` in registration order.

## Running

```bash
pnpm --filter @bslt/testing test        # the kit's own unit tests, no database
POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5433 POSTGRES_USER=postgres POSTGRES_PASSWORD=postgres \
  POSTGRES_DB=postgres pnpm test:real-db # every describeRealDb suite
```
