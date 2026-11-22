// main/tools/scripts/export/server-main.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT as ROOT_DIR } from '../../lib/paths';

const TMP_DIR = join(ROOT_DIR, '.tmp');
const OUTPUT_FILE = join(TMP_DIR, 'server_main_export.txt');

const FILES_TO_EXPORT = [
  'main/apps/server/src/main.ts',
  'main/apps/server/src/bootstrap/app.ts',
  'main/apps/server/src/bootstrap/context.ts',
  'main/apps/server/src/bootstrap/runtime.ts',
  'main/apps/server/src/bootstrap/build-app.ts',
];

export async function exportServerMain(): Promise<void> {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
  }

  let content = `// Server Main & Bootstrap Export (Exclusive)
// Generated: ${new Date().toISOString()}

`;

  for (const relativePath of FILES_TO_EXPORT) {
    const filePath = join(ROOT_DIR, relativePath);

    if (!existsSync(filePath)) {
      console.warn(`File not found: ${relativePath}`);
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
  console.log(`
Consolidated export written to ${OUTPUT_FILE}`);
}
