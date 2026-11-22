# BSLT Core (`foundation-v1`)

Self-owned TypeScript SaaS & platform foundation (React 19 + Vite 8 + owned `node:http` router + PostgreSQL 17 with forced Row-Level Security).

- **Zero third-party runtime npm dependencies** outside `react` and `react-dom`.
- **12 Kernel Packages (`main/kernel/*`):** `@bslt/schema`, `@bslt/contract`, `@bslt/protocols` (`pg`, `jwt`, `totp`, `cbor`, `cose`, `webpush`, `otlp`), `@bslt/db`, `@bslt/server-system`, `@bslt/realtime`, `@bslt/storage`, `@bslt/comms`, `@bslt/client-engine`, `@bslt/react`, `@bslt/ui`, `@bslt/web-platform`.
- **Minimal Core Vertical Modules (`main/modules/*`):**
  - `@bslt/identity` — Email/password, magic link, OAuth, WebAuthn passkeys, TOTP/SMS MFA, sessions, devices, personal API keys, admin user management.
  - `@bslt/compliance` — Terms/Privacy versioning, cookie consent sync, GDPR data export, account deletion lifecycle.
  - `@bslt/audit` — Partitioned append-only `audit_log` + security metrics.
  - `@bslt/devtools` (`devOnly`) — Live API route explorer (`/routes`) and interactive `@bslt/ui` component catalog (`/ui-library`).

## One-Click Quickstart

Requires **Node.js 24**, **pnpm 10.26.2**, and **PostgreSQL 17** (or Docker).

```bash
git clone https://github.com/abrahamahn/bslt-core.git my-app
cd my-app
pnpm install
pnpm quickstart
```

`pnpm quickstart` (`bslt init`) walks you through naming your app, migrating your `@scope`, picking optional feature modules, generating local 32-byte secrets in `config/env/.env.local`, and optionally starting PostgreSQL.

Non-interactive one-liner:

```bash
pnpm quickstart -- --name "Acme Cloud" --domain acme.com --scope @acme --with-postgres --yes
pnpm dev
```

## Installing Optional Feature Modules

Optional vertical modules (`orgs`, `entitlements`, `billing`, `flags`, `tasks`, `support`, `status`, `search`, `analytics`, `notifications`, `files`, `moderation`, `webhooks`, `admin`) plug directly into `main/modules/<id>` and `bslt.config.ts` with automatic DAG dependency resolution and SHA-256 verification:

```bash
# List installed and available modules
pnpm bslt module list --catalog /path/to/modules.catalog.json

# Add modules (automatically installs transitive dependencies in topological order)
pnpm bslt module add billing tasks --catalog /path/to/modules.catalog.json

# Or fetch from a private HTTPS catalog using BSLT_MODULE_TOKEN
BSLT_MODULE_TOKEN="<token>" pnpm bslt module add billing --catalog https://releases.example.com/modules.catalog.json

# Scaffold your own custom full-stack vertical module
pnpm bslt module new notes
```

## Verification & Quality Gates

```bash
pnpm build                                  # Build all workspace packages & prerender public SSR pages
pnpm bslt gate merge --concurrency=2        # Run all 50 static, contract, snapshot, lint, type-check & unit gates
pnpm test:real-db                           # Run real PostgreSQL 17 + forced RLS isolation suites
```

## License

MIT — see [LICENSE](./LICENSE).
