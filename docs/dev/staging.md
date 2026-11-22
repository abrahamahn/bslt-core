# Staging Environment

## How to Deploy

**Automatic:** a push or merge to the `staging` branch starts `.github/workflows/deploy.yml` for the
`staging` environment.

```bash
# Deploy current branch to staging
git push origin my-branch:staging
```

**Manual:** GitHub Actions > "Deploy" > Run workflow, with `environment` = `staging` (the default).
Run it from the branch you want deployed.

Either way the run does this:

1. `staging-images`: the merge gate (`pnpm bslt gate merge`), then the API and web images, built
   exactly as CI builds the production ones and tagged with the commit SHA;
2. `app`: the same remote steps as production, on the staging app server: database version check,
   `bootstrap-roles`, `migrate`, `docker compose up -d`, health wait, image check.

CI (`ci.yml`) does not run on the `staging` branch, which is why the deploy runs the merge gate
itself. The real-DB suites and the security scanners run on the pull request into `main`.

**Rollback:** run the workflow with `environment` = `staging` and `rollback_sha` = the full SHA of
an earlier staging deploy. Nothing is built; the images of that commit are run again.

## Environment Configuration

Staging uses the GitHub `staging` environment, which has its own secrets and variables. They are the
same names as production, pointing at isolated resources: a staging app server and a staging
database server. The full list is the [secrets checklist](../deploy/secrets-checklist.md); the ones
that must differ from production:

| Variable / Secret                                                           | Description                                           |
| --------------------------------------------------------------------------- | ----------------------------------------------------- |
| `DEPLOY_HOST`, `SSH_PRIVATE_KEY`                                            | The staging app server                                |
| `DB_HOST`                                                                   | The staging database server's private address         |
| `DB_PASSWORD`, `DB_OWNER_PASSWORD`, `DB_APP_PASSWORD`, `DB_WORKER_PASSWORD` | Staging database passwords (separate from production) |
| `JWT_SECRET`, `COOKIE_SECRET`, `OAUTH_TOKEN_ENCRYPTION_KEY`                 | Staging secrets (separate from production)            |
| `DOMAIN`                                                                    | The staging domain                                    |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`                                | Stripe **test mode** values, set on the server        |

When no staging app server is configured, an automatic run skips the deploy with a warning and a
manual run fails.

## Accessing Staging

Once deployed, staging is reachable at the domain configured in the `staging` environment. It runs
the same two compose files as production ([two servers](../deploy/README.md#two-servers)).

## Relationship to Production Deploy

Staging and production are the same job of the same workflow in two environments. The differences:
production images are built by CI on a push to `main` and deployed by digest once CI passed;
staging builds its own on a push to `staging`. Terraform for either environment is the manual
`terraform` input of the same workflow, and applies nothing until a remote state backend is
declared.
