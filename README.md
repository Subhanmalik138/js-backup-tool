# SnapBack — CLI Backup Tool with Deduplication

A zero-dependency Node.js backup tool. Point it at a directory and it takes a
snapshot: every file is split into content-defined chunks, each chunk is
stored once under its SHA-256 hash, and the snapshot manifest records which
chunks make up each file. A second backup of an unchanged tree stores nothing
new; editing a file only stores the chunks that actually changed.

## Why this exists

Naive backup tools copy whole files. Change one line in a 500 MB virtual
machine image and they store another 500 MB. SnapBack stores data by content,
so identical bytes — repeated files, unchanged files, or the unchanged tail of
an edited file — are stored exactly once. The repository is just files on
disk (JSON manifests + a two-level object store), so it is inspectable with
ordinary tools and needs no server.

## Design decisions

1. **Content-defined chunking, not fixed-size blocks.** Chunk boundaries are
   found with a 32-bit rolling hash over a 64-byte window (cut when the low
   16 bits are all set, target ~64 KiB, clamped to 16–256 KiB). Because a
   boundary depends on the bytes around it, inserting data at the top of a
   file only re-chunks the head — every chunk after the next boundary is
   byte-identical and deduplicated. Verified by test: a 21-byte insertion
   leaves all tail chunks unchanged.
2. **Content-addressed object store.** Chunks live at
   `objects/<first 2 hex>/<rest of SHA-256>`. `put` is idempotent, writes are
   atomic (temp file + rename), and the store never holds two copies of the
   same bytes.
3. **Manifests are the whole truth.** Each snapshot is one small JSON file:
   file list, chunk hashes, sizes, mtimes and modes, plus aggregate stats.
   `list` and `prune` never touch chunk data. `verify` re-hashes every chunk
   a snapshot references and reports missing or corrupt objects.
4. **Prune is reference-counted garbage collection.** Deleting old snapshots
   only deletes chunks no remaining snapshot references, so a chunk shared
   between a kept and a pruned snapshot survives automatically.

## Install

Requires Node.js 18 or newer. No dependencies to install.

```bash
git clone https://github.com/Subhanmalik138/js-backup-tool.git
cd js-backup-tool
```

## Usage

```bash
# Create a repository (defaults to ./.snapback in the current directory)
node bin/snapback.js init ./my-backups

# Snapshot a directory
node bin/snapback.js backup ~/Documents --repo ./my-backups
# snapshot 20261118T14054-340fb5
#   files: 128 (12.4 MiB), dirs: 14, symlinks: 2
#   chunks: 214 total, 214 new, 0 B deduplicated
#   stored: 12.4 MiB

# Back it up again — unchanged files store nothing new
node bin/snapback.js backup ~/Documents --repo ./my-backups
#   chunks: 214 total, 0 new, 12.4 MiB deduplicated

# List snapshots, newest first
node bin/snapback.js list --repo ./my-backups

# Check repository health
node bin/snapback.js status --repo ./my-backups

# Verify a snapshot's chunks are intact
node bin/snapback.js verify 20261118T14054-340fb5 --repo ./my-backups

# Restore a snapshot (refuses a non-empty directory unless --force is given)
node bin/snapback.js restore 20261118T14054-340fb5 ./restored --repo ./my-backups

# Keep the 7 newest snapshots; delete the rest and their orphaned chunks
node bin/snapback.js prune --keep 7 --repo ./my-backups
```

Exclude patterns (repeatable, glob `*` / `**` / `?`):

```bash
node bin/snapback.js backup ~/project --repo ./my-backups \
  --exclude 'node_modules' --exclude '*.log' --exclude 'build/**'
```

Default excludes are `.snapback`, `.git` and `node_modules`. Symlinks are
stored as symlinks, empty files and empty directories are preserved, and
file mtimes and permission bits are restored.

## Repository layout

```
<repo>/
  config.json            { version, createdAt }
  objects/ab/cdef...     one file per unique chunk, named by its SHA-256
  snapshots/<id>.json    one manifest per snapshot
```

## Tests

```bash
npm test
```

24 tests, zero dependencies: chunker bounds/determinism/resync, object-store
round-trips, full backup → restore → verify → prune flows, and the CLI
end to end.

## Tech stack

- **Language:** JavaScript (Node.js ≥ 18, CommonJS)
- **Dependencies:** none — `node:crypto` for SHA-256, `node:fs` for storage
- **Tests:** `node:test` + `node:assert/strict`

## License

MIT
