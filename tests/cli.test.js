'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'snapback.js');

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
}

describe('CLI', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-cli-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('prints help and version', () => {
    assert.match(run(['--help']).stdout, /SnapBack/);
    assert.match(run(['--version']).stdout, /snapback 1\.0\.0/);
    assert.equal(run(['nonsense']).status, 1);
  });

  it('runs the full workflow: init, backup, list, status, verify, restore, prune', () => {
    const src = path.join(tmp, 'data');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'a.txt'), 'cli test data\n'.repeat(100));
    const repo = path.join(tmp, 'repo');

    assert.equal(run(['init', repo]).status, 0);
    assert.match(run(['init', repo]).stdout, /already exists/);

    const backup = run(['backup', src, '--repo', repo]);
    assert.equal(backup.status, 0, backup.stderr);
    const id = backup.stdout.match(/snapshot (\S+)/)[1];

    const list = run(['list', '--repo', repo]);
    assert.equal(list.status, 0);
    assert.ok(list.stdout.includes(id));

    assert.match(run(['status', '--repo', repo]).stdout, /snapshots: 1/);

    const verify = run(['verify', id, '--repo', repo]);
    assert.equal(verify.status, 0, verify.stderr);
    assert.match(verify.stdout, /OK/);

    const dest = path.join(tmp, 'out');
    const restore = run(['restore', id, dest, '--repo', repo]);
    assert.equal(restore.status, 0, restore.stderr);
    assert.equal(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8'), 'cli test data\n'.repeat(100));

    const prune = run(['prune', '--keep', '1', '--repo', repo]);
    assert.equal(prune.status, 0);
    assert.match(prune.stdout, /kept 1/);
  });

  it('fails cleanly when the repo does not exist', () => {
    const result = run(['list', '--repo', path.join(tmp, 'missing')]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no SnapBack repository/);
  });
});
