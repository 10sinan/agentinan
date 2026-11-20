// Plain shells behind pseudo-terminals, for the drawer at the bottom of the window: run a project's dev server,
// tests, anything. Unlike terminals.js these have nothing to do with Claude Code sessions.
const fs = require('fs');
const os = require('os');
const path = require('path');
const pty = require('@lydell/node-pty');

// Where a new shell starts: the asked-for folder if it exists, otherwise the home directory.
function resolveCwd(cwd) {
  try {
    if (typeof cwd === 'string' && path.isAbsolute(cwd) && fs.statSync(cwd).isDirectory()) return cwd;
  } catch {}
  return os.homedir();
}

function shellBin() {
  const s = process.env.SHELL;
  if (s && path.isAbsolute(s) && fs.existsSync(s)) return s;
  return fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
}

// Variables inherited from VS Code or a parent Claude Code would leak into the user's shell.
function shellEnv() {
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  for (const k of ['ELECTRON_RUN_AS_NODE', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'VSCODE_PID']) delete env[k];
  return env;
}

class Shells {
  constructor(send) {
    this.send = send; // (channel, payload) → renderer
    this.shells = new Map(); // id → { proc, buffer, cwd }
    this.next = 1;
  }

  open(cwd) {
    const dir = resolveCwd(cwd);
    const id = `sh:${this.next++}`;
    const proc = pty.spawn(shellBin(), [], { name: 'xterm-256color', cols: 100, rows: 12, cwd: dir, env: shellEnv() });
    this.shells.set(id, { proc, cwd: dir });
    proc.onData((data) => this.send('shell:data', { id, data }));
    proc.onExit(() => {
      this.shells.delete(id);
      this.send('shell:exit', { id });
    });
    return { id, cwd: dir, name: path.basename(dir) || dir };
  }

  write(id, data) {
    this.shells.get(id)?.proc.write(String(data));
  }

  resize(id, cols, rows) {
    const s = this.shells.get(id);
    if (!s || !(cols > 1 && rows > 1)) return;
    try {
      s.proc.resize(cols, rows);
    } catch {}
  }

  close(id) {
    const s = this.shells.get(id);
    if (!s) return;
    try {
      s.proc.kill();
    } catch {}
  }

  disposeAll() {
    for (const id of [...this.shells.keys()]) this.close(id);
  }
}

module.exports = { Shells, resolveCwd };
