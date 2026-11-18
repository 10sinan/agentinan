// Reads Claude Code's own files under ~/.claude (read only) and turns them into a snapshot for the UI.
//   sessions/<pid>.json                      one per running Claude Code process: cwd, status (busy / idle / waiting)
//   projects/<dir>/<sessionId>.jsonl          the transcript: prompts, replies with token usage, tool calls
//   projects/<dir>/<sessionId>/subagents/     each subagent's own transcript and a .meta.json
const fs = require('fs');
const path = require('path');
const os = require('os');
const { costOf, prettyModel } = require('./pricing');

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const SESS_DIR = path.join(CLAUDE_DIR, 'sessions');
const PROJ_DIR = path.join(CLAUDE_DIR, 'projects');
const CHUNK = 4 * 1024 * 1024;

const dayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

const emptyUsage = () => ({ input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 });

function usageOf(u) {
  const out = emptyUsage();
  if (!u) return out;
  out.input = u.input_tokens || 0;
  out.output = u.output_tokens || 0;
  out.cacheRead = u.cache_read_input_tokens || 0;
  const cc = u.cache_creation;
  if (cc && (cc.ephemeral_1h_input_tokens != null || cc.ephemeral_5m_input_tokens != null)) {
    out.cacheWrite1h = cc.ephemeral_1h_input_tokens || 0;
    out.cacheWrite5m = cc.ephemeral_5m_input_tokens || 0;
  } else {
    out.cacheWrite5m = u.cache_creation_input_tokens || 0;
  }
  return out;
}

const addUsage = (a, b) => {
  for (const k in a) a[k] += b[k];
  return a;
};
const totalTokens = (u) => u.input + u.output + u.cacheWrite5m + u.cacheWrite1h + u.cacheRead;

function clip(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function toolBrief(name, input) {
  if (!input || typeof input !== 'object') return '';
  const base = (p) => (p ? path.basename(String(p)) : '');
  switch (name) {
    case 'Bash':
      return clip(input.description || input.command, 60);
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
      return base(input.file_path);
    case 'NotebookEdit':
      return base(input.notebook_path);
    case 'Grep':
    case 'Glob':
      return clip(input.pattern, 40);
    case 'WebFetch':
      try {
        return new URL(input.url).host;
      } catch {
        return clip(input.url, 40);
      }
    case 'WebSearch':
      return clip(input.query, 50);
    case 'Agent':
    case 'Task':
      return clip(input.description || input.subagent_type, 50);
    default:
      return clip(input.description || input.file_path || input.query || '', 40);
  }
}

// Text a person typed, not tool results or the harness's own injected blocks.
function promptText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const c of content) {
    if (c.type === 'tool_result') return '';
    if (c.type === 'text' && c.text) parts.push(c.text);
  }
  return parts.join(' ');
}

const looksInjected = (t) => /^\s*<(system-reminder|browser_instruction|command-|local-command|ide_|bash-|task-notification|user-prompt)/.test(t);

class Transcript {
  constructor(file) {
    this.file = file;
    this.offset = 0;
    this.rest = Buffer.alloc(0);
    this.ino = null;
    this.reset();
  }

  reset() {
    this.offset = 0;
    this.rest = Buffer.alloc(0);
    this.msgs = new Map(); // message id → { day, model, usage }
    this.model = null;
    this.aiTitle = null;
    this.customTitle = null;
    this.lastPrompt = '';
    this.lastText = '';
    this.context = 0;
    this.recentTools = [];
    this.pending = new Map();
    this.toolCount = 0;
    this.files = new Set();
    this.lastActivity = 0;
  }

  update() {
    let st;
    try {
      st = fs.statSync(this.file);
    } catch {
      return false;
    }
    if (this.ino !== null && (st.ino !== this.ino || st.size < this.offset)) this.reset();
    this.ino = st.ino;
    if (st.size === this.offset) return false;
    const fd = fs.openSync(this.file, 'r');
    try {
      while (this.offset < st.size) {
        const len = Math.min(CHUNK, st.size - this.offset);
        const buf = Buffer.alloc(len);
        const n = fs.readSync(fd, buf, 0, len, this.offset);
        if (n <= 0) break;
        this.offset += n;
        let data = this.rest.length ? Buffer.concat([this.rest, buf.subarray(0, n)]) : buf.subarray(0, n);
        const nl = data.lastIndexOf(10);
        if (nl < 0) {
          this.rest = Buffer.from(data);
          continue;
        }
        this.rest = Buffer.from(data.subarray(nl + 1));
        const text = data.toString('utf8', 0, nl);
        for (const line of text.split('\n')) this.line(line);
      }
    } finally {
      fs.closeSync(fd);
    }
    return true;
  }

