// Claude plan usage limits (the 5-hour and the weekly window).
// Claude Code runs the `statusLine` command from ~/.claude/settings.json on each status update and pipes its status
// JSON to it; for subscription accounts that JSON has `rate_limits`. Our small script keeps the latest such JSON in
// limits.json, so Agentinan never needs Claude's credentials. The limits are per account: any session that updates
// its status line (a terminal session, an Agentinan-started one) refreshes them for all.
//
// Hooking the script in edits Claude Code's settings, so it only happens when the user asks (enable()), the file is
// backed up first, and disable() puts the previous status line back. A status line the user already had keeps
// working: its command is saved and our script hands the JSON on to it and prints what it prints.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeFileAtomic } = require('./atomic');

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const CLAUDE_SETTINGS = path.join(CLAUDE_DIR, 'settings.json');

function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

const KEEP_BACKUPS = 5;
// Keeps the newest KEEP_BACKUPS settings.json.bak-* files, removes older ones.
function pruneBackups() {
  try {
    const prefix = path.basename(CLAUDE_SETTINGS) + '.bak-';
    const old = fs.readdirSync(CLAUDE_DIR).filter((f) => f.startsWith(prefix)).sort().slice(0, -KEEP_BACKUPS);
    for (const f of old) fs.rmSync(path.join(CLAUDE_DIR, f), { force: true });
  } catch {}
}

class Limits {
  constructor(dataDir) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'limits.json');
    this.script = path.join(dataDir, 'statusline.sh');
    this.next = path.join(dataDir, 'statusline-next'); // the user's own status line command, if they had one
    this.backup = path.join(dataDir, 'claude-settings.backup.json');
  }

  get command() {
    return `/bin/sh ${shq(this.script)}`;
  }

  scriptText() {
    return `#!/bin/sh
# Agentinan: Claude Code pipes its status JSON here (statusLine in ~/.claude/settings.json).
# The latest JSON that carries the plan's usage limits is kept for the dashboard; nothing else is stored.
# A status line you had before (saved in statusline-next) still gets the JSON and shows its output.
dir=${shq(this.dir)}
json=$(cat)
case "$json" in
  *'"rate_limits"'*)
    tmp="$dir/limits.$$.tmp"
    printf '%s' "$json" > "$tmp" && mv -f "$tmp" "$dir/limits.json"
    ;;
esac
if [ -s "$dir/statusline-next" ]; then
  printf '%s' "$json" | /bin/sh -c "$(cat "$dir/statusline-next")"
fi
exit 0
`;
  }

  readSettings() {
    if (!fs.existsSync(CLAUDE_SETTINGS)) return {};
    const text = fs.readFileSync(CLAUDE_SETTINGS, 'utf8');
    const j = JSON.parse(text); // throws on a file that isn't JSON: then we leave it alone
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('settings.json beklenen biçimde değil');
    return j;
  }

  // Writes settings.json atomically. Before each write the current file is copied to settings.json.bak-<timestamp>
  // (next to it); if the write fails, that copy is put back and the error is rethrown. Returns the backup path (or null
  // when there was no file yet).
  writeSettings(j) {
    fs.mkdirSync(CLAUDE_DIR, { recursive: true });
    const existed = fs.existsSync(CLAUDE_SETTINGS);
    let bak = null;
    if (existed) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      for (let i = 0; !bak; i++) {
        const cand = `${CLAUDE_SETTINGS}.bak-${stamp}${i ? '-' + i : ''}`;
        try {
          fs.copyFileSync(CLAUDE_SETTINGS, cand, fs.constants.COPYFILE_EXCL); // never overwrites an older backup
          bak = cand;
        } catch (e) {
          if (e.code !== 'EEXIST' || i > 99) throw e;
        }
      }
      pruneBackups();
    }
    try {
      // the text is parsed back before anything is written: it must be a JSON object
      const text = JSON.stringify(j, null, 2) + '\n';
      const back = JSON.parse(text);
      if (!back || typeof back !== 'object' || Array.isArray(back)) throw new Error('settings.json beklenen biçimde değil');
      writeFileAtomic(CLAUDE_SETTINGS, text, { json: true });
    } catch (err) {
      try {
        if (bak) fs.copyFileSync(bak, CLAUDE_SETTINGS); // put the previous content back
      } catch {}
      throw err;
    }
    return bak;
  }

  enabled() {
    try {
      return this.readSettings().statusLine?.command === this.command;
    } catch {
      return false;
    }
  }

  enable() {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.script, this.scriptText(), { mode: 0o755 });
    const j = this.readSettings();
    if (j.statusLine?.command === this.command) return true;
    if (fs.existsSync(CLAUDE_SETTINGS) && !fs.existsSync(this.backup)) fs.copyFileSync(CLAUDE_SETTINGS, this.backup);
    const prev = j.statusLine?.command;
    if (prev) fs.writeFileSync(this.next, prev);
    else fs.rmSync(this.next, { force: true });
    j.statusLine = { ...(j.statusLine || {}), type: 'command', command: this.command };
    this.writeSettings(j);
    return true;
  }

  disable() {
    const j = this.readSettings();
    if (j.statusLine?.command === this.command) {
      let prev = '';
      try {
        prev = fs.readFileSync(this.next, 'utf8').trim();
      } catch {}
      if (prev) j.statusLine = { ...j.statusLine, command: prev };
      else delete j.statusLine;
      this.writeSettings(j);
    }
    fs.rmSync(this.next, { force: true });
    return true;
  }

  // { enabled, fiveHour: {pct, resetsAt} | null, week: {...} | null, at } (times in ms), or { enabled } when nothing came yet.
  read() {
    const out = { enabled: this.enabled() };
    let st;
    try {
      st = fs.statSync(this.file);
    } catch {
      return out;
    }
    let rl;
    try {
      rl = JSON.parse(fs.readFileSync(this.file, 'utf8')).rate_limits;
    } catch {
      return out;
    }
    if (!rl || typeof rl !== 'object') return out;
    const win = (w) => {
      if (!w || typeof w.used_percentage !== 'number') return null;
      const r = Number(w.resets_at) || 0;
      return { pct: w.used_percentage, resetsAt: r && r < 1e12 ? r * 1000 : r };
    };
    out.fiveHour = win(rl.five_hour);
    out.week = win(rl.seven_day);
    out.at = st.mtimeMs;
    return out;
  }
}

module.exports = { Limits, CLAUDE_SETTINGS };
