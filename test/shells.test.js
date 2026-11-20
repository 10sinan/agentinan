const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveCwd } = require('../src/shells');

test('a new shell starts in the asked-for folder when it exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentinan-sh-'));
  try {
    assert.strictEqual(resolveCwd(dir), dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('otherwise it starts in the home directory (missing, relative, a file, or nothing)', () => {
  const file = path.join(os.tmpdir(), `agentinan-sh-file-${process.pid}`);
  fs.writeFileSync(file, '');
  try {
    for (const bad of [undefined, null, '', 'relative/dir', '/no/such/dir/anywhere', file, 42]) {
      assert.strictEqual(resolveCwd(bad), os.homedir(), String(bad));
    }
  } finally {
    fs.rmSync(file, { force: true });
  }
});
