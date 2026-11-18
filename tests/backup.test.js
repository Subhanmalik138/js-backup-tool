'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Repository } = require('../src/snapshot');
const { ObjectStore } = require('../src/store');
const { createBackup } = require('../src/backup');
const { restoreSnapshot } = require('../src/restore');
const { verifySnapshot } = require('../src/verify');
const { pruneSnapshots } = require('../src/prune');

function makeTree(base) {
  fs.mkdirSync(path.join(base, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(base, 'empty-dir'), { recursive: true });
  fs.writeFileSync(path.join(base, 'hello.txt'), 'hello world\n'.repeat(3000));
  fs.writeFileSync(path.join(base, 'docs', 'notes.md'), '# notes\nsome text\n');
  fs.writeFileSync(path.join(base, 'empty.txt'), '');
  fs.symlinkSync('hello.txt', path.join(base, 'link.txt'));
}

function treeBytes(dir) {
  const out = {};
  const walk = (d, rel = '') => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, r);
      else if (e.isSymbolicLink()) out[r] = { symlink: fs.readlinkSync(p) };
      else if (e.isFile()) out[r] = fs.readFileSync(p).toString('utf8');
    }
  };
  walk(dir);
  return out;
}

describe('backup / restore / verify / prune', () => {
  let tmp;
  let src;
  let repoDir;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-'));
    src = path.join(tmp, 'src');
    repoDir = path.join(tmp, 'repo');
    fs.mkdirSync(src, { recursive: true });
    makeTree(src);
    new Repository(repoDir).init();
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('backs up and restores a tree byte-identically, including empty files, empty dirs and symlinks', () => {
    const manifest = createBackup({ repoDir, sourceDir: src });
    assert.equal(manifest.stats.files, 3);
    assert.equal(manifest.stats.dirs, 2);
    assert.equal(manifest.stats.symlinks, 1);

    const dest = path.join(tmp, 'restored');
    const result = restoreSnapshot({ repoDir, snapshotId: manifest.id, destDir: dest });
    assert.equal(result.restoredFiles, 3);
    assert.deepEqual(treeBytes(dest), treeBytes(src));
  });

  it('stores zero new chunks for an unchanged re-backup', () => {
    const first = createBackup({ repoDir, sourceDir: src });
    const second = createBackup({ repoDir, sourceDir: src });
    assert.equal(second.stats.newChunks, 0);
    assert.ok(second.stats.dedupedBytes > 0);
    assert.equal(second.stats.chunks, first.stats.chunks);
  });

  it('stores only the changed chunks after an append', () => {
    const first = createBackup({ repoDir, sourceDir: src });
    fs.appendFileSync(path.join(src, 'hello.txt'), 'one more line\n');
    const second = createBackup({ repoDir, sourceDir: src });
    assert.ok(second.stats.newChunks < second.stats.chunks, 'append should reuse most chunks');
    assert.ok(second.stats.newChunks >= 1);
    assert.equal(new Repository(repoDir).listSnapshots().length, 2);
    void first;
  });

  it('respects exclude globs', () => {
    fs.mkdirSync(path.join(src, 'node_modules', 'dep'), { recursive: true });
    fs.writeFileSync(path.join(src, 'node_modules', 'dep', 'index.js'), 'code');
    fs.writeFileSync(path.join(src, 'skip.log'), 'log');
    const manifest = createBackup({ repoDir, sourceDir: src, excludes: ['node_modules', '*.log'] });
    const paths = manifest.files.map((f) => f.path);
    assert.ok(!paths.some((p) => p.startsWith('node_modules')));
    assert.ok(!paths.includes('skip.log'));
    assert.ok(paths.includes('hello.txt'));
  });

  it('verifies a healthy snapshot and flags a corrupted chunk', () => {
    const manifest = createBackup({ repoDir, sourceDir: src });
    const ok = verifySnapshot({ repoDir, snapshotId: manifest.id });
    assert.equal(ok.ok, true);
    assert.ok(ok.checkedChunks > 0);

    // Corrupt one stored object in place.
    const store = new ObjectStore(path.join(repoDir, 'objects'));
    const fileEntry = manifest.files.find((f) => f.type === 'file' && f.chunks.length > 0);
    const victim = fileEntry.chunks[0].hash;
    const objectPath = store.objectPath(victim);
    const data = fs.readFileSync(objectPath);
    data[0] ^= 0xff;
    fs.writeFileSync(objectPath, data);

    const bad = verifySnapshot({ repoDir, snapshotId: manifest.id });
    assert.equal(bad.ok, false);
    assert.equal(bad.problems[0].problem, 'corrupt');
    assert.equal(bad.problems[0].path, fileEntry.path);
  });

  it('prune keeps the newest N snapshots and garbage-collects orphaned chunks', () => {
    const first = createBackup({ repoDir, sourceDir: src });
    fs.writeFileSync(path.join(src, 'hello.txt'), 'completely different content '.repeat(5000));
    createBackup({ repoDir, sourceDir: src });
    const store = new ObjectStore(path.join(repoDir, 'objects'));
    const before = store.count();
    assert.ok(before > 0);

    const result = pruneSnapshots({ repoDir, keep: 1 });
    assert.deepEqual(result.deletedSnapshots, [first.id]);
    assert.equal(result.keptSnapshots.length, 1);
    assert.ok(result.deletedObjects > 0, 'chunks unique to the pruned snapshot should be collected');
    assert.ok(store.count() < before);

    // The kept snapshot still verifies and restores.
    const kept = result.keptSnapshots[0];
    assert.equal(verifySnapshot({ repoDir, snapshotId: kept }).ok, true);
    assert.equal(new Repository(repoDir).listSnapshots().length, 1);
  });

  it('refuses to restore into a non-empty directory without --force', () => {
    const manifest = createBackup({ repoDir, sourceDir: src });
    const dest = path.join(tmp, 'busy');
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, 'keep.txt'), 'do not overwrite');
    assert.throws(() => restoreSnapshot({ repoDir, snapshotId: manifest.id, destDir: dest }), /not empty/);
    const result = restoreSnapshot({ repoDir, snapshotId: manifest.id, destDir: dest, force: true });
    assert.equal(result.restoredFiles, 3);
  });

  it('rejects backing up a missing source and opening a missing repo', () => {
    assert.throws(() => createBackup({ repoDir, sourceDir: path.join(tmp, 'nope') }), /not a directory/);
    assert.throws(() => createBackup({ repoDir: path.join(tmp, 'no-repo'), sourceDir: src }), /no SnapBack repository/);
    assert.throws(() => pruneSnapshots({ repoDir, keep: 0 }), /positive integer/);
  });
});
