// main/kernel/web/src/web-module.ts
/**
 * Web module binding (`implementWeb`, `WebImpls`), lazy page descriptor
 * (`lazyModulePage`), and module-scoped `en-US` message lookup (`useModuleMessages`).
 */

import { useCallback, type ComponentType } from 'react';

import type { Auth, BsltConfig, ModuleDefinition, Requirement } from '@bslt/contract';

export type ShellName = 'public' | 'auth' | 'app' | 'console';

export type NavSlot = 'app.primary' | 'app.settings' | 'console.primary' | 'palette' | 'dashboard';

export type SiteSectionId = 'product' | 'legal' | 'support';

export interface LazyPageDescriptor {
  readonly pageName: string;
  readonly load: () => Promise<ComponentType>;
  readonly eager?: ComponentType | undefined;
}

/**
 * Bind an already-loaded lightweight route stub synchronously without Suspense chunk delay.
 */
export function eagerModulePage(component: ComponentType, name: string): LazyPageDescriptor {
  if (typeof component !== 'function') {
    throw new Error(`Eager page "${name}" is not a React component function`);
  }
  if (name.trim().length === 0) {
    throw new Error('Eager page pageName must not be empty');
  }
  return {
    pageName: name,
    eager: component,
    load: () => Promise.resolve(component),
  };
}

/**
 * Code-split a module page by its named export without coupling the module to app-internal helpers.
 */
export function lazyModulePage<M extends Record<string, unknown>>(
  load: () => Promise<M>,
  name: keyof M & string,
): LazyPageDescriptor {
  return {
    pageName: name,
    load: async () => {
      const mod = await load();
      const candidate = mod[name];
      if (typeof candidate !== 'function') {
        throw new Error(`Lazy page export "${name}" is not a React component function`);
      }
      return candidate as ComponentType;
    },
  };
}

export interface WebRoute {
  readonly path: `/${string}`;
  readonly shell: ShellName;
  readonly standalone?: true;
  readonly auth: Auth;
  readonly publicOnly?: true;
  readonly requires?: readonly Requirement[];
  readonly page: LazyPageDescriptor;
  readonly fallbackPage?: LazyPageDescriptor;
  readonly adminSurface?: string;
  readonly title: string;
  readonly unlisted?: true;
}

export interface WebNavItem {
  readonly id?: string;
  readonly to: `/${string}`;
  readonly slot: NavSlot;
  readonly audience?: 'public' | 'authenticated' | 'admin';
  readonly requires?: readonly Requirement[];
  readonly label: string;
  readonly hint?: string;
  readonly description?: string;
  readonly actionLabel?: string;
  readonly keywords?: readonly string[];
  readonly icon: string;
  readonly order: number;
}

export interface ModuleSettingsSection {
  readonly id: string;
  readonly label: string;
  readonly kind: 'modal' | 'route';
  readonly to?: `/${string}`;
  readonly aliases?: readonly string[];
  readonly requires?: readonly Requirement[];
  readonly order: number;
}

export interface ModuleAdminSurface {
  readonly id: string;
  readonly label: string;
  readonly href: `/admin${string}`;
  readonly routePath: string;
  readonly unlisted?: true;
  readonly requires?: readonly Requirement[];
  readonly order: number;
}

export interface ModuleSitePage {
  readonly path: `/${string}`;
  readonly title: string;
  readonly description?: string;
  readonly section: SiteSectionId;
  readonly document?: string;
  readonly live: boolean;
  readonly order: number;
}

export type NotificationRouteResolver = (
  data: Readonly<Record<string, unknown>>,
) => `/${string}` | null;

export interface ModuleNotificationRouteRule {
  readonly field: 'actionPrefix' | 'notificationType' | 'notificationTypePrefix';
  readonly match: string;
  readonly to: `/${string}`;
}

export interface WebModule<M extends ModuleDefinition = ModuleDefinition> {
  readonly module: M;
  readonly routes: readonly WebRoute[];
  readonly nav?: readonly WebNavItem[];
  readonly settings?: readonly ModuleSettingsSection[];
  readonly admin?: readonly ModuleAdminSurface[];
  readonly sitePages?: readonly ModuleSitePage[];
  readonly notificationRoutes?: Readonly<Record<string, NotificationRouteResolver>>;
  readonly notificationRules?: readonly ModuleNotificationRouteRule[];
  readonly messages: Readonly<Record<string, string>>;
}

