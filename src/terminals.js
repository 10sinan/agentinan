// Sessions Agentinan can talk to, each behind a pseudo-terminal (PTY):
//   bg:<jobId>   a Claude Code background session (`claude --bg`), shown through `claude attach <jobId>`.
//                Killing the attach process only detaches: the session keeps running after Agentinan quits.
//   own:<pid>    a plain interactive `claude` that Agentinan runs itself, used for a folder that hasn't been
//                trusted yet (background sessions refuse those). It ends when Agentinan quits; main.js
//                remembers those and resumes them (`claude --resume`) at the next start.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pty = require('@lydell/node-pty');

const MAX_BUFFER = 400 * 1024; // scrollback kept per terminal, replayed when the page reloads

function claudeBin() {
  const local = path.join(os.homedir(), '.local', 'bin', 'claude');
  if (fs.existsSync(local)) return local;
  for (const dir of (process.env.PATH || '').split(':')) {
    const f = path.join(dir, 'claude');
    if (dir && fs.existsSync(f)) return f;
  }
  return 'claude';
}

// Environment for child processes: a desktop launcher may lack ~/.local/bin on PATH, and variables inherited from
// VS Code or a parent Claude Code would change how claude starts.
function childEnv() {
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  for (const k of ['ELECTRON_RUN_AS_NODE', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'VSCODE_PID']) delete env[k];
  const local = path.join(os.homedir(), '.local', 'bin');
  if (!(env.PATH || '').split(':').includes(local)) env.PATH = `${local}:${env.PATH || '/usr/bin:/bin'}`;
  return env;
}

function isTrusted(cwd) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
    return !!cfg.projects?.[cwd]?.hasTrustDialogAccepted;
  } catch {
    return false;
  }
}

class Terminals {
  constructor(send) {
    this.send = send; // (channel, payload) → renderer
    this.terms = new Map(); // key → { key, proc, buffer, kind, cols, rows }
    this.bin = claudeBin();
  }

  spawn(key, args, cwd, kind) {
    const proc = pty.spawn(this.bin, args, { name: 'xterm-256color', cols: 100, rows: 30, cwd, env: childEnv() });
    const t = { key, proc, buffer: '', kind, cols: 100, rows: 30 };
    // t.key, not key: an Agentinan-owned session is renamed to own:<pid> once its pid is known
    proc.onData((d) => {
      t.buffer += d;
      if (t.buffer.length > MAX_BUFFER) t.buffer = t.buffer.slice(-MAX_BUFFER);
      this.send('term:data', { key: t.key, data: d });
    });
    proc.onExit(() => {
      t.exited = true;
      if (this.terms.get(t.key) === t) this.terms.delete(t.key);
      this.send('term:exit', { key: t.key });
    });
    this.terms.set(key, t);
    return t;
  }

  // Opens (or reuses) the terminal for a session and returns what it has shown so far.
  attach(key) {
    let t = this.terms.get(key);
    if (!t && key.startsWith('bg:')) {
      const job = key.slice(3);
      if (!/^[A-Za-z0-9_-]+$/.test(job)) throw new Error('bad job id');
      t = this.spawn(key, ['attach', job], os.homedir(), 'bg');
    }
    if (!t) return null;
    return { key, buffer: t.buffer, kind: t.kind };
  }

  write(key, data) {
    this.terms.get(key)?.proc.write(String(data));
  }

  // Typed text, then Enter a moment later so Claude Code reads it as typing and not as a pasted line.
  sendLine(key, text) {
    const t = this.terms.get(key);
    if (!t) return false;
    t.proc.write(String(text));
    setTimeout(() => {
      if (!t.exited) t.proc.write('\r');
    }, 120);
    return true;
  }

  resize(key, cols, rows) {
    const t = this.terms.get(key);
    if (!t || !(cols > 1 && rows > 1) || (t.cols === cols && t.rows === rows)) return;
    t.cols = cols;
    t.rows = rows;
    try {
      t.proc.resize(cols, rows);
    } catch {}
  }

  // pid of each Agentinan-owned interactive claude, so the snapshot can mark those sessions as controllable.
  ownPids() {
    const m = new Map();
    for (const t of this.terms.values()) if (t.kind === 'own') m.set(t.proc.pid, t.key);
    return m;
  }

  // Starts a new session in `cwd`. Resolves to { key, kind }.
  start(cwd, name, prompt) {
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error('Klasör bulunamadı');
    const nameArgs = name ? ['-n', String(name).slice(0, 60)] : [];
    if (!isTrusted(cwd)) {
      // Background sessions need a trusted folder; run claude here so its trust question shows in our terminal.
      const t = this.spawn(null, nameArgs, cwd, 'own');
      const key = `own:${t.proc.pid}`;
      this.terms.delete(null);
      t.key = key;
      this.terms.set(key, t);
      if (prompt) this.queuePrompt(t, prompt, true);
      return Promise.resolve({ key, kind: 'own' });
    }
    return new Promise((resolve, reject) => {
      execFile(this.bin, ['--bg', ...nameArgs], { cwd, env: childEnv(), timeout: 60_000 }, (err, stdout, stderr) => {
        const out = `${stdout}\n${stderr}`;
        const m = out.match(/backgrounded\s*·\s*([A-Za-z0-9_-]+)/);
        if (!m) return reject(new Error(out.trim().split('\n').pop() || String(err)));
        const key = `bg:${m[1]}`;
        const t = this.spawn(key, ['attach', m[1]], os.homedir(), 'bg');
        if (prompt) this.queuePrompt(t, prompt, false);
        resolve({ key, kind: 'bg' });
      });
    });
  }

  // Re-opens a session Agentinan ran itself in an earlier run: `claude --resume <id>` in its folder.
  resume(id, cwd) {
    if (!/^[A-Za-z0-9_-]+$/.test(String(id)) || typeof cwd !== 'string' || !path.isAbsolute(cwd)) return null;
    try {
      if (!fs.statSync(cwd).isDirectory()) return null;
    } catch {
      return null;
    }
    const t = this.spawn(null, ['--resume', String(id)], cwd, 'own');
    const key = `own:${t.proc.pid}`;
    this.terms.delete(null);
    t.key = key;
    this.terms.set(key, t);
    return key;
  }

  // Types the first prompt once Claude Code's input box has appeared (its "❯" marker), not before.
  queuePrompt(t, prompt, needsTrust) {
    let sent = false;
    const started = Date.now();
    const tick = setInterval(() => {
      if (sent || !this.terms.has(t.key) || Date.now() - started > 120_000) return clearInterval(tick);
      const tail = t.buffer.slice(-4000);
      if (needsTrust && /trust/i.test(tail) && !/❯\s*Try/.test(tail)) return; // still on the trust question
      if (/❯/.test(tail)) {
        sent = true;
        clearInterval(tick);
        setTimeout(() => this.sendLine(t.key, prompt), 600);
      }
    }, 500);
  }

  stop(key) {
    if (key.startsWith('bg:')) {
      const job = key.slice(3);
      if (!/^[A-Za-z0-9_-]+$/.test(job)) return;
      this.terms.get(key)?.proc.kill();
      execFile(this.bin, ['stop', job], { env: childEnv() }, () => {});
    } else {
      this.terms.get(key)?.proc.kill();
    }
  }

  // Detach from background sessions (they keep running) and end Agentinan's own ones.
  disposeAll() {
    for (const t of this.terms.values()) {
      try {
        t.proc.kill();
      } catch {}
    }
    this.terms.clear();
  }
}

module.exports = { Terminals };
