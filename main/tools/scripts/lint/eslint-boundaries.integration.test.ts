// main/tools/scripts/lint/eslint-boundaries.integration.test.ts
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../../', import.meta.url));

describe('ESLint source boundaries from different workspace directories', () => {
  it.each(['.', 'main/apps/server'])(
    'resolves shared sources and rejects forbidden/unknown imports from %s',
    (directory) => {
      // A fresh process prevents the resolver's project cache masking cwd differences.
      // lintText exercises the real configuration without writing into application source.
      const script = `
        import { ESLint } from 'eslint';
        const eslint = new ESLint({ cwd: process.cwd() });
        const filePath = ${JSON.stringify(path.join(root, 'main/apps/server/src/middleware/csrf.ts'))};
        const examples = {
          allowed: "import { AUTH_CONSTANTS, ForbiddenError } from '@bslt/contract';\\n",
          forbidden: "import { ApiError } from '../../../../kernel/client/src/index';\\n",
          unknown: "import { missing } from './does-not-exist';\\n",
        };
        const output = {};
        for (const [name, code] of Object.entries(examples)) {
          const results = await eslint.lintText(code, { filePath });
          output[name] = results.flatMap(result => result.messages
            .filter(message => message.fatal || message.ruleId?.startsWith('boundaries/'))
            .map(message => message.fatal ? 'fatal' : message.ruleId));
        }
        process.stdout.write(JSON.stringify(output));
      `;
      const output = execFileSync(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '--eval', script],
        { cwd: path.resolve(root, directory), encoding: 'utf8', timeout: 30_000 },
      );
      const results = JSON.parse(output) as Record<string, string[]>;
      expect(results['allowed']).toEqual([]);
      expect(results['forbidden']).toEqual(['boundaries/element-types']);
      expect(results['unknown']).toEqual(['boundaries/no-unknown']);
    },
    40_000,
  );
});
