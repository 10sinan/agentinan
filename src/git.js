// Git for the Source Control tab. Every call runs the git binary directly (no shell) in a repository Agentinan
// already knows: one a session works in, or one the user added. Paths and hashes go after "--" or are validated.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAX_DIFF = 600 * 1024;

function git(cwd, args, { okCodes = [0], timeout = 20_000, maxBuffer = 16 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout, maxBuffer, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
      if (!okCodes.includes(code)) return reject(new Error((stderr || stdout || String(err)).trim().split('\n').slice(-3).join('\n')));
      resolve(stdout);
    });
  });
}

const roots = new Map(); // folder → { root, at }; root is '' when the folder is not in a repository
const NEG_TTL = 30_000; // "not a repository" is rechecked after this long (the folder may get `git init`)

async function rootOf(dir) {
  const c = roots.get(dir);
  if (c && (c.root || Date.now() - c.at < NEG_TTL) && (!c.root || fs.existsSync(c.root))) return c.root;
  let r = '';
  try {
    if (fs.statSync(dir).isDirectory()) r = (await git(dir, ['rev-parse', '--show-toplevel'], { timeout: 5000 })).trim();
  } catch {}
  roots.set(dir, { root: r, at: Date.now() });
  return r;
}

// porcelain v2: "# branch.*" headers, "1"/"2" changed entries, "u" conflicts, "?" untracked; NUL separated.
function parseStatus(out) {
  const info = { branch: '', upstream: '', ahead: 0, behind: 0, staged: [], unstaged: [], untracked: [], conflicts: [] };
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];
    if (!line) continue;
    if (line.startsWith('# branch.head ')) info.branch = line.slice(14);
    else if (line.startsWith('# branch.upstream ')) info.upstream = line.slice(18);
    else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+) -(\d+)/);
      if (m) [info.ahead, info.behind] = [Number(m[1]), Number(m[2])];
    } else if (line[0] === '1' || line[0] === '2') {
      const f = line.split(' ');
      const xy = f[1];
      const file = f.slice(line[0] === '1' ? 8 : 9).join(' ');
      const from = line[0] === '2' ? parts[++i] : null; // renames carry the old path in the next field
      if (xy[0] !== '.') info.staged.push({ path: file, code: xy[0], from });
      if (xy[1] !== '.') info.unstaged.push({ path: file, code: xy[1] });
    } else if (line[0] === 'u') {
      info.conflicts.push({ path: line.split(' ').slice(10).join(' '), code: 'U' });
    } else if (line[0] === '?') {
      info.untracked.push({ path: line.slice(2), code: 'U' });
    }
  }
  return info;
}

const safePath = (p) => {
  if (typeof p !== 'string' || !p || p.includes('\0') || path.isAbsolute(p) || p.split('/').includes('..')) throw new Error('bad path');
  return p;
};
const safeHash = (h) => {
  if (!/^[0-9a-f]{4,64}$/i.test(String(h))) throw new Error('bad hash');
  return h;
};

const clipDiff = (s) => (s.length > MAX_DIFF ? s.slice(0, MAX_DIFF) + '\n… (fark çok büyük, kısaltıldı)\n' : s);

class Git {
  constructor() {
    this.known = new Set(); // repository roots the renderer may act on
  }

  // Repositories of the given folders (session cwds and user-added ones), deduplicated, with a change count each.
  async repos(dirs, fresh = false) {
    if (fresh) for (const d of dirs) roots.delete(d);
    const out = [];
    const seen = new Set();
    for (const d of dirs) {
      if (typeof d !== 'string' || !path.isAbsolute(d)) continue;
      const r = await rootOf(d);
      if (!r || seen.has(r)) continue;
      seen.add(r);
      this.known.add(r);
      let changes = 0;
      let branch = '';
      try {
        const st = parseStatus(await git(r, ['status', '--porcelain=v2', '--branch', '-z'], { timeout: 8000 }));
        changes = st.staged.length + st.unstaged.length + st.untracked.length + st.conflicts.length;
        branch = st.branch;
      } catch {}
      out.push({ root: r, name: path.basename(r), changes, branch });
    }
    return out;
  }

  repo(r) {
    if (!this.known.has(r)) throw new Error('Bilinmeyen depo');
    return r;
  }

  async status(r) {
    return parseStatus(await git(this.repo(r), ['status', '--porcelain=v2', '--branch', '-z']));
  }

  async diff(r, file, kind) {
    r = this.repo(r);
    file = safePath(file);
    if (kind === 'untracked') return clipDiff(await git(r, ['diff', '--no-color', '--no-index', '--', '/dev/null', file], { okCodes: [0, 1] }));
    if (kind === 'conflict') return clipDiff(await git(r, ['diff', '--no-color', '--', file], { okCodes: [0, 1] }));
    const args = ['diff', '--no-color'];
    if (kind === 'staged') args.push('--cached');
    return clipDiff(await git(r, [...args, '--', file]));
  }

  async stage(r, files) {
    r = this.repo(r);
    if (files === 'all') return git(r, ['add', '-A']);
    return git(r, ['add', '--', ...files.map(safePath)]);
  }

  async unstage(r, files) {
    r = this.repo(r);
    if (files === 'all') return git(r, ['reset', '-q']);
    return git(r, ['reset', '-q', '--', ...files.map(safePath)]);
  }

  async commit(r, message) {
    if (typeof message !== 'string' || !message.trim()) throw new Error('Commit mesajı boş olamaz');
    return git(this.repo(r), ['commit', '-m', message], { timeout: 60_000 });
  }

  // Graph lines from `git log --graph`; a line carrying a commit has the fields after a \x1f separator.
  async log(r, n = 120) {
    const out = await git(this.repo(r), ['log', '--graph', '--date-order', '--all', `-n${Math.min(500, n | 0)}`, '--format=%x1f%H%x1f%h%x1f%an%x1f%ct%x1f%D%x1f%s'], {
      okCodes: [0, 128], // 128: a repository without commits yet
    });
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const i = line.indexOf('\x1f');
        if (i < 0) return { graph: line };
        const [hash, short, author, time, refs, subject] = line.slice(i + 1).split('\x1f');
        return { graph: line.slice(0, i), hash, short, author, time: Number(time) * 1000, refs, subject };
      });
  }

  async show(r, hash) {
    return clipDiff(await git(this.repo(r), ['show', '--no-color', '--stat', '--patch', '--format=commit %H%nYazar: %an <%ae>%nTarih: %ad%n%n%B', safeHash(hash)]));
  }

  async push(r) {
    return git(this.repo(r), ['push'], { timeout: 120_000 });
  }

  async pull(r) {
    return git(this.repo(r), ['pull', '--ff-only'], { timeout: 120_000 });
  }

  async fetch(r) {
    return git(this.repo(r), ['fetch', '--all', '--prune'], { timeout: 120_000 });
  }
}

module.exports = { Git, parseStatus };
