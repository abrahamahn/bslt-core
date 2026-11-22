// main/tools/scripts/audit/file-utils.ts

import { readdirSync } from 'node:fs';
import path from 'node:path';

export function toPosixPath(filePath: string): string {
  return filePath.replaceAll(path.sep, '/');
}

export function toRepoRelative(repoRoot: string, filePath: string): string {
  return toPosixPath(path.relative(repoRoot, filePath));
}

export function walkFiles(
  root: string,
  shouldInclude: (absolutePath: string) => boolean,
  ignoredDirectoryNames: ReadonlySet<string>,
): string[] {
  const files: string[] = [];
  const stack: string[] = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;

    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (ignoredDirectoryNames.has(entry.name)) continue;
        stack.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!shouldInclude(absolutePath)) continue;
      files.push(absolutePath);
    }
  }

  return files.sort();
}
