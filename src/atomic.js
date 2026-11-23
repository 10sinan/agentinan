// Atomic file writes: the text goes to a temp file next to the target, then rename() swaps it in, so a crash or a
// full disk never leaves a half-written file behind.
const fs = require('fs');

// Writes `text` to `file`. With `json: true` the text must parse as JSON first (nothing is written otherwise).
// The file mode of an existing target is kept; a new file gets 0600.
function writeFileAtomic(file, text, { json = false } = {}) {
  if (json) JSON.parse(text);
  let mode = 0o600;
  try {
    mode = fs.statSync(file).mode & 0o777;
  } catch {}
  const tmp = `${file}.agentinan.${process.pid}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'w', mode);
    try {
      fs.writeFileSync(fd, text);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

module.exports = { writeFileAtomic };
