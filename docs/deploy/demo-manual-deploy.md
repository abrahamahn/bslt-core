# Deploying the demo without GitHub Actions

> The live demo at [app.bslt.dev](https://app.bslt.dev) normally deploys itself when
> `main` moves. While that is unavailable, the owner's workstation deploy runner
> delivers each accepted `main` commit through `remote-deploy.sh` (below), and
> `pnpm deploy:demo` is the manual path.
>
> Last verified: 2026-08-06 (`pnpm deploy:demo`). The runner path is not yet verified
> on the droplet.

## The workstation runner

The runner (outside this repository) builds and tests a `main` commit on the
workstation, ships the two images to the droplet with `docker save | docker load`, and
copies the stack files next to them in `/opt/bslt/demo`: `docker-compose.demo.yml`,
`nginx.conf`, `generate-env.sh`, `remote-deploy.sh`, `versions.env` and
`.env.production.example`. Never the `Caddyfile`. It then runs the same script the
`demo` job of `deploy.yml` runs, with the images it loaded:

```bash
cd /opt/bslt/demo && IMAGE_SOURCE=loaded \
  API_IMAGE=local-deploy/bslt-api:<sha> WEB_IMAGE=local-deploy/bslt-web:<sha> \
  PUBLIC_HOST=app.bslt.dev DEMO_DIR=/opt/bslt/demo bash remote-deploy.sh
```

| Caller                 | `IMAGE_SOURCE`   | Requires                                          | Registry                   |
| ---------------------- | ---------------- | ------------------------------------------------- | -------------------------- |
| `deploy.yml`, `demo`   | `ghcr` (default) | `IMAGE_TAG`, `OWNER`, `GHCR_TOKEN`, `PUBLIC_HOST` | login and pull, then prune |
| the workstation runner | `loaded`         | `API_IMAGE`, `WEB_IMAGE`, `PUBLIC_HOST`           | none, and no prune         |

In both modes the script, in order:

1. stops before changing anything when `versions.env` is missing or, in `loaded` mode,
   when either image is not on the host;
2. regenerates `.env` from `.env.production.example` (secrets persist; the public
   origin is `https://PUBLIC_HOST` unless `PUBLIC_BASE_URL` says otherwise) and pins
   `API_IMAGE` and `WEB_IMAGE` in it, so every later `docker compose` on the host runs
   the deployed images;
3. drops the database volume when it holds another Postgres major than
   `versions.env` pins;
4. starts Postgres, runs `bootstrap-roles`, then `migrate`; when `migrate` exits 3 (a
   database built from other baselines) it drops the volume and runs both again;
5. recreates `api` and `web` only: `up -d --no-deps --force-recreate api web`.

Exit 0 means deployed. Any other exit means the deploy failed, and `api` and `web` may
be down; the runner owns the restore. The demo database is disposable: no deploy keeps
its data across a reset, so take a dump first when it matters.

Caddy is the edge of the whole host: its `Caddyfile` on the droplet also serves
ganbate.io and kanustudio.com. The script never names it, and the `caddy` service in
`docker-compose.demo.yml` is the droplet's exactly, so that no `docker compose up`
recreates it. The same file carries the droplet's sizing for its shared 2 GB: a memory
limit per service, the Postgres memory settings, the API's V8 heap limit, and the
`./uploads` bind mount (owned by the image's user, uid 1001; the script creates it so).
`main/tools/scripts/audit/compose-database-roles.test.ts` pins both, and
`demo-remote-deploy.test.ts` runs the script in both modes against a stubbed `docker`.

## Same-origin API configuration

For the bundled Caddy demo, leave `VITE_API_URL` unset or empty. The browser client
adds `/api` to this base; setting it to `/api` generates invalid requests such as
`/api/api/csrf-token`. The local deploy script rejects relative overrides before
building. A separately hosted API can use an absolute base such as
`https://api.example.com`, without the `/api` route suffix.

This setting is baked into the web image. Changing an environment variable after
the build does not fix already published assets: rebuild and deploy the web image,
then verify the actual browser's CSRF request. A direct API health check alone
cannot detect a bad frontend base URL.

## Why this exists

Three faults have to be true at once for the demo to deploy on its own, and as of
2026-08-06 only the first two are fixed:

| Requirement                                | State                                     |
| ------------------------------------------ | ----------------------------------------- |
| The demo deploy watches the default branch | fixed (`af0ef532`) — was a deleted branch |
| `Dockerfile.web` builds                    | fixed (`040a4b39`) — TS6305 on ui deps    |
| GitHub Actions can run jobs                | **blocked — Actions budget unavailable**  |

An exhausted budget refuses every job regardless of trigger, so `workflow_dispatch`
is not a workaround either. The Cloudflare web deploy is separately unusable: the
repo has no `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets. (Since Phase 4 both are jobs
of `.github/workflows/deploy.yml`: `demo` and `web`.)

## What you need

- **SSH to the droplet.** Its firewall allows specific source IPs only. Add the
  address you are deploying from under DigitalOcean → Networking → Firewalls → the
  droplet's firewall → the SSH (TCP 22) rule, and remove it afterwards. The script
  fails fast with your current IP in the message if this is missing.
- **The deploy key**, `~/.ssh/bslt_deploy` by default (`SSH_KEY=` to override). This
  is the key matching the repo's `DROPLET_SSH_KEY` secret; the droplet accepts it as
  `root`.
- **Docker locally.** Images are built here on purpose — the droplet has 2 GB of RAM,
  shared with other stacks, and cannot build them.

No registry credentials are needed. Images travel as a `docker save | docker load`
stream, which is why the missing `write:packages` scope does not matter.

## Usage

```bash
DROPLET_HOST=192.241.141.36 pnpm deploy:demo            # both images
DROPLET_HOST=192.241.141.36 pnpm deploy:demo --web      # frontend only
DROPLET_HOST=192.241.141.36 pnpm deploy:demo --api --migrate
DROPLET_HOST=192.241.141.36 pnpm deploy:demo --dry-run  # print the plan, change nothing
```

`--migrate` is off by default because migrations are not reversible, so running
them is a decision rather than a step. When it is
given, the database jobs run **before** the API restarts: the role bootstrap, then
the migrations. If either fails the script stops there and the previous API
container keeps serving. Without it the database is left as it is, and the script
says so at preflight: pass `--migrate` whenever the new API image needs a migration
the database does not have. `--prune` is likewise opt-in: the droplet also runs
ganbate and kanustudio, and their images are not this script's business.

## Database role split

The API image connects as `bslt_app` and `bslt_worker`, and runs every user session
as the `authenticated` role, which gets its grants from the baselines (see
[Database roles](./env.md#database-roles)). Two files on the droplet decide whether
the demo runs that way, and this script writes neither of them:

| Droplet file              | What the role split needs in it                                                                     | Written by                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `.env`                    | `DATABASE_URL` (`bslt_app`), `WORKER_DATABASE_URL`, `LISTEN_DATABASE_URL`, `MIGRATION_DATABASE_URL` | `generate-env.sh`, which `remote-deploy.sh` runs                    |
| `docker-compose.demo.yml` | the `bootstrap-roles` and `migrate` services, and the blanked superuser variables on `api`          | the runner's and the workflow's file sync; never `pnpm deploy:demo` |

So what `--migrate` runs depends on the droplet's own copy of the compose file:

- **It has the one-shot services:** `bootstrap-roles` (as the superuser), then
  `migrate` (as `bslt_owner`), then the API restart.
- **It predates them:** the script says so, skips the role bootstrap, and migrates
  through the `api` service with whatever login the droplet's `.env` names. The
  demo keeps working on its old single superuser login until both files are
  brought up to date.

The runner's first deploy moves the droplet onto the role split: it syncs both
files and resets the database, which holds a cluster of an older Postgres major.
After that, `pnpm deploy:demo --migrate` finds the one-shot services.

## The two things that make this safe

**It syncs `nginx.conf`, and only `nginx.conf`.** That file is a _host mount_, and
commit `80a4a492` changed the image layout and the config together (the document root
moved from `…/html/client` to `…/html`). The workflow re-syncs it on every deploy, so
a manual deploy that only swaps the image leaves a new image behind an old config —
which is exactly how the first hand-rolled deploy 404'd the whole site for ~3
minutes. The previous copy is kept as `nginx.conf.bak.<timestamp>`.

**It never writes `Caddyfile` or `docker-compose.demo.yml`.** The Caddyfile on the
droplet also routes **ganbate.io and kanustudio.com**; overwriting it from here would
take down two unrelated production sites. The compose file is the runner's and the
workflow's to sync. The script reports a difference and leaves both alone; `--no-deps`
on the compose restart keeps Caddy and Postgres running for the same reason. What it
does write besides `nginx.conf` is the `API_IMAGE` / `WEB_IMAGE` line of `.env` for
each image it shipped: `remote-deploy.sh` pins the deployed images there, and the
restart would otherwise bring those back.

Those properties are asserted in `main/tools/scripts/audit/local-deploy-safety.test.ts`,
because "sync every stack file" and "restart everything" both look like improvements
to someone who does not know what else lives on that box. The same file runs the
script against stub `ssh` and `docker` binaries to pin the order above: database
jobs first, API restart last, and no restart after a failed job.

## If it fails

The script checks the public URL and refuses to report success on a non-200, printing
the rollback command. Manually:

```bash
ssh -i ~/.ssh/bslt_deploy root@$DROPLET_HOST \
  'cd /opt/bslt/demo && WEB_IMAGE=ghcr.io/abrahamahn/bslt-web:<tag> \
     docker compose -f docker-compose.demo.yml up -d --no-deps web'
```

and restore `nginx.conf` from the newest `nginx.conf.bak.*`. Previous ghcr tags are
still on the droplet — `docker images | grep bslt` lists them. A variable given on the
command line wins over the `WEB_IMAGE=` line of `.env` for that one command; set the
line too, or the next `docker compose` there brings the pinned image back.

## Known drift

The demo can end up running mismatched images: deploying `--web` alone leaves the API
on whatever it had. `docker compose ps` shows both. As of 2026-08-06 web is at `main`
and the API is a four-week-old ghcr image, which is fine for a frontend change and
not fine for anything server-side.
