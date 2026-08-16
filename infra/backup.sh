#!/usr/bin/env bash
#
# Backs up both stores.
#
# The two need different treatment. Postgres is small and holds the data that
# cannot be reconstructed from anything else — accounts, projects, the identity
# graph, saved analysis. ClickHouse is large and, for the most part,
# regenerable only from itself; a full copy every night would be wasteful, so
# it uses ClickHouse's own incremental BACKUP.
#
# Losing ClickHouse costs history. Losing Postgres costs the product: every
# project key, every person, every merge. That asymmetry is why Postgres is
# backed up more often and kept longer.
#
#   ./infra/backup.sh                 # both
#   ./infra/backup.sh postgres        # just Postgres
#   BACKUP_DIR=/mnt/backups ./infra/backup.sh

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./infra/backups}"
COMPOSE="${COMPOSE:-docker compose -f infra/docker-compose.yml}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${1:-all}"

PG_RETENTION_DAYS="${PG_RETENTION_DAYS:-30}"
CH_RETENTION_DAYS="${CH_RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR/postgres" "$BACKUP_DIR/clickhouse"

log() { printf '  %s\n' "$*"; }

backup_postgres() {
  local out="$BACKUP_DIR/postgres/falorb-$STAMP.sql.gz"
  log "Postgres → $out"

  # --clean --if-exists so the dump can be restored over an existing database
  # without a manual drop first, which is the state you are in during an
  # actual recovery.
  $COMPOSE exec -T postgres pg_dump \
    --username=falorb \
    --dbname=falorb \
    --clean --if-exists --no-owner --no-privileges \
    | gzip -9 > "$out"

  # A dump that cannot be read back is not a backup. Cheap to verify now,
  # expensive to discover during an incident.
  if ! gzip -t "$out"; then
    log "FAILED: $out is corrupt"
    rm -f "$out"
    return 1
  fi

  log "  $(du -h "$out" | cut -f1)"
  find "$BACKUP_DIR/postgres" -name 'falorb-*.sql.gz' -mtime "+$PG_RETENTION_DAYS" -delete
}

backup_clickhouse() {
  local name="falorb-$STAMP"
  log "ClickHouse → $name"

  # Incremental against the previous backup when one exists: only new parts
  # are copied, which turns a nightly full copy of the whole event history
  # into minutes of work.
  local previous
  previous="$(ls -1t "$BACKUP_DIR/clickhouse" 2>/dev/null | head -1 || true)"

  local settings=""
  if [ -n "$previous" ]; then
    settings="SETTINGS base_backup = Disk('backups', '$previous')"
    log "  incremental against $previous"
  else
    log "  full (no previous backup found)"
  fi

  $COMPOSE exec -T clickhouse clickhouse-client \
    --user falorb --password falorb \
    --query "BACKUP DATABASE falorb TO Disk('backups', '$name') $settings" \
    || {
      log "FAILED — is a 'backups' disk configured in ClickHouse?"
      log "Add one under <storage_configuration> pointing at a mounted volume."
      return 1
    }

  find "$BACKUP_DIR/clickhouse" -maxdepth 1 -name 'falorb-*' -mtime "+$CH_RETENTION_DAYS" -exec rm -rf {} + 2>/dev/null || true
}

echo "Falorb backup — $STAMP"

case "$TARGET" in
  postgres)   backup_postgres ;;
  clickhouse) backup_clickhouse ;;
  all)        backup_postgres; backup_clickhouse ;;
  *)          echo "usage: $0 [postgres|clickhouse|all]" >&2; exit 1 ;;
esac

echo "Done."
echo
echo "Restore:"
echo "  Postgres    gunzip -c BACKUP.sql.gz | $COMPOSE exec -T postgres psql -U falorb -d falorb"
echo "  ClickHouse  RESTORE DATABASE falorb FROM Disk('backups', 'NAME')"
echo
echo "A backup you have never restored is a hypothesis. Test one on a scratch"
echo "database before you need it."
