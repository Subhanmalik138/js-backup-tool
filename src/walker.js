'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Recursive directory walker with glob excludes.
 *
 * Yields one entry per file, directory and symlink, in sorted order so two
 * backups of the same tree produce identical manifests. Paths in entries are
 * POSIX-style and relative to the walk root, which keeps snapshots portable
 * across machines.
 */

const DEFAULT_EXCLUDES = ['.snapback', '.git', 'node_modules'];

/** Convert a small glob (`*`, `**`, `?`) to a RegExp matched against a path. */
function globToRegExp(glob) {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**` crosses directory boundaries; an optional trailing slash too.
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`${re}$`);
}

/**
 * A pattern matches a path if it matches the whole path, any trailing
 * segment (so `node_modules` excludes it at any depth), or any leading
 * directory prefix (so `build` excludes `build/output.js` too).
 */
function matchesPattern(pattern, relPosix) {
  const re = globToRegExp(pattern);
  if (re.test(relPosix)) return true;
  const parts = relPosix.split('/');
  for (let i = 1; i <= parts.length; i++) {
    if (re.test(parts.slice(0, i).join('/'))) return true;
    if (re.test(parts.slice(-i).join('/'))) return true;
  }
  return false;
}

function isExcluded(relPosix, excludes) {
  return excludes.some((p) => matchesPattern(p, relPosix));
}

/**
 * Walk `root` depth-first. Yields entries:
 *   { type: 'dir'|'file'|'symlink', path, size?, mtimeMs?, mode?, target? }
 * `excludes` are glob patterns matched against relative POSIX paths.
 */
function* walkDir(root, excludes = DEFAULT_EXCLUDES) {
  const absRoot = path.resolve(root);
  const stack = [{ abs: absRoot, rel: '' }];
  while (stack.length > 0) {
    const { abs, rel } = stack.pop();
    const entries = fs
      .readdirSync(abs, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    // Push in reverse so popping yields sorted order.
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      const childAbs = path.join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (isExcluded(childRel, excludes)) continue;
      if (entry.isDirectory()) {
        yield { type: 'dir', path: childRel };
        stack.push({ abs: childAbs, rel: childRel });
      } else if (entry.isSymbolicLink()) {
        yield {
          type: 'symlink',
          path: childRel,
          target: fs.readlinkSync(childAbs),
        };
      } else if (entry.isFile()) {
        const stat = fs.statSync(childAbs);
        yield {
          type: 'file',
          path: childRel,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          mode: stat.mode,
        };
      }
      // Sockets, FIFOs and devices are skipped: they have no stable bytes.
    }
  }
}

module.exports = { walkDir, globToRegExp, matchesPattern, DEFAULT_EXCLUDES };
