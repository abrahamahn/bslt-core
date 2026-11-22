# In-Network Encrypted PostgreSQL Backups & PITR (`infra/runtime/backup`)

Replaces `.github/workflows/database-backup.yml` per owner decision **D13**:
backups run inside the private network on the database host (never from public CI runners),
encrypt every logical dump and WAL segment client-side with **AES-256-GCM** (`BSLTBK01`, HKDF-SHA256
per-archive salt + AAD object binding), and upload + read-back verify via `@bslt/protocols/s3`.

## Scripts

| Script             | Purpose                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| `backup.sh`        | `pg_dump -Fc --no-owner` (pinned `POSTGRES_IMAGE`) -> TOC verification -> AES-256-GCM -> S3 + `.prom` |
| `wal-archive.sh`   | PostgreSQL `archive_command` (`%p %f`) -> AES-256-GCM -> `s3://<bucket>/<prefix>/wal/<seg>.enc`       |
| `wal-restore.sh`   | PostgreSQL `restore_command` (`%f %p`) -> S3 fetch -> AES-256-GCM verify & decrypt                    |
| `restore-drill.sh` | Automated restore drill into a disposable scratch database, verifying table & `sys_migrations` counts |

## Required Environment (`/etc/bslt-backup.env`, mode `0600`)

- `BACKUP_DATABASE_URL` — PostgreSQL superuser / `BYPASSRLS` connection string on loopback
- `BACKUP_ENCRYPTION_KEY` — 32-byte hex master key (`openssl rand -hex 32`)
- `BACKUP_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- Optional: `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION` (`us-east-1`), `BACKUP_S3_PREFIX` (`db-backups`), `BACKUP_METRICS_FILE`

## PostgreSQL PITR Configuration (`postgresql.conf`)

```ini
wal_level = replica
archive_mode = on
archive_timeout = 300s
archive_command = '/opt/bslt/infra/runtime/backup/wal-archive.sh %p %f'
```
