// main/tools/scripts/audit/bundle-size.ts
/**
 * Bundle Size & Public Entry Lighthouse Budget Audit (restructure plan §11.3).
 *
 * 1. Measures actual production gzipped bundle sizes in `dist/client/assets`
 *    against a 250KB gzipped per-JS-chunk ceiling;
 * 2. Enforces `config/lighthouse-budget.json` (`script`, `stylesheet`, `total`
 *    KB budgets) against the public SSR hydration entry (`src/entry-public.tsx`)
 *    resolved from `dist/client/.vite/manifest.json`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { fail, pass, type CheckResult } from '../../gates/types';
import { REPO_ROOT } from '../../lib/paths';

const MAX_GZIP_KB = 250;

interface AssetEntry {
  readonly name: string;
  readonly rawBytes: number;
  readonly gzipBytes: number;
}

interface ResourceBudgetItem {
  readonly resourceType: string;
  readonly budget: number;
}

interface LighthouseBudgetEntry {
  readonly path?: string;
  readonly resourceSizes?: readonly ResourceBudgetItem[];
}

interface ViteManifestEntry {
  readonly file?: string;
  readonly css?: readonly string[];
  readonly imports?: readonly string[];
}

function collectAssets(dir: string, extensions: readonly string[]): AssetEntry[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((file) => extensions.some((ext) => file.endsWith(ext)))
    .map((name) => {
      const filePath = join(dir, name);
      const content = readFileSync(filePath);
      const rawBytes = statSync(filePath).size;
      const gzipBytes = gzipSync(content).length;
      return { name, rawBytes, gzipBytes };
    })
    .sort((a, b) => b.gzipBytes - a.gzipBytes);
}

function formatKB(bytes: number): string {
  return (bytes / 1024).toFixed(1);
}

function readPublicEntryGzipTotals(clientDir: string): {
  readonly jsGzipBytes: number;
  readonly cssGzipBytes: number;
  readonly jsChunkCount: number;
} | null {
  const manifestPath = join(clientDir, '.vite/manifest.json');
  if (!existsSync(manifestPath)) {
    return null;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Readonly<
    Record<string, ViteManifestEntry>
  >;
  const entryKey = Object.keys(manifest).find(
    (key) => key === 'src/entry-public.tsx' || key.endsWith('/src/entry-public.tsx'),
  );
  if (entryKey === undefined) {
    return null;
  }

  const jsFiles = new Set<string>();
  const cssFiles = new Set<string>();
  const visited = new Set<string>();

  const walk = (key: string): void => {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = manifest[key];
    if (chunk === undefined) return;
    if (chunk.file !== undefined && chunk.file !== '') {
      jsFiles.add(chunk.file);
    }
    for (const css of chunk.css ?? []) {
      cssFiles.add(css);
    }
    for (const imp of chunk.imports ?? []) {
      walk(imp);
    }
  };

  walk(entryKey);

  let jsGzipBytes = 0;
  for (const rel of jsFiles) {
    const full = join(clientDir, rel);
    if (existsSync(full)) {
      jsGzipBytes += gzipSync(readFileSync(full)).length;
    }
  }

  let cssGzipBytes = 0;
  for (const rel of cssFiles) {
    const full = join(clientDir, rel);
    if (existsSync(full)) {
      cssGzipBytes += gzipSync(readFileSync(full)).length;
    }
  }

  return {
    jsGzipBytes,
    cssGzipBytes,
    jsChunkCount: jsFiles.size,
  };
}

function readPublicBudgets(root: string): {
  readonly scriptKb: number;
  readonly stylesheetKb: number;
  readonly totalKb: number;
} | null {
  const budgetPath = join(root, 'config/lighthouse-budget.json');
  if (!existsSync(budgetPath)) {
    return null;
  }

  const parsed = JSON.parse(readFileSync(budgetPath, 'utf8')) as readonly LighthouseBudgetEntry[];
  const first = parsed[0];
  const sizes = first?.resourceSizes ?? [];
  const findBudget = (type: string, fallback: number): number =>
    sizes.find((entry) => entry.resourceType === type)?.budget ?? fallback;

  return {
    scriptKb: findBudget('script', 250),
    stylesheetKb: findBudget('stylesheet', 60),
    totalKb: findBudget('total', 320),
  };
}

export function auditBundleSize(root: string = REPO_ROOT, quiet = true): CheckResult {
  const clientDir = join(root, 'main/apps/web/dist/client');
  const distAssets = join(clientDir, 'assets');

  if (!existsSync(distAssets)) {
    return fail(
      'no web build output at dist/client/assets: run `pnpm --filter @bslt/web build` first',
    );
  }

  const budgets = readPublicBudgets(root);
  if (budgets === null) {
    return fail('missing config/lighthouse-budget.json');
  }

  const jsAssets = collectAssets(distAssets, ['.js']);
  const cssAssets = collectAssets(distAssets, ['.css']);
  const allAssets = [...jsAssets, ...cssAssets];

  if (allAssets.length === 0) {
    return fail('the web build output holds no JS or CSS assets');
  }

  if (!quiet) {
    console.log('Bundle Size Audit\n');
    console.log('File'.padEnd(50) + 'Raw'.padStart(10) + 'Gzipped'.padStart(10));
    console.log('-'.repeat(70));
    for (const asset of allAssets) {
      const flag =
        asset.name.endsWith('.js') && asset.gzipBytes / 1024 > MAX_GZIP_KB ? ' [OVER LIMIT]' : '';
      console.log(
        asset.name.padEnd(50) +
          `${formatKB(asset.rawBytes)}KB`.padStart(10) +
          `${formatKB(asset.gzipBytes)}KB`.padStart(10) +
          flag,
      );
    }
  }

  const overChunkLimit = jsAssets.filter((asset) => asset.gzipBytes / 1024 > MAX_GZIP_KB);
  if (overChunkLimit.length > 0) {
    return fail(
      `a JS chunk exceeds ${String(MAX_GZIP_KB)}KB gzipped (${overChunkLimit.map((a) => `${a.name}: ${formatKB(a.gzipBytes)}KB`).join(', ')})`,
    );
  }

  const publicTotals = readPublicEntryGzipTotals(clientDir);
  if (publicTotals === null) {
    return fail('missing .vite/manifest.json or src/entry-public.tsx entry in dist/client');
  }

  const publicJsKb = publicTotals.jsGzipBytes / 1024;
  const publicCssKb = publicTotals.cssGzipBytes / 1024;
  const publicTotalKb = publicJsKb + publicCssKb;

  if (publicJsKb > budgets.scriptKb) {
    return fail(
      `entry-public JS (${publicJsKb.toFixed(1)}KB gzipped) exceeds script budget (${String(budgets.scriptKb)}KB) in config/lighthouse-budget.json`,
    );
  }
  if (publicCssKb > budgets.stylesheetKb) {
    return fail(
      `entry-public CSS (${publicCssKb.toFixed(1)}KB gzipped) exceeds stylesheet budget (${String(budgets.stylesheetKb)}KB) in config/lighthouse-budget.json`,
    );
  }
  if (publicTotalKb > budgets.totalKb) {
    return fail(
      `entry-public total JS+CSS (${publicTotalKb.toFixed(1)}KB gzipped) exceeds total budget (${String(budgets.totalKb)}KB) in config/lighthouse-budget.json`,
    );
  }

  return pass(
    `${String(jsAssets.length)} JS chunks <= ${String(MAX_GZIP_KB)}KB; entry-public ${publicJsKb.toFixed(1)}KB JS + ${publicCssKb.toFixed(1)}KB CSS within Lighthouse budgets`,
  );
}

export function run(root: string = REPO_ROOT): CheckResult {
  return auditBundleSize(root, false);
}
