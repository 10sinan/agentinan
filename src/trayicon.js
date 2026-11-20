// Tray icons drawn in code: a small glowing sun whose colour tells the state of the sessions
// (waiting for you / working / all idle). Encoded as PNG by hand so no image library is needed.
const zlib = require('zlib');

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// rgba: Uint8Array of size*size*4
function png(size, rgba) {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0);
  head.writeUInt32BE(size, 4);
  head[8] = 8; // bit depth
  head[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // no filter
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// A disc with a soft glow; `dot` adds a small badge in the corner (something waits for you).
function sunIcon(color, { size = 32, dot = null } = {}) {
  const [r, g, b] = hex(color);
  const px = new Uint8Array(size * size * 4);
  const c = size / 2;
  const R = size * 0.3;
  const put = (i, cr, cg, cb, a) => {
    // "over" blend onto what is there
    const da = px[i + 3] / 255;
    const oa = a + da * (1 - a);
    if (oa <= 0) return;
    px[i] = Math.round((cr * a + px[i] * da * (1 - a)) / oa);
    px[i + 1] = Math.round((cg * a + px[i + 1] * da * (1 - a)) / oa);
    px[i + 2] = Math.round((cb * a + px[i + 2] * da * (1 - a)) / oa);
    px[i + 3] = Math.round(oa * 255);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      const glow = Math.max(0, 1 - (d - R) / (size * 0.2));
      if (d > R) put(i, r, g, b, 0.45 * glow * glow);
      else {
        // brighter toward the top-left, like the sun on the map
        const lit = 1 - Math.hypot(x + 0.5 - c * 0.8, y + 0.5 - c * 0.8) / (R * 1.6);
        const k = 0.55 + 0.45 * Math.max(0, lit);
        put(i, Math.min(255, r * k + 255 * (1 - k) * 0.35), Math.min(255, g * k + 255 * (1 - k) * 0.35), Math.min(255, b * k + 255 * (1 - k) * 0.35), Math.min(1, R - d + 0.5));
      }
      if (dot) {
        const [dr, dg, db] = hex(dot);
        const dd = Math.hypot(x + 0.5 - size * 0.78, y + 0.5 - size * 0.22);
        const rr = size * 0.14;
        if (dd < rr + 1.5) put(i, 12, 14, 24, Math.min(1, rr + 1.5 - dd)); // dark outline
        if (dd < rr) put(i, dr, dg, db, Math.min(1, rr - dd + 0.5));
      }
    }
  }
  return png(size, px);
}

const TRAY = {
  waiting: { color: '#ff5a6e', dot: '#ffffff' },
  busy: { color: '#ffb340' },
  idle: { color: '#8a96b8' },
};
const trayIcon = (state, size) => sunIcon(TRAY[state].color, { size, dot: TRAY[state].dot });

module.exports = { trayIcon, png, crc32 };
