// main/tools/scripts/audit/version-pins.ts
/**
 * Runtime versions come from two files, and actions are pinned by commit
 * (restructure plan, section 14.3).
 *
 * The pins:
 *
 * - `/.node-version`: the exact Node.js version (`major.minor.patch`).
 * - `/infra/versions.env`: `POSTGRES_MAJOR`, `POSTGRES_IMAGE` (a minor release
 *   of that major) and `PGBOUNCER_IMAGE` (pinned by digest).
 *
 * Everything else that names one of these versions must name the pinned value,
 * or read it from the pin:
 *
 * - `package.json`: the root `engines.node` is `>=<major> <<major + 1>`, and so
 *   is the `engines.node` of any workspace package that declares one.
 * - Dockerfiles: a Node image is `node:${NODE_VERSION}[-variant]`, and the file
 *   declares `ARG NODE_VERSION=<pin>`. A Postgres image is `POSTGRES_IMAGE`.
 * - `image:` in compose files and workflows (service containers): a Postgres
 *   image is `POSTGRES_IMAGE`, a PgBouncer image is `PGBOUNCER_IMAGE`, a Node
 *   image is `node:<pin>[-variant]`. `${VAR:-default}` is checked by its default.
 * - Workflows and composite actions: `actions/setup-node` reads
 *   `node-version-file: .node-version` (the exact pin as a literal
 *   `node-version` also passes); no `node-version` input is declared or passed
 *   through; a literal `NODE_VERSION` is the pin.
 * - Terraform: a managed Postgres (`engine = "pg"` with a `version`, or
 *   `database_version = "POSTGRES_<n>"`) runs `POSTGRES_MAJOR`.
 * - `.nvmrc`, when present, holds the pin.
 *
 * And every `uses:` in `.github/workflows` and `.github/actions` that names
 * another repository is `owner/repo[/path]@<40 hex commit SHA> # vX.Y.Z`: a tag
 * or a branch can be moved to other code, a commit cannot, and the comment
 * tells a reader (and an update bot) which release the commit is. A `docker://`
 * action is pinned by digest. Local actions (`./...`) are part of this commit.
 *
 * Files are matched line by line, without a YAML or HCL parser: the gate reads
 * the forms these files use and reports anything else that carries a version
 * in one of the checked positions.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { fail, pass, type CheckResult } from '../../gates/types';
import { REPO_ROOT } from '../../lib/paths';

export interface Pins {
  /** `.node-version`: `major.minor.patch`. */
  readonly node: string;
  readonly nodeMajor: number;
  readonly postgresMajor: string;
  readonly postgresImage: string;
  readonly pgbouncerImage: string;
}

const NODE_VERSION_FILE = '.node-version';
const VERSIONS_FILE = 'infra/versions.env';

/** Directories that hold installed or generated files, never sources. */
const SKIPPED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.turbo',
  '.terraform',
  '.cache',
]);

const DIGEST = /@sha256:[0-9a-f]{64}$/u;
const VERSION_COMMENT = /^v?\d+(?:\.\d+)*(?:[-+][\w.]+)?$/u;
const PINNED_ACTION = /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40}$/u;

