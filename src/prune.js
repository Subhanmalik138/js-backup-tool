'use strict';

const { ObjectStore } = require('./store');
const { Repository } = require('./snapshot');

/**
 * Retention pruning with garbage collection.
 *
 * Keeps the `keep` newest snapshots and deletes the rest, then walks the
 * object store and deletes every chunk no remaining snapshot references.
 * Because chunks are content-addressed, a chunk shared by a kept snapshot
 * and a pruned one survives automatically — the reference set decides.
 */
function pruneSnapshots({ repoDir, keep }) {
  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error('--keep must be a positive integer');
  }
  const repo = Repository.open(repoDir);
  const store = new ObjectStore(repo.objectsDir);
  const snapshots = repo.listSnapshots(); // newest first

  const toDelete = snapshots.slice(keep);
  for (const snap of toDelete) repo.deleteSnapshot(snap.id);

  // Reference set: every chunk hash still reachable from a kept snapshot.
  const referenced = new Set();
  for (const snap of snapshots.slice(0, keep)) {
    for (const entry of snap.files) {
      if (entry.type !== 'file') continue;
      for (const chunk of entry.chunks) referenced.add(chunk.hash);
    }
  }

  // Garbage-collect unreferenced objects by scanning the two-level fan-out.
  const fs = require('node:fs');
  const path = require('node:path');
  let deletedObjects = 0;
  let freedBytes = 0;
  for (const bucket of fs.readdirSync(store.dir, { withFileTypes: true })) {
    if (!bucket.isDirectory()) continue;
    const dir = path.join(store.dir, bucket.name);
    for (const file of fs.readdirSync(dir)) {
      const hash = bucket.name + file;
      if (!referenced.has(hash)) {
        freedBytes += fs.statSync(path.join(dir, file)).size;
        fs.unlinkSync(path.join(dir, file));
        deletedObjects++;
      }
    }
  }

  return {
    deletedSnapshots: toDelete.map((s) => s.id),
    keptSnapshots: snapshots.slice(0, keep).map((s) => s.id),
    deletedObjects,
    freedBytes,
  };
}

module.exports = { pruneSnapshots };
