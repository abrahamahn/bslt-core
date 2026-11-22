# Testing

## Overview

- **Runner:** Vitest v4 with turbo orchestration
- **Browser env:** jsdom (for React component tests)
- **React testing:** `@testing-library/react` + `@testing-library/user-event`
- **Assertions:** `@testing-library/jest-dom/vitest` matchers

## Test File Placement

| Test type         | Location               | Example                          |
| ----------------- | ---------------------- | -------------------------------- |
| Unit tests        | Colocated with source  | `service.ts` + `service.test.ts` |
| Handler tests     | Colocated with handler | `login.ts` + `login.test.ts`     |
| Integration tests | Package-owned suite    | `tests/integration/api/`         |
| E2E tests         | Package-owned suite    | `tests/e2e/specs/`               |

## Server integration tests: `@bslt/testing`

Server integration suites do not build a server. They get one from the testing kit
(`main/testing`, `main/testing/README.md`):

- **With a database:** `describeRealDb` (from `@bslt/testing/real-db`) gives the suite an isolated
  database built by the real migration runner, on the production role split, and `buildTestApp`
  boots the production `buildApp()` on it with fakes for the external ports (email, SMS, storage,
  push). Files are named `*.real-db.test.ts` and run with `pnpm test:real-db`.
- **Without a database:** `buildTestServer` is the production `createServer()` over the suite's
  mocks; route maps are registered with `registerTestRouteMap`.

A suite never registers plugins, hooks, a guard or an error handler itself:
`tests/integration/api/real-db-suites.test.ts` fails a real-DB suite that does. The reason is in the
record: suites on a hand-built server passed for months against middleware production did not run
in that order, or at all.

## Running Tests

```bash
pnpm test                          # All tests (turbo cached, errors-only)
pnpm test:verbose                  # All tests with full output
pnpm test -- --run path/to/file    # Single test file
pnpm test:integration              # Package-owned integration suite (@bslt/tests)
pnpm test:real-db                  # The describeRealDb suites (needs a reachable Postgres)
pnpm test:e2e                      # Package-owned Playwright suite (@bslt/tests)

# Package-scoped
pnpm --filter @bslt/web test
pnpm --filter @bslt/server test
pnpm --filter @bslt/tests test:integration
pnpm --filter @bslt/ui test
```

### What the e2e suite needs

`pnpm test:e2e` starts the API (`pnpm --filter @bslt/server dev`) and the web dev server itself, so
it needs what they need:

- **An env file with the API's secrets.** The API refuses to start without `JWT_SECRET` and the
  rest. On a fresh checkout this writes `config/env/.env.development`, and CI's `e2e` job runs the
  same command:

  ```bash
  pnpm bootstrap --preset docker --yes --skip-db --skip-docker --skip-install
  ```

- **A migrated database.** `pnpm db:migrate` against the database the env names. Values in the
  process environment win over env files, so `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`,
  `POSTGRES_USER` and `POSTGRES_PASSWORD` can point one run at a throwaway database.
- **The starter auth default, `AUTH_STRATEGIES=local`.** The specs sign in with a password. With
  `magic` enabled the sign-in dialog opens on the email-code form and those specs time out, so a
  personal `.env.local` that enables it gives false failures: run the suite from a clean worktree.
- **Free ports**, or `E2E_API_PORT` and `E2E_WEB_PORT` (defaults 8080 and 5173).

The script runs Playwright with the `source` condition (`NODE_OPTIONS=--conditions=source`), as
Vitest and the API's `dev` script do: specs import workspace packages whose exports name only their
source.

### Optional surfaces (runtime flags)

A default run leaves the optional surfaces off and skips their specs. Three toggles turn one on, each
with `1`, `true`, `yes` or `on`, set in the shell or an env file:

| Toggle                      | Runtime flag           | Specs it un-skips                                                                |
| --------------------------- | ---------------------- | -------------------------------------------------------------------------------- |
| `E2E_ENABLE_ADVANCED_ADMIN` | `flags.advanced_admin` | `admin/audit.e2e.ts`; four tests of `admin/admin-jobs.e2e.ts`                    |
| `E2E_ENABLE_BILLING`        | `flags.billing`        | `billing/billing.e2e.ts`; the `/billing/*` login redirects in `auth/auth.e2e.ts` |
| `E2E_ENABLE_ACTIVITY_FEED`  | `flags.activity_feed`  | the `/activities` login redirect in `auth/auth.e2e.ts`                           |

A toggle does both halves: the specs read it to un-skip (`tests/e2e/fixtures/capabilities.ts`), and
globalSetup turns its runtime flag on (`syncE2eRuntimeFlags`). `system/runtime-flags.e2e.ts` checks
that `/api/platform/context` then serves every `flags.*` flag as the toggles set it, in one test
signed out and one signed in.

**globalSetup owns the `flags.*` rows of the run's database.** At the start of every run it deletes
every `flags.*` row, and with it that flag's org overrides, then inserts the toggled flags enabled
for everyone (no allow-list, no rollout, no override). A run's flags therefore depend only on its
toggles, whatever an earlier run, a killed run or a hand edit left; nothing is restored at teardown.
So a run resets the `flags.*` flags you set by hand in that database, including the `app_dev`
database `pnpm dev` uses: point the run at a throwaway database (`POSTGRES_DB` or `DATABASE_URL`) to
keep them. Other flag keys are not touched. The server reads the flags on every request, so a reused
server (`E2E_REUSE_SERVER=1`) needs no restart.

