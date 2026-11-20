// Path checks for things the page asks the main process to touch.
const fs = require('fs');
const path = require('path');

// True when `p` is an absolute path to an existing directory (following symlinks, like opening it would).
function isDirectory(p) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) return false;
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// The real path of `p` (symlinks resolved) when it lies under `root` and, if `ext` is given, ends with it;
// otherwise null. A symlink inside `root` that points outside is therefore refused.
function realInside(root, p, ext) {
  try {
    const base = fs.realpathSync(root);
    const real = fs.realpathSync(p);
    if (!real.startsWith(base + path.sep)) return null;
    if (ext && !real.endsWith(ext)) return null;
    return real;
  } catch {
    return null;
  }
}

module.exports = { isDirectory, realInside };
