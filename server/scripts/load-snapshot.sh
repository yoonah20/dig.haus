#!/usr/bin/env bash
#
# Load a production snapshot from /api/admin/snapshot-dump into the
# local server/data/ directory.
#
# Pulls the tar.gz (diggershaus.db + avatars/ + custom-covers/),
# backs up the current DB with a timestamp suffix, clears any stale
# -shm/-wal files (they checkpoint against the OLD db and corrupt
# the state if left alongside a fresh .db), and untars everything
# into server/data/.
#
# Usage:
#   server/scripts/load-snapshot.sh [path-to-archive]
#
# With no argument, picks the most recent diggershaus-*.tar.gz from
# ~/diggershaus/db-dump/. Prior backups are kept — cleanup is manual.
#
# Safety: aborts if the dev server is still running, since replacing
# the .db underneath an open better-sqlite3 handle leaves the
# process writing to a detached inode.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DATA_DIR="$REPO_ROOT/server/data"
DEFAULT_DUMP_DIR="$HOME/diggershaus/db-dump"

archive="${1:-}"
if [[ -z "$archive" ]]; then
  archive=$(ls -t "$DEFAULT_DUMP_DIR"/diggershaus-*.tar.gz 2>/dev/null | head -n1 || true)
  if [[ -z "$archive" ]]; then
    echo "error: no diggershaus-*.tar.gz found in $DEFAULT_DUMP_DIR" >&2
    echo "usage: $0 [path-to-archive]" >&2
    exit 1
  fi
fi

if [[ ! -f "$archive" ]]; then
  echo "error: archive not found: $archive" >&2
  exit 1
fi

if pgrep -af 'nodemon|tsx.*server/src|node.*server/dist' >/dev/null; then
  echo "error: dev server appears to be running. Stop it first:" >&2
  pgrep -af 'nodemon|tsx.*server/src|node.*server/dist' >&2
  exit 1
fi

# Materialise the listing first so pipefail doesn't choke on tar
# getting SIGPIPE when grep -q exits early on its first match.
archive_entries=$(tar tzf "$archive")
if ! printf '%s\n' "$archive_entries" | grep -q '^diggershaus\.db$'; then
  echo "error: archive does not contain diggershaus.db at the root: $archive" >&2
  exit 1
fi

mkdir -p "$DATA_DIR"
ts=$(date +%Y%m%d-%H%M%S)

if [[ -f "$DATA_DIR/diggershaus.db" ]]; then
  backup="$DATA_DIR/diggershaus.db.local-backup-$ts"
  cp "$DATA_DIR/diggershaus.db" "$backup"
  echo "backup: $backup"
fi

rm -f "$DATA_DIR/diggershaus.db-shm" "$DATA_DIR/diggershaus.db-wal"

tar xzf "$archive" -C "$DATA_DIR"
echo "extracted: $archive -> $DATA_DIR"

echo
echo "current server/data/:"
ls -la "$DATA_DIR"
