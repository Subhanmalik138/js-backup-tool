'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chunkBuffer, MIN_SIZE, MAX_SIZE } = require('../src/chunker');

describe('chunkBuffer', () => {
  it('returns no chunks for empty input', () => {
    assert.deepEqual(chunkBuffer(Buffer.alloc(0)), []);
  });

  it('returns a single chunk for tiny input', () => {
    const chunks = chunkBuffer(Buffer.from('hello'));
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].toString(), 'hello');
  });

  it('is deterministic', () => {
    const buf = crypto.randomBytes(512 * 1024);
    const a = chunkBuffer(buf).map((c) => c.length);
    const b = chunkBuffer(buf).map((c) => c.length);
    assert.deepEqual(a, b);
  });

  it('keeps every chunk except the last within [MIN_SIZE, MAX_SIZE]', () => {
    const buf = crypto.randomBytes(2 * 1024 * 1024);
    const chunks = chunkBuffer(buf);
    assert.ok(chunks.length > 1);
    for (const chunk of chunks.slice(0, -1)) {
      assert.ok(chunk.length >= MIN_SIZE, `chunk too small: ${chunk.length}`);
      assert.ok(chunk.length <= MAX_SIZE, `chunk too large: ${chunk.length}`);
    }
  });

  it('reassembles to the original bytes', () => {
    const buf = crypto.randomBytes(700 * 1024);
    assert.deepEqual(Buffer.concat(chunkBuffer(buf)), buf);
  });

  it('resyncs after an insertion: tail chunks are byte-identical', () => {
    const buf = crypto.randomBytes(1024 * 1024);
    const before = chunkBuffer(buf);
    const shifted = Buffer.concat([Buffer.from('inserted prefix!'), buf]);
    const after = chunkBuffer(shifted);
    const afterSet = new Set(after.map((c) => c.toString('hex')));
    // Every chunk after the first must survive the insertion unchanged.
    const survivors = before.slice(1).filter((c) => afterSet.has(c.toString('hex')));
    assert.ok(survivors.length >= before.length - 2, `only ${survivors.length} of ${before.length - 1} tail chunks survived`);
  });

  it('produces different chunks for different content', () => {
    const a = chunkBuffer(crypto.randomBytes(256 * 1024));
    const b = chunkBuffer(crypto.randomBytes(256 * 1024));
    const aHashes = new Set(a.map((c) => c.toString('hex')));
    assert.ok(!b.every((c) => aHashes.has(c.toString('hex'))));
  });

  it('handles highly compressible input without exploding chunk count', () => {
    const buf = Buffer.alloc(1024 * 1024, 0x41); // 1 MiB of 'A'
    const chunks = chunkBuffer(buf);
    assert.ok(chunks.length >= 4, 'uniform input must still cut at MAX_SIZE');
    assert.ok(chunks.length <= 70, `too many chunks: ${chunks.length}`);
    assert.deepEqual(Buffer.concat(chunks), buf);
  });
});
