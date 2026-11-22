// main/apps/server/src/http/route-modules.test.ts
import { describe, expect, it } from 'vitest';

import { createAppRouteModuleRegistrations } from './route-modules';

describe('app route module registrations', () => {
  it('registers system probes by default and includes realtime routes only when requested', async () => {
    const registrations = await createAppRouteModuleRegistrations(['local']);
    const modules = registrations.map((registration) => registration.module);

    expect(modules).toEqual(['system']);

    const withRealtime = await createAppRouteModuleRegistrations(['local'], {
      includeRealtimeRoutes: true,
    });
    expect(withRealtime.map((registration) => registration.module)).toEqual(['realtime', 'system']);
  });

  it('excludes domain module routes now that vertical modules register via @bslt/server-system/module', async () => {
    const registrations = await createAppRouteModuleRegistrations(['local']);
    const authRegistration = registrations.find((registration) => registration.module === 'auth');

    expect(authRegistration).toBeUndefined();
  });
});
