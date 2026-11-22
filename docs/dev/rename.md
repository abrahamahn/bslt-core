# Starter Rename

Use the starter rename helper after cloning and before adding product code:

```bash
pnpm bslt rename "Acme Cloud" --domain acme.com --scope @acme --apply
pnpm bslt gate merge
```

Without `--apply`, the command prints a dry run.

## What It Changes

The command updates safe product identity fields:

- `APP_NAME`, `VITE_APP_NAME`, `TOTP_ISSUER`, and `EMAIL_FROM_NAME`.
- `JWT_ISSUER` and `JWT_AUDIENCE`.
- Starter database names in env examples.
- Production `APP_URL`, `API_BASE_URL`, OAuth callback examples, and sender email when `--domain` is provided. `VITE_API_URL` stays unset for the bundled single-domain Caddy deployment so the browser uses relative `/api` URLs.
- `pnpm bootstrap` defaults in `main/tools/scripts/dev/setup.ts`.
- Root README title, product framing, clone path, and contributor attribution.
- Safe Docker Compose, Terraform variable defaults, Prometheus job names, and deployment guide examples that use the starter slug.

## What It Does Not Change

Internal workspace packages still use `@bslt/*`. Keep that scope until the app runs under its new product identity, then migrate it in one automated pass with `bslt rename scope` (see below).

Brand assets, provider-specific hostnames that are not safe defaults, and real secrets still need product-specific review.

## Migrating the `@bslt/*` Package Scope

This is separate from `bslt rename` because it rewrites build wiring, not just
product strings. Do it once, on a clean branch, after the app runs under its new
identity. It is automated by `bslt rename scope`:

```bash
pnpm bslt rename scope @acme          # dry run: lists every file + edit count
pnpm bslt rename scope @acme --apply  # rewrite the whole workspace scope
pnpm install                             # regenerate the lockfile + workspace links
pnpm bslt gate merge                      # confirm the tree is green under @acme
```

The tool rewrites the scope token everywhere it is a package **prefix** — source
imports (`from '@acme/...'`, dynamic `import('@acme/...')`), `name` and
`dependencies`/`devDependencies` keys in every `package.json`, `turbo`/`pnpm --filter=` selectors, and
ESLint boundary rules (including escaped-slash regex literals like `/^@acme\/shared$/`).

It anchors strictly on `@bslt` immediately followed by `/` (or `\` in a regex
literal), so incidental "bslt" is never touched: product copy (`BSLT`), URLs
(`github.com/abrahamahn/bslt-main`), cache filenames (`eslintcache-bslt-api`), and
localStorage keys (`bslt-device-id`) all survive. The transform is idempotent — a
second run is a no-op — and the pnpm lockfile is deliberately skipped (regenerate
it with `pnpm install`).

If `type-check` reports unresolved `@acme/*` paths afterward, run `pnpm install`
(the lockfile still pins the old scope until it is regenerated).
