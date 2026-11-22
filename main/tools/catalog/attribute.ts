// main/tools/catalog/attribute.ts
/**
 * Catalog attribution, computed and not parsed (restructure plan, section 9.1
 * item 3).
 *
 * `bslt db catalog` applies the migration sources one at a time and reads the
 * catalog after each. This module turns those readings into the committed
 * catalog: every type, sequence, function, table and view carries the id of the
 * source that created it. Because a source is applied in exactly one step, an
 * object that an earlier source created and that looks different, or is gone,
 * after a later step was altered or dropped by that later source: the
 * cross-module ALTER the old migration chain was full of. That is a problem,
 * and so is an object that was there before any source ran.
 *
 * A table is attributed as a whole: its columns, constraints, indexes,
 * policies, triggers, grants and comment belong to the source of the table,
 * since no other source may change them.
 *
 * Roles, extensions and schemas belong to the cluster and the database, not to
 * a source; they are recorded as the last step left them.
 */
import { compareText } from '../snapshot/snapshot-file';

import type {
  CatalogFunction,
  CatalogRole,
  CatalogSchema,
  CatalogSequence,
  CatalogTable,
  CatalogType,
  CatalogView,
  DbCatalog,
} from './read';

/** A migration source as the catalog records it. */
export interface CatalogSource {
  readonly id: string;
  /** The sources whose objects its files may reference (the kernel always). */
  readonly dependsOn: readonly string[];
}

/** The catalog as it was after one source was applied. */
export interface CatalogStep {
  readonly source: string;
  readonly catalog: DbCatalog;
}

export type Attributed<T> = T & {
  /** The id of the migration source that created the object. */
  readonly source: string;
};

/** The committed catalog: the final catalog with every object attributed. */
export interface AttributedCatalog {
  /** The migration sources, in the order they were applied. */
  readonly sources: readonly CatalogSource[];
  readonly roles: readonly CatalogRole[];
  readonly extensions: readonly string[];
  readonly schemas: readonly CatalogSchema[];
  readonly types: ReadonlyArray<Attributed<CatalogType>>;
  readonly sequences: ReadonlyArray<Attributed<CatalogSequence>>;
  readonly functions: ReadonlyArray<Attributed<CatalogFunction>>;
  readonly tables: ReadonlyArray<Attributed<CatalogTable>>;
  readonly views: ReadonlyArray<Attributed<CatalogView>>;
}

/** The attributed kinds, in the order the catalog lists them. */
export const ATTRIBUTED_KINDS = ['types', 'sequences', 'functions', 'tables', 'views'] as const;
export type AttributedKind = (typeof ATTRIBUTED_KINDS)[number];

const KIND_LABELS: Readonly<Record<AttributedKind, string>> = {
  types: 'type',
  sequences: 'sequence',
  functions: 'function',
  tables: 'table',
  views: 'view',
};

interface Named {
  readonly schema: string;
  readonly name: string;
}

/** `<schema>.<name>` of a catalog object. */
export function qualifiedName(object: Named): string {
  return `${object.schema}.${object.name}`;
}

/** The properties of an object that differ between two readings, sorted. */
function changedFacets(before: Named, after: Named): string[] {
  const left = before as unknown as Readonly<Record<string, unknown>>;
  const right = after as unknown as Readonly<Record<string, unknown>>;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]))
    .sort(compareText);
}

export interface AttributionInput {
  /** The catalog before any source ran: it must hold no attributable object. */
  readonly initial: DbCatalog;
  /** One reading per source, in the order the sources were applied. */
  readonly steps: readonly CatalogStep[];
  /** The sources that were applied, in the same order. */
  readonly sources: readonly CatalogSource[];
}

export interface AttributionResult {
  readonly catalog: AttributedCatalog;
  /** Why the sources do not own what they touch; empty when they do. */
  readonly problems: readonly string[];
}

/**
 * Attribute every object of the last reading to the source that created it.
 *
 * @throws {Error} When the steps and the sources do not name the same ids in
 *   the same order, or there is no step (the caller's mistake, not a finding).
 */
