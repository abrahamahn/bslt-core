// main/kernel/contract/src/module.ts
import { describe, type Schema, type SchemaNode } from '@bslt/schema';

import { lookupErrorCode } from './errors';

import type { Endpoint } from './endpoint';
import type { EventDef } from './event';
import type { JobDef } from './job';

export type ModuleId = string;

export interface FlagDef {
  readonly default: boolean;
  readonly summary: string;
}

export interface CspNeeds {
  readonly 'connect-src'?: readonly string[];
  readonly 'img-src'?: readonly string[];
  readonly 'media-src'?: readonly string[];
  readonly 'frame-src'?: readonly string[];
  readonly 'worker-src'?: readonly string[];
}

export interface ModuleDefinition<
  Id extends ModuleId = ModuleId,
  C extends Readonly<Record<string, Endpoint>> = Readonly<Record<string, Endpoint>>,
  E extends Readonly<Record<string, EventDef>> = Readonly<Record<string, EventDef>>,
  J extends Readonly<Record<string, JobDef>> = Readonly<Record<string, JobDef>>,
> {
  readonly id: Id;
  readonly summary: string;
  readonly status: 'stable' | 'beta' | 'experimental';
  readonly dependsOn: readonly ModuleDefinition[];
  readonly endpoints: C;
  readonly events: E;
  readonly jobs: J;
  readonly tables: readonly (Id | `${Id}_${string}`)[];
  readonly web?: false;
  readonly permissions?: readonly `${Id}.${string}`[];
  readonly flags?: Readonly<Record<`${Id}.${string}`, FlagDef>>;
  readonly entitlements?: readonly `${Id}.${string}`[];
  readonly env?: Schema;
  readonly csp?: CspNeeds;
}

export const PROJECTION_MODULE_IDS = ['audit', 'notifications', 'webhooks', 'analytics'] as const;

const PROJECTION_SET: ReadonlySet<string> = new Set<string>(PROJECTION_MODULE_IDS);
const MODULE_ID_PATTERN = /^[a-z][a-z0-9]*$/;
const TABLE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const ALLOWED_CSP_DIRECTIVES: ReadonlySet<string> = new Set<string>([
  'connect-src',
  'img-src',
  'media-src',
  'frame-src',
  'worker-src',
]);
const FORBIDDEN_CSP_SOURCES: ReadonlySet<string> = new Set<string>([
  '*',
  "'unsafe-inline'",
  "'unsafe-eval'",
  "'wasm-unsafe-eval'",
  "'unsafe-hashes'",
]);

function isObjectSchemaNode(node: SchemaNode): boolean {
  if (node.kind === 'object') return true;
  if (node.kind === 'refine') return isObjectSchemaNode(node.inner);
  return false;
}

export function validateModule(mod: ModuleDefinition): void {
  if (!MODULE_ID_PATTERN.test(mod.id)) {
    throw new Error(
      `Invalid module id "${mod.id}": expected lowercase alphanumeric matching /^[a-z][a-z0-9]*$/`,
    );
  }
  if (mod.summary.trim().length === 0) {
    throw new Error(`Module "${mod.id}" must declare a non-empty summary`);
  }

  for (const dep of mod.dependsOn) {
    if (PROJECTION_SET.has(dep.id)) {
      throw new Error(
        `Module "${mod.id}" cannot list projection module "${dep.id}" in dependsOn (projections subscribe via event metadata)`,
      );
    }
  }

  const tableSeen = new Set<string>();
  for (const tbl of mod.tables) {
    if (!TABLE_NAME_PATTERN.test(tbl) || (tbl !== mod.id && !tbl.startsWith(`${mod.id}_`))) {
      throw new Error(
        `Module "${mod.id}" declares invalid table "${tbl}": must equal "${mod.id}" or start with "${mod.id}_"`,
      );
    }
    if (tableSeen.has(tbl)) {
      throw new Error(`Module "${mod.id}" declares duplicate table "${tbl}"`);
    }
    tableSeen.add(tbl);
  }

  const endpointKeys = new Set(Object.keys(mod.endpoints));
  for (const [epKey, ep] of Object.entries(mod.endpoints)) {
    for (const errCode of ep.errors ?? []) {
      if (!errCode.startsWith(`${mod.id}.`)) {
        throw new Error(
          `Module "${mod.id}" endpoint "${epKey}" declares foreign error code "${errCode}" (expected "${mod.id}.*")`,
        );
      }
      if (lookupErrorCode(errCode) === undefined) {
        throw new Error(
          `Module "${mod.id}" endpoint "${epKey}" declares unregistered error code "${errCode}"`,
        );
      }
    }
    for (const sibling of ep.invalidates ?? []) {
      if (!endpointKeys.has(sibling)) {
        throw new Error(
          `Module "${mod.id}" endpoint "${epKey}" invalidates unknown sibling endpoint "${sibling}"`,
        );
      }
    }
  }

  for (const [eventKey, ev] of Object.entries(mod.events)) {
    if (!ev.name.startsWith(`${mod.id}.`)) {
      throw new Error(
        `Module "${mod.id}" event "${eventKey}" ("${ev.name}") must start with "${mod.id}."`,
      );
    }
  }

  for (const [jobKey, jb] of Object.entries(mod.jobs)) {
    if (!jb.name.startsWith(`${mod.id}.`)) {
      throw new Error(
        `Module "${mod.id}" job "${jobKey}" ("${jb.name}") must start with "${mod.id}."`,
      );
    }
  }

  for (const perm of mod.permissions ?? []) {
    if (!perm.startsWith(`${mod.id}.`)) {
      throw new Error(`Module "${mod.id}" permission "${perm}" must start with "${mod.id}."`);
    }
  }

  if (mod.flags !== undefined) {
    for (const flagKey of Object.keys(mod.flags)) {
      if (!flagKey.startsWith(`${mod.id}.`)) {
        throw new Error(`Module "${mod.id}" flag "${flagKey}" must start with "${mod.id}."`);
      }
    }
  }

  for (const ent of mod.entitlements ?? []) {
    if (!ent.startsWith(`${mod.id}.`)) {
      throw new Error(`Module "${mod.id}" entitlement "${ent}" must start with "${mod.id}."`);
    }
  }

  if (mod.env !== undefined && !isObjectSchemaNode(describe(mod.env))) {
    throw new Error(`Module "${mod.id}" env schema must be an object() schema`);
  }

  if (mod.csp !== undefined) {
    for (const [directive, sources] of Object.entries(mod.csp) as Array<
      [string, readonly string[] | undefined]
    >) {
      if (!ALLOWED_CSP_DIRECTIVES.has(directive)) {
        throw new Error(`Module "${mod.id}" declares unsupported CSP directive "${directive}"`);
      }
      for (const src of sources ?? []) {
        if (src.length === 0) {
          throw new Error(`Module "${mod.id}" declares empty CSP source in "${directive}"`);
        }
        if (/[\s;]/u.test(src)) {
          throw new Error(
            `Module "${mod.id}" CSP source "${src}" in "${directive}" must not contain whitespace or semicolons`,
          );
        }
        if (FORBIDDEN_CSP_SOURCES.has(src.toLowerCase())) {
          throw new Error(
            `Module "${mod.id}" CSP source "${src}" in "${directive}" is unsafe or wildcard`,
          );
        }
      }
    }
  }
}

