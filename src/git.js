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

// ---------- branches (for-each-ref) ----------
// One line per ref, fields separated by \x1f. The subject goes last: it is free text.
const REF_FORMAT = ['%(refname)', '%(refname:short)', '%(objectname)', '%(committerdate:unix)', '%(HEAD)', '%(subject)'].join('%1f');

// for-each-ref output → [{ ref, name, remote, hash, time, current, subject }]. "origin/HEAD" (a pointer, not a
// branch) and lines that don't look like a ref are skipped.
function parseRefs(out) {
  const list = [];
  for (const line of String(out || '').split('\n')) {
    const f = line.split('\x1f');
    if (f.length < 6) continue;
    const [ref, name, hash, time, head] = f;
    const subject = f.slice(5).join('\x1f');
    if (!/^[0-9a-f]{7,64}$/.test(hash)) continue;
    let remote = null;
    if (ref.startsWith('refs/remotes/')) {
      const rest = ref.slice('refs/remotes/'.length);
      if (rest.endsWith('/HEAD') || !rest.includes('/')) continue;
      remote = rest.slice(0, rest.indexOf('/'));
    } else if (!ref.startsWith('refs/heads/')) continue;
    list.push({ ref, name, remote, hash, time: (Number(time) || 0) * 1000, current: head === '*', subject });
  }
  return list;
}

// The branch the others are measured against: what origin/HEAD points at, else main, else master, else HEAD's.
// origin's copy wins over the local one: the local main is often not pulled, and against it a branch already
// merged on GitHub would still look ahead.
async function mainRef(r, refs) {
  const has = (ref) => refs.find((x) => x.ref === ref);
  let target = '';
  try {
    target = (await git(r, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], { okCodes: [0, 1, 128], timeout: 5000 })).trim();
  } catch {}
  const short = (ref) => ref.replace(/^refs\/(heads|remotes\/[^/]+)\//, '');
  if (target && has(target)) return { ref: target, short: short(target) };
  for (const n of ['main', 'master']) {
    if (has(`refs/remotes/origin/${n}`)) return { ref: `refs/remotes/origin/${n}`, short: n };
    if (has(`refs/heads/${n}`)) return { ref: `refs/heads/${n}`, short: n };
  }
  const cur = refs.find((x) => x.current);
  return cur ? { ref: cur.ref, short: cur.name } : null;
}

// Commits `ref` has that `base` lacks (ahead) and the other way round (behind). Full ref names only, so a branch
// called "-x" can't be read as an option.
async function aheadBehind(r, base, ref) {
  if (base === ref) return { ahead: 0, behind: 0 };
  try {
    const out = await git(r, ['rev-list', '--left-right', '--count', `${base}...${ref}`, '--'], { timeout: 5000 });
    const [behind, ahead] = out.trim().split(/\s+/).map(Number);
    return { ahead: ahead || 0, behind: behind || 0 };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

const clipDiff =(s) => (s.length > MAX_DIFF ? s.slice(0, MAX_DIFF) + '\n… (fark çok büyük, kısaltıldı)\n' : s);

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
    if (kind === 'head') {
      // staged and unstaged changes together; a repository without commits has no HEAD, so compare the index instead
      const hasHead = await git(r, ['rev-parse', '--verify', '-q', 'HEAD'], { okCodes: [0, 1] }).then((o) => !!o.trim());
      return clipDiff(await git(r, ['diff', '--no-color', hasHead ? 'HEAD' : '--cached', '--', file]));
    }
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

  // The repository's branches for the map's "branch galaxy": local ones and origin/* (as of the last fetch; no
  // network here), each with how far it is from main. A local branch and its origin/ twin are one entry.
  async branches(r, max = 40) {
    r = this.repo(r);
    const refs = parseRefs(
      await git(r, ['for-each-ref', '--sort=-committerdate', `--format=${REF_FORMAT}`, 'refs/heads', 'refs/remotes'], { timeout: 8000 }),
    );
    const main = await mainRef(r, refs);
    const head = refs.find((x) => x.current);
    const byName = new Map();
    for (const ref of refs) {
      const key = ref.remote ? ref.name.slice(ref.remote.length + 1) : ref.name;
      let b = byName.get(key);
      if (!b) {
        if (byName.size >= max) continue; // newest first, so the oldest branches are the ones left out
        byName.set(key, (b = { name: key, local: null, remote: null, current: false }));
      }
      if (ref.remote) {
        if (!b.remote || ref.remote === 'origin') b.remote = ref; // origin wins over other remotes
      } else b.local = ref;
      if (ref.current) b.current = true;
    }
    const branches = [];
    for (const b of byName.values()) {
      const tip = b.local || b.remote;
      const vs = main ? await aheadBehind(r, main.ref, tip.ref) : { ahead: 0, behind: 0 };
      let sync = b.local ? 'local-only' : 'remote-only';
      if (b.local && b.remote) {
        const ab = b.local.hash === b.remote.hash ? { ahead: 0, behind: 0 } : await aheadBehind(r, b.remote.ref, b.local.ref);
        sync = ab.ahead && ab.behind ? 'diverged' : ab.ahead ? 'ahead' : ab.behind ? 'behind' : 'same';
      }
      branches.push({
        name: b.name,
        isMain: !!main && (tip.ref === main.ref || b.name === main.short),
        current: b.current,
        hasLocal: !!b.local,
        hasRemote: !!b.remote,
        remote: b.remote ? b.remote.name : null,
        hash: tip.hash,
        time: Math.max(b.local?.time || 0, b.remote?.time || 0),
        subject: tip.subject,
        ahead: vs.ahead,
        behind: vs.behind,
        sync,
      });
    }
    return { root: r, name: path.basename(r), main: main ? main.short : null, head: head ? head.name : null, branches };
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

module.exports = { Git, parseStatus, parseRefs };
