# Configuration

## TypeScript Configuration

### Hierarchy

The root `tsconfig.json` defines shared compiler options and project references. Each package extends it via `"references"` in the root config.

```
tsconfig.json (root)
├── main/apps/web/tsconfig.json
├── main/apps/server/tsconfig.json
├── main/shared/tsconfig.json
├── main/server/core/tsconfig.json
├── main/server/db/tsconfig.json
├── main/server/system/tsconfig.json
├── main/client/ui/tsconfig.json
├── main/client/api/tsconfig.json
└── main/client/react/tsconfig.json
```

### Key Compiler Options

The root config enforces strict TypeScript:

```jsonc
{
  "target": "ES2023",
  "module": "ESNext",
  "moduleResolution": "bundler",
  "strict": true,
  "noUncheckedIndexedAccess": true, // Index signatures return T | undefined
  "noImplicitOverride": true,
  "exactOptionalPropertyTypes": true, // Distinguish undefined from missing
  "verbatimModuleSyntax": true, // Enforces explicit type imports
  "composite": true, // Required for project references
  "incremental": true, // Build caching
}
```

Build cache is stored at `node_modules/.cache/typescript/tsconfig.tsbuildinfo`.

### Module Resolution (no aliases)

There are no tsconfig `paths`, no `baseUrl` and no Vite or Vitest aliases. The `tombstones`
gate fails if one comes back (restructure Phase 3).

**Workspace packages** expose their entry points through package.json `exports`. Each entry has
a `source` condition that points at `src`, plus the built output (`types`, `default`) where the
package is built:

```json
"exports": {
  ".": { "source": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" }
}
```

- TypeScript resolves `source` through `customConditions: ["source"]` in
  `config/tsconfig.base.json`.
- Vite and Vitest get it from `@bslt/build-config` (`defineViteConfig`, `defineVitestConfig`).
- tsx runs with `--conditions=source`.
- Without the condition, Node and bundlers load the built `dist`.

A consumer imports a subpath only if the package's `exports` lists it, and it declares the
package in its own `package.json`. A specifier the map does not list does not resolve.

**App-internal imports** in `main/apps/web` use the package.json `imports` key `#app/*`, which
maps to `./src/*`:

```typescript
import { useClientEnvironment } from '#app/app/ClientEnvironment';
import { clientConfig } from '#app/config';
```

TypeScript does not try extensions on an `imports` target, and Vite does not accept an array of
targets. So the key's `types` condition lists the candidate files (`*.ts`, `*.tsx`, `*/index.ts`,
`*/index.tsx`) for TypeScript, and `default` is the extensionless path, which Vite, Vitest and
the ESLint resolver complete. `#` imports are resolved against the package.json nearest the
importing file, so `#app/*` works only inside the web app. Other packages use relative imports
for their own files (for example `@bslt/ui`), and `tests/` uses `#tests/*`.

## Vite Configuration

The web app's Vite config is at `main/apps/web/vite.config.ts`.

### Dev Server

```typescript
server: {
  port: 5173,
  strictPort: true,
  open: true,
  proxy: {
    '/api':     { target: 'http://localhost:8080', changeOrigin: true },
    '/ws':      { target: 'ws://localhost:8080', ws: true },
    '/uploads': { target: 'http://localhost:8080', changeOrigin: true },
  },
}
```

The proxy forwards API requests from the Vite dev server to the Fastify backend on port 8080.

### Build Output

```typescript
build: {
  outDir: 'dist',
  rollupOptions: {
    output: {
      manualChunks: {
        'vendor-react': ['react', 'react-dom'],  // Separate React vendor chunk
      },
    },
  },
  chunkSizeWarningLimit: 300,   // Warn on chunks > 300KB
  cssCodeSplit: true,           // Split CSS per route
  minify: 'esbuild',
  target: 'es2020',
}
```

### Resolve Conditions

