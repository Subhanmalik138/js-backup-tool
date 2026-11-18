'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ObjectStore } = require('./store');
const { Repository } = require('./snapshot');

/**
 * Restore a snapshot into `destDir`.
 *
 * Files are rebuilt by concatenating their chunks in manifest order, so a
 * restore only ever reads the chunks a snapshot actually references.
 * Directory entries recreate empty directories; symlinks are recreated as
 * symlinks; file mtimes and permission bits are restored where the platform
 * allows. Restoring into a non-empty directory is refused unless `--force`
 * is passed, so a typo can never clobber live data.
 */
function restoreSnapshot({ repoDir, snapshotId, destDir, force = false }) {
  const repo = Repository.open(repoDir);
  const store = new ObjectStore(repo.objectsDir);
  const manifest = repo.loadSnapshot(snapshotId);
  const absDest = path.resolve(destDir);

  if (fs.existsSync(absDest)) {
    if (!fs.statSync(absDest).isDirectory()) {
      throw new Error(`destination is not a directory: ${destDir}`);
    }
    if (!force && fs.readdirSync(absDest).length > 0) {
      throw new Error(
        `destination is not empty: ${destDir} (pass --force to overwrite)`
      );
    }
  }
  fs.mkdirSync(absDest, { recursive: true });

  let restoredFiles = 0;
  let restoredBytes = 0;
  for (const entry of manifest.files) {
    const target = path.join(absDest, entry.path);
    if (entry.type === 'dir') {
      fs.mkdirSync(target, { recursive: true });
    } else if (entry.type === 'symlink') {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      try {
        fs.unlinkSync(target);
      } catch {
        /* not present yet */
      }
      fs.symlinkSync(entry.target, target);
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const parts = entry.chunks.map((c) => store.get(c.hash));
      const data = Buffer.concat(parts);
      if (data.length !== entry.size) {
        throw new Error(
          `size mismatch restoring ${entry.path}: expected ${entry.size}, got ${data.length}`
        );
      }
      fs.writeFileSync(target, data);
      if (entry.mtimeMs) fs.utimesSync(target, new Date(entry.mtimeMs), new Date(entry.mtimeMs));
      if (entry.mode) {
        try {
          fs.chmodSync(target, entry.mode & 0o777);
        } catch {
          /* Windows ignores permission bits */
        }
      }
      restoredFiles++;
      restoredBytes += entry.size;
    }
  }

  return { snapshotId: manifest.id, destDir: absDest, restoredFiles, restoredBytes };
}

module.exports = { restoreSnapshot };
