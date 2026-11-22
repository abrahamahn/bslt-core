// main/tools/catalog/rls.ts
/**
 * The class template of `sys_apply_rls`, restated over the catalog
 * (restructure plan, section 9.4).
 *
 * `describeTableRls` reads what a table's catalog entry says about row-level
 * security (its class, its owner column, the commands each role has) and
 * reports everything that is not the template of that class: a policy with
 * another text, a grant without a policy, a policy without a grant, a grantee
 * the role matrix does not know, row security that is not forced.
 *
 * The role matrix:
 *
 * | Role            | Holds                                                        |
 * | --------------- | ------------------------------------------------------------ |
 * | `authenticated` | exactly the commands of the `rls_user_*` and `rls_admin_*`   |
 * |                 | policies (a command may be granted on columns only)          |
 * | `bslt_system`   | the system commands, and then `system_access_policy`         |
 * | `bslt_definer`  | nothing; it reads through `SELECT` policies written to it    |
 * | anyone else     | nothing (`PUBLIC`, the login roles)                          |
 *
 * The audit (./audit.ts) runs it on the committed catalog; the generated
 * structural test runs it per table on a live database.
 */
import { compareText } from '../snapshot/snapshot-file';

import type { CatalogPolicy, CatalogTable } from './read';

export const RLS_CLASSES = [
  'owner_user',
  'owner_org',
  'public_read',
  'append_only',
  'system',
  'custom',
  'internal',
] as const;
export type RlsClass = (typeof RLS_CLASSES)[number];

/** In the order the template lists them. */
export const RLS_COMMANDS = ['select', 'insert', 'update', 'delete'] as const;
export type RlsCommand = (typeof RLS_COMMANDS)[number];

/** The policy targets (main/server/db/src/roles.ts). */
export const RLS_ROLES = {
  user: 'authenticated',
  system: 'bslt_system',
  definer: 'bslt_definer',
} as const;

/** How Postgres prints the admin predicate `(SELECT sys_current_user_is_platform_admin())`. */
export const ADMIN_PREDICATE =
  '( SELECT sys_current_user_is_platform_admin() AS sys_current_user_is_platform_admin)';

const IDENTIFIER = '[a-z_][a-z0-9_]*';

/** What a table's catalog entry says about row-level security. */
export interface TableRls {
  readonly class: RlsClass;
  /** The owner column of an `owner_user`, `owner_org` or `append_only` table. */
  readonly ownerColumn: string | null;
  /** Commands with an `rls_user_<command>` policy. */
  readonly user: readonly RlsCommand[];
  /** Commands with an `rls_admin_<command>` policy. */
  readonly admin: readonly RlsCommand[];
  /** Commands granted to the system role. */
  readonly system: readonly RlsCommand[];
  /** Policies the owner's migration wrote by hand (class `custom` only), sorted. */
  readonly custom: readonly string[];
  /** `SELECT` policies written to the definer role alone, sorted. */
  readonly definerRead: readonly string[];
  /** Whether `sys_apply_audience` added its restrictive policy. */
  readonly audience: boolean;
}

/** The class a table comment names, or null. */
export function rlsClassOf(table: Pick<CatalogTable, 'comment'>): RlsClass | null {
  const named = /^rls:([a-z_]+)$/u.exec(table.comment ?? '')?.[1];
  return (RLS_CLASSES as readonly string[]).includes(named ?? '') ? (named as RlsClass) : null;
}

const inTemplateOrder = (commands: Iterable<RlsCommand>): RlsCommand[] => {
  const present = new Set(commands);
  return RLS_COMMANDS.filter((command) => present.has(command));
};

/** The user predicate of a class as Postgres prints it. */
function userPredicate(rlsClass: RlsClass, ownerColumn: string | null): string | null {
  if (rlsClass === 'public_read') return 'true';
  if (ownerColumn === null) return null;
  if (rlsClass === 'owner_user' || rlsClass === 'append_only') {
    return `(${ownerColumn} = sys_current_user_id())`;
  }
  if (rlsClass === 'owner_org') return `sys_current_user_is_org_member(${ownerColumn})`;
  return null;
}

/** The owner column a user predicate names, or null when it is not one of the template. */
function ownerColumnOf(rlsClass: RlsClass, expression: string): string | null {
  const pattern =
    rlsClass === 'owner_org'
      ? new RegExp(`^sys_current_user_is_org_member\\((${IDENTIFIER})\\)$`, 'u')
      : new RegExp(`^\\((${IDENTIFIER}) = sys_current_user_id\\(\\)\\)$`, 'u');
  return pattern.exec(expression)?.[1] ?? null;
}

/** One policy of the template: `USING` for what a command reads, `WITH CHECK` for what it writes. */
function templatePolicy(
  name: string,
  command: RlsCommand,
  role: string,
  predicate: string,
): CatalogPolicy {
  return {
    name,
    command: command.toUpperCase() as CatalogPolicy['command'],
    permissive: true,
    roles: [role],
    using: command === 'insert' ? null : predicate,
    withCheck: command === 'insert' || command === 'update' ? predicate : null,
  };
}

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

