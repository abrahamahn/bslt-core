// main/tools/scripts/lint/walkFiles.ts
/**
 * Recursive file walk shared by the lint scripts.
 *
 * Skips `node_modules`, build output, and dotfiles — scanning `dist` would
 * report every violation twice and blame a generated path for it.
 *
 * @module lint/walkFiles
 */

import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Every file under `dir` whose name ends with one of `extensions`.
 *
 * @param dir - Directory to walk
 * @param extensions - Suffixes to match, e.g. `['.tsx']`
 * @returns Absolute paths, depth-first
 * @complexity O(n) in files visited
 */
export function walkFiles(dir: string, extensions: readonly string[]): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const fullPath = path.join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      results.push(...walkFiles(fullPath, extensions));
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}
