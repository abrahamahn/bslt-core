# Development Guides

Workflow, testing, configuration, and tooling for BSLT.

| Document                                      | Purpose                                                    |
| --------------------------------------------- | ---------------------------------------------------------- |
| [Workflow](./workflow.md)                     | Daily commands, git hooks, CI pipeline                     |
| [Configuration](./configuration.md)           | TypeScript, module resolution, Vite, build system          |
| [Testing](./testing.md)                       | TDD workflow, unit/integration/E2E patterns                |
| [Database](./database.md)                     | Adding a table, sessions, transactions, raw SQL fragments  |
| [Tenancy](./tenancy.md)                       | The one isolation model and how it is proven               |
| [Starter Rename](./rename.md)                 | Safe product identity rename flow                          |
| [Module Creation](./module-creation.md)       | Scaffolding a new server module                            |
| [API Versioning](./api-versioning.md)         | Version strategy for shared HTTP contracts                 |
| [Sync Scripts](./sync-scripts.md)             | DX automation: file headers, barrels, TS references, theme |
| [Security](./security.md)                     | Passwords, tokens, rate limiting, CSRF, auditing           |
| [Security CI](./security-ci.md)               | CodeQL, Semgrep, OSV, Gitleaks, Trivy in CI                |
| [Performance](./performance.md)               | Database tuning, N+1 fixes, frontend code splitting        |
| [Staging](./staging.md)                       | Staging environment workflow                               |
| [Horizontal Scaling](./horizontal-scaling.md) | Multi-instance architecture and session sharing            |

For coding standards and anti-patterns, see [`../specs/principles.md`](../specs/principles.md) (canonical). For onboarding, see [`../ONBOARDING.md`](../ONBOARDING.md).