function readText(root: string, relative: string): string | undefined {
  const file = path.join(root, relative);
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = /^(['"])(.*)\1$/u.exec(trimmed);
  return quoted === null ? trimmed : (quoted[2] ?? '');
}

/** Reads `.node-version` and `infra/versions.env`; `pins` is set only when both are well formed. */
export function readPins(root: string): { pins: Pins | undefined; problems: string[] } {
  const problems: string[] = [];

  const nodeFile = readText(root, NODE_VERSION_FILE);
  const node = nodeFile?.trim() ?? '';
  if (nodeFile === undefined) {
    problems.push(`${NODE_VERSION_FILE}: missing`);
  } else if (!/^\d+\.\d+\.\d+$/u.test(node)) {
    problems.push(`${NODE_VERSION_FILE}: "${node}" is not an exact version (major.minor.patch)`);
  }

  const versionsFile = readText(root, VERSIONS_FILE);
  const versions = new Map<string, string>();
  if (versionsFile === undefined) {
    problems.push(`${VERSIONS_FILE}: missing`);
  } else {
    for (const line of versionsFile.split('\n')) {
      const entry = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line.trim());
      if (entry !== null) versions.set(entry[1] ?? '', unquote(entry[2] ?? ''));
    }
    for (const key of ['POSTGRES_MAJOR', 'POSTGRES_IMAGE', 'PGBOUNCER_IMAGE']) {
      if ((versions.get(key) ?? '') === '') problems.push(`${VERSIONS_FILE}: ${key} is not set`);
    }
  }

  const postgresMajor = versions.get('POSTGRES_MAJOR') ?? '';
  const postgresImage = versions.get('POSTGRES_IMAGE') ?? '';
  const pgbouncerImage = versions.get('PGBOUNCER_IMAGE') ?? '';
  if (postgresMajor !== '' && !/^\d+$/u.test(postgresMajor)) {
    problems.push(`${VERSIONS_FILE}: POSTGRES_MAJOR "${postgresMajor}" is not a major version`);
  } else if (
    postgresMajor !== '' &&
    postgresImage !== '' &&
    !new RegExp(`^postgres:${postgresMajor}\\.\\d+(?:-[\\w.]+)?$`, 'u').test(postgresImage)
  ) {
    problems.push(
      `${VERSIONS_FILE}: POSTGRES_IMAGE "${postgresImage}" is not a minor release of PostgreSQL ${postgresMajor} (expected postgres:${postgresMajor}.<minor>)`,
    );
  }
  if (pgbouncerImage !== '' && !DIGEST.test(pgbouncerImage)) {
    problems.push(`${VERSIONS_FILE}: PGBOUNCER_IMAGE must be pinned by digest (@sha256:<64 hex>)`);
  }

  if (problems.length > 0) return { pins: undefined, problems };
  return {
    pins: {
      node,
      nodeMajor: Number(node.split('.')[0]),
      postgresMajor,
      postgresImage,
      pgbouncerImage,
    },
    problems,
  };
}

/** Repository-relative paths (forward slashes) of every file outside `SKIPPED_DIRS`, sorted. */
function listFiles(root: string, dir = ''): string[] {
  const files: string[] = [];
  const entries = readdirSync(path.join(root, dir), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = dir === '' ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) files.push(...listFiles(root, relative));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
}

type FileKind = 'package' | 'dockerfile' | 'compose' | 'workflow' | 'terraform' | 'nvmrc';

function kindOf(relative: string): FileKind | undefined {
  const name = path.posix.basename(relative);
  if (name === 'package.json') return 'package';
  if (relative === '.nvmrc') return 'nvmrc';
  if (name.endsWith('.tf')) return 'terraform';
  if (/^\.github\/(?:workflows|actions)\/.+\.ya?ml$/u.test(relative)) return 'workflow';
  if (/^(?:docker-)?compose[\w.-]*\.ya?ml$/u.test(name)) return 'compose';
  if (
    (name === 'Dockerfile' || name.startsWith('Dockerfile.') || name.endsWith('.Dockerfile')) &&
    !name.endsWith('.dockerignore')
  ) {
    return 'dockerfile';
  }
  return undefined;
}

/** `${VAR:-default}` and `${VAR-default}` replaced by their defaults. */
function withDefaults(image: string): string {
  return image.replace(/\$\{\w+:?-([^}]*)\}/gu, '$1');
}

/** The repository name of an image reference, without registry, tag or digest. */
function imageName(image: string): string {
  const withoutDigest = image.split('@')[0] ?? '';
  const lastSlash = withoutDigest.lastIndexOf('/');
  const colon = withoutDigest.indexOf(':', lastSlash + 1);
  return colon === -1 ? withoutDigest : withoutDigest.slice(0, colon);
}

function isOfficial(name: string, image: string): boolean {
  return image === name || image === `library/${name}` || image.endsWith(`/library/${name}`);
}

