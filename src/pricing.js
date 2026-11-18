// Anthropic API list prices, USD per million tokens: [input, output, cacheRead].
// cacheRead null means the usual 0.1 × input. Cache writes: 5 minutes 1.25 × input, 1 hour 2 × input.
// Claude Code on a Pro/Max plan doesn't bill these; they're only an estimate of what the same work would cost on the API.
const PRICES = {
  'claude-fable-5-2': [8, 40, 0.2],
  'claude-mythos-5-2': [8, 40, 0.2],
  'claude-fable-5-1': [10, 50, null],
  'claude-mythos-5-1': [10, 50, null],
  'claude-fable-5': [10, 50, null],
  'claude-opus-5-5': [4, 20, 0.2],
  'claude-opus-5': [5, 25, null],
  'claude-opus-4-8': [5, 25, null],
  'claude-opus-4-7': [5, 25, null],
  'claude-opus-4-6': [5, 25, null],
  'claude-opus-4-5': [5, 25, null],
  'claude-sonnet-5-5': [2, 10, 0.1],
  'claude-sonnet-5': [2, 10, null],
  'claude-sonnet-4-6': [3, 15, null],
  'claude-sonnet-4-5': [3, 15, null],
  'claude-haiku-5-5': [0.1, 0.5, null],
  'claude-haiku-4-5': [1, 5, null],
  // older models
  'claude-opus-4-1': [15, 75, null],
  'claude-opus-4': [15, 75, null],
  'claude-sonnet-4': [3, 15, null],
  'claude-3-7-sonnet': [3, 15, null],
  'claude-3-5-sonnet': [3, 15, null],
  'claude-3-5-haiku': [0.8, 4, null],
  'claude-3-opus': [15, 75, null],
  'claude-3-haiku': [0.25, 1.25, null],
};

const FAMILY_FALLBACK = { fable: 'claude-fable-5-2', mythos: 'claude-mythos-5-2', opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' };

const KEYS = Object.keys(PRICES).sort((a, b) => b.length - a.length);

function exactKey(model) {
  if (!model) return null;
  const m = String(model).toLowerCase().replace(/^.*?(claude-)/, '$1');
  for (const k of KEYS) if (m === k || m.startsWith(k + '-') || m.startsWith(k + '@') || m.startsWith(k + '[')) return k;
  return null;
}

// For pricing an id we don't know, fall back to the newest model of its family (an estimate either way).
function priceKey(model) {
  const k = exactKey(model);
  if (k || !model) return k;
  const m = String(model).toLowerCase();
  for (const [fam, f] of Object.entries(FAMILY_FALLBACK)) if (m.includes(fam)) return f;
  return null;
}

// u: { input, output, cacheWrite5m, cacheWrite1h, cacheRead }
function costOf(model, u) {
  const k = priceKey(model);
  if (!k) return 0;
  const [inp, out, read] = PRICES[k];
  const r = read == null ? inp * 0.1 : read;
  return (u.input * inp + u.output * out + u.cacheWrite5m * inp * 1.25 + u.cacheWrite1h * inp * 2 + u.cacheRead * r) / 1e6;
}

// "claude-opus-4-1" → "Opus 4.1", "claude-3-5-haiku" → "Haiku 3.5"; an unknown id is shown as it is.
function prettyModel(model) {
  const k = exactKey(model);
  if (!k) return model ? String(model).replace(/^claude-/, '') : '?';
  const parts = k.split('-').slice(1);
  const fam = parts.find((x) => /^[a-z]+$/.test(x));
  const ver = parts.filter((x) => /^\d+$/.test(x)).join('.');
  return fam[0].toUpperCase() + fam.slice(1) + ' ' + ver;
}

module.exports = { costOf, priceKey, prettyModel };
