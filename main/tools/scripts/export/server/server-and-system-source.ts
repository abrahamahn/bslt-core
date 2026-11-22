// main/tools/scripts/export/server/server-and-system-source.ts
/**
 * Server + System Source Exporter
 *
 * Exports all .ts/.tsx files from:
 *   - main/apps/server
 *   - main/kernel/server
 *
 * Output: .tmp/server-and-system-source.txt
 *
 * @usage pnpm bslt export server-and-system-source
 */

import fs from 'fs';
import path from 'path';

import { REPO_ROOT } from '../../../lib/paths';

const TARGETS = [
  {
    label: 'apps-server',
    dir: path.join(REPO_ROOT, 'main', 'apps', 'server'),
  },
  {
    label: 'server-system',
    dir: path.join(REPO_ROOT, 'main', 'kernel', 'server'),
  },
] as const;

const OUTPUT_DIR = path.join(REPO_ROOT, '.tmp');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'server-and-system-source.txt');

const SKIP_DIRS = new Set(['node_modules', '.git', '.turbo', 'dist', 'build', 'coverage']);
const EXTENSIONS = new Set(['.ts', '.tsx']);

function collectTsTsxFiles(dirPath: string, base = ''): string[] {
  if (!fs.existsSync(dirPath)) return [];

  const files: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const relPath = path.join(base, entry.name);
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectTsTsxFiles(fullPath, relPath));
      continue;
    }

    if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) {
      files.push(relPath);
    }
  }

  return files;
}

export function run(): void {
  console.log('Exporting main/apps/server + main/kernel/server (.ts/.tsx)...\n');

  let output = '';
  let totalFiles = 0;

  output += '# BSLT - Server + System Source Export\n\n';
  output += `Generated: ${new Date().toISOString()}\n`;
  output += 'Targets: main/apps/server, main/kernel/server\n';
  output += 'Extensions: .ts, .tsx\n\n';
  output += '---\n\n';

  for (const target of TARGETS) {
    if (!fs.existsSync(target.dir)) {
      console.log(`  - ${target.label}: target not found`);
      continue;
    }

    const relFiles = collectTsTsxFiles(target.dir).sort();
    console.log(`  - ${target.label}: ${String(relFiles.length)} files`);
    totalFiles += relFiles.length;

    output += `## ${target.label}\n\n`;

    for (const relFile of relFiles) {
      const absPath = path.join(target.dir, relFile);
      const displayPath = path.relative(REPO_ROOT, absPath);
      const ext = path.extname(relFile).slice(1) || 'txt';

      output += `### ${displayPath}\n\n`;
      try {
        const content = fs.readFileSync(absPath, 'utf8');
        output += `\`\`\`${ext}\n`;
        output += content;
        if (!content.endsWith('\n')) output += '\n';
        output += '```\n\n';
      } catch (error) {
        output += '```\n';
        output += `(ERROR READING FILE: ${(error as Error).message})\n`;
        output += '```\n\n';
      }
    }

    output += '---\n\n';
  }

  output += '## Summary\n\n';
  output += '```\n';
  output += `Total files exported: ${String(totalFiles)}\n`;
  output += `Output file: ${path.relative(REPO_ROOT, OUTPUT_FILE)}\n`;
  output += '```\n';

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, output, 'utf8');

  console.log(`\nExport complete: ${OUTPUT_FILE}`);
  console.log(`Total files: ${String(totalFiles)}`);
}
