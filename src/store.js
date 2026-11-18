'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * Content-addressed object store.
 *
 * Every chunk is stored once, under a path derived from its SHA-256 hash:
 *   objects/<first 2 hex chars>/<remaining 62 hex chars>
 * Two-level fan-out keeps any single directory small even with many chunks.
 * Writes are atomic (temp file + rename) so a crashed backup never leaves a
 * half-written object behind, and `put` is idempotent: storing the same
 * bytes twice is a no-op that reports "already present".
 */

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

class ObjectStore {
  constructor(objectsDir) {
    this.dir = objectsDir;
    fs.mkdirSync(objectsDir, { recursive: true });
  }

  objectPath(hash) {
    return path.join(this.dir, hash.slice(0, 2), hash.slice(2));
  }

  exists(hash) {
    try {
      fs.accessSync(this.objectPath(hash), fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Store `buffer`. Returns { hash, size, isNew }.
   */
  put(buffer) {
    const hash = sha256(buffer);
    const dest = this.objectPath(hash);
    if (this.exists(hash)) return { hash, size: buffer.length, isNew: false };
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, dest);
    return { hash, size: buffer.length, isNew: true };
  }

  /** Read a chunk back. Throws if the object is missing. */
  get(hash) {
    return fs.readFileSync(this.objectPath(hash));
  }

  /** Delete an object (used by prune's garbage collection). */
  delete(hash) {
    try {
      fs.unlinkSync(this.objectPath(hash));
      return true;
    } catch {
      return false;
    }
  }

  /** Number of stored objects, by walking the two-level fan-out. */
  count() {
    let total = 0;
    for (const bucket of fs.readdirSync(this.dir, { withFileTypes: true })) {
      if (!bucket.isDirectory()) continue;
      total += fs.readdirSync(path.join(this.dir, bucket.name)).length;
    }
    return total;
  }

  /** Total bytes held by the store. */
  bytes() {
    let total = 0;
    for (const bucket of fs.readdirSync(this.dir, { withFileTypes: true })) {
      if (!bucket.isDirectory()) continue;
      const dir = path.join(this.dir, bucket.name);
      for (const file of fs.readdirSync(dir)) {
        total += fs.statSync(path.join(dir, file)).size;
      }
    }
    return total;
  }
}

module.exports = { ObjectStore, sha256 };