  line(line) {
    if (!line || line.startsWith('{"type":"api-request') || line.startsWith('{"type":"file-history')) return;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      return;
    }
    const ts = j.timestamp ? Date.parse(j.timestamp) : 0;
    switch (j.type) {
      case 'ai-title':
        this.aiTitle = j.aiTitle || this.aiTitle;
        return;
      case 'custom-title':
        this.customTitle = j.customTitle || this.customTitle;
        return;
      case 'last-prompt':
        if (j.lastPrompt && !looksInjected(j.lastPrompt)) this.lastPrompt = clip(j.lastPrompt, 300);
        return;
      case 'assistant':
        return this.assistant(j, ts);
      case 'user':
        return this.user(j, ts);
    }
  }

  assistant(j, ts) {
    const m = j.message || {};
    if (ts) this.lastActivity = Math.max(this.lastActivity, ts);
    if (m.model && m.model !== '<synthetic>') this.model = m.model;
    if (m.id && m.usage && m.model !== '<synthetic>') {
      const u = usageOf(m.usage);
      // A reply is written as several records (one per content block) that repeat its usage; the last one wins.
      this.msgs.set(m.id, { day: dayKey(ts || Date.now()), model: m.model, usage: u });
      if (!j.isSidechain) this.context = u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h + u.output;
    }
    for (const c of Array.isArray(m.content) ? m.content : []) {
      if (c.type === 'text' && c.text && c.text.trim()) this.lastText = clip(c.text, 300);
      if (c.type === 'tool_use') {
        const t = { id: c.id, name: c.name, brief: toolBrief(c.name, c.input), ts: ts || Date.now() };
        this.recentTools.push(t);
        if (this.recentTools.length > 30) this.recentTools.shift();
        this.pending.set(c.id, t);
        this.toolCount++;
        const f = c.input && (c.input.file_path || c.input.notebook_path);
        if (f) this.files.add(f);
      }
    }
  }

  user(j, ts) {
    const m = j.message || {};
    if (Array.isArray(m.content)) for (const c of m.content) if (c.type === 'tool_result') this.pending.delete(c.tool_use_id);
    if (j.isMeta || j.isSidechain) return;
    const t = promptText(m.content);
    if (t && !looksInjected(t)) {
      this.lastPrompt = clip(t, 300);
      if (ts) this.lastActivity = Math.max(this.lastActivity, ts);
    }
  }

  totals(day) {
    const u = emptyUsage();
    let cost = 0;
    for (const v of this.msgs.values()) {
      if (day && v.day !== day) continue;
      addUsage(u, v.usage);
      cost += costOf(v.model, v.usage);
    }
    return { usage: u, cost };
  }
}

function procStartTime(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    // Field 22 (starttime), counted after the ")" that ends the command name, which may itself hold spaces.
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  } catch {
    return null;
  }
}

