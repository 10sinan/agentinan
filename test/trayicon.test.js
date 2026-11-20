const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { trayIcon, crc32 } = require('../src/trayicon');

test('crc32 matches the standard check value', () => {
  assert.strictEqual(crc32(Buffer.from('123456789')).toString(16), 'cbf43926');
});

test('tray icons are valid RGBA PNGs of the asked size, with a transparent corner', () => {
  for (const state of ['waiting', 'busy', 'idle']) {
    const p = trayIcon(state, 32);
    assert.deepStrictEqual([...p.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.strictEqual(p.readUInt32BE(16), 32); // IHDR width
    assert.strictEqual(p.readUInt32BE(20), 32); // IHDR height
    // every chunk's CRC is right
    let at = 8;
    let idat = null;
    while (at < p.length) {
      const len = p.readUInt32BE(at);
      const type = p.toString('ascii', at + 4, at + 8);
      assert.strictEqual(p.readUInt32BE(at + 8 + len), crc32(p.subarray(at + 4, at + 8 + len)), type);
      if (type === 'IDAT') idat = p.subarray(at + 8, at + 8 + len);
      at += 12 + len;
    }
    const raw = zlib.inflateSync(idat);
    assert.strictEqual(raw.length, (32 * 4 + 1) * 32);
    assert.strictEqual(raw[1 + 3], 0); // top-left pixel is transparent
    const mid = 16 * (32 * 4 + 1) + 1 + 16 * 4;
    assert.strictEqual(raw[mid + 3], 255); // the sun's middle is opaque
  }
});