function grantsOf(lines: readonly string[]): Map<string, string[]> {
  const grants = new Map<string, string[]>();
  for (const line of lines) {
    const separator = line.indexOf(': ');
    const grantee = line.slice(0, separator);
    grants.set(grantee, [...(grants.get(grantee) ?? []), ...line.slice(separator + 2).split(', ')]);
  }
  return grants;
}

/** `<grantee>: <privilege> (<columns>)` lines as privileges per grantee. */
function columnGrantsOf(lines: readonly string[]): Map<string, string[]> {
  const grants = new Map<string, string[]>();
  for (const line of lines) {
    const match = /^(.+?): (.+) \(.*\)$/u.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    grants.set(match[1], [...(grants.get(match[1]) ?? []), match[2]]);
  }
  return grants;
}

const asCommands = (privileges: readonly string[]): RlsCommand[] =>
  inTemplateOrder(
    privileges
      .map((privilege) => privilege.toLowerCase())
      .filter((privilege): privilege is RlsCommand =>
        (RLS_COMMANDS as readonly string[]).includes(privilege),
      ),
  );

export interface TableRlsDescription {
  /** Null when the table has no known class. */
  readonly rls: TableRls | null;
  /** Everything that is not the template of the class; empty when the table equals it. */
  readonly problems: readonly string[];
}

/**
 * Describe the row-level security of a table and check it against the template
 * of its class.
 */
