#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${SELLERHUB_DATA_DIR:-$ROOT/data}"
BACKUP_DIR="${SELLERHUB_BACKUP_DIR:-$ROOT/backups}"
RETENTION_DAYS="${SELLERHUB_BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="$BACKUP_DIR/sellerhub-data-$STAMP.tar.gz"

mkdir -p "$DATA_DIR" "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" || true

tar -C "$DATA_DIR" -czf "$ARCHIVE" .
chmod 600 "$ARCHIVE"
find "$BACKUP_DIR" -type f -name 'sellerhub-data-*.tar.gz' -mtime "+$RETENTION_DAYS" -delete

echo "$ARCHIVE"