/** A Postgres, PgBouncer or Node image that is not its pin; `undefined` for any other image. */
function imageProblem(rawImage: string, pins: Pins): string | undefined {
  const image = withDefaults(unquote(rawImage));
  const name = imageName(image);
  if (isOfficial('postgres', name)) {
    return image === pins.postgresImage
      ? undefined
      : `image ${image} is not POSTGRES_IMAGE ${pins.postgresImage} (${VERSIONS_FILE})`;
  }
  if (name.includes('pgbouncer')) {
    return image === pins.pgbouncerImage
      ? undefined
      : `image ${image} is not PGBOUNCER_IMAGE ${pins.pgbouncerImage} (${VERSIONS_FILE})`;
  }
  if (isOfficial('node', name)) {
    const tag = image.slice(name.length + 1);
    return tag === pins.node || tag.startsWith(`${pins.node}-`)
      ? undefined
      : `image ${image} is not node:${pins.node}[-variant] (${NODE_VERSION_FILE})`;
  }
  return undefined;
}

function checkPackage(relative: string, text: string, pins: Pins): string[] {
  const expected = `>=${String(pins.nodeMajor)} <${String(pins.nodeMajor + 1)}`;
  let manifest: { engines?: { node?: unknown } };
  try {
    manifest = JSON.parse(text) as typeof manifest;
  } catch {
    // A deliberately broken fixture manifest; it declares no engine.
    return relative === 'package.json' ? [`${relative}: not valid JSON`] : [];
  }
  const range = manifest.engines?.node;
  if (range === undefined) {
    return relative === 'package.json'
      ? [`${relative}: engines.node is not set, expected "${expected}"`]
      : [];
  }
  return range === expected
    ? []
    : [`${relative}: engines.node is "${String(range)}", expected "${expected}"`];
}

function checkDockerfile(relative: string, text: string, pins: Pins): string[] {
  const problems: string[] = [];
  let usesNode = false;
  let hasArgDefault = false;
  text.split('\n').forEach((line, index) => {
    const at = `${relative}:${String(index + 1)}`;
    const arg = /^\s*ARG\s+NODE_VERSION=(\S*)/iu.exec(line);
    if (arg !== null) {
      const value = unquote(arg[1] ?? '');
      hasArgDefault = true;
      if (value !== pins.node) {
        problems.push(
          `${at}: ARG NODE_VERSION defaults to "${value}", expected ${pins.node} (${NODE_VERSION_FILE})`,
        );
      }
    }
    const from = /^\s*FROM\s+(?:--\S+\s+)*(\S+)/iu.exec(line);
    const copy = /^\s*COPY\s+.*--from=(\S+)/iu.exec(line);
    const image = from?.[1] ?? copy?.[1];
    if (image === undefined) return;
    const instruction = from === null ? 'COPY --from=' : 'FROM ';
    if (isOfficial('node', imageName(image))) {
      usesNode = true;
      if (!/:\$(?:\{NODE_VERSION\}|NODE_VERSION\b)/u.test(image)) {
        problems.push(
          `${at}: ${instruction}${image} must take its version from the build arg: node:\${NODE_VERSION}[-variant]`,
        );
      }
      return;
    }
    const problem = imageProblem(image, pins);
    if (problem !== undefined) problems.push(`${at}: ${problem}`);
  });
  if (usesNode && !hasArgDefault) {
    problems.push(
      `${relative}: uses a Node image without "ARG NODE_VERSION=${pins.node}" (${NODE_VERSION_FILE})`,
    );
  }
  return problems;
}

