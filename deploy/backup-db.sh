#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

set -a
source .env
set +a

: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET must be set in .env}"

TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)
DUMP_FILE="/tmp/keizaal_inventory-${TIMESTAMP}.sql.gz"

sudo docker compose exec -T db pg_dump -U keizaal keizaal_inventory | gzip > "$DUMP_FILE"
aws s3 cp "$DUMP_FILE" "s3://${BACKUP_S3_BUCKET}/backups/$(basename "$DUMP_FILE")"
rm -f "$DUMP_FILE"

echo "Backup uploaded: s3://${BACKUP_S3_BUCKET}/backups/$(basename "$DUMP_FILE")"
