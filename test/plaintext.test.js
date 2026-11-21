const test = require('node:test');
const assert = require('node:assert');
const { plainText } = require('../renderer/plaintext.js');

test('plainText turns terminal control sequences into harmless text', () => {
  // OSC: set the window title; CSI: clear the screen; OSC 8: a hyperlink; C1 CSI (0x9b); BEL; DEL
  const nasty = '\x1b]0;pwned\x07\x1b[2J\x1b]8;;https://example.invalid\x1b\\link\x1b]8;;\x1b\\\x9b31m\x7f';
  const out = plainText(nasty);
  assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(out), JSON.stringify(out));
  assert.match(out, /pwned/); // the text itself stays readable
});

test('plainText leaves ordinary text, Turkish letters and emoji alone', () => {
  const s = 'Bağlanılamadı: bad job id — ığüşöç İĞÜŞÖÇ ✓ 🚀';
  assert.strictEqual(plainText(s), s);
});

test('plainText takes anything', () => {
  assert.strictEqual(plainText(null), '');
  assert.strictEqual(plainText(undefined), '');
  assert.strictEqual(plainText(42), '42');
  assert.strictEqual(plainText('a\r\nb\tc'), 'a  b c');
});
