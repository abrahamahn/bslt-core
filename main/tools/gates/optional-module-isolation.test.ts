// main/tools/gates/optional-module-isolation.test.ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../lib/paths';

import { findOptionalModuleViolations, run } from './optional-module-isolation';

const tempDirs: string[] = [];

function createFixtureRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'bslt-opt-isolation-'));
  tempDirs.push(root);
  mkdirSync(path.join(root, 'main/kernel/contract/src'), { recursive: true });
  mkdirSync(path.join(root, 'main/modules/identity/server'), { recursive: true });
  mkdirSync(path.join(root, 'main/modules/billing/web'), { recursive: true });
  mkdirSync(path.join(root, 'main/apps/server/src/bootstrap'), { recursive: true });
  mkdirSync(path.join(root, 'main/apps/server/src/generated'), { recursive: true });
  mkdirSync(path.join(root, 'main/apps/web/src/app'), { recursive: true });
  mkdirSync(path.join(root, 'main/apps/web/src/generated'), { recursive: true });
  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('optional-module-isolation gate', () => {
  it('fails when a kernel package imports an optional module', () => {
    const root = createFixtureRoot();
    writeFileSync(
      path.join(root, 'main/kernel/contract/src/leak.ts'),
      `import type { Plan } from '@bslt/billing/contract';\nexport type Leaked = Plan;\n`,
    );

    const res = run(root);
    expect(res.ok).toBe(false);
    expect(res.problems?.[0]).toContain('main/kernel/contract/src/leak.ts:1');
    expect(res.problems?.[0]).toContain('@bslt/billing/contract');
  });

  it('fails when a Minimal Core module imports an optional module', () => {
    const root = createFixtureRoot();
    writeFileSync(
      path.join(root, 'main/modules/identity/server/leak.ts'),
      `export { resolveActingOrg } from '@bslt/orgs/server';\n`,
    );

    const res = run(root);
    expect(res.ok).toBe(false);
    expect(res.problems?.[0]).toContain('main/modules/identity/server/leak.ts:1');
    expect(res.problems?.[0]).toContain('@bslt/orgs/server');
  });

  it('fails when server or web app code outside src/generated/ imports, dynamic-imports, or mocks an optional module', () => {
    const root = createFixtureRoot();
    writeFileSync(
      path.join(root, 'main/apps/server/src/bootstrap/context.ts'),
      `import { resolveActingOrg } from '@bslt/orgs/server';\nexport const fn = resolveActingOrg;\n`,
    );
    writeFileSync(
      path.join(root, 'main/apps/web/src/app/Page.tsx'),
      `export const loadPlans = () => import('@bslt/billing/web');\nexport type T = typeof import('@bslt/files/web');\n`,
    );
    writeFileSync(
      path.join(root, 'main/apps/web/src/app/Page.test.tsx'),
      `import { vi } from 'vitest';\nvi.mock('@bslt/notifications/web', () => ({}));\n`,
    );

    const violations = findOptionalModuleViolations(root);
    expect(violations).toEqual([
      {
        file: 'main/apps/server/src/bootstrap/context.ts',
        line: 1,
        specifier: '@bslt/orgs/server',
        moduleId: 'orgs',
      },
      {
        file: 'main/apps/web/src/app/Page.test.tsx',
        line: 2,
        specifier: '@bslt/notifications/web',
        moduleId: 'notifications',
      },
      {
        file: 'main/apps/web/src/app/Page.tsx',
        line: 1,
        specifier: '@bslt/billing/web',
        moduleId: 'billing',
      },
      {
        file: 'main/apps/web/src/app/Page.tsx',
        line: 2,
        specifier: '@bslt/files/web',
        moduleId: 'files',
      },
    ]);
  });

  it('catches newly scaffolded custom optional modules under main/modules/* as well as known optional modules', () => {
    const root = createFixtureRoot();
    mkdirSync(path.join(root, 'main/modules/crm'), { recursive: true });
    writeFileSync(
      path.join(root, 'main/apps/web/src/app/CrmLeak.tsx'),
      `import { crmWeb } from '@bslt/crm/web';\nexport const x = crmWeb;\n`,
    );

    const res = run(root);
    expect(res.ok).toBe(false);
    expect(res.problems?.[0]).toContain('@bslt/crm/web');
  });

  it('passes when optional modules are imported only inside src/generated/ and other optional modules', () => {
    const root = createFixtureRoot();
    writeFileSync(
      path.join(root, 'main/apps/server/src/generated/modules.ts'),
      `export { resolveActingOrg } from '@bslt/orgs/server';\n`,
    );
    writeFileSync(
      path.join(root, 'main/apps/web/src/generated/modules.ts'),
      `import { billingWeb } from '@bslt/billing/web';\nexport const installed = [billingWeb];\n`,
    );
    writeFileSync(
      path.join(root, 'main/apps/web/src/app/Shell.tsx'),
      `import { useAuth } from '@bslt/identity/web';\nimport { DataControlsSection } from '@bslt/compliance/web';\nimport { useAuditEvents } from '@bslt/audit/web';\nexport const core = [useAuth, DataControlsSection, useAuditEvents];\n`,
    );
    writeFileSync(
      path.join(root, 'main/modules/billing/web/BillingPage.tsx'),
      `import { useActiveOrg } from '@bslt/orgs/web';\nexport const x = useActiveOrg;\n`,
    );

    const res = run(root);
    expect(res.ok).toBe(true);
  });

  it('passes across the live bslt-main repository', () => {
    const res = run(REPO_ROOT);
    expect(res.problems ?? []).toEqual([]);
    expect(res.ok).toBe(true);
  });
});
