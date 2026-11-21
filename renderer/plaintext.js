// Text we write into an xterm ourselves (a message, not the terminal's own output) must stay text: an ESC, CSI or
// OSC sequence in it would be run by the terminal (change the title, colours, cursor, write a hyperlink, …).
// Control characters (C0, DEL, C1) become spaces. Loaded by the page (window.plainText) and by the tests.
(function (root) {
  function plainText(s) {
    return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
  }
  if (typeof module === 'object' && module.exports) module.exports = { plainText };
  else root.plainText = plainText;
})(typeof window !== 'undefined' ? window : globalThis);
