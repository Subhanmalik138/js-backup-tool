'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Repository, REPO_DIRNAME } = require('./snapshot');
const { ObjectStore } = require('./store');
const { createBackup } = require('./backup');
const { restoreSnapshot } = require('./restore');
const { verifySnapshot } = require('./verify');
const { pruneSnapshots } = require('./prune');

const VERSION = '1.0.0';

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let v = n;
  let u = -1;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(1)} ${units[u]}`;
}

function defaultRepoDir() {
  return path.join(process.cwd(), REPO_DIRNAME);
}

/** Parse `--flag value` / `--flag=value` / `--bool` options after positionals. */
function parseOptions(args) {
  const positionals = [];
  const opts = { exclude: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const value = eq === -1 ? args[++i] : arg.slice(eq + 1);
      if (key === 'exclude') opts.exclude.push(value);
      else if (key === 'force') opts.force = true;
      else opts[key] = value === undefined ? true : value;
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, opts };
}

function usage() {
  return `SnapBack ${VERSION} — snapshot backups with content-addressed deduplication

Usage:
  snapback init [repo-dir]                        create a backup repository (default: ./${REPO_DIRNAME})
  snapback backup <source> [--repo dir] [--exclude glob ...]
                                                  snapshot a directory
  snapback list [--repo dir]                      list snapshots, newest first
  snapback restore <snapshot-id> <dest> [--repo dir] [--force]
                                                  restore a snapshot
  snapback verify <snapshot-id> [--repo dir]      re-hash every chunk a snapshot references
  snapback prune --keep <n> [--repo dir]          keep the n newest snapshots, delete the rest + orphaned chunks
  snapback status [--repo dir]                    repository size and snapshot count

Options:
  --repo <dir>     repository directory (default: ./${REPO_DIRNAME} in the current directory)
  --exclude <glob> skip matching paths when backing up (repeatable; default excludes: .snapback, .git, node_modules)
  --force          restore into a non-empty directory`;
}

function main(argv) {
  const [command, ...rest] = argv;
  const { positionals, opts } = parseOptions(rest);
  const repoDir = opts.repo ? path.resolve(opts.repo) : defaultRepoDir();

  switch (command) {
    case 'init': {
      const dir = positionals[0] ? path.resolve(positionals[0]) : defaultRepoDir();
      if (fs.existsSync(path.join(dir, 'config.json'))) {
        console.log(`repository already exists at ${dir}`);
        return 0;
      }
      new Repository(dir).init();
      console.log(`initialized SnapBack repository at ${dir}`);
      return 0;
    }

    case 'backup': {
      const source = positionals[0];
      if (!source) throw new Error('backup needs a source directory: snapback backup <source>');
      const excludes = opts.exclude.length > 0 ? opts.exclude : undefined;
      const manifest = createBackup({ repoDir, sourceDir: source, ...(excludes ? { excludes } : {}) });
      const s = manifest.stats;
      console.log(`snapshot ${manifest.id}`);
      console.log(`  files: ${s.files} (${formatBytes(s.bytes)}), dirs: ${s.dirs}, symlinks: ${s.symlinks}`);
      console.log(`  chunks: ${s.chunks} total, ${s.newChunks} new, ${formatBytes(s.dedupedBytes)} deduplicated`);
      console.log(`  stored: ${formatBytes(s.storedBytes)}`);
      return 0;
    }

    case 'list':
    case 'snapshots': {
      const repo = Repository.open(repoDir);
      const snaps = repo.listSnapshots();
      if (snaps.length === 0) {
        console.log('no snapshots yet');
        return 0;
      }
      for (const snap of snaps) {
        console.log(
          `${snap.id}  ${snap.createdAt}  ${snap.stats.files} files, ` +
            `${formatBytes(snap.stats.bytes)} (${formatBytes(snap.stats.storedBytes)} stored)  ${snap.source}`
        );
      }
      return 0;
    }

    case 'restore': {
      const [id, dest] = positionals;
      if (!id || !dest) throw new Error('usage: snapback restore <snapshot-id> <dest>');
      const result = restoreSnapshot({ repoDir, snapshotId: id, destDir: dest, force: !!opts.force });
      console.log(`restored snapshot ${result.snapshotId} to ${result.destDir}`);
      console.log(`  ${result.restoredFiles} files, ${formatBytes(result.restoredBytes)}`);
      return 0;
    }

    case 'verify': {
      const id = positionals[0];
      if (!id) throw new Error('usage: snapback verify <snapshot-id>');
      const result = verifySnapshot({ repoDir, snapshotId: id });
      if (result.ok) {
        console.log(
          `snapshot ${result.snapshotId} OK — ${result.checkedChunks} chunks, ${formatBytes(result.checkedBytes)} verified`
        );
        return 0;
      }
      console.log(`snapshot ${result.snapshotId} FAILED — ${result.problems.length} problem(s):`);
      for (const p of result.problems) console.log(`  ${p.problem}: ${p.path} (chunk ${p.hash.slice(0, 12)}…)`);
      return 1;
    }

    case 'prune': {
      const keep = Number(opts.keep);
      if (!opts.keep) throw new Error('usage: snapback prune --keep <n>');
      const result = pruneSnapshots({ repoDir, keep });
      console.log(
        `pruned ${result.deletedSnapshots.length} snapshot(s), kept ${result.keptSnapshots.length}`
      );
      console.log(`  deleted ${result.deletedObjects} orphaned chunk(s), freed ${formatBytes(result.freedBytes)}`);
      return 0;
    }

    case 'status': {
      const repo = Repository.open(repoDir);
      const store = new ObjectStore(repo.objectsDir);
      const snaps = repo.listSnapshots();
      console.log(`repository: ${repoDir}`);
      console.log(`snapshots: ${snaps.length}`);
      if (snaps.length > 0) console.log(`latest: ${snaps[0].id} (${snaps[0].createdAt})`);
      console.log(`stored chunks: ${store.count()} (${formatBytes(store.bytes())})`);
      return 0;
    }

    case '--help':
    case '-h':
    case 'help':
    case undefined:
      console.log(usage());
      return 0;

    case '--version':
    case '-v':
      console.log(`snapback ${VERSION}`);
      return 0;

    default:
      throw new Error(`unknown command: ${command}\n\n${usage()}`);
  }
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`snapback: ${err.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main, formatBytes };
