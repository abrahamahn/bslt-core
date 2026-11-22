// main/tools/scripts/audit/docs-links.ts
/**
 * Validates local Markdown links in current template documentation.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { fail, pass, type CheckResult } from '../../gates/types';
import { PATHS, REPO_ROOT } from '../../lib/paths';

import { toRepoRelative, walkFiles } from './file-utils';

export interface DocsLinksOptions {
  /** Also scan archived logs, todos, planning docs and refactor notes. */
  readonly includeArchive?: boolean;
}

interface LinkReference {
  readonly destination: string;
  readonly file: string;
  readonly line: number;
}

interface LinkViolation extends LinkReference {
  readonly resolvedPath: string;
}

interface ParsedDestination {
  readonly destination: string;
  readonly endIndex: number;
}

const DOCS_ROOT = PATHS.docs;
const ROOT_README = path.join(REPO_ROOT, 'README.md');
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.cache', '.turbo']);
const MARKDOWN_FILE_PATTERN = /\.md$/u;
const FENCE_PATTERN = /^\s{0,3}(```+|~~~+)/u;
const HTML_HREF_PATTERN = /\bhref\s*=\s*["']([^"']+)["']/giu;
const REFERENCE_LINK_PATTERN = /^\s{0,3}\[[^\]]+\]:\s*(.+)$/u;
const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/iu;

function isArchiveHistoryFile(filePath: string): boolean {
  const relative = toRepoRelative(REPO_ROOT, filePath);
  if (!relative.startsWith('docs/archive/')) return false;
  return !relative.endsWith('/README.md') && relative !== 'docs/archive/README.md';
}

function shouldIncludeMarkdown(filePath: string, options: DocsLinksOptions): boolean {
  if (!MARKDOWN_FILE_PATTERN.test(filePath)) return false;
  return options.includeArchive || !isArchiveHistoryFile(filePath);
}

function collectMarkdownFiles(options: DocsLinksOptions): string[] {
  const files = walkFiles(
    DOCS_ROOT,
    (filePath) => shouldIncludeMarkdown(filePath, options),
    IGNORED_DIRS,
  );

  if (existsSync(ROOT_README)) files.push(ROOT_README);

  return files.sort();
}

function skipInlineCode(line: string): string {
  return line.replace(/`[^`]*`/gu, (match) => ' '.repeat(match.length));
}

function parseDestination(source: string, startIndex: number): ParsedDestination | undefined {
  let index = startIndex;
  while (source[index] === ' ' || source[index] === '\t') index += 1;

  if (source[index] === '<') {
    const closingIndex = source.indexOf('>', index + 1);
    if (closingIndex === -1) return undefined;
    return {
      destination: source.slice(index + 1, closingIndex),
      endIndex: closingIndex + 1,
    };
  }

  const destinationStart = index;
  while (index < source.length) {
    const current = source[index];
    if (current === undefined || current === ')' || current === ' ' || current === '\t') break;
    index += 1;
  }

  if (index === destinationStart) return undefined;

  return {
    destination: source.slice(destinationStart, index),
    endIndex: index,
  };
}

function collectInlineLinks(line: string, file: string, lineNumber: number): LinkReference[] {
  const links: LinkReference[] = [];

  for (let index = 0; index < line.length - 1; index += 1) {
    if (line[index] !== ']' || line[index + 1] !== '(') continue;
    const parsed = parseDestination(line, index + 2);
    if (parsed === undefined) continue;
    links.push({
      file,
      line: lineNumber,
      destination: parsed.destination,
    });
    index = parsed.endIndex;
  }

  return links;
}

function collectReferenceLink(line: string, file: string, lineNumber: number): LinkReference[] {
  const match = line.match(REFERENCE_LINK_PATTERN);
  const rawDestination = match?.[1];
  if (rawDestination === undefined) return [];

  const parsed = parseDestination(rawDestination, 0);
  if (parsed === undefined) return [];

  return [
    {
      file,
      line: lineNumber,
      destination: parsed.destination,
    },
  ];
}

function collectHtmlLinks(line: string, file: string, lineNumber: number): LinkReference[] {
  const links: LinkReference[] = [];

  for (const match of line.matchAll(HTML_HREF_PATTERN)) {
    const destination = match[1];
    if (destination === undefined) continue;
    links.push({
      file,
      line: lineNumber,
      destination,
    });
  }

  return links;
}

function collectLinks(filePath: string): LinkReference[] {
  const source = readFileSync(filePath, 'utf8');
  const lines = source.split(/\r?\n/u);
  const links: LinkReference[] = [];
  let inFence = false;

  for (const [index, rawLine] of lines.entries()) {
    const fence = rawLine.match(FENCE_PATTERN);
    if (fence !== null) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const line = skipInlineCode(rawLine);
    const lineNumber = index + 1;
    links.push(...collectInlineLinks(line, filePath, lineNumber));
    links.push(...collectReferenceLink(line, filePath, lineNumber));
    links.push(...collectHtmlLinks(line, filePath, lineNumber));
  }

  return links;
}

function decodeDestination(destination: string): string {
  try {
    return decodeURI(destination);
  } catch {
    return destination;
  }
}

function stripQueryAndHash(destination: string): string {
  const queryIndex = destination.indexOf('?');
  const hashIndex = destination.indexOf('#');
  const indexes = [queryIndex, hashIndex].filter((index) => index >= 0);
  if (indexes.length === 0) return destination;
  return destination.slice(0, Math.min(...indexes));
}

function isIgnoredDestination(destination: string): boolean {
  const trimmed = destination.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return true;
  if (trimmed.startsWith('//')) return true;
  if (URI_SCHEME_PATTERN.test(trimmed)) return true;
  if (trimmed.startsWith('/') && !trimmed.startsWith('/docs/') && trimmed !== '/README.md') {
    return true;
  }
  return false;
}

function resolveLocalDestination(filePath: string, destination: string): string | undefined {
  const trimmed = destination.trim();
  if (isIgnoredDestination(trimmed)) return undefined;

  const withoutQueryOrHash = stripQueryAndHash(trimmed);
  if (withoutQueryOrHash === '') return undefined;

  const decoded = decodeDestination(withoutQueryOrHash);
  if (decoded.startsWith('/')) return path.join(REPO_ROOT, decoded.slice(1));

  return path.resolve(path.dirname(filePath), decoded);
}

function collectViolations(files: readonly string[]): LinkViolation[] {
  const violations: LinkViolation[] = [];

  for (const file of files) {
    for (const link of collectLinks(file)) {
      const resolvedPath = resolveLocalDestination(file, link.destination);
      if (resolvedPath === undefined) continue;
      if (existsSync(resolvedPath)) continue;
      violations.push({
        ...link,
        resolvedPath,
      });
    }
  }

  return violations;
}

export function run(options: DocsLinksOptions = {}): CheckResult {
  const files = collectMarkdownFiles(options);
  const violations = collectViolations(files);

  if (violations.length === 0) {
    console.log(`Docs link audit passed (${files.length} markdown files checked).`);
    if (options.includeArchive !== true) {
      console.log('Archived history bodies skipped; pass --include-archive to scan them.');
    }
    return pass(`${String(files.length)} markdown files link only to paths that exist`);
  }

  console.error('Docs link audit failed:');
  for (const violation of violations) {
    console.error(
      `- ${toRepoRelative(REPO_ROOT, violation.file)}:${violation.line} ` +
        `links to missing ${violation.destination} ` +
        `(resolved ${toRepoRelative(REPO_ROOT, violation.resolvedPath)})`,
    );
  }

  return fail(`${String(violations.length)} link(s) to missing paths`);
}