/** `image:` values of a compose file or a workflow. */
function checkImages(relative: string, lines: readonly string[], pins: Pins): string[] {
  const problems: string[] = [];
  lines.forEach((line, index) => {
    const match = /^\s*(?:-\s+)?image:\s*(\S.*?)\s*(?:\s#.*)?$/u.exec(line);
    if (match === null) return;
    const problem = imageProblem(match[1] ?? '', pins);
    if (problem !== undefined) problems.push(`${relative}:${String(index + 1)}: ${problem}`);
  });
  return problems;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** The lines of the step (a `- ` list item) that contains line `index`. */
function stepBlock(lines: readonly string[], index: number): string[] {
  let start = index;
  while (start > 0 && !/^\s*-\s/u.test(lines[start] ?? '')) start -= 1;
  const dashIndent = indentOf(lines[start] ?? '');
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end] ?? '';
    if (line.trim() !== '' && indentOf(line) <= dashIndent) break;
    end += 1;
  }
  return lines.slice(start, end);
}

interface UsesResult {
  readonly problems: string[];
  /** References to other repositories and docker images that are pinned. */
  readonly pinned: number;
}

function checkUses(relative: string, lines: readonly string[]): UsesResult {
  const problems: string[] = [];
  let pinned = 0;
  lines.forEach((line, index) => {
    const match = /^\s*(?:-\s+)?uses:\s*(\S+)\s*(?:#\s*(.*?)\s*)?$/u.exec(line);
    if (match === null) return;
    const reference = unquote(match[1] ?? '');
    const at = `${relative}:${String(index + 1)}`;
    if (reference.startsWith('./')) return;
    if (reference.startsWith('docker://')) {
      if (DIGEST.test(reference)) pinned += 1;
      else problems.push(`${at}: ${reference} is not pinned by digest (@sha256:<64 hex>)`);
      return;
    }
    if (!PINNED_ACTION.test(reference)) {
      problems.push(
        `${at}: ${reference} is not pinned to a full commit SHA (owner/repo@<40 hex> # vX.Y.Z)`,
      );
    } else if (!VERSION_COMMENT.test(match[2] ?? '')) {
      problems.push(`${at}: ${reference} needs its version tag in a trailing comment (# vX.Y.Z)`);
    } else {
      pinned += 1;
    }
  });
  return { problems, pinned };
}

function checkNodeInWorkflow(relative: string, lines: readonly string[], pins: Pins): string[] {
  const problems: string[] = [];
  lines.forEach((line, index) => {
    const at = `${relative}:${String(index + 1)}`;

    const file = /^\s*node-version-file:\s*(\S.*?)\s*(?:\s#.*)?$/u.exec(line);
    if (file !== null && unquote(file[1] ?? '') !== NODE_VERSION_FILE) {
      problems.push(
        `${at}: node-version-file is "${unquote(file[1] ?? '')}", expected ${NODE_VERSION_FILE}`,
      );
    }

    const version = /^\s*node-version:\s*(.*?)\s*(?:\s#.*)?$/u.exec(line);
    if (version !== null) {
      const value = unquote(version[1] ?? '');
      if (value === '') {
        problems.push(
          `${at}: a node-version input lets a caller choose the Node version; read ${NODE_VERSION_FILE} instead`,
        );
      } else if (value !== pins.node) {
        problems.push(
          `${at}: node-version is "${value}"; use "node-version-file: ${NODE_VERSION_FILE}" (or the exact pin ${pins.node})`,
        );
      }
    }

    for (const literal of line.matchAll(/\bNODE_VERSION\s*[:=]\s*['"]?(\d[\w.-]*)/gu)) {
      if (literal[1] !== pins.node) {
        problems.push(
          `${at}: NODE_VERSION is "${literal[1] ?? ''}", expected ${pins.node} (${NODE_VERSION_FILE})`,
        );
      }
    }

    if (/^\s*(?:-\s+)?uses:\s*['"]?actions\/setup-node@/u.test(line)) {
      const names = stepBlock(lines, index).some((stepLine) =>
        /^\s*node-version(?:-file)?:/u.test(stepLine),
      );
      if (!names) {
        problems.push(
          `${at}: actions/setup-node without "node-version-file: ${NODE_VERSION_FILE}"`,
        );
      }
    }
  });
  return problems;
}

function checkTerraform(relative: string, text: string, pins: Pins): string[] {
  const problems: string[] = [];
  const lines = text.split('\n');
  let blockStart = 0;
  lines.forEach((line, index) => {
    const at = `${relative}:${String(index + 1)}`;
    if (/^\S.*\{\s*$/u.test(line)) blockStart = index;

    const cloudSql = /^\s*database_version\s*=\s*"(POSTGRES_\w+)"/u.exec(line);
    if (cloudSql !== null && cloudSql[1] !== `POSTGRES_${pins.postgresMajor}`) {
      problems.push(
        `${at}: database_version is "${cloudSql[1] ?? ''}", expected "POSTGRES_${pins.postgresMajor}" (POSTGRES_MAJOR in ${VERSIONS_FILE})`,
      );
    }

    const version = /^\s*version\s*=\s*"([^"]*)"/u.exec(line);
    if (version === null || version[1] === pins.postgresMajor) return;
    let blockEnd = lines.findIndex((candidate, at2) => at2 > index && /^\}/u.test(candidate));
    if (blockEnd === -1) blockEnd = lines.length;
    const isPostgres = lines
      .slice(blockStart, blockEnd)
      .some((candidate) => /^\s*engine\s*=\s*"pg"/u.test(candidate));
    if (isPostgres) {
      problems.push(
        `${at}: managed PostgreSQL version is "${version[1] ?? ''}", expected "${pins.postgresMajor}" (POSTGRES_MAJOR in ${VERSIONS_FILE})`,
      );
    }
  });
  return problems;
}

interface Audit {
  readonly problems: string[];
  readonly files: number;
  readonly pinnedActions: number;
  readonly pins: Pins | undefined;
}

function audit(root: string): Audit {
  const { pins, problems: pinProblems } = readPins(root);
  if (pins === undefined) return { problems: pinProblems, files: 0, pinnedActions: 0, pins };

  const problems: string[] = [];
  let files = 0;
  let pinnedActions = 0;
  for (const relative of listFiles(root)) {
    const kind = kindOf(relative);
    if (kind === undefined) continue;
    files += 1;
    const text = readFileSync(path.join(root, relative), 'utf8');
    const lines = text.split('\n');
    if (kind === 'package') problems.push(...checkPackage(relative, text, pins));
    if (kind === 'dockerfile') problems.push(...checkDockerfile(relative, text, pins));
    if (kind === 'compose') problems.push(...checkImages(relative, lines, pins));
    if (kind === 'terraform') problems.push(...checkTerraform(relative, text, pins));
    if (kind === 'nvmrc' && text.trim().replace(/^v/u, '') !== pins.node) {
      problems.push(
        `${relative}: "${text.trim()}" is not the pinned Node.js version ${pins.node} (${NODE_VERSION_FILE})`,
      );
    }
    if (kind === 'workflow') {
      const uses = checkUses(relative, lines);
      pinnedActions += uses.pinned;
      problems.push(
        ...[
          ...checkImages(relative, lines, pins),
          ...checkNodeInWorkflow(relative, lines, pins),
          ...uses.problems,
        ].sort((a, b) => lineOf(a) - lineOf(b)),
      );
    }
  }
  return { problems, files, pinnedActions, pins };
}

function lineOf(problem: string): number {
  return Number(/^[^:]+:(\d+):/u.exec(problem)?.[1] ?? 0);
}

/** Every place that names a Node.js, Postgres or action version other than through the pins. */
export function auditVersionPins(root: string): string[] {
  return audit(root).problems;
}

/** Runtime versions are the pins everywhere, and actions are pinned by commit. */
export function run(root: string = REPO_ROOT): CheckResult {
  const { problems, files, pinnedActions, pins } = audit(root);
  if (problems.length > 0 || pins === undefined) {
    return fail(
      `${String(problems.length)} version pin violation${problems.length === 1 ? '' : 's'}`,
      problems,
    );
  }
  return pass(
    `Node ${pins.node} and ${pins.postgresImage} in ${String(files)} files; ${String(pinnedActions)} action references pinned by commit`,
  );
}
