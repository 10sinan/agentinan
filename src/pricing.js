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
};

const FAMILY_FALLBACK = { fable: 'claude-fable-5-2', mythos: 'claude-mythos-5-2', opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' };

const KEYS = Object.keys(PRICES).sort((a, b) => b.length - a.length);

function priceKey(model) {
  if (!model) return null;
  const m = String(model).toLowerCase().replace(/^.*?(claude-)/, '$1');
  for (const k of KEYS) if (m === k || m.startsWith(k + '-') || m.startsWith(k + '@') || m.startsWith(k + '[')) return k;
  for (const [fam, k] of Object.entries(FAMILY_FALLBACK)) if (m.includes(fam)) return k;
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

function prettyModel(model) {
  const k = priceKey(model);
  if (!k) return model || '?';
  const [, fam, ...ver] = k.split('-');
  return fam[0].toUpperCase() + fam.slice(1) + ' ' + ver.join('.');
}

module.exports = { costOf, priceKey, prettyModel };
