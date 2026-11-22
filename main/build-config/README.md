# Build config (`@bslt/build-config`)

Shared build configuration, imported by package name. Dev tooling only, never built or shipped.

| Import                       | What it is                                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@bslt/build-config/vitest`  | `defineVitestConfig()` and `baseVitestConfig`: the Vitest base every package extends, with the `source` condition; `withSourceConditions()` adds only the condition |
| `@bslt/build-config/vite`    | `defineViteConfig()`, `clientConditions`, `serverConditions`: Vite's default conditions with `source` first                                                         |
| `@bslt/build-config/eslint`  | The repository ESLint preset (`baseConfig`, `exportAllBan`, `rawFormElementBans`)                                                                                   |
| `@bslt/build-config/esm-fix` | `fixEsmExtensions()`; the `bslt-esm-fix [dir...]` bin runs it after `tsc` in every package build                                                                    |

Workspace packages expose their entry points through package.json `exports` with a `source`
condition that points at `src`. TypeScript resolves it through `customConditions: ["source"]`
(`config/tsconfig.base.json`), Vite and Vitest through `resolve.conditions` set here, and tsx with
`--conditions=source`. Without the condition, Node and bundlers load the built `dist`.

`src/vite.ts` and `src/vitest.ts` are loaded by Node directly (Vite bundles a config file but leaves
its package imports to Node), so they use only erasable TypeScript and reach each other by package
name. Node 22.18 or later runs them without a loader.
