#!/usr/bin/env bash
# Demo: back up a sample tree twice and watch deduplication work.
# Run from the repo root:  bash examples/backup-demo.sh
set -euo pipefail

DEMO_DIR="$(mktemp -d)"
SRC="$DEMO_DIR/notes"
REPO="$DEMO_DIR/repo"

mkdir -p "$SRC/chapters"
printf 'Chapter one.\n%.0s' $(seq 1 3000) > "$SRC/chapters/ch1.txt"
printf 'Chapter two.\n%.0s' $(seq 1 3000) > "$SRC/chapters/ch2.txt"
echo "todo: finish chapter three" > "$SRC/todo.md"

node bin/snapback.js init "$REPO"
echo "--- first backup ---"
node bin/snapback.js backup "$SRC" --repo "$REPO"
echo "--- second backup, nothing changed ---"
node bin/snapback.js backup "$SRC" --repo "$REPO"
echo "--- edit one line, back up again ---"
echo "todo: finish chapter three (done)" > "$SRC/todo.md"
node bin/snapback.js backup "$SRC" --repo "$REPO"
node bin/snapback.js status --repo "$REPO"
echo "Demo files live in $DEMO_DIR (deleted with it when you are done)."