export function attributeCatalog({ initial, steps, sources }: AttributionInput): AttributionResult {
  const stepIds = steps.map((step) => step.source);
  const sourceIds = sources.map((source) => source.id);
  if (JSON.stringify(stepIds) !== JSON.stringify(sourceIds)) {
    throw new Error(
      `catalog attribution: the steps (${stepIds.join(', ')}) are not the sources (${sourceIds.join(', ')})`,
    );
  }
  const last = steps.at(-1);
  if (last === undefined) throw new Error('catalog attribution: no source was applied');

  const problems: string[] = [];
  const owners: Record<AttributedKind, Map<string, string>> = {
    types: new Map(),
    sequences: new Map(),
    functions: new Map(),
    tables: new Map(),
    views: new Map(),
  };

  for (const kind of ATTRIBUTED_KINDS) {
    for (const object of initial[kind]) {
      problems.push(
        `${KIND_LABELS[kind]} ${qualifiedName(object)} exists before any source ran: it is unattributed (the scratch database was not empty)`,
      );
    }
  }

  let previous = initial;
  for (const step of steps) {
    for (const kind of ATTRIBUTED_KINDS) {
      const before = new Map<string, Named>(
        previous[kind].map((object) => [qualifiedName(object), object]),
      );
      const after = new Map<string, Named>(
        step.catalog[kind].map((object) => [qualifiedName(object), object]),
      );
      for (const [name, object] of after) {
        const earlier = before.get(name);
        if (earlier === undefined) {
          owners[kind].set(name, step.source);
          continue;
        }
        const facets = changedFacets(earlier, object);
        if (facets.length > 0) {
          problems.push(
            `${step.source} alters ${KIND_LABELS[kind]} ${name}, which ${owners[kind].get(name) ?? 'no source'} created (${facets.join(', ')}): a source changes only its own objects`,
          );
        }
      }
      for (const name of before.keys()) {
        if (!after.has(name)) {
          problems.push(
            `${step.source} drops ${KIND_LABELS[kind]} ${name}, which ${owners[kind].get(name) ?? 'no source'} created: a source drops only its own objects`,
          );
        }
      }
    }
    previous = step.catalog;
  }

  const attributed = <T extends Named>(
    kind: AttributedKind,
    objects: readonly T[],
  ): Attributed<T>[] =>
    objects.map((object) => {
      const { schema, name, ...rest } = object;
      // `source` right after the name, so it reads as part of the identity.
      return {
        schema,
        name,
        source: owners[kind].get(qualifiedName(object)) ?? '',
        ...rest,
      } as unknown as Attributed<T>;
    });

  return {
    catalog: {
      sources: sources.map((source) => ({
        id: source.id,
        dependsOn: [...source.dependsOn].sort(compareText),
      })),
      roles: last.catalog.roles,
      extensions: last.catalog.extensions,
      schemas: last.catalog.schemas,
      types: attributed('types', last.catalog.types),
      sequences: attributed('sequences', last.catalog.sequences),
      functions: attributed('functions', last.catalog.functions),
      tables: attributed('tables', last.catalog.tables),
      views: attributed('views', last.catalog.views),
    },
    problems,
  };
}

/** The catalog without its attribution: what a database built in one go holds. */
export function withoutAttribution(catalog: AttributedCatalog): DbCatalog {
  const plain = <T extends Named>(objects: ReadonlyArray<Attributed<T>>): T[] =>
    objects.map((object) => {
      const { source: _source, ...rest } = object;
      return rest as unknown as T;
    });
  return {
    roles: catalog.roles,
    extensions: catalog.extensions,
    schemas: catalog.schemas,
    types: plain<CatalogType>(catalog.types),
    sequences: plain<CatalogSequence>(catalog.sequences),
    functions: plain<CatalogFunction>(catalog.functions),
    tables: plain<CatalogTable>(catalog.tables),
    views: plain<CatalogView>(catalog.views),
  };
}
