// The packaged app must ship every three.js add-on the map imports. electron-builder always leaves folders named
// "examples" out of node_modules (NodeModuleCopyHelper's excludedFiles, not overridable), and three's add-ons live in
// three/examples/jsm, so package.json copies the folders it needs with an explicit file set. A new add-on from a
// folder not listed there would work in `npm start` and break only the package: this test catches that.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function addonImports() {
  const out = new Set();
  for (const f of fs.readdirSync(path.join(root, 'renderer'))) {
    if (!/\.m?js$/.test(f)) continue;
    const src = fs.readFileSync(path.join(root, 'renderer', f), 'utf8');
    for (const m of src.matchAll(/from\s+['"]three\/addons\/([^'"]+)['"]/g)) out.add(m[1]);
  }
  return [...out];
}

// the files an add-on pulls in through relative imports, followed inside three/examples/jsm
function withDeps(rel) {
  const base = path.join(root, 'node_modules', 'three', 'examples', 'jsm');
  const seen = new Set();
  const todo = [rel];
  while (todo.length) {
    const r = path.normalize(todo.pop());
    if (seen.has(r)) continue;
    seen.add(r);
    const src = fs.readFileSync(path.join(base, r), 'utf8');
    for (const m of src.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) todo.push(path.join(path.dirname(r), m[1]));
  }
  return [...seen];
}

test('every three.js add-on the map imports (and what it imports) is in the package file set', () => {
  const set = pkg.build.files.find((f) => f && typeof f === 'object' && f.from === 'node_modules/three/examples/jsm');
  assert.ok(set, 'package.json build.files has the three/examples/jsm file set');
  assert.strictEqual(set.to, 'node_modules/three/examples/jsm'); // same place: the page's import map stays as it is
  const dirs = new Set(set.filter.map((p) => p.replace(/\/\*\*$/, '')));
  const used = addonImports();
  assert.ok(used.length >= 5, `found the map's add-on imports (${used.join(', ')})`);
  for (const a of used) {
    for (const f of withDeps(a)) assert.ok(dirs.has(f.split(path.sep)[0]), `${f} (from three/addons/${a}) is not packaged`);
  }
});