**Two configurations are two runs.** One API server and one database serve both Playwright projects,
so the starter configuration and the optional surfaces cannot run side by side. Run them one after
the other; `AUTH_STRATEGIES=local` in the shell wins over a personal `.env.local`:

```bash
AUTH_STRATEGIES=local pnpm test:e2e
AUTH_STRATEGIES=local E2E_ENABLE_ADVANCED_ADMIN=1 E2E_ENABLE_BILLING=1 E2E_ENABLE_ACTIVITY_FEED=1 \
  pnpm test:e2e billing/ admin/ auth/auth.e2e.ts system/runtime-flags.e2e.ts
```

The second run turns the three flags on; the next default run turns them off again. Only a toggled
run, or a database with leftover `flags.*` rows, exercises `syncE2eRuntimeFlags`: on a fresh
database a default run has nothing to delete or insert, so `runtime-flags.e2e.ts` passes there even
if globalSetup never reconciled. After changing the reconcile, run the second command.

## Configuration

### Base Config

Every package's `vitest.config.ts` extends `defineVitestConfig` from `@bslt/build-config/vitest`
(main/build-config/src/vitest.ts). It adds the `source` resolve condition, so workspace packages
load from source with no aliases and no prior build, and the shared test settings:

```typescript
export const baseVitestConfig = mergeConfig(vitestSourceResolveConfig, {
  test: {
    globals: true,
    exclude: ['**/node_modules/**', '**/dist/**', '**/backup/**', '**/*.spec.ts'],
    testTimeout: 10000,
    clearMocks: true,
    restoreMocks: true,
  },
});
```

### Web App Config

`main/apps/web/vitest.config.ts` extends the base with:

- `environment: 'jsdom'` for browser API simulation
- `setupFiles: ['./src/__tests__/setup.ts']` for global mocks
- `pool: 'threads'` with `maxConcurrency: 4` for memory management
- Custom `resolveWorkspaceToSource` plugin to resolve `@bslt/*` to source files

## Test Setup (Golden Standard)

The reference setup file is `main/apps/web/src/__tests__/setup.ts`. Every web test file inherits this setup.

### Required Browser API Mocks

```typescript
// matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }),
});

// ResizeObserver, IntersectionObserver
vi.stubGlobal('ResizeObserver', MockResizeObserver);
vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

// scrollTo, window.scroll
vi.stubGlobal('scrollTo', vi.fn());
Object.defineProperty(window, 'scroll', { writable: true, value: vi.fn() });
```

### Fetch Mock

The setup provides a default fetch mock that rejects with a helpful error. Individual tests override it:

```typescript
vi.stubGlobal(
  'fetch',
  vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data: 'test' }),
  }),
);
```

### Lifecycle Hooks

```typescript
afterEach(() => {
  cleanup(); // RTL DOM cleanup
  vi.clearAllMocks(); // Prevent mock state leakage
  vi.useRealTimers(); // Reset fake timers
});
```

## Common Pitfalls

### Fake Timers + waitFor

`waitFor` polls via `setTimeout`. If `vi.useFakeTimers()` is active, the timeout never fires and the test hangs indefinitely.

**Fix:** Use synchronous timer advancement:

```typescript
// WRONG - hangs forever
vi.useFakeTimers();
await waitFor(() => expect(element).toBeVisible());

// CORRECT - advance timers synchronously
vi.useFakeTimers();
act(() => vi.advanceTimersByTime(1000));
expect(element).toBeVisible();
```

### MemoryRouter initialEntries

`MemoryRouter` captures `initialEntries` on mount via a ref. Passing a new array reference on re-render causes infinite loops because `useMemo` recomputes, triggers `useEffect`, which calls `setState`.

**Fix:** Use a stable reference or add a `key` prop to force remount:

```typescript
// WRONG - new array each render
<MemoryRouter initialEntries={['/dashboard']}>

// CORRECT - stable reference with key for different routes
<MemoryRouter key="/dashboard" initialEntries={['/dashboard']}>
```

### Running Tests from Package Directory

Tests must be run from the package directory (not root) for jsdom environment to load correctly:

```bash
# CORRECT
pnpm --filter @bslt/web test

# ALSO CORRECT
cd main/apps/web && pnpm test
```

## Writing Tests

### Component Test Pattern

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

describe('MyComponent', () => {
  it('handles click', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<MyComponent onClick={onClick} />);

    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
```

### Service/Handler Test Pattern

```typescript
import { describe, expect, it, vi } from 'vitest';

describe('myService', () => {
  it('returns data for valid input', async () => {
    const mockRepo = { findById: vi.fn().mockResolvedValue({ id: '1', name: 'Test' }) };
    const result = await myService({ repos: mockRepo });
    expect(result).toEqual({ id: '1', name: 'Test' });
  });
});
```

### vi.spyOn Exception

Namespace imports (`import * as module`) are allowed in test files where `vi.spyOn` requires them:

```typescript
import * as authService from '../service';
vi.spyOn(authService, 'authenticateUser').mockResolvedValue(mockResult);
```

This is the only exception to the "no namespace imports" rule.
