# Security CI

Security scanning is part of the one CI workflow, `.github/workflows/ci.yml`: five `security-*` jobs and a `security` job that is red when any of them is.

## Overview

| Scanner     | Type           | What It Finds                                               |
| ----------- | -------------- | ----------------------------------------------------------- |
| CodeQL      | SAST           | Code-level vulnerabilities (XSS, injection, auth flaws)     |
| Semgrep     | SAST           | Pattern-based security issues with auto-config rules        |
| OSV Scanner | SCA            | Known vulnerabilities in dependencies                       |
| pnpm audit  | SCA            | npm advisory database matches                               |
| Gitleaks    | Secrets        | Leaked credentials, API keys, tokens in git history         |
| Trivy       | Container + FS | OS-level CVEs in Docker images + filesystem vulnerabilities |

## Security Jobs

**Triggers:** every CI run: pull requests, pushes to `main`, the nightly schedule and manual runs.

| Job                     | Scanner                 |
| ----------------------- | ----------------------- |
| `security-codeql`       | CodeQL                  |
| `security-semgrep`      | Semgrep                 |
| `security-dependencies` | `pnpm audit`, OSV       |
| `security-secrets`      | Gitleaks                |
| `security-trivy`        | Trivy (image and files) |
| `security`              | the verdict of the five |

**Permissions:** each job has `contents: read`; the jobs that upload SARIF add `security-events: write`.

### CodeQL

Runs GitHub's CodeQL analysis for JavaScript/TypeScript with `security-extended` and `security-and-quality` query suites.

```yaml
- Initialize CodeQL (languages: javascript-typescript)
- Autobuild (automatic code compilation)
- Analyze (upload results to GitHub Security tab)
```

Results appear in the repository's **Security > Code scanning alerts** tab.

### Semgrep (SAST)

Runs Semgrep with `--config auto` (community rules) and outputs SARIF format.

- Results uploaded to GitHub Security tab via `codeql-action/upload-sarif`
- SARIF artifact also saved for offline review (`semgrep-sarif`)

### Dependencies (pnpm audit + OSV)

Two-pronged dependency scanning:

1. **pnpm audit** with `--audit-level moderate`
2. **OSV Scanner** (Google's Open Source Vulnerability scanner) with recursive scanning and SARIF output

OSV results are uploaded to GitHub Security tab and saved as artifacts.

### Gitleaks (Secrets)

Scans the full git history (`fetch-depth: 0`) for leaked secrets using Gitleaks v2. Runs with `GITLEAKS_ENABLE_COMMENTS: false` to avoid noisy PR comments.

### Trivy (Container + Filesystem)

Runs two scans:

1. **Image scan**: Builds the Docker image (`infra/docker/Dockerfile`) and scans for CRITICAL and HIGH severity CVEs.
2. **Filesystem scan**: Scans the repository for CRITICAL and HIGH vulnerabilities in language-specific files.

Both results are uploaded to GitHub Security tab as separate categories (`trivy-image`, `trivy-fs`).

## Nightly Production Audit

The `security-dependencies` job also runs `pnpm audit --prod` on the nightly schedule and on manual
runs: production dependencies, at any severity. It was a workflow of its own (`dependency-audit.yml`)
before Phase 4.

## Blocking Policy

| Scanner                               | A finding                                                            |
| ------------------------------------- | -------------------------------------------------------------------- |
| Semgrep                               | fails `security-semgrep`                                             |
| `pnpm audit --audit-level moderate`   | fails `security-dependencies`                                        |
| `pnpm audit --prod` (nightly, manual) | fails `security-dependencies`                                        |
| OSV                                   | fails `security-dependencies`                                        |
| Gitleaks                              | fails `security-secrets`                                             |
| CodeQL analysis                       | does not fail the job (`continue-on-error`); findings are in the log |
| Trivy image and filesystem scans      | do not fail the job (`continue-on-error`); findings are in the SARIF |

The `security` job fails when any `security-*` job did, so it is the one name to require in branch
protection. SARIF upload steps are best-effort, so an upload outage does not hide the scanner
result. The Deploy workflow starts only for a CI run that passed as a whole: a failing scanner on
`main` holds the production deploy back.

`main/tools/scripts/audit/workflows.test.ts` fails when one of the blocking steps gains a
`continue-on-error`.

## SARIF Upload

All scanners output SARIF format and upload results via `github/codeql-action/upload-sarif`. This integrates with the GitHub **Security** tab, providing:

- Centralized view of all findings across scanners
- Automatic deduplication across scan runs
- Dismissal and triage workflow
- PR annotations for new findings

Each scanner uploads to a distinct category (`codeql`, `semgrep`, `osv`, `trivy-image`, `trivy-fs`) for clear attribution.

## Triaging Findings

### In GitHub Security Tab

1. Navigate to **Security > Code scanning alerts**
2. Filter by tool (CodeQL, Semgrep, Trivy, OSV)
3. Review each finding: severity, affected code, suggested fix
4. Mark as **Dismissed** with reason (false positive, won't fix, used in tests) or **Open** to track

### Priority Matrix

| Severity | Scanner        | Action                                     |
| -------- | -------------- | ------------------------------------------ |
| Critical | Any            | Fix immediately, block merge               |
| High     | CodeQL/Semgrep | Fix before next release                    |
| High     | Trivy/OSV      | Update dependency or assess exploitability |
| Medium   | Any            | Track in backlog, fix within sprint        |
| Low/Info | Any            | Review, dismiss if non-applicable          |

### Common False Positives

- **Semgrep**: Generic pattern matches on test fixtures or documentation strings
- **OSV/Trivy**: Dev-only dependencies that are never bundled in production
- **Gitleaks**: Example API keys in documentation or test files

Use GitHub's dismissal workflow with an appropriate reason to suppress repeat alerts.
