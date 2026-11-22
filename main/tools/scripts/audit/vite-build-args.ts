// main/tools/scripts/audit/vite-build-args.ts
/**
 * Verifies the chain that decides what a production web image actually ships.
 *
 * `VITE_*` values are inlined at BUILD time. If a flag is not passed to
 * `docker build`, the image is built with the Dockerfile's default (usually
 * empty) and there is no runtime env var that can turn the feature on later —
 * the bundle simply does not contain it. The failure is silent: the build
 * succeeds, the container is healthy, and the feature is just missing.
 *
 * Three links have to hold, and the interesting one is the middle:
 *
 *   1. Dockerfile declares the ARG *and* exports it into the `vite build` step.
 *      An ARG that is declared but never referenced does nothing at all.
 *   2. The workflow that builds the DEPLOYED image passes it. This is the link
 *      that actually decides what ships, and the one that silently rots when
 *      someone adds a flag to the Dockerfile and nowhere else.
 *   3. Anything deliberately left at its default is listed here, so "not passed"
 *      is a decision on the record rather than an oversight.
 *
 * Deliberately anchored at `ci.yml` (its `images` job), which builds the image
 * the deploy workflow later pulls by digest. Anchoring an audit at a workflow
 * that does not produce the deployed artifact is how this kind of check ends up
 * passing green forever while proving nothing.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { fail, pass, type CheckResult } from '../../gates/types';
import { PATHS, REPO_ROOT, toRepoRelative } from '../../lib/paths';

const DOCKERFILE = toRepoRelative(PATHS.webDockerfile);

/** The workflow that builds the image the deploy pulls. */
const IMAGE_BUILD_WORKFLOW = toRepoRelative(PATHS.ciWorkflow);

/** Marks the web image build step inside that workflow. */
const WEB_BUILD_MARKER = 'steps.image-vars.outputs.web_tag';

/**
 * Args the production image intentionally builds with the Dockerfile default.
 *
 * Everything here ships OFF (or at its default) in the deployed bundle, and
 * cannot be switched on without rebuilding. A starter defaults its optional
 * surfaces off, so this list is expected to be long — but every entry is a
 * statement, not an accident.
 */
const INTENTIONALLY_DEFAULTED = new Set([
  'NODE_VERSION',
  'VITE_APP_NAME', // branding: forks override per deployment
  'PUBLIC_STRIPE_ID',
]);

interface Issue {
  readonly arg: string;
  readonly message: string;
}

function read(relative: string): string | undefined {
  const full = path.join(REPO_ROOT, relative);
  return existsSync(full) ? readFileSync(full, 'utf8') : undefined;
}

/** ARG names declared in the Dockerfile, in declaration order. */
function declaredArgs(dockerfile: string): string[] {
  return [...dockerfile.matchAll(/^ARG\s+([A-Z0-9_]+)/gmu)].map((m) => m[1] ?? '').filter(Boolean);
}

/**
 * The build command's own text, so "is this ARG referenced where vite runs?"
 * is answered against the RUN that performs the build and not the whole file —
 * an ARG mentioned only in a comment is not wired to anything.
 */
function buildStepText(dockerfile: string): string {
  // Anchored on the command that runs the web build, then walked back to its
  // own RUN. Anchoring on the first cache-mounted RUN finds the *deps* stage,
  // which references none of these args — and would report every one of them
  // as unwired. An audit that cries wolf gets muted, so this has to be exact.
  const buildCmd = dockerfile.indexOf('pnpm --filter @bslt/web build');
  if (buildCmd < 0) return '';
  const runStart = dockerfile.lastIndexOf('\nRUN ', buildCmd);
  if (runStart < 0) return '';
  return dockerfile.slice(runStart, buildCmd + 'pnpm --filter @bslt/web build'.length);
}

