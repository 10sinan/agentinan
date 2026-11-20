// What the settings file and the page's settings:set calls may contain. Anything not listed here, or of the wrong
// type or outside its range, is dropped, so the page can't store arbitrary keys or junk in settings.json.
const path = require('path');

const bool = (v) => typeof v === 'boolean';
const int = (min, max) => (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const list = (maxItems, item) => (v) => Array.isArray(v) && v.length <= maxItems && v.every(item);
const str = (maxLen) => (v) => typeof v === 'string' && v.length > 0 && v.length <= maxLen;

const KEY_RE = /^((Ctrl|Alt|Shift|Meta)\+){0,4}\S{1,20}$/; // "Ctrl+Shift+N", "F5", "Ctrl+`"
const keys = (v) =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).every((k) => ['dock', 'newSession'].includes(k) && typeof v[k] === 'string' && v[k].length <= 40 && KEY_RE.test(v[k]));

// The page may change these.
const PAGE = {
  notifyWaiting: bool,
  notifyDone: bool,
  notifyLimits: bool,
  hogAlert: bool,
  trayKeep: bool,
  restoreOwn: bool,
  restoreShells: bool,
  quality: (v) => v === 'high' || v === 'low',
  theme: (v) => typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v),
  hogCpu: int(1, 1000), // % of one core
  hogSecs: int(1, 3600),
  hogMem: int(1, 100), // % of RAM
  hogIgnore: list(200, str(200)),
  keys,
};
// Only the main process sets these (the Source Control "add repository" dialog).
const INTERNAL = { gitRepos: list(200, (p) => typeof p === 'string' && path.isAbsolute(p) && p.length <= 4096) };

// A copy of `obj` with only the allowed keys whose values are valid. `internal` also allows main-only keys
// (used when reading settings.json, which main wrote).
function sanitize(obj, { internal = false } = {}) {
  const rules = internal ? { ...PAGE, ...INTERNAL } : PAGE;
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const k of Object.keys(rules)) {
    if (Object.prototype.hasOwnProperty.call(obj, k) && rules[k](obj[k])) out[k] = k === 'keys' ? { ...obj[k] } : obj[k];
  }
  return out;
}

module.exports = { sanitize, PAGE_KEYS: Object.keys(PAGE) };
