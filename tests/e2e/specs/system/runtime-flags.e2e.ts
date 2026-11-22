// tests/e2e/specs/system/runtime-flags.e2e.ts
/**
 * Runtime flags E2E
 *
 * globalSetup writes the `flags.*` rows of the run's database from this run's
 * E2E_ENABLE_* toggles. This pins that the server then serves exactly those
 * flags on `/api/platform/context`, to a signed-out visitor and to a signed-in
 * user, so a toggle can never un-skip a spec while its surface stays off.
 */

import { deserializeCapabilityContext, type CapabilityContext } from '@bslt/contract';
import { refreshResponseSchema } from '@bslt/identity/contract';
import { expect, test, type APIResponse } from '@playwright/test';

import { createE2eUser, ensureVerifiedE2eUser } from '#tests/e2e/fixtures/auth';
import { e2eRuntimeFlags } from '#tests/e2e/fixtures/capabilities';

const CONTEXT_PATH = '/api/platform/context';

async function readContext(response: APIResponse): Promise<CapabilityContext> {
  expect(response.status(), await response.text()).toBe(200);
  return deserializeCapabilityContext(await response.json());
}

/** Every served `flags.*` flag is off, except the toggled ones, which equal their toggle. */
function expectRuntimeFlags(flags: CapabilityContext['flags']): void {
  const served = Object.entries(flags).filter(([key]) => key.startsWith('flags.'));
  expect(Object.fromEntries(served)).toEqual({
    ...Object.fromEntries(served.map(([key]) => [key, false])),
    ...e2eRuntimeFlags,
  });
}

// One test per viewer, so each reports on its own: the signed-out flags come from a different
// server path (anonymous evaluation), and a failure there must not hide the signed-in result.
test.describe("the server serves every flags.* flag as this run's E2E_ENABLE_* toggles set it", () => {
  test('to a signed-out visitor', async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'The context is browser-independent.');

    const anonymous = await readContext(await request.get(CONTEXT_PATH));
    expect(anonymous.viewer).toBeNull();
    expectRuntimeFlags(anonymous.flags);
  });

  test('to a signed-in user', async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'The context is browser-independent.');

    // A user of its own, so the per-user session cap cannot evict it between login and refresh.
    const user = createE2eUser('runtime-flags');
    const userId = await ensureVerifiedE2eUser(user);
    const login = await request.post('/api/auth/login', {
      data: { identifier: user.email, password: user.password },
    });
    expect(login.status(), await login.text()).toBe(200);
    const refresh = await request.post('/api/auth/refresh', { data: {} });
    expect(refresh.status(), await refresh.text()).toBe(200);
    const { token } = refreshResponseSchema.parse(await refresh.json());

    const signedIn = await readContext(
      await request.get(CONTEXT_PATH, { headers: { Authorization: `Bearer ${token}` } }),
    );
    expect(signedIn.viewer?.userId).toBe(userId);
    expectRuntimeFlags(signedIn.flags);
  });
});
