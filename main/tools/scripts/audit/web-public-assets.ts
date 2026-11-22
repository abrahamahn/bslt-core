// main/tools/scripts/audit/web-public-assets.ts
/**
 * Verifies that public web assets are real browser-loadable files, not placeholders.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { fail, pass, type CheckResult } from '../../gates/types';
import { PATHS, REPO_ROOT } from '../../lib/paths';

interface ManifestIcon {
  readonly src?: string;
  readonly sizes?: string;
  readonly type?: string;
  readonly purpose?: string;
}

interface Manifest {
  readonly id?: string;
  readonly icons?: ManifestIcon[];
  readonly name?: string;
  readonly short_name?: string;
  readonly description?: string;
  readonly start_url?: string;
  readonly scope?: string;
  readonly display?: string;
  readonly theme_color?: string;
  readonly background_color?: string;
}

const PUBLIC_DIR = PATHS.webPublic;
const MANIFEST_PATH = path.join(PUBLIC_DIR, 'manifest.json');
const PLACEHOLDER_PATTERN = /\b(placeholder|creating placeholder|your app)\b/iu;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ICO_SIGNATURE = Buffer.from([0, 0, 1, 0]);

class AssetDefect extends Error {}

function defect(message: string): never {
  throw new AssetDefect(message);
}

function assertExists(filePath: string): void {
  if (!existsSync(filePath)) {
    defect(`Missing asset: ${path.relative(REPO_ROOT, filePath)}`);
  }
}

function assertNoPlaceholderText(filePath: string): void {
  const sample = readFileSync(filePath).subarray(0, 256).toString('utf8');
  if (PLACEHOLDER_PATTERN.test(sample)) {
    defect(`Placeholder text found in ${path.relative(REPO_ROOT, filePath)}`);
  }
}

function assertMagic(filePath: string, expected: Buffer, label: string): void {
  const actual = readFileSync(filePath).subarray(0, expected.length);
  if (!actual.equals(expected)) {
    defect(`${path.relative(REPO_ROOT, filePath)} is not a valid ${label} file`);
  }
}

function assertSvg(filePath: string): void {
  const source = readFileSync(filePath, 'utf8').trimStart();
  if (!source.startsWith('<svg')) {
    defect(`${path.relative(REPO_ROOT, filePath)} is not a valid SVG file`);
  }
}

function assetPathFromManifestSource(src: string): string {
  const normalized = src.startsWith('/') ? src.slice(1) : src;
  return path.join(PUBLIC_DIR, normalized);
}

function assertAsset(filePath: string): void {
  assertExists(filePath);
  assertNoPlaceholderText(filePath);

  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') {
    assertMagic(filePath, PNG_SIGNATURE, 'PNG');
    return;
  }
  if (extension === '.ico') {
    assertMagic(filePath, ICO_SIGNATURE, 'ICO');
    return;
  }
  if (extension === '.svg') {
    assertSvg(filePath);
  }
}

function readManifest(): Manifest {
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
  } catch (error) {
    defect(`Unable to parse manifest: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function auditManifest(manifest: Manifest): void {
  if (manifest.name === undefined || PLACEHOLDER_PATTERN.test(manifest.name)) {
    defect('manifest.json must use a real app name');
  }
  if (manifest.short_name === undefined || PLACEHOLDER_PATTERN.test(manifest.short_name)) {
    defect('manifest.json must use a real short_name');
  }
  for (const field of [
    'id',
    'description',
    'start_url',
    'scope',
    'display',
    'theme_color',
    'background_color',
  ] as const) {
    const val = manifest[field];
    if (typeof val !== 'string' || val.trim() === '') {
      defect(`manifest.json must declare non-empty "${field}"`);
    }
  }

  const icons = manifest.icons ?? [];
  if (icons.length === 0) {
    defect('manifest.json must declare at least one icon');
  }

  for (const icon of icons) {
    if (icon.src === undefined || icon.src === '') {
      defect('manifest icon entry is missing src');
    }
    if (icon.purpose === undefined || icon.purpose.trim() === '') {
      defect(`manifest icon "${icon.src}" must declare purpose`);
    }
    assertAsset(assetPathFromManifestSource(icon.src));
  }
}

export function run(): CheckResult {
  try {
    assertAsset(path.join(PUBLIC_DIR, 'icons/logo192.png'));
    assertAsset(path.join(PUBLIC_DIR, 'icons/logo512.png'));
    auditManifest(readManifest());
  } catch (error) {
    if (error instanceof AssetDefect) return fail(error.message);
    throw error;
  }
  return pass('web manifest and icons are real assets');
}
