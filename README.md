# BSLT source distribution

A React and Fastify application with PostgreSQL, authentication, and account management.
The edition name, release version, and source file hashes are recorded in `edition.json`.

| Edition | Included features                                                                                                                      |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Core    | Authentication, account settings, API keys, consent, notifications, and security auditing                                              |
| Pro     | Core plus dashboard, administration, billing, organizations, tasks, files, analytics, support, telemetry, media, realtime, and workers |

The public Core source is available at [abrahamahn/bslt-core](https://github.com/abrahamahn/bslt-core).
Pro is distributed privately. Optional provider credentials and flags are configured through the
environment examples.

## Run locally

Use Node.js 22 or 24, pnpm 10.26.2, and PostgreSQL 16 or newer.

1. Run `pnpm install --frozen-lockfile`.
2. Copy `config/env/.env.local.example` to `config/env/.env.local`.
3. Set `JWT_SECRET`, `COOKIE_SECRET`, and `OAUTH_TOKEN_ENCRYPTION_KEY` to separate random values
   of at least 32 characters, and set your `POSTGRES_*` connection settings.
   Generate each secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
4. Run `pnpm db:migrate` against your development database.
5. Run `pnpm dev`. The web app uses port 5173 and the API uses port 8080 by default.

The console email provider prints development verification links. Configure SMTP before deploying.
Production settings are documented in `config/env/.env.production.example`.

## Install a feature pack (Core)

For a downloaded module, complete the local setup above and run this command from your Core project:

```sh
pnpm features:ui
```

Your browser opens a local module installer. Choose the downloaded `.tar.gz` file (up to 8 MiB),
review the module version, Core compatibility, and proposed file changes, then click **Install module**.
For an installed module, the preview shows **Update** with the previous version and any removed files.
The installer connects its page, navigation, and API automatically. After installation, run
`pnpm type-check && pnpm build`, restart the app, then sign in and open the module route shown on screen.
Complete any provider setup described in the module's guide.

Keep the terminal open while installing; Ctrl+C closes the installer. If the browser does not open,
use the complete URL printed in the terminal. `pnpm features:ui --no-open` prints the URL without
opening a browser. The installer accepts files through your browser and operates only on the Core
project where you started it. Uploads are validated in memory; installation uses that exact previewed
archive. Full Core and Pro source downloads are separate from module packs.

For a catalog or a command-line workflow, use the feature commands below.

Keep your distributor's catalog and archives together. If downloaded as a ZIP, unzip that bundle first.
Save its catalog location once, then choose a feature from the interactive picker:

```sh
pnpm features:setup /path/to/downloads/features.catalog.json
pnpm features

# Or install directly, with an optional preview:
pnpm features:add account-insights --dry-run
pnpm features:add account-insights
# Pin a specific release: pnpm features:add account-insights@1.0.0
pnpm type-check
pnpm build
pnpm dev
```

Setup also accepts a stable HTTPS catalog URL. Set `BSLT_FEATURE_TOKEN` in your shell or secret manager
if the server requires a download token. Setup validates access and saves only the catalog address in
`.bslt-features.json`, which Git ignores. Tokens and URLs with query parameters are never saved by setup.
`BSLT_FEATURE_CATALOG` overrides saved setup; `--catalog` overrides both.

Names select the newest catalog release compatible with this Core version. `features:available` lists
those releases and installed versions; append a word to search, such as `pnpm features:available insights`. Override the catalog for one command with `--catalog /path/to/features.catalog.json`.
Catalogs contain names, versions, archive addresses, and mandatory SHA-256 checksums. Remote catalogs
cannot read local files; bearer tokens are sent only to the configured catalog origin, including during
redirects. Keep tokens and catalog URLs containing temporary credentials out of Git. There is no
default hosted catalog or npm registry lookup.

You can also install a trusted download directly: `pnpm features:add /path/to/pack.tar.gz`. Run
`pnpm features` or `pnpm features:add` to choose a numbered entry, name, or path. Press Enter to cancel. The npm equivalent is
`npm run features:add -- account-insights` after installing workspace dependencies
with pnpm. Sign in and open **Account Insights** in the navigation (`/extensions/account-insights`).
It shows profile completeness and email verification using an authenticated feature API.

The installer connects the page, navigation, and backend automatically. Restart your development
servers afterward; deployed apps need a rebuild and redeploy. `pnpm features:list` lists installed
packs, `pnpm features:check` checks them, and `pnpm features:remove <id>` removes a pack.

Packs must match this Core version exactly and use its existing dependencies/database schema. The
installer refuses local edits, unsafe archive paths, and unmanaged file collisions. To change a pack
release, run `pnpm features:update <name>`; preview it first with `--dry-run`. The replacement is verified
before existing source changes, and a failed write restores the previous release. Updates also work
after a Core version change. Automatic selection never downgrades; use `name@version` to request one.
`features:list` stays readable when a pack needs updating; `features:check` enforces compatibility.
Run `pnpm features --help` for all commands. Keep installed files, both
`src/extensions/installed.*` registries, and `features.lock.json` together in your private Git repository.
Only install trusted source: hashes detect corruption but do not authenticate the publisher. Use
`--sha256 <trusted-download-checksum>` to verify a distributor-provided archive checksum.

An interrupted write can leave `.bslt-feature-install/backup.json`; stop any running installer and
restore its listed files from the base64 undo journal before deleting the lock directory. Null entries
mean the file was previously absent. Do not discard that journal before recovery.

The full Pro edition already contains its bundled features and does not use this Core-only installer.
Paid downloads are provided by the distributor; installed packs need no licensing API to run.

## Validate

```sh
pnpm type-check
pnpm build
pnpm test
```

Set `EDITION_TEST_DATABASE_URL` to a **dedicated test PostgreSQL database** to also exercise migrations,
registration, email verification, login, and account access. That test creates test accounts.

## Continuous integration

The public Core repository includes its own **Core CI** workflow. Pushes and pull requests run
installation, type checking, builds, and account-flow tests against an isolated PostgreSQL database.
Core CI needs no credentials for the private development repository.

## Editions and updates

Core contains account authentication, account settings, security auditing, and supporting infrastructure.
Pro also contains the product features and optional service packages. Pro runtime flags and provider
credentials are configured through the environment examples; possessing the source does not configure
Stripe, SMTP, or a telemetry service for you.

Core omits the paid browser/server implementations. Both editions retain the common database migrations,
repository interfaces, and shared contracts so the schema remains compatible during an edition upgrade.
Back up your database before upgrading. Merge upstream source updates with your own changes and apply
pending migrations; replacing an edited checkout will overwrite your customizations.

Paid access is managed by the distributor. This application runs on your infrastructure and does not
require a licensing API to start. The source inventory is an integrity check, not a license signature.

## Contributions

Core is distributed under the [MIT license](https://github.com/abrahamahn/bslt-core/blob/main/LICENSE)
included in the public Core repository. Paid access and any commercial terms for Pro are handled
separately by the distributor.

Core users can report issues and propose changes in the public Core repository. Releases are generated
from the maintained source repository. Maintainers bring accepted fixes back into that source before
publishing another release so contributions survive future updates.