export function mergeModuleCspNeeds(
  base: Readonly<Record<string, string>>,
  modules: readonly ModuleDefinition[],
): Record<string, string> {
  const merged: Record<string, string[]> = {};
  for (const [directive, rawValue] of Object.entries(base)) {
    merged[directive] = rawValue.split(/\s+/u).filter((token) => token.length > 0);
  }

  for (const mod of modules) {
    if (mod.csp === undefined) continue;
    validateModule(mod);
    for (const [directive, sources] of Object.entries(mod.csp) as Array<
      [string, readonly string[] | undefined]
    >) {
      if (sources === undefined || sources.length === 0) continue;
      const list = (merged[directive] ??= []);
      for (const src of sources) {
        if (!list.includes(src)) {
          list.push(src);
        }
      }
    }
  }

  const out: Record<string, string> = {};
  for (const [directive, tokens] of Object.entries(merged)) {
    out[directive] = tokens.join(' ');
  }
  return out;
}

export function validateModules(modules: readonly ModuleDefinition[]): void {
  const installedIds = new Set<string>();
  for (const mod of modules) {
    if (installedIds.has(mod.id)) {
      throw new Error(`Duplicate module id "${mod.id}" in installedModules`);
    }
    installedIds.add(mod.id);
  }

  const seenInOrder = new Set<string>();
  const globalTables = new Map<string, string>();

  for (const mod of modules) {
    validateModule(mod);

    for (const dep of mod.dependsOn) {
      if (!installedIds.has(dep.id)) {
        throw new Error(
          `Module "${mod.id}" dependsOn "${dep.id}", which is not installed in installedModules`,
        );
      }
      if (!seenInOrder.has(dep.id)) {
        throw new Error(
          `Module "${mod.id}" dependsOn "${dep.id}", which appears later (or forms a cycle): installedModules must be in topological order`,
        );
      }
    }

    for (const tbl of mod.tables) {
      const owner = globalTables.get(tbl);
      if (owner !== undefined) {
        throw new Error(`Table "${tbl}" is claimed by both "${owner}" and "${mod.id}"`);
      }
      globalTables.set(tbl, mod.id);
    }

    seenInOrder.add(mod.id);
  }
}

export function defineModule<const M extends ModuleDefinition>(mod: M): M {
  validateModule(mod);
  return Object.freeze(mod);
}

export interface BsltConfig<Ms extends readonly ModuleDefinition[] = readonly ModuleDefinition[]> {
  readonly name: string;
  readonly installedModules: Ms;
  readonly devOnly: readonly ModuleDefinition[];
  readonly locales: readonly ['en-US'];
  readonly brand: {
    readonly accent: string;
    readonly logo: string;
  };
}

export function defineConfig<const C extends BsltConfig>(cfg: C): C {
  validateModules(cfg.installedModules);
  validateModules([...cfg.installedModules, ...cfg.devOnly]);
  return cfg;
}
