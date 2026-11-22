// main/tools/catalog/rls.test.ts
import { describe, expect, it } from 'vitest';

import { adminSelect, policy, systemAccess, table, userPolicies } from './fixtures';
import { describeTableRls, ownerColumnIsNotNull, rlsClassOf } from './rls';

const ORG = 'sys_current_user_is_org_member(org_id)';

describe('rlsClassOf', () => {
  it('reads the class from the table comment, and nothing else', () => {
    expect(rlsClassOf({ comment: 'rls:owner_org' })).toBe('owner_org');
    expect(rlsClassOf({ comment: 'rls:internal' })).toBe('internal');
    expect(rlsClassOf({ comment: 'rls:everyone' })).toBeNull();
    expect(rlsClassOf({ comment: 'the tasks table' })).toBeNull();
    expect(rlsClassOf({ comment: null })).toBeNull();
  });
});

describe('describeTableRls', () => {
  it('describes an owner_user table that equals its class', () => {
    expect(describeTableRls(table('tasks'))).toEqual({
      rls: {
        class: 'owner_user',
        ownerColumn: 'user_id',
        user: ['select', 'insert', 'update', 'delete'],
        admin: [],
        system: [],
        custom: [],
        definerRead: [],
        audience: false,
      },
      problems: [],
    });
  });

  it('describes per-table command lists: admin and system commands, column grants', () => {
    const described = describeTableRls(
      table('webhooks', {
        comment: 'rls:owner_org',
        columns: ['id uuid NOT NULL', 'org_id uuid NOT NULL', 'url text NOT NULL'],
        policies: [
          adminSelect(),
          ...userPolicies(ORG).filter((entry) => entry.name !== 'rls_user_delete'),
          systemAccess(),
        ],
        grants: ['authenticated: INSERT, SELECT', 'bslt_system: SELECT'],
        columnGrants: ['authenticated: UPDATE (url)'],
      }),
    );

    expect(described.problems).toEqual([]);
    expect(described.rls).toMatchObject({
      class: 'owner_org',
      ownerColumn: 'org_id',
      user: ['select', 'insert', 'update'],
      admin: ['select'],
      system: ['select'],
    });
  });

  it('lists the hand-written policies of a custom table, and its definer read policy', () => {
    const described = describeTableRls(
      table('users', {
        comment: 'rls:custom',
        policies: [
          policy('definer_read_policy', 'SELECT', 'true', null, ['bslt_definer']),
          policy('rls_user_select', 'SELECT', '((id = sys_current_user_id()) OR shared)', null),
        ],
        grants: ['authenticated: SELECT'],
      }),
    );

    expect(described.problems).toEqual([]);
    expect(described.rls).toMatchObject({
      class: 'custom',
      ownerColumn: null,
      user: ['select'],
      custom: ['rls_user_select'],
      definerRead: ['definer_read_policy'],
    });
  });

  it('accepts the audience backstop and public_read, system and internal tables', () => {
    const audience = describeTableRls(
      table('posts', {
        comment: 'rls:public_read',
        policies: [
          policy(
            'rls_audience',
            'SELECT',
            '((user_id = sys_current_user_id()) OR ((audience IS NOT NULL) AND (audience <= sys_max_audience())))',
            null,
            ['PUBLIC'],
            false,
          ),
          policy('rls_user_select', 'SELECT', 'true', null),
        ],
        grants: ['authenticated: SELECT'],
      }),
    );
    expect(audience).toMatchObject({ problems: [], rls: { audience: true, user: ['select'] } });

    expect(
      describeTableRls(
        table('sys_jobs', {
          comment: 'rls:system',
          policies: [systemAccess()],
          grants: ['bslt_system: INSERT, SELECT'],
        }),
      ),
    ).toMatchObject({ problems: [], rls: { class: 'system', system: ['select', 'insert'] } });

    expect(
      describeTableRls(
        table('sys_migrations', {
          comment: 'rls:internal',
          rowSecurity: { enabled: false, forced: false },
          policies: [],
          grants: [],
        }),
      ),
    ).toMatchObject({ problems: [], rls: { class: 'internal' } });
  });

  it('reports a table without a class', () => {
    expect(describeTableRls(table('notes', { comment: null }))).toEqual({
      rls: null,
      problems: ['no row-level security class (comment: null); classify it with sys_apply_rls'],
    });
  });

  it('reports row security that is not forced', () => {
    expect(
      describeTableRls(table('tasks', { rowSecurity: { enabled: true, forced: false } })).problems,
    ).toEqual(['row security is not enabled and forced']);
  });

  it('reports a policy whose text is not the template of the class', () => {
    const wide = userPolicies('(user_id = sys_current_user_id())').map((entry) =>
      entry.name === 'rls_user_select' ? { ...entry, using: 'true' } : entry,
    );

    expect(describeTableRls(table('tasks', { policies: wide })).problems).toEqual([
      'the user policies do not name one owner column the way class owner_user does',
    ]);

    const noCheck = userPolicies('(user_id = sys_current_user_id())').map((entry) =>
      entry.name === 'rls_user_update' ? { ...entry, withCheck: null } : entry,
    );
    expect(describeTableRls(table('tasks', { policies: noCheck })).problems).toEqual([
      'policy rls_user_update is not the template of class owner_user',
    ]);
  });

  it('reports a policy the template does not know, and one to another role', () => {
    const extra = [
      ...userPolicies('(user_id = sys_current_user_id())'),
      policy('legacy_wide', 'ALL', 'true', null),
    ];
    expect(describeTableRls(table('tasks', { policies: extra })).problems).toEqual([
      'policy legacy_wide is not of the template of class owner_user',
    ]);

    const toPublic = userPolicies('(user_id = sys_current_user_id())').map((entry) =>
      entry.name === 'rls_user_select' ? { ...entry, roles: ['PUBLIC'] } : entry,
    );
    expect(describeTableRls(table('tasks', { policies: toPublic })).problems).toEqual([
      'policy rls_user_select is not the template of class owner_user',
    ]);
  });

  it('reports a definer policy that writes, and an admin policy that reads app.role', () => {
    const described = describeTableRls(
      table('users', {
        comment: 'rls:custom',
        policies: [
          policy('definer_write_policy', 'ALL', 'true', 'true', ['bslt_definer']),
          policy(
            'rls_admin_select',
            'SELECT',
            "(current_setting('app.role'::text, true) = 'admin'::text)",
            null,
          ),
        ],
        grants: ['authenticated: SELECT'],
      }),
    );

    expect(described.problems).toEqual([
      'policy definer_write_policy: a policy to bslt_definer is SELECT only (the owner must not write past FORCE)',
      'policy rls_admin_select is not the admin template',
    ]);
  });

  it('reports grants that are not the role matrix', () => {
    expect(
      describeTableRls(
        table('tasks', {
          grants: [
            'PUBLIC: SELECT',
            'authenticated: DELETE, INSERT, SELECT, TRUNCATE, UPDATE',
            'bslt_app: SELECT',
            'bslt_system: SELECT',
          ],
        }),
      ).problems,
    ).toEqual([
      'PUBLIC holds a grant: only the policy targets hold table privileges',
      'authenticated holds TRUNCATE: no runtime role needs it',
      'bslt_app holds a grant: only the policy targets hold table privileges',
      'bslt_system is granted (select) without system_access_policy',
    ]);
  });

  it('reports a grant without a policy and a policy without a grant', () => {
    expect(
      describeTableRls(table('tasks', { grants: ['authenticated: SELECT'] })).problems,
    ).toEqual([
      'authenticated is granted (select) but has policies for (select, insert, update, delete)',
    ]);
    expect(
      describeTableRls(
        table('tasks', {
          policies: [
            policy('rls_user_select', 'SELECT', '(user_id = sys_current_user_id())', null),
            systemAccess(),
          ],
        }),
      ).problems,
    ).toEqual([
      'authenticated is granted (select, insert, update, delete) but has policies for (select)',
      'system_access_policy without a grant to bslt_system',
    ]);
  });

  it('reports commands a class does not allow', () => {
    expect(
      describeTableRls(
        table('audit_events', {
          comment: 'rls:append_only',
          grants: ['authenticated: DELETE, INSERT, SELECT, UPDATE'],
        }),
      ).problems,
    ).toEqual([
      'class append_only allows users no update',
      'class append_only allows users no delete',
    ]);
    expect(
      describeTableRls(
        table('plans', {
          comment: 'rls:public_read',
          policies: [
            policy('rls_user_insert', 'INSERT', null, 'true'),
            policy('rls_user_select', 'SELECT', 'true', null),
          ],
          grants: ['authenticated: INSERT, SELECT'],
        }),
      ).problems,
    ).toEqual(['class public_read allows users no insert']);
  });

  it('reports an internal table with a policy or a grant', () => {
    expect(
      describeTableRls(
        table('sys_migrations', { comment: 'rls:internal', grants: ['bslt_system: SELECT'] }),
      ).problems,
    ).toEqual(['class internal has no policy', 'class internal grants nothing']);
  });
});

describe('ownerColumnIsNotNull', () => {
  it('reads NOT NULL from the column line, not from a default that mentions it', () => {
    const entry = table('tasks', {
      columns: ['user_id uuid NOT NULL', 'org_id uuid', "note text DEFAULT 'NOT NULL'::text"],
    });
    expect(ownerColumnIsNotNull(entry, 'user_id')).toBe(true);
    expect(ownerColumnIsNotNull(entry, 'org_id')).toBe(false);
    expect(ownerColumnIsNotNull(entry, 'missing')).toBe(false);
  });
});