function readJSON(f) {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

class Collector {
  constructor() {
    this.transcripts = new Map(); // file → Transcript
    this.fileOf = new Map(); // sessionId → transcript file
    this.lastDayScan = 0;
  }

  transcript(file) {
    let t = this.transcripts.get(file);
    if (!t) this.transcripts.set(file, (t = new Transcript(file)));
    t.update();
    return t;
  }

  findTranscript(sid, cwd) {
    const known = this.fileOf.get(sid);
    if (known && fs.existsSync(known)) return known;
    const guess = path.join(PROJ_DIR, String(cwd || '').replace(/[^A-Za-z0-9]/g, '-'), sid + '.jsonl');
    if (fs.existsSync(guess)) return this.fileOf.set(sid, guess), guess;
    let dirs = [];
    try {
      dirs = fs.readdirSync(PROJ_DIR);
    } catch {}
    for (const d of dirs) {
      const f = path.join(PROJ_DIR, d, sid + '.jsonl');
      if (fs.existsSync(f)) return this.fileOf.set(sid, f), f;
    }
    return null;
  }

  subagents(file, sid) {
    const dir = path.join(path.dirname(file), sid, 'subagents');
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    const out = [];
    const now = Date.now();
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue;
      const f = path.join(dir, n);
      const t = this.transcript(f);
      const meta = readJSON(f.replace(/\.jsonl$/, '.meta.json')) || {};
      let mtime = 0;
      try {
        mtime = fs.statSync(f).mtimeMs;
      } catch {}
      const active = meta.finished === false || (meta.finished === undefined && now - mtime < 60_000);
      out.push({ id: n.replace(/\.jsonl$/, ''), type: meta.agentType || 'agent', desc: clip(meta.description, 60), active, t });
    }
    return out;
  }

  // Bring in every transcript touched today so the daily totals include closed sessions too.
  scanToday() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const walk = (dir, depth) => {
      let ents = [];
      try {
        ents = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of ents) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (depth < 3 && e.name !== 'memory') walk(p, depth + 1);
        } else if (e.name.endsWith('.jsonl')) {
          try {
            if (fs.statSync(p).mtimeMs >= start.getTime()) this.transcript(p);
          } catch {}
        }
      }
    };
    walk(PROJ_DIR, 0);
  }

  snapshot() {
    const now = Date.now();
    if (now - this.lastDayScan > 15_000) {
      this.lastDayScan = now;
      this.scanToday();
    }

    let files = [];
    try {
      files = fs.readdirSync(SESS_DIR).filter((f) => f.endsWith('.json'));
    } catch {}

    const sessions = [];
    for (const f of files) {
      const s = readJSON(path.join(SESS_DIR, f));
      if (!s || !s.pid || !s.sessionId) continue;
      const start = procStartTime(s.pid);
      if (start === null || (s.procStart && String(s.procStart) !== start)) continue; // process gone or pid reused
      const file = this.findTranscript(s.sessionId, s.cwd);
      const t = file ? this.transcript(file) : null;
      const subs = file ? this.subagents(file, s.sessionId) : [];
      const tot = t ? t.totals() : { usage: emptyUsage(), cost: 0 };
      for (const sa of subs) {
        const st = sa.t.totals();
        addUsage(tot.usage, st.usage);
        tot.cost += st.cost;
      }
      const cwd = s.cwd || '';
      sessions.push({
        id: s.sessionId,
        pid: s.pid,
        name: (t && t.customTitle) || s.name || (t && t.aiTitle) || path.basename(cwd) || s.sessionId.slice(0, 8),
        title: t ? t.aiTitle : null,
        cwd,
        project: path.basename(cwd),
        status: s.status || 'idle',
        waitingFor: s.waitingFor || null,
        statusSince: s.statusUpdatedAt || s.updatedAt || s.startedAt,
        startedAt: s.startedAt,
        entrypoint: s.entrypoint || '',
        kind: s.kind || 'interactive',
        jobId: s.jobId || null,
        version: s.version || '',
        model: t && t.model ? prettyModel(t.model) : null,
        tokens: { ...tot.usage, total: totalTokens(tot.usage) },
        cost: tot.cost,
        context: t ? t.context : 0,
        lastPrompt: t ? t.lastPrompt : '',
        lastText: t ? t.lastText : '',
        recentTools: t ? t.recentTools.slice(-8).map(({ id, name, brief, ts }) => ({ id, name, brief, ts })) : [],
        toolCount: t ? t.toolCount : 0,
        pendingTools: t ? t.pending.size : 0,
        fileCount: t ? t.files.size : 0,
        subagents: subs.map(({ id, type, desc, active }) => ({ id, type, desc, active })),
        lastActivity: t ? t.lastActivity : 0,
      });
    }
    sessions.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));

    const today = dayKey(now);
    const day = { usage: emptyUsage(), cost: 0, byModel: {} };
    for (const t of this.transcripts.values()) {
      for (const v of t.msgs.values()) {
        if (v.day !== today) continue;
        const c = costOf(v.model, v.usage);
        addUsage(day.usage, v.usage);
        day.cost += c;
        const name = prettyModel(v.model);
        const bm = (day.byModel[name] ||= { tokens: 0, output: 0, cost: 0 });
        bm.tokens += totalTokens(v.usage);
        bm.output += v.usage.output;
        bm.cost += c;
      }
    }

    return {
      at: now,
      claudeDir: CLAUDE_DIR,
      sessions,
      today: { tokens: totalTokens(day.usage), output: day.usage.output, cost: day.cost, byModel: day.byModel },
    };
  }
}

module.exports = { Collector, Transcript, CLAUDE_DIR };