export function describeTableRls(table: CatalogTable): TableRlsDescription {
  const rlsClass = rlsClassOf(table);
  if (rlsClass === null) {
    return {
      rls: null,
      problems: [
        `no row-level security class (comment: ${JSON.stringify(table.comment)}); classify it with sys_apply_rls`,
      ],
    };
  }

  const problems: string[] = [];
  const tableGrants = grantsOf(table.grants);
  const columnGrants = columnGrantsOf(table.columnGrants);
  const columns = new Map(
    table.columns.map((line) => [line.slice(0, line.indexOf(' ')), line] as const),
  );

  if (rlsClass === 'internal') {
    // The migrator's own bookkeeping: forcing it would bind the migrator.
    if (table.policies.length > 0) problems.push('class internal has no policy');
    if (table.grants.length > 0 || table.columnGrants.length > 0) {
      problems.push('class internal grants nothing');
    }
    return {
      rls: {
        class: rlsClass,
        ownerColumn: null,
        user: [],
        admin: [],
        system: [],
        custom: [],
        definerRead: [],
        audience: false,
      },
      problems,
    };
  }

  if (!table.rowSecurity.enabled || !table.rowSecurity.forced) {
    problems.push('row security is not enabled and forced');
  }

  const user = new Map<RlsCommand, CatalogPolicy>();
  const admin = new Map<RlsCommand, CatalogPolicy>();
  const custom: string[] = [];
  const definerRead: string[] = [];
  let systemPolicy: CatalogPolicy | undefined;
  let audiencePolicy: CatalogPolicy | undefined;

  for (const policy of table.policies) {
    const templated = /^rls_(user|admin)_(select|insert|update|delete)$/u.exec(policy.name);
    if (templated !== null) {
      const command = templated[2] as RlsCommand;
      (templated[1] === 'user' ? user : admin).set(command, policy);
    } else if (policy.name === 'system_access_policy') {
      systemPolicy = policy;
    } else if (policy.name === 'rls_audience') {
      audiencePolicy = policy;
    } else if (same(policy.roles, [RLS_ROLES.definer])) {
      definerRead.push(policy.name);
      if (policy.command !== 'SELECT') {
        problems.push(
          `policy ${policy.name}: a policy to ${RLS_ROLES.definer} is SELECT only (the owner must not write past FORCE)`,
        );
      }
    } else if (rlsClass === 'custom') {
      custom.push(policy.name);
    } else {
      problems.push(`policy ${policy.name} is not of the template of class ${rlsClass}`);
    }
  }

  // --- User policies ---------------------------------------------------------
  let ownerColumn: string | null = null;
  if (rlsClass === 'custom') {
    custom.push(...[...user.values()].map((policy) => policy.name));
    for (const policy of user.values()) {
      const command = policy.name.slice('rls_user_'.length);
      if (
        policy.command !== command.toUpperCase() ||
        !policy.permissive ||
        !same(policy.roles, [RLS_ROLES.user])
      ) {
        problems.push(
          `policy ${policy.name} is not a permissive ${command.toUpperCase()} policy to ${RLS_ROLES.user}`,
        );
      }
    }
  } else {
    const allowed: readonly RlsCommand[] =
      rlsClass === 'system'
        ? []
        : rlsClass === 'public_read'
          ? ['select']
          : rlsClass === 'append_only'
            ? ['select', 'insert']
            : RLS_COMMANDS;
    for (const command of inTemplateOrder(user.keys())) {
      if (!allowed.includes(command)) {
        problems.push(`class ${rlsClass} allows users no ${command}`);
      }
    }
    if (rlsClass !== 'public_read' && rlsClass !== 'system') {
      const named = new Set<string | null>();
      for (const policy of user.values()) {
        const expression = policy.using ?? policy.withCheck ?? '';
        named.add(ownerColumnOf(rlsClass, expression));
      }
      if (named.size === 1) [ownerColumn] = [...named] as [string | null];
      if (user.size > 0 && (named.size !== 1 || ownerColumn === null)) {
        problems.push(
          `the user policies do not name one owner column the way class ${rlsClass} does`,
        );
        ownerColumn = null;
      }
      if (ownerColumn !== null && !columns.has(ownerColumn)) {
        problems.push(`the owner column ${ownerColumn} is not a column of the table`);
      }
    }
    const predicate = userPredicate(rlsClass, ownerColumn);
    if (predicate !== null) {
      for (const [command, policy] of user) {
        const expected = templatePolicy(policy.name, command, RLS_ROLES.user, predicate);
        if (!same(policy, expected)) {
          problems.push(`policy ${policy.name} is not the template of class ${rlsClass}`);
        }
      }
    }
  }

  // --- Admin, system, audience ----------------------------------------------
  for (const [command, policy] of admin) {
    if (!same(policy, templatePolicy(policy.name, command, RLS_ROLES.user, ADMIN_PREDICATE))) {
      problems.push(`policy ${policy.name} is not the admin template`);
    }
    if (rlsClass === 'append_only' && command !== 'select' && command !== 'insert') {
      problems.push(`class append_only allows admins no ${command}`);
    }
  }
  if (
    systemPolicy !== undefined &&
    !same(systemPolicy, {
      name: 'system_access_policy',
      command: 'ALL',
      permissive: true,
      roles: [RLS_ROLES.system],
      using: 'true',
      withCheck: 'true',
    })
  ) {
    problems.push('policy system_access_policy is not the system template');
  }
  if (audiencePolicy !== undefined) {
    const shape = new RegExp(
      `^\\(\\(${IDENTIFIER} = sys_current_user_id\\(\\)\\) OR \\(\\((${IDENTIFIER}) IS NOT NULL\\) AND \\(\\1 <= sys_max_audience\\(\\)\\)\\)\\)$`,
      'u',
    );
    if (
      audiencePolicy.command !== 'SELECT' ||
      audiencePolicy.permissive ||
      !same(audiencePolicy.roles, ['PUBLIC']) ||
      !shape.test(audiencePolicy.using ?? '')
    ) {
      problems.push('policy rls_audience is not the one sys_apply_audience writes');
    }
  }

  // --- Grants: the role matrix ----------------------------------------------
  for (const grantee of new Set([...tableGrants.keys(), ...columnGrants.keys()])) {
    if (grantee !== RLS_ROLES.user && grantee !== RLS_ROLES.system) {
      problems.push(`${grantee} holds a grant: only the policy targets hold table privileges`);
    }
    const privileges = [...(tableGrants.get(grantee) ?? []), ...(columnGrants.get(grantee) ?? [])];
    for (const privilege of privileges) {
      if (!(RLS_COMMANDS as readonly string[]).includes(privilege.toLowerCase())) {
        problems.push(`${grantee} holds ${privilege}: no runtime role needs it`);
      }
    }
  }
  const userGranted = asCommands([
    ...(tableGrants.get(RLS_ROLES.user) ?? []),
    ...(columnGrants.get(RLS_ROLES.user) ?? []),
  ]);
  const userPolicied =
    rlsClass === 'custom'
      ? inTemplateOrder(
          table.policies
            .filter((policy) => policy.roles.includes(RLS_ROLES.user) && policy.command !== 'ALL')
            .map((policy) => policy.command.toLowerCase() as RlsCommand),
        )
      : inTemplateOrder([...user.keys(), ...admin.keys()]);
  if (!same(userGranted, userPolicied)) {
    problems.push(
      `${RLS_ROLES.user} is granted (${userGranted.join(', ')}) but has policies for (${userPolicied.join(', ')})`,
    );
  }
  if ((columnGrants.get(RLS_ROLES.system) ?? []).length > 0) {
    problems.push(`${RLS_ROLES.system} holds a column grant: its commands are table grants`);
  }
  const system = asCommands(tableGrants.get(RLS_ROLES.system) ?? []);
  if (system.length > 0 !== (systemPolicy !== undefined)) {
    problems.push(
      system.length > 0
        ? `${RLS_ROLES.system} is granted (${system.join(', ')}) without system_access_policy`
        : `system_access_policy without a grant to ${RLS_ROLES.system}`,
    );
  }

  return {
    rls: {
      class: rlsClass,
      ownerColumn,
      user: inTemplateOrder(user.keys()),
      admin: inTemplateOrder(admin.keys()),
      system,
      custom: custom.sort(compareText),
      definerRead: definerRead.sort(compareText),
      audience: audiencePolicy !== undefined,
    },
    problems,
  };
}

/** Whether the owner column of a table is `NOT NULL` (plan 9.2). */
export function ownerColumnIsNotNull(table: CatalogTable, ownerColumn: string): boolean {
  const line = table.columns.find((column) => column.startsWith(`${ownerColumn} `));
  return line !== undefined && / NOT NULL( |$)/u.test(line);
}
