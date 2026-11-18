'use strict';

/**
 * Content-defined chunking.
 *
 * A file is split into variable-length chunks whose boundaries depend on the
 * file's *content*, not on fixed offsets. That is what makes deduplication
 * survive edits: inserting 100 bytes at the top of a file only re-chunks the
 * first chunk or two — every chunk after the next boundary is byte-identical
 * to the old ones and is stored once.
 *
 * The boundary test is a 32-bit rolling hash over a 64-byte window. A chunk
 * is cut when the low 16 bits of the hash are all set (expected chunk size
 * ~64 KiB), subject to a 16 KiB minimum and a 256 KiB maximum so pathological
 * input can neither produce a flood of tiny chunks nor one giant chunk.
 */

const WINDOW = 64;
const MIN_SIZE = 16 * 1024;
const TARGET_MASK = 0xffff; // cut when (hash & 0xffff) === 0xffff -> avg ~64 KiB
const MAX_SIZE = 256 * 1024;

// 31^WINDOW mod 2^32, for removing the byte that leaves the window.
// After seeding, hash = sum W[j]*31^(63-j). Rolling one step multiplies the
// whole window by 31, so the outgoing byte must be removed as W[0]*31^64.
const POW31 = (() => {
  let p = 1;
  for (let i = 0; i < WINDOW; i++) p = Math.imul(p, 31);
  return p >>> 0;
})();

/**
 * Split `buffer` into chunks. Returns an array of Buffers.
 * Deterministic: the same bytes always produce the same chunks.
 * Every chunk except possibly the last is within [MIN_SIZE, MAX_SIZE].
 */
function chunkBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  const chunks = [];
  if (buffer.length === 0) return chunks;

  let start = 0;
  let hash = 0;
  // Seed the window with the first WINDOW bytes (or fewer at the tail).
  const seedEnd = Math.min(WINDOW, buffer.length);
  for (let i = 0; i < seedEnd; i++) hash = (Math.imul(hash, 31) + buffer[i]) >>> 0;

  for (let i = WINDOW; i < buffer.length; i++) {
    const size = i - start;
    if (size >= MIN_SIZE && (hash & TARGET_MASK) === TARGET_MASK) {
      chunks.push(buffer.subarray(start, i));
      start = i;
      // Re-seed the window at the new chunk start.
      hash = 0;
      const end = Math.min(i + WINDOW, buffer.length);
      for (let j = i; j < end; j++) hash = (Math.imul(hash, 31) + buffer[j]) >>> 0;
      i = end - 1;
      continue;
    }
    if (size >= MAX_SIZE) {
      chunks.push(buffer.subarray(start, i));
      start = i;
      hash = 0;
      const end = Math.min(i + WINDOW, buffer.length);
      for (let j = i; j < end; j++) hash = (Math.imul(hash, 31) + buffer[j]) >>> 0;
      i = end - 1;
      continue;
    }
    // Roll the window forward by one byte: drop buffer[i - WINDOW], add buffer[i].
    const out = buffer[i - WINDOW];
    hash = (Math.imul(hash, 31) - Math.imul(out, POW31) + buffer[i]) >>> 0;
  }
  if (start < buffer.length) chunks.push(buffer.subarray(start));
  return chunks;
}

module.exports = { chunkBuffer, WINDOW, MIN_SIZE, MAX_SIZE };
