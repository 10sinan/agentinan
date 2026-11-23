// The shell drawer floats over the bottom of the window (it does not take space from the view), so the Claude
// terminal behind it keeps its size and its pty is never resized by the drawer. To keep the bottom of that
// terminal (Claude's input box) visible, the terminal is moved up by as much as the drawer covers of it; the top
// rows are hidden instead. Moving with a CSS transform changes no layout, so nothing fires a resize.
// Loaded by the page (window.dockShift) and by the tests.
(function (root) {
  // termBottom, dockTop: y coordinates (px) of the terminal box's bottom edge and the drawer's top edge.
  // Returns how many px the terminal has to move up; 0 when the drawer is closed or does not reach the terminal.
  function dockShift(termBottom, dockTop, open) {
    if (!open || !(termBottom > dockTop)) return 0;
    return Math.round(termBottom - dockTop);
  }
  if (typeof module === 'object' && module.exports) module.exports = { dockShift };
  else root.dockShift = dockShift;
})(typeof window !== 'undefined' ? window : globalThis);