`vite.config.ts` wraps its config in `defineViteConfig` from `@bslt/build-config/vite`. That
puts `source` first in Vite's default client and SSR conditions, so the dev server, the client
build and the SSR build that prerenders the public pages all read workspace packages from
source, with HMR across packages. Node loads `@bslt/build-config/vite` directly (type
stripping), so building the web app needs Node 22.18 or later.

## Environment Variables

Environment variables are validated at startup using schema definitions in `main/shared/src/modules/system/config/`. The validated config object is used throughout the application.

```typescript
// Example: accessing validated config
import { config } from '@bslt/shared/config';

config.server.port; // number, validated
config.auth.jwtSecret; // string, validated length >= 32
config.db.connectionString; // string, validated format
```

Environment files are stored in `config/env/`:

| File               | Purpose                           |
| ------------------ | --------------------------------- |
| `.env.local`       | Local development (not committed) |
| `.env.development` | Development defaults              |
| `.env.production`  | Production defaults               |

### Web Push (VAPID)

Browser push delivery is opt-in and inert until VAPID keys are set. The provider
self-disables when any key is missing, so leaving these unset is safe.

| Variable            | Purpose                                                       |
| ------------------- | ------------------------------------------------------------- |
| `VAPID_PUBLIC_KEY`  | Application server key sent to browsers at subscribe time.    |
| `VAPID_PRIVATE_KEY` | Signs push requests to the browser push service. Keep secret. |
| `VAPID_SUBJECT`     | Contact URL or `mailto:` the push service can reach you at.   |

Generate a key pair once per environment:

```bash
npx web-push generate-vapid-keys
```

Set the output, plus a subject, in the server environment:

```bash
VAPID_PUBLIC_KEY=BNc...        # public key from the command above
VAPID_PRIVATE_KEY=xq3...       # private key from the command above
VAPID_SUBJECT=mailto:ops@yourdomain.com
```

With all three present the `/notifications/vapid-key` endpoint returns the public
key, the settings UI can subscribe, and `notifications/send` fans out to each of a
user's stored subscriptions. Subscriptions the push service reports as expired
(`404`/`410`) are pruned automatically on the next send.

### IP blocklist / allowlist

A per-request IP blocklist runs as the first `onRequest` hook (before rate-limit,
CORS, and handlers), so denied addresses are rejected with `403` immediately. It is
**inert by default** — registered only when a blocklist is configured.

| Variable              | Purpose                                                                           |
| --------------------- | --------------------------------------------------------------------------------- |
| `IP_BLOCKLIST`        | Comma-separated exact IPs or CIDR ranges blocked on all routes.                   |
| `IP_BLOCKLIST_STRICT` | Additionally blocked only on routes that opt into the `strict` IP policy.         |
| `IP_ALLOWLIST`        | Always permitted; takes priority over the blocklists (e.g. office egress, pings). |

```bash
IP_BLOCKLIST=1.2.3.4,10.0.0.0/8
IP_ALLOWLIST=203.0.113.10
```

Values accept IPv4 addresses and CIDR ranges. Leaving all three unset keeps the
middleware unregistered with zero per-request cost. For external reputation feeds
(AbuseIPDB, MaxMind, …) implement the `IpReputationProvider` interface and pass it
through `createIpBlocklistMiddleware`.

### Billing (Stripe)

Billing auto-enables when `STRIPE_SECRET_KEY` + `STRIPE_PUBLISHABLE_KEY` are set;
`STRIPE_WEBHOOK_SECRET` is required to accept webhooks (mandatory in production).
See **[Stripe Connection & Verification](./stripe.md)** for keys, Stripe CLI
webhook forwarding, plan price-ID mapping, and the end-to-end verification flow.

## Turbo Configuration

Turbo (`turbo.json`) orchestrates monorepo tasks with caching:

- `build`, `lint`, `type-check`, `test` are turbo-managed tasks
- Output is cached at `node_modules/.cache/turbo/`
- `--output-logs=errors-only` keeps CI output clean
- Turbo respects package dependency graph for build order

```bash
# View turbo task graph
pnpm exec turbo run build --graph
```
