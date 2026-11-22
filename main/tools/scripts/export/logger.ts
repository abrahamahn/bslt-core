// main/tools/scripts/export/logger.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, globSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { REPO_ROOT as ROOT_DIR } from '../../lib/paths';

const TMP_DIR = resolve(ROOT_DIR, '.tmp');
const OUTPUT_FILE = join(TMP_DIR, 'logger_export.txt');

const GLOBS_TO_EXPORT = [
  'main/kernel/server/src/logger/*.ts',
  'main/shared/src/infra/logger/*.ts',
  'main/apps/server/src/bootstrap/*.ts',
];

export async function exportLogger(): Promise<void> {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
  }

  let content = `// Consolidated Logger Export
// Generated: ${new Date().toISOString()}

`;

  const filesToExport = GLOBS_TO_EXPORT.flatMap((pattern) =>
    globSync(pattern, { cwd: ROOT_DIR }),
  ).filter((file) => !file.endsWith('.test.ts')); // Usually we don't want tests in these exports unless specified

  for (const relativePath of filesToExport) {
    const filePath = resolve(ROOT_DIR, relativePath);

    if (!existsSync(filePath)) {
      console.warn(`File not found: ${filePath}`);
      continue;
    }

    const fileContent = readFileSync(filePath, 'utf-8');
    content += `
// ============================================
`;
    content += `// FILE: ${relativePath}
`;
    content += `// ============================================

`;
    content += fileContent;
    content += `
`;
    console.log(`Exported ${relativePath}`);
  }

  writeFileSync(OUTPUT_FILE, content);
  console.log(`\nConsolidated export written to ${OUTPUT_FILE}`);
}
