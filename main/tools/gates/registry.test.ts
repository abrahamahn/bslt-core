// main/tools/gates/registry.test.ts
import { existsSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { repoPath } from '../lib/paths';

import { AUDIT_LIBRARIES, GATES, REPORTS, findGate } from './registry';
import { gatesForLane, validateRegistry } from './runner';

describe('the gate registry', () => {
  it('is well formed: unique kebab-case ids, known lanes, sources that exist', () => {
    expect(validateRegistry(GATES)).toEqual([]);
  });

  it('runs the merge lane in the order the old ci:merge-gate chain ran its checks', () => {
    expect(gatesForLane(GATES, 'merge').map((gate) => gate.id)).toEqual([
      'headers',
      'ts-references',
      'client-surfaces',
      'web-feature-surfaces',
      'api-client-surfaces',
      'generated-artifacts',
      'esm-dist',
      'package-exports',
      'declared-dependencies',
      'deps-allowlist',
      'env-examples',
      'version-pins',
      'vite-build-args',
      'route-contract-coverage',
      'snapshot-api',
      'snapshot-web-routes',
      'generated-rows',
      'generated-modules',
      'generated-icons',
      'generated-stories',
      'generated-openapi',
      'generated-csp',
      'generated-docs',
      'lockfile',
      'module-shape',
      'module-graph',
      'optional-module-isolation',
      'events',
      'ssr-public-only',
      'db-audit',
      'web-assets',
      'i18n',
      'docs-links',
      'css-tokens',
      'responsive',
      'dead-classes',
      'undefined-tokens',
      'gate-coverage',
      'tombstones',
      'swallowed-catch',
      'raw-sql-outside-repos',
      'setinterval',
      'inline-style',
      'opaque-schema',
      'unused-exports',
      'format',
      'test-pairs',
      'lint',
      'type-check',
      'test',
    ]);
  });

  it('runs every merge gate in the changed and nightly lanes too', () => {
    for (const gate of gatesForLane(GATES, 'merge')) {
      expect(gate.lanes, gate.id).toEqual(expect.arrayContaining(['changed', 'nightly']));
    }
    expect(gatesForLane(GATES, 'nightly').map((gate) => gate.id)).toContain('build');
  });

  it('registers every audit and lint script as a gate or a report', () => {
    // An audit that is not registered runs nowhere: the TOOL-02 failure mode.
    const registered = new Set([
      ...GATES.map((gate) => gate.source),
      ...REPORTS.map((report) => report.source),
      ...AUDIT_LIBRARIES,
    ]);
    const scripts = ['main/tools/scripts/audit', 'main/tools/scripts/lint'].flatMap((dir) =>
      readdirSync(repoPath(dir))
        .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
        .map((file) => `${dir}/${file}`),
    );
    expect(scripts.length).toBeGreaterThan(30);
    expect(scripts.filter((script) => !registered.has(script))).toEqual([]);
  });

  it('lists reports with unique ids and existing sources, apart from the gates', () => {
    const ids = REPORTS.map((report) => report.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const report of REPORTS) {
      expect(existsSync(repoPath(report.source)), report.source).toBe(true);
      expect(findGate(report.id)).toBeUndefined();
    }
  });
});
