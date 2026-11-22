// main/tools/catalog/names.ts
/**
 * The name prefix rule of the flat `public` schema (restructure plan, section
 * 9.1 item 1): every table, type, sequence, function and view is named
 * `<moduleId>` or `<moduleId>_<entity>` after the source that owns it, and the
 * kernel owns `sys_*`.
 *
 * The legacy baselines keep the names their tables had before the restructure;
 * each module renames its own inside its still-editable baseline when it
 * migrates. Until then the names that break the rule are counted by the
 * `db-legacy-names` ratchet, which may only go down (0 by Phase 16, strict in
 * Phase 20).
 */
import { ATTRIBUTED_KINDS, type AttributedCatalog } from './attribute';
import { KERNEL_SOURCE } from './audit';

/** The prefix the objects of the kernel carry. */
export const KERNEL_PREFIX = 'sys';

/** The prefix the objects of a source carry. */
export function prefixOf(source: string): string {
  return source === KERNEL_SOURCE ? KERNEL_PREFIX : source;
}

/** Whether `name` is `<prefix>` or `<prefix>_<entity>`. A function name may carry its arguments. */
export function carriesPrefix(name: string, source: string): boolean {
  const prefix = prefixOf(source);
  const bare = name.replace(/\(.*$/su, '');
  return bare === prefix || bare.startsWith(`${prefix}_`);
}

export interface LegacyName {
  /** `table`, `type`, `sequence`, `function` or `view`. */
  readonly kind: string;
  readonly name: string;
  readonly source: string;
}

/** The objects whose name does not carry the prefix of their source, in catalog order. */
export function legacyNames(catalog: AttributedCatalog): LegacyName[] {
  return ATTRIBUTED_KINDS.flatMap((kind) =>
    catalog[kind]
      .filter((object) => !carriesPrefix(object.name, object.source))
      .map((object) => ({ kind: kind.slice(0, -1), name: object.name, source: object.source })),
  );
}
