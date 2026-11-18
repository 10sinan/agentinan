// Prints one snapshot without Electron, to check the collector against the real ~/.claude.
const { Collector } = require('../src/collector');

const c = new Collector();
const t0 = Date.now();
const s = c.snapshot();
console.log(`snapshot in ${Date.now() - t0} ms, ${c.transcripts.size} transcripts read`);
for (const x of s.sessions) {
  console.log(
    `- ${x.name} [${x.status}${x.waitingFor ? ': ' + x.waitingFor : ''}] ${x.project} · ${x.model || '?'} · ` +
      `${x.tokens.total.toLocaleString()} tok · $${x.cost.toFixed(2)} · ctx ${x.context.toLocaleString()} · ` +
      `${x.toolCount} tools (${x.pendingTools} pending) · ${x.subagents.length} subagents`,
  );
  console.log(`    prompt: ${x.lastPrompt.slice(0, 100)}`);
  console.log(`    tools:  ${x.recentTools.map((t) => t.name + (t.brief ? ' ' + t.brief : '')).join(' | ').slice(0, 160)}`);
}
console.log('today:', s.today.tokens.toLocaleString(), 'tok, $' + s.today.cost.toFixed(2), s.today.byModel);
const t1 = Date.now();
c.snapshot();
console.log(`second snapshot in ${Date.now() - t1} ms`);
