'use strict';

const { ObjectStore, sha256 } = require('./store');
const { Repository } = require('./snapshot');

/**
 * Verify a snapshot's integrity.
 *
 * Every chunk a snapshot references is read back and re-hashed; a chunk
 * whose bytes no longer match its hash is corrupt, and a missing file is
 * reported rather than crashing the whole check. Verification never writes
 * anything, so it is safe to run on a live repository.
 */
function verifySnapshot({ repoDir, snapshotId }) {
  const repo = Repository.open(repoDir);
  const store = new ObjectStore(repo.objectsDir);
  const manifest = repo.loadSnapshot(snapshotId);

  const problems = [];
  let checkedChunks = 0;
  let checkedBytes = 0;
  for (const entry of manifest.files) {
    if (entry.type !== 'file') continue;
    for (const chunk of entry.chunks) {
      checkedChunks++;
      checkedBytes += chunk.size;
      if (!store.exists(chunk.hash)) {
        problems.push({ path: entry.path, hash: chunk.hash, problem: 'missing' });
        continue;
      }
      const data = store.get(chunk.hash);
      if (data.length !== chunk.size || sha256(data) !== chunk.hash) {
        problems.push({ path: entry.path, hash: chunk.hash, problem: 'corrupt' });
      }
    }
  }

  return {
    snapshotId: manifest.id,
    ok: problems.length === 0,
    checkedChunks,
    checkedBytes,
    problems,
  };
}

module.exports = { verifySnapshot };
