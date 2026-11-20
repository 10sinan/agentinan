// Only the app's own page may talk to the main process. Every ipcMain.handle / ipcMain.on handler is wrapped once,
// here, so a handler added later is covered without remembering to check: a frame that is not the top frame of
// renderer/index.html (a navigated-away window, an iframe, a webview) gets nothing.
const path = require('path');
const { pathToFileURL } = require('url');

// True when `url` is exactly the local file `allowedFile` (a hash or query on it does not matter).
function isTrustedUrl(url, allowedFile) {
  if (typeof url !== 'string') return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === 'file:' && u.pathname === pathToFileURL(path.resolve(allowedFile)).pathname;
}

// A frame is trusted when it is a top-level frame showing the allowed page.
function isTrustedFrame(frame, allowedFile) {
  return !!frame && frame.parent === null && isTrustedUrl(frame.url, allowedFile);
}

// Replaces ipcMain.handle and ipcMain.on with versions that check event.senderFrame first.
function guardIpc(ipcMain, allowedFile, onDenied = () => {}) {
  const handle = ipcMain.handle.bind(ipcMain);
  const on = ipcMain.on.bind(ipcMain);
  ipcMain.handle = (channel, fn) =>
    handle(channel, (e, ...args) => {
      if (!isTrustedFrame(e.senderFrame, allowedFile)) {
        onDenied(channel, e.senderFrame && e.senderFrame.url);
        throw new Error('Yetkisiz kaynak');
      }
      return fn(e, ...args);
    });
  ipcMain.on = (channel, fn) =>
    on(channel, (e, ...args) => {
      if (!isTrustedFrame(e.senderFrame, allowedFile)) return onDenied(channel, e.senderFrame && e.senderFrame.url);
      return fn(e, ...args);
    });
}

module.exports = { isTrustedUrl, isTrustedFrame, guardIpc };
