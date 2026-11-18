'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chunkBuffer } = require('./chunker');
const { ObjectStore } = require('./store');
const { Repository, snapshotId } = require('./snapshot');
const { walkDir, DEFAULT_EXCLUDES } = require('./walker');

/**
 * Create a snapshot of `sourceDir` inside the repository at `repoDir`.
 *
 * Every file is content-defined chunked and each chunk is stored once in the
 * object store, so a second backup of an unchanged tree stores zero new
 * chunks, and an edited file only stores the chunks that actually changed.
 * Returns the saved manifest.
 */
function createBackup({ repoDir, sourceDir, excludes = DEFAULT_EXCLUDES }) {
  const repo = Repository.open(repoDir);
  const store = new ObjectStore(repo.objectsDir);
  const absSource = path.resolve(sourceDir);
  if (!fs.existsSync(absSource) || !fs.statSync(absSource).isDirectory()) {
    throw new Error(`source is not a directory: ${sourceDir}`);
  }

  const manifest = {
    id: snapshotId(),
    createdAt: new Date().toISOString(),
    source: absSource,
    files: [],
    stats: {
      files: 0,
      dirs: 0,
      symlinks: 0,
      bytes: 0,
      chunks: 0,
      newChunks: 0,
      dedupedBytes: 0,
      storedBytes: 0,
    },
  };

  for (const entry of walkDir(absSource, excludes)) {
    if (entry.type === 'dir') {
      manifest.files.push({ type: 'dir', path: entry.path });
      manifest.stats.dirs++;
    } else if (entry.type === 'symlink') {
      manifest.files.push({ type: 'symlink', path: entry.path, target: entry.target });
      manifest.stats.symlinks++;
    } else {
      const data = fs.readFileSync(path.join(absSource, entry.path));
      const chunks = [];
      for (const chunk of chunkBuffer(data)) {
        const { hash, size, isNew } = store.put(chunk);
        chunks.push({ hash, size });
        manifest.stats.chunks++;
        if (isNew) {
          manifest.stats.newChunks++;
          manifest.stats.storedBytes += size;
        } else {
          manifest.stats.dedupedBytes += size;
        }
      }
      manifest.files.push({
        type: 'file',
        path: entry.path,
        size: entry.size,
        mtimeMs: entry.mtimeMs,
        mode: entry.mode,
        chunks,
      });
      manifest.stats.files++;
      manifest.stats.bytes += entry.size;
    }
  }

  return repo.saveSnapshot(manifest);
}

module.exports = { createBackup };
