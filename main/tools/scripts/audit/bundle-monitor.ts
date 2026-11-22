#!/usr/bin/env tsx
// main/tools/scripts/audit/bundle-monitor.ts
/**
 * Bundle Size Monitor
 *
 * Monitors bundle sizes and provides regression detection
 * Tracks changes over time and alerts on significant increases
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS, repoPath } from '../../lib/paths';

interface BundleInfo {
  name: string;
  size: number;
  gzipSize: number;
  timestamp: string;
  commit?: string;
}

interface BundleReport {
  timestamp: string;
  commit?: string;
  packages: Record<string, BundleInfo[]>;
  totals: Record<string, { size: number; gzipSize: number }>;
}

// ============================================================================
// Bundle Size Estimation
// ============================================================================

function estimatePackageBundleSize(packageName: string, packagePath: string): BundleInfo[] {
  const bundles: BundleInfo[] = [];
  const packageJsonPath = join(packagePath, 'package.json');

  if (!existsSync(packageJsonPath)) return bundles;

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const dependencies: Record<string, string> = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  // Estimate sizes for each dependency
  const sizeEstimates: Record<string, { size: number; gzipSize: number }> = {
    // Framework
    react: { size: 150, gzipSize: 45 },
    'react-dom': { size: 1200, gzipSize: 320 },

    // Build Tools (not included in bundle)
    typescript: { size: 0, gzipSize: 0 },
    vite: { size: 0, gzipSize: 0 },
    webpack: { size: 0, gzipSize: 0 },
    esbuild: { size: 0, gzipSize: 0 },

    // Dev Tools (not included in bundle)
    eslint: { size: 0, gzipSize: 0 },
    prettier: { size: 0, gzipSize: 0 },
    '@types/node': { size: 0, gzipSize: 0 },
    '@types/react': { size: 0, gzipSize: 0 },
    vitest: { size: 0, gzipSize: 0 },

    // UI & Contract Libraries
    '@bslt/ui': { size: 200, gzipSize: 60 },
    '@bslt/contract': { size: 60, gzipSize: 20 },
    '@bslt/schema': { size: 40, gzipSize: 15 },

    // Database (runtime only, not in client bundle)
    '@bslt/db': { size: 0, gzipSize: 0 },

    // Development dependencies
    '@playwright/test': { size: 0, gzipSize: 0 },
    '@testing-library/react': { size: 0, gzipSize: 0 },
    msw: { size: 0, gzipSize: 0 },
    jsdom: { size: 0, gzipSize: 0 },
  };

  let totalSize = 0;
  let totalGzipSize = 0;

  for (const [name] of Object.entries(dependencies)) {
    const estimate = sizeEstimates[name] ?? { size: 30, gzipSize: 10 }; // Default estimate
    totalSize += estimate.size;
    totalGzipSize += estimate.gzipSize;

    bundles.push({
      name,
      size: estimate.size,
      gzipSize: estimate.gzipSize,
      timestamp: new Date().toISOString(),
    });
  }

  // Add main bundle estimate
  bundles.unshift({
    name: `${packageName} (main)`,
    size: Math.max(50, totalSize * 0.1), // Estimate 10% for app code
    gzipSize: Math.max(15, totalGzipSize * 0.1),
    timestamp: new Date().toISOString(),
  });

  return bundles;
}

// ============================================================================
// Report Generation
// ============================================================================

function generateBundleReport(): BundleReport {
  const packages: Record<string, BundleInfo[]> = {};
  const totals: Record<string, { size: number; gzipSize: number }> = {};

  // Analyze web app (the old `src/apps/web` root never existed).
  const webPath = PATHS.webApp;
  if (existsSync(webPath)) {
    const bundles = estimatePackageBundleSize('@bslt/web', webPath);
    packages['@bslt/web'] = bundles;

    const total = bundles.reduce(
      (acc, bundle) => ({
        size: acc.size + bundle.size,
        gzipSize: acc.gzipSize + bundle.gzipSize,
      }),
      { size: 0, gzipSize: 0 },
    );
    totals['@bslt/web'] = total;
  }

  // Analyze packages across main/kernel/* and main/modules/*
  const packageLayers = ['main/kernel', 'main/modules'];
  for (const layer of packageLayers) {
    const layerDir = repoPath(layer);
    if (!existsSync(layerDir)) continue;

    const packageDirs = readdirSync(layerDir);
    for (const pkgName of packageDirs) {
      const pkgPath = join(layerDir, pkgName);
      if (existsSync(join(pkgPath, 'package.json'))) {
        const bundles = estimatePackageBundleSize(`@bslt/${pkgName}`, pkgPath);
        packages[`@bslt/${pkgName}`] = bundles;

        const total = bundles.reduce(
          (acc, bundle) => ({
            size: acc.size + bundle.size,
            gzipSize: acc.gzipSize + bundle.gzipSize,
          }),
          { size: 0, gzipSize: 0 },
        );
        totals[`@bslt/${pkgName}`] = total;
      }
    }
  }

  return {
    timestamp: new Date().toISOString(),
    packages,
    totals,
  };
}

// ============================================================================
// Historical Comparison
// ============================================================================

function getOutputDir(): string {
  return repoPath('.tmp');
}

function getReportPath(): string {
  return join(getOutputDir(), '.bundle-sizes.json');
}

function loadPreviousReport(): BundleReport | null {
  const reportPath = getReportPath();

  if (!existsSync(reportPath)) return null;

  try {
    const data = readFileSync(reportPath, 'utf-8');
    const reports = JSON.parse(data) as BundleReport[];
    return reports[reports.length - 1] ?? null;
  } catch {
    return null;
  }
}

function saveReport(report: BundleReport): void {
  const outputDir = getOutputDir();
  const reportPath = getReportPath();

  // Ensure .tmp directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  let reports: BundleReport[] = [];
  if (existsSync(reportPath)) {
    try {
      reports = JSON.parse(readFileSync(reportPath, 'utf-8')) as BundleReport[];
    } catch {
      reports = [];
    }
  }

  reports.push(report);

  // Keep only last 10 reports
  if (reports.length > 10) {
    reports = reports.slice(-10);
  }

  writeFileSync(reportPath, JSON.stringify(reports, null, 2));
}

// ============================================================================
// Report Display
// ============================================================================

function displayReport(current: BundleReport, previous: BundleReport | null): void {
  console.log('📏 Bundle Size Report\n');

  for (const [pkgName, bundles] of Object.entries(current.packages)) {
    console.log(`📦 ${pkgName}`);

    const total = current.totals[pkgName];
    const prevTotal = previous?.totals[pkgName];
    if (total === undefined) continue;

    console.log(`  Total: ${String(total.size)}KB (${String(total.gzipSize)}KB gzipped)`);

    if (prevTotal) {
      const sizeDiff = total.size - prevTotal.size;
      const gzipDiff = total.gzipSize - prevTotal.gzipSize;

      if (sizeDiff !== 0) {
        const sign = sizeDiff > 0 ? '+' : '';
        console.log(
          `  Change: ${sign}${String(sizeDiff)}KB (${sign}${String(gzipDiff)}KB gzipped)`,
        );
      }
    }

    // Show top contributors
    const mainBundle = bundles.find((b) => b.name.includes('(main)'));
    if (mainBundle) {
      console.log(
        `  Main bundle: ${String(mainBundle.size)}KB (${String(mainBundle.gzipSize)}KB gzipped)`,
      );
    }

    console.log('');
  }

  // Overall totals
  const overallTotal = Object.values(current.totals).reduce(
    (acc, total) => ({
      size: acc.size + total.size,
      gzipSize: acc.gzipSize + total.gzipSize,
    }),
    { size: 0, gzipSize: 0 },
  );

  console.log('📊 Overall Totals:');
  console.log(`  Total size: ${String(overallTotal.size)}KB`);
  console.log(`  Total gzipped: ${String(overallTotal.gzipSize)}KB`);

  if (previous) {
    const prevOverall = Object.values(previous.totals).reduce(
      (acc, total) => ({
        size: acc.size + total.size,
        gzipSize: acc.gzipSize + total.gzipSize,
      }),
      { size: 0, gzipSize: 0 },
    );

    const sizeDiff = overallTotal.size - prevOverall.size;
    const gzipDiff = overallTotal.gzipSize - prevOverall.gzipSize;

    if (sizeDiff !== 0) {
      const sign = sizeDiff > 0 ? '+' : '';
      console.log(`  Change: ${sign}${String(sizeDiff)}KB (${sign}${String(gzipDiff)}KB gzipped)`);

      if (sizeDiff > 50) {
        console.log('⚠️  WARNING: Bundle size increased significantly!');
      }
    }
  }
}

// ============================================================================
// Main Execution
// ============================================================================

export function run(): number {
  try {
    const report = generateBundleReport();
    const previous = loadPreviousReport();

    displayReport(report, previous);
    saveReport(report);

    console.log('\n💾 Report saved to .tmp/.bundle-sizes.json');
    return 0;
  } catch (error) {
    console.error('❌ Bundle monitoring failed:', error);
    return 1;
  }
}
