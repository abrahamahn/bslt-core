// main/tools/gates/events.test.ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { syncModules } from '../sync/modules';

import { run } from './events';

const tempDirs: string[] = [];

function createEventsWorkspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'bslt-events-gate-'));
  tempDirs.push(root);

  mkdirSync(path.join(root, 'config'), { recursive: true });
  writeFileSync(
    path.join(root, 'config/.prettierrc'),
    JSON.stringify({ singleQuote: true, trailingComma: 'all', printWidth: 100 }, null, 2),
  );
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: '@bslt/root', private: true, devDependencies: {} }, null, 2),
  );
  mkdirSync(path.join(root, 'main/apps/server/src'), { recursive: true });
  writeFileSync(
    path.join(root, 'main/apps/server/package.json'),
    JSON.stringify({ name: '@bslt/server', dependencies: {} }, null, 2),
  );
  writeFileSync(
    path.join(root, 'main/apps/server/tsconfig.json'),
    JSON.stringify({ references: [] }, null, 2),
  );
  mkdirSync(path.join(root, 'main/apps/web/src'), { recursive: true });
  writeFileSync(
    path.join(root, 'main/apps/web/package.json'),
    JSON.stringify({ name: '@bslt/web', dependencies: {} }, null, 2),
  );
  writeFileSync(
    path.join(root, 'main/apps/web/tsconfig.json'),
    JSON.stringify({ references: [] }, null, 2),
  );

  mkdirSync(path.join(root, 'main/modules/orgs/contract'), { recursive: true });
  mkdirSync(path.join(root, 'main/modules/orgs/server'), { recursive: true });

  writeFileSync(
    path.join(root, 'main/modules/orgs/contract/events.ts'),
    `import { event } from '@bslt/contract';

export const orgsEvents = {
  memberAdded: event('orgs.member.added', memberAddedSchema, { webhook: true }),
  memberRemoved: event('orgs.member.removed', memberRemovedSchema, { webhook: true }),
};
`,
  );
  writeFileSync(
    path.join(root, 'main/modules/orgs/module.ts'),
    `import { defineModule } from '@bslt/contract';
import { orgsEvents } from './contract/events';

export const orgsModule = defineModule({
  id: 'orgs',
  summary: 'Organizations shell.',
  status: 'stable',
  dependsOn: [],
  endpoints: {},
  events: orgsEvents,
  jobs: {},
  tables: [],
  web: false,
});
`,
  );
  writeFileSync(
    path.join(root, 'main/modules/orgs/server/index.ts'),
    `import { implementServer } from '@bslt/server-system/module';
import { orgsEvents } from '../contract/events';
import { orgsModule } from '../module';

export async function publishOrgsEvents(k: { events: { publish: (...args: unknown[]) => Promise<void> } }, tx: unknown): Promise<void> {
  await k.events.publish(tx, orgsEvents.memberAdded, {});
  await k.events.publish(tx, orgsEvents.memberRemoved, {});
}

export const orgsServer = implementServer(orgsModule, {
  create: () => ({}),
  handlers: {},
});
`,
  );
  writeFileSync(
    path.join(root, 'main/modules/orgs/README.md'),
    '# Orgs\n\n<!-- bslt:generated reference -->\n<!-- /bslt:generated -->\n',
  );
  writeFileSync(
    path.join(root, 'bslt.config.ts'),
    `import { defineConfig } from '@bslt/contract';
import { orgsModule } from '@bslt/orgs/module';

export default defineConfig({
  name: 'BSLT',
  installedModules: [orgsModule] as const,
  devOnly: [],
  locales: ['en-US'],
  brand: { accent: 'oklch(0.62 0.19 264)', logo: '/brand/logo.svg' },
});
`,
  );

  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('events gate', () => {
  it('passes when every declared EventDef is published in server/ and webhook events appear in README docs', async () => {
    const root = createEventsWorkspace();
    await syncModules({ root });

    const result = run(root);
    expect(result.ok).toBe(true);
  });

  it('fails when an EventDef has no publish(<tx>, <module>Events.<key>, ...) call in server/', async () => {
    const root = createEventsWorkspace();
    await syncModules({ root });

    writeFileSync(
      path.join(root, 'main/modules/orgs/server/index.ts'),
      `import { implementServer } from '@bslt/server-system/module';
import { orgsEvents } from '../contract/events';
import { orgsModule } from '../module';

export async function publishOnlyAdded(k: { events: { publish: (...args: unknown[]) => Promise<void> } }, tx: unknown): Promise<void> {
  await k.events.publish(tx, orgsEvents.memberAdded, {});
}

export const orgsServer = implementServer(orgsModule, {
  create: () => ({}),
  handlers: {},
});
`,
    );

    const result = run(root);
    expect(result.ok).toBe(false);
    expect(result.problems?.some((p) => p.includes('memberRemoved'))).toBe(true);
  });

  it('ignores publish calls inside test files when checking production server emit sites', async () => {
    const root = createEventsWorkspace();
    await syncModules({ root });

    writeFileSync(
      path.join(root, 'main/modules/orgs/server/index.ts'),
      `import { implementServer } from '@bslt/server-system/module';
import { orgsModule } from '../module';
export const orgsServer = implementServer(orgsModule, { create: () => ({}), handlers: {} });
`,
    );
    writeFileSync(
      path.join(root, 'main/modules/orgs/server/index.test.ts'),
      `import { orgsEvents } from '../contract/events';
it('publishes in test only', async () => {
  await k.events.publish(tx, orgsEvents.memberAdded, {});
  await k.events.publish(tx, orgsEvents.memberRemoved, {});
});
`,
    );

    const result = run(root);
    expect(result.ok).toBe(false);
    expect(result.problems?.some((p) => p.includes('memberAdded'))).toBe(true);
    expect(result.problems?.some((p) => p.includes('memberRemoved'))).toBe(true);
  });

  it('rejects publish calls referencing another module events object', async () => {
    const root = createEventsWorkspace();
    await syncModules({ root });

    writeFileSync(
      path.join(root, 'main/modules/orgs/server/index.ts'),
      `import { implementServer } from '@bslt/server-system/module';
import { otherEvents } from '@bslt/other/contract';
import { orgsModule } from '../module';

export async function publishWrong(k: { events: { publish: (...args: unknown[]) => Promise<void> } }, tx: unknown): Promise<void> {
  await k.events.publish(tx, otherEvents.memberAdded, {});
  await k.events.publish(tx, otherEvents.memberRemoved, {});
}

export const orgsServer = implementServer(orgsModule, { create: () => ({}), handlers: {} });
`,
    );

    const result = run(root);
    expect(result.ok).toBe(false);
    expect(result.problems?.some((p) => p.includes('memberAdded'))).toBe(true);
  });

  it('fails when a webhook: true event is missing from the generated README block', () => {
    const root = createEventsWorkspace();
    // Deliberately skip syncModules so README block is empty

    const result = run(root);
    expect(result.ok).toBe(false);
    expect(
      result.problems?.some((p) => p.includes('orgs.member.added') && p.includes('README.md')),
    ).toBe(true);
  });
});
