'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * Snapshot model + repository layout.
 *
 * A backup repository is a plain directory:
 *
 *   <repo>/
 *     config.json            { version, createdAt }
 *     objects/               content-addressed chunks (see store.js)
 *     snapshots/<id>.json    one manifest per snapshot
 *
 * A snapshot manifest is the whole truth about one point in time: the file
 * list, each file's chunk hashes, sizes and mtimes, and aggregate stats.
 * Manifests are small JSON, so `list` and `prune` never touch chunk data.
 */

const REPO_DIRNAME = '.snapback';

function snapshotId() {
  // Timestamp (sortable) + 6 random hex chars to stay unique within a second.
  const ts = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 14);
  return `${ts}-${crypto.randomBytes(3).toString('hex')}`;
}

class Repository {
  constructor(root) {
    this.root = path.resolve(root);
    this.objectsDir = path.join(this.root, 'objects');
    this.snapshotsDir = path.join(this.root, 'snapshots');
  }

  get configPath() {
    return path.join(this.root, 'config.json');
  }

  exists() {
    return fs.existsSync(this.configPath);
  }

  init() {
    fs.mkdirSync(this.objectsDir, { recursive: true });
    fs.mkdirSync(this.snapshotsDir, { recursive: true });
    fs.writeFileSync(
      this.configPath,
      JSON.stringify({ version: 1, createdAt: new Date().toISOString() }, null, 2) + '\n'
    );
    return this;
  }

  static open(root) {
    const repo = new Repository(root);
    if (!repo.exists()) {
      throw new Error(
        `no SnapBack repository at ${root} — run 'snapback init <dir>' first`
      );
    }
    return repo;
  }

  saveSnapshot(manifest) {
    const file = path.join(this.snapshotsDir, `${manifest.id}.json`);
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n');
    fs.renameSync(tmp, file);
    return manifest;
  }

  loadSnapshot(id) {
    const file = path.join(this.snapshotsDir, `${id}.json`);
    if (!fs.existsSync(file)) throw new Error(`snapshot not found: ${id}`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  /** All manifests, newest first. */
  listSnapshots() {
    if (!fs.existsSync(this.snapshotsDir)) return [];
    return fs
      .readdirSync(this.snapshotsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(this.snapshotsDir, f), 'utf8')))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  deleteSnapshot(id) {
    fs.unlinkSync(path.join(this.snapshotsDir, `${id}.json`));
  }
}

module.exports = { Repository, snapshotId, REPO_DIRNAME };