function assertNamespacedMessageKey(
  moduleId: string,
  messages: Readonly<Record<string, string>>,
  key: string,
  field: string,
): void {
  const prefix = `${moduleId}.`;
  if (!key.startsWith(prefix)) {
    throw new Error(
      `Module "${moduleId}" ${field} message key "${key}" must start with "${prefix}"`,
    );
  }
  if (!Object.hasOwn(messages, key)) {
    throw new Error(`Module "${moduleId}" ${field} references missing message key "${key}"`);
  }
}

/**
 * Bind a module manifest to its web routes, navigation items, settings sections,
 * admin surfaces, public site-map pages, notification routes, and `en-US` messages.
 */
export function implementWeb<M extends ModuleDefinition>(
  module: M,
  impl: Omit<WebModule<M>, 'module'>,
): WebModule<M> {
  const prefix = `${module.id}.`;

  for (const key of Object.keys(impl.messages)) {
    if (!key.startsWith(prefix)) {
      throw new Error(`Module "${module.id}" message key "${key}" must start with "${prefix}"`);
    }
  }

  for (const route of impl.routes) {
    if (!route.path.startsWith('/') || route.path.length === 0) {
      throw new Error(`Module "${module.id}" route path "${route.path}" must start with "/"`);
    }
    assertNamespacedMessageKey(module.id, impl.messages, route.title, 'route title');
  }

  if (impl.nav !== undefined) {
    for (const item of impl.nav) {
      if (!item.to.startsWith('/') || item.to.length === 0) {
        throw new Error(`Module "${module.id}" nav target "${item.to}" must start with "/"`);
      }
      assertNamespacedMessageKey(module.id, impl.messages, item.label, 'nav label');
      if (item.hint !== undefined) {
        assertNamespacedMessageKey(module.id, impl.messages, item.hint, 'nav hint');
      }
      if (item.description !== undefined) {
        assertNamespacedMessageKey(module.id, impl.messages, item.description, 'nav description');
      }
      if (item.actionLabel !== undefined) {
        assertNamespacedMessageKey(module.id, impl.messages, item.actionLabel, 'nav actionLabel');
      }
    }
  }

  if (impl.settings !== undefined) {
    for (const section of impl.settings) {
      if (section.id.trim().length === 0) {
        throw new Error(`Module "${module.id}" settings section id must not be empty`);
      }
      if (section.kind === 'route' && (section.to === undefined || !section.to.startsWith('/'))) {
        throw new Error(
          `Module "${module.id}" route settings section "${section.id}" must declare a "/" target`,
        );
      }
      assertNamespacedMessageKey(module.id, impl.messages, section.label, 'settings label');
    }
  }

  if (impl.admin !== undefined) {
    for (const surface of impl.admin) {
      if (surface.id.trim().length === 0) {
        throw new Error(`Module "${module.id}" admin surface id must not be empty`);
      }
      if (!surface.href.startsWith('/admin')) {
        throw new Error(
          `Module "${module.id}" admin surface "${surface.id}" href "${surface.href}" must start with "/admin"`,
        );
      }
      assertNamespacedMessageKey(module.id, impl.messages, surface.label, 'admin label');
    }
  }

  if (impl.sitePages !== undefined) {
    for (const page of impl.sitePages) {
      if (!page.path.startsWith('/') || page.path.length === 0) {
        throw new Error(`Module "${module.id}" sitePage path "${page.path}" must start with "/"`);
      }
      assertNamespacedMessageKey(module.id, impl.messages, page.title, 'sitePage title');
      if (page.description !== undefined) {
        assertNamespacedMessageKey(
          module.id,
          impl.messages,
          page.description,
          'sitePage description',
        );
      }
    }
  }

  if (impl.notificationRoutes !== undefined) {
    for (const key of Object.keys(impl.notificationRoutes)) {
      if (!key.startsWith(prefix)) {
        throw new Error(
          `Module "${module.id}" notificationRoute key "${key}" must start with "${prefix}"`,
        );
      }
    }
  }

  if (impl.notificationRules !== undefined) {
    for (const rule of impl.notificationRules) {
      if (rule.match.trim().length === 0) {
        throw new Error(`Module "${module.id}" notificationRule match pattern must not be empty`);
      }
      if (!rule.to.startsWith('/')) {
        throw new Error(
          `Module "${module.id}" notificationRule target "${rule.to}" must start with "/"`,
        );
      }
      if (rule.to.startsWith('//')) {
        throw new Error(
          `Module "${module.id}" notificationRule target "${rule.to}" must not be protocol-relative`,
        );
      }
    }
  }

  return Object.freeze({
    module,
    routes: Object.freeze(
      impl.routes.map((route) =>
        Object.freeze({
          ...route,
          ...(route.requires !== undefined ? { requires: Object.freeze([...route.requires]) } : {}),
        }),
      ),
    ),
    ...(impl.nav !== undefined
      ? {
          nav: Object.freeze(
            impl.nav.map((item) =>
              Object.freeze({
                ...item,
                ...(item.keywords !== undefined
                  ? { keywords: Object.freeze([...item.keywords]) }
                  : {}),
                ...(item.requires !== undefined
                  ? { requires: Object.freeze([...item.requires]) }
                  : {}),
              }),
            ),
          ),
        }
      : {}),
    ...(impl.settings !== undefined
      ? {
          settings: Object.freeze(
            impl.settings.map((section) =>
              Object.freeze({
                ...section,
                ...(section.aliases !== undefined
                  ? { aliases: Object.freeze([...section.aliases]) }
                  : {}),
                ...(section.requires !== undefined
                  ? { requires: Object.freeze([...section.requires]) }
                  : {}),
              }),
            ),
          ),
        }
      : {}),
    ...(impl.admin !== undefined
      ? { admin: Object.freeze(impl.admin.map((surface) => Object.freeze({ ...surface }))) }
      : {}),
    ...(impl.sitePages !== undefined
      ? { sitePages: Object.freeze(impl.sitePages.map((page) => Object.freeze({ ...page }))) }
      : {}),
    ...(impl.notificationRoutes !== undefined
      ? { notificationRoutes: Object.freeze({ ...impl.notificationRoutes }) }
      : {}),
    ...(impl.notificationRules !== undefined
      ? {
          notificationRules: Object.freeze(
            impl.notificationRules.map((rule) => Object.freeze({ ...rule })),
          ),
        }
      : {}),
    messages: Object.freeze({ ...impl.messages }),
  });
}