/** Build args the image-building workflow passes to `docker build`. */
function argsPassedByImageBuild(workflow: string): Set<string> {
  const marker = workflow.indexOf(WEB_BUILD_MARKER);
  if (marker < 0) return new Set();

  const buildArgsAt = workflow.indexOf('build-args:', marker);
  if (buildArgsAt < 0) return new Set();

  // The block ends at the next key at the same indentation.
  const rest = workflow.slice(buildArgsAt);
  const blockEnd = rest.search(/\n {8}[a-z-]+:/u);
  const block = blockEnd < 0 ? rest : rest.slice(0, blockEnd);

  return new Set(
    [...block.matchAll(/^\s*([A-Z0-9_]+)=/gmu)].map((m) => m[1] ?? '').filter(Boolean),
  );
}

export function run(): CheckResult {
  const dockerfile = read(DOCKERFILE);
  const workflow = read(IMAGE_BUILD_WORKFLOW);

  if (dockerfile === undefined) {
    console.error(`vite build-args audit: ${DOCKERFILE} not found`);
    return fail(`${DOCKERFILE} not found`);
  }
  if (workflow === undefined) {
    console.error(`vite build-args audit: ${IMAGE_BUILD_WORKFLOW} not found`);
    return fail(`${IMAGE_BUILD_WORKFLOW} not found`);
  }
  if (!workflow.includes(WEB_BUILD_MARKER)) {
    // Refuse to pass vacuously: if the anchor is gone the audit is checking
    // nothing, and a green result would be a lie.
    console.error(
      `vite build-args audit: could not find the web image build (${WEB_BUILD_MARKER}) in ${IMAGE_BUILD_WORKFLOW}.\n` +
        'Re-anchor this audit at whatever now builds the deployed web image.',
    );
    return fail(
      `no web image build (${WEB_BUILD_MARKER}) in ${IMAGE_BUILD_WORKFLOW}: re-anchor the audit`,
    );
  }

  const args = declaredArgs(dockerfile);
  const buildStep = buildStepText(dockerfile);
  const passed = argsPassedByImageBuild(workflow);
  const issues: Issue[] = [];

  for (const arg of args) {
    if (arg === 'NODE_VERSION') continue; // base-image pin, not a client value

    // Link 1: declared AND wired into the build command.
    if (!buildStep.includes(`$${arg}`) && !buildStep.includes(`\${${arg}}`)) {
      issues.push({
        arg,
        message: `declared in ${DOCKERFILE} but never referenced by the build step — it cannot reach vite, so it does nothing`,
      });
      continue;
    }

    // Link 2: passed by the workflow that builds the deployed image, or stated
    // as an intentional default.
    if (!passed.has(arg) && !INTENTIONALLY_DEFAULTED.has(arg)) {
      issues.push({
        arg,
        message: `not passed by ${IMAGE_BUILD_WORKFLOW} and not listed as intentionally defaulted — the deployed image builds it empty, and no runtime env can switch it on`,
      });
    }
  }

  // Link 3: stale entries in the allowlist are their own drift.
  for (const arg of INTENTIONALLY_DEFAULTED) {
    if (!args.includes(arg)) {
      issues.push({
        arg,
        message: `listed as intentionally defaulted but no longer declared in ${DOCKERFILE} — remove it from INTENTIONALLY_DEFAULTED`,
      });
    }
    if (passed.has(arg)) {
      issues.push({
        arg,
        message: `listed as intentionally defaulted but ${IMAGE_BUILD_WORKFLOW} passes it — the list and the build disagree`,
      });
    }
  }

  if (issues.length > 0) {
    console.error('Vite build-args audit failed:');
    for (const issue of issues) {
      console.error(`- ${issue.arg}: ${issue.message}`);
    }
    return fail(`${String(issues.length)} build-arg issue(s)`);
  }

  const defaulted = args.filter((a) => INTENTIONALLY_DEFAULTED.has(a)).length;
  console.log(
    `Vite build-args audit passed (${String(args.length - 1)} client args: ` +
      `${String(passed.size)} passed by the image build, ${String(defaulted)} intentionally defaulted).`,
  );
  return pass(
    `${String(args.length - 1)} client build args: ${String(passed.size)} passed by the image build, ${String(defaulted)} intentionally defaulted`,
  );
}
