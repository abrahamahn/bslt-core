# Environment Files

This directory contains environment templates for the starter. The configuration system loads and validates these files before the application starts.

## Quick Start for New Users

**First time setup:**

Run the bootstrap script from the repository root:

```bash
pnpm bootstrap
```

The recommended Docker Development preset writes `config/env/.env.development`, generates development-only secrets, starts Postgres, pushes the schema, and seeds sample data. For unattended setup:

```bash
pnpm bootstrap -- --preset docker --yes
```

Manual setup is still supported when you want to manage each step:

1. Generate the env file without starting services:

   ```bash
   pnpm bootstrap -- --preset docker --yes --skip-install --skip-docker --skip-db
   ```

2. Start Docker Postgres, push the schema, and seed:

   ```bash
   docker compose --env-file config/env/.env.development -f infra/docker/development/docker-compose.dev.yml up -d
   pnpm db:migrate
   pnpm db:seed
   ```

3. Customize as needed by editing the env file you’re using.

Optional systems such as billing, advanced admin, and workers stay off until a product feature needs them. Their env vars are listed in [`docs/deploy/env.md`](../../docs/deploy/env.md).

> **Note:** The four main env files (`.env.development`, `.env.production`, `.env.test`, `.env.local`) are gitignored for security.

Before preparing a public template release, run:

```bash
pnpm bslt gate run local-env-secrets
```

This checks ignored local env files for non-placeholder credential values without printing the values themselves. It is intentionally separate from `pnpm bslt gate merge` because product forks may have legitimate local secrets.

## File Structure

```
config/env/
├── .env.development.example  # Template for development
├── .env.production.example   # Template for production
├── .env.test.example         # Template for testing
└── .env.local.example        # Template for local overrides
```

## Loading Priority

Environment variables are loaded in this order (highest to lowest priority):

1. **System Environment** - Runtime variables (Vercel, AWS, Docker, etc.)
2. **ENV_FILE** - Explicit file path via `ENV_FILE` environment variable
3. **`.env.local`** - Local developer overrides (config directory)
4. **`.env.{NODE_ENV}`** - Stage-specific (config directory)
5. **`.env`** - Base configuration (config directory, if exists)
6. **Root fallbacks** - `.env.local`, `.env.{NODE_ENV}`, and `.env` in repo root (if exists)

> **Note:** Variables set in higher priority sources will NOT be overwritten by lower priority sources.

## File Descriptions

### `.env.development`

**Purpose:** Default settings for Docker-based development

**Includes:** Docker Postgres on `localhost:5432`, local cache, console email, local file storage, development-only secrets

**Optimized for:** Consistent, reproducible local dev with Docker

**When to use:** Running Docker dev DB + `pnpm dev` or `NODE_ENV=development`

### `.env.production`

**Purpose:** Production-ready configuration

**Requires:** PostgreSQL database, SMTP email provider, cloud storage (S3)

**Database roles:** the API never connects as the Postgres superuser. Set one URL per role, each with its own password (`openssl rand -hex 32`): `DATABASE_URL` (`bslt_app`), `WORKER_DATABASE_URL` (`bslt_worker`) and `MIGRATION_DATABASE_URL` (`bslt_owner`). `LISTEN_DATABASE_URL` repeats the worker role and password at the database server itself (not PgBouncer) for the pub/sub `LISTEN` connection. `POSTGRES_HOST` / `POSTGRES_PORT` name the separate database server (the production compose file runs none), and `POSTGRES_USER` / `POSTGRES_PASSWORD` are its superuser, used only by the role bootstrap and PgBouncer's lookups. See [Database roles](../../docs/deploy/env.md#database-roles).

**Security:** SSL enabled, strong secrets required, localhost URLs disabled

**When to use:** Production deployments, `NODE_ENV=production`

**Customization:** You must configure cloud provider credentials and production URLs

### `.env.test`

**Purpose:** Test environment configuration

**Includes:** PostgreSQL test defaults, mocked services, fast execution settings

