// main/tools/scripts/git-environment.ts
/** Keep Git hooks from redirecting commands intended for a different repository. */
import { execFileSync } from 'node:child_process';

export function gitEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const repositoryVariables = execFileSync('git', ['rev-parse', '--local-env-vars'], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n');
  const excluded = new Set(repositoryVariables);
  return Object.fromEntries(Object.entries(env).filter(([name]) => !excluded.has(name)));
}