type MapWebModules<T extends readonly ModuleDefinition[]> = {
  readonly [K in keyof T]: T[K] extends { readonly web: false } ? null : WebModule<T[K]>;
};

type ExtractInstalledModules<T extends BsltConfig | readonly ModuleDefinition[]> =
  T extends BsltConfig<infer Ms> ? Ms : T extends readonly ModuleDefinition[] ? T : never;

/**
 * Install agreement for `main/apps/web/src/generated/modules.ts`:
 * every installed module in `bslt.config.ts` must provide a `WebModule` binding
 * unless its manifest explicitly declares `web: false` (`null`).
 */
export type WebImpls<T extends BsltConfig | readonly ModuleDefinition[]> = MapWebModules<
  ExtractInstalledModules<T>
>;

/**
 * Module-scoped `t(key)` lookup backed by the module's `en-US.json` bundle.
 */
export function useModuleMessages<Messages extends Readonly<Record<string, string>>>(
  messages: Messages,
): (key: keyof Messages & string, params?: Readonly<Record<string, string | number>>) => string {
  return useCallback(
    (key: keyof Messages & string, params?: Readonly<Record<string, string | number>>): string => {
      if (!Object.hasOwn(messages, key)) {
        throw new Error(`Missing message key "${key}"`);
      }
      const value = messages[key];
      if (typeof value !== 'string') {
        throw new Error(`Missing message key "${key}"`);
      }
      if (params === undefined) {
        return value;
      }
      return value.replace(/\{([a-zA-Z0-9_]+)\}/gu, (_match, name: string) => {
        if (!Object.hasOwn(params, name)) {
          throw new Error(`Missing interpolation parameter "${name}" for message key "${key}"`);
        }
        return String(params[name]);
      });
    },
    [messages],
  );
}