**When to use:** Running tests with `pnpm test`

**Note:** Tracked in git for consistent test environments across team

### `.env.local`

**Purpose:** Local Postgres development (VM-like)

**Use this for:**

- Local Postgres credentials and ports (defaults to `localhost:5432`)
- API keys for testing third-party services
- Debug settings and feature flags
- Any secrets that should never be committed

**Security:** ❌ Never tracked in git (in `.gitignore`)

**When to use:** When you want a developer-specific override file. Copy from `.env.local.example` and customize for your machine.

## Advanced Usage

### Using a Specific Environment File

You can override the default file loading with the `ENV_FILE` variable:

```bash
# Use a custom environment file
ENV_FILE=config/env/.env.production pnpm dev
```

### Setting NODE_ENV

`NODE_ENV` determines which `.env.{NODE_ENV}` file is loaded:

```bash
# Development (default)
NODE_ENV=development pnpm dev

# Production
NODE_ENV=production pnpm start

# Test
NODE_ENV=test pnpm test
```

### Customizing Environment Directory Location

**Current default:** `config/env/` (with repository root as fallback)

**To change the directory:**

1. Modify `main/apps/server/src/config/factory.ts`
2. Update the `configDir` resolution logic in `initEnv()`
3. Or use `ENV_FILE` to point to a specific file anywhere

**Example using ENV_FILE:**

```bash
# Load from a different directory
ENV_FILE=/path/to/my/custom/.env pnpm dev

# Load from project root
ENV_FILE=.env pnpm dev
```

## Security Best Practices

### DO

- Keep `.env.*` in `.gitignore` (already configured)
- Use strong secrets (32+ characters) for production
- Rotate secrets regularly (at least quarterly)
- Use different secrets for each environment
- Document all variables in `.example` files
- Run `pnpm bslt gate run local-env-secrets` before public template release prep
- Use environment-specific values (dev vs prod)

### DON'T

- Commit `.env.local` to git
- Commit real secrets to `.env.development` or `.env.production`
- Use development secrets in production
- Share secrets via Slack/email/chat
- Hardcode secrets in source code
- Use weak or default secrets in production

## Related Documentation

- **Server Config Runtime:** [`main/kernel/server/src/config/README.md`](../../main/kernel/server/src/config/README.md)
- **Environment Variables:** [`docs/deploy/env.md`](../../docs/deploy/env.md)

## Troubleshooting

### "Environment Validation Failed"

The configuration system validates all environment variables on startup. If you see this error:

1. Check which variable is missing or invalid (shown in error message)
2. Compare your `.env.local` with `.env.local.example`
3. Ensure required variables are set for your environment
4. Check variable formats (URLs should include protocol, ports should be numbers, etc.)

### "Cannot find config directory"

The loader searches up to 5 parent directories for `config/`. Ensure you're running commands from the repository root or a subdirectory.

### Variables Not Loading

Check the priority order above. Higher priority sources override lower ones. Debug with:

```javascript
// Add after imports in your entry file
import { initEnv } from '@bslt/server-system/config';
initEnv();
console.log('MY_VAR:', process.env.MY_VAR);
```

### Database Connection Issues

**Development:** Ensure PostgreSQL is running locally:

```bash
# Check if PostgreSQL is running
pg_isready

# Start PostgreSQL (macOS with Homebrew)
brew services start postgresql

# Start PostgreSQL (Linux)
sudo systemctl start postgresql
```

**Production:** Verify `DATABASE_URL` (`bslt_app`), `WORKER_DATABASE_URL` (`bslt_worker`) and `LISTEN_DATABASE_URL` (`bslt_worker`, direct to the database server) are set, that `POSTGRES_HOST` is the database server's address, and that the two database jobs ran before the API started: `bootstrap-roles` (creates the roles), then `migrate`. The server refuses to start in production when `DATABASE_URL` is a superuser or table-owning role. See [`docs/deploy/migrations.md`](../../docs/deploy/migrations.md#production).
