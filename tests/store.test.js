'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ObjectStore, sha256 } = require('../src/store');

describe('ObjectStore', () => {
  let dir;
  let store;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-store-'));
    store = new ObjectStore(path.join(dir, 'objects'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips bytes and reports the SHA-256 hash', () => {
    const data = Buffer.from('some chunk bytes');
    const { hash, size, isNew } = store.put(data);
    assert.equal(hash, sha256(data));
    assert.equal(size, data.length);
    assert.equal(isNew, true);
    assert.deepEqual(store.get(hash), data);
    assert.equal(store.exists(hash), true);
  });

  it('is idempotent: storing the same bytes twice stores one object', () => {
    const data = Buffer.from('deduplicate me');
    const first = store.put(data);
    const second = store.put(data);
    assert.equal(first.hash, second.hash);
    assert.equal(second.isNew, false);
    assert.equal(store.count(), 1);
  });

  it('fans objects out into two-level directories', () => {
    const { hash } = store.put(Buffer.from('fanout'));
    assert.ok(fs.existsSync(path.join(dir, 'objects', hash.slice(0, 2), hash.slice(2))));
  });

  it('reports missing hashes as not existing and throws on get', () => {
    const fake = '0'.repeat(64);
    assert.equal(store.exists(fake), false);
    assert.throws(() => store.get(fake));
  });

  it('deletes objects and tracks count and bytes', () => {
    const a = store.put(Buffer.from('aaa'));
    store.put(Buffer.from('bbbb'));
    assert.equal(store.count(), 2);
    assert.equal(store.bytes(), 7);
    assert.equal(store.delete(a.hash), true);
    assert.equal(store.count(), 1);
    assert.equal(store.delete(a.hash), false);
  });
});
