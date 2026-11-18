// Finds processes that strain the computer, from /proc (Linux only, read only).
// A process is a "hog" when it keeps using about a whole CPU core, or a large share of the RAM, for a while.
// Each hog is tied to the Claude Code session that started it, when there is one (by walking up its parents).
const fs = require('fs');
const os = require('os');

const TICKS = 100; // USER_HZ: clock ticks per second in /proc/<pid>/stat on Linux
const PAGE = 4096;

function readStat(pid) {
  try {
    const s = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = s.lastIndexOf(')');
    const name = s.slice(s.indexOf('(') + 1, close);
    const f = s.slice(close + 2).split(' '); // f[0] is field 3 (state)
    return {
      name,
      ppid: Number(f[1]),
      ticks: Number(f[11]) + Number(f[12]), // utime + stime
      start: f[19],
      rss: Number(f[21]) * PAGE,
    };
  } catch {
    return null;
  }
}

function cmdline(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ');
  } catch {
    return '';
  }
}

function totalMem() {
  try {
    const m = fs.readFileSync('/proc/meminfo', 'utf8').match(/MemTotal:\s+(\d+)/);
    return m ? Number(m[1]) * 1024 : os.totalmem();
  } catch {
    return os.totalmem();
  }
}

class Monitor {
  constructor() {
    this.prev = new Map(); // pid → { ticks, start, at }
    this.hot = new Map(); // pid → { since, start }
    this.notified = new Set(); // "pid:start" already announced
    this.uid = process.getuid ? process.getuid() : null;
    this.memTotal = totalMem();
    this.cores = os.cpus().length || 1;
  }

  // limits: { cpu: percent of one core, cpuSecs: how long, memPct: percent of RAM, ignore: [names] }
  sample(sessionPids, limits) {
    const now = Date.now();
    const procs = new Map();
    let pids = [];
    try {
      pids = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d));
    } catch {
      return [];
    }
    for (const d of pids) {
      const pid = Number(d);
      if (this.uid !== null) {
        try {
          if (fs.statSync(`/proc/${d}`).uid !== this.uid) continue; // only the user's own processes
        } catch {
          continue;
        }
      }
      const st = readStat(pid);
      if (!st) continue;
      const p = this.prev.get(pid);
      let cpu = 0;
      if (p && p.start === st.start && now > p.at) cpu = ((st.ticks - p.ticks) / TICKS / ((now - p.at) / 1000)) * 100;
      this.prev.set(pid, { ticks: st.ticks, start: st.start, at: now });
      procs.set(pid, { pid, ...st, cpu });
    }
    for (const pid of this.prev.keys()) if (!procs.has(pid)) this.prev.delete(pid);

    // Agentinan's own processes (Electron's renderer and GPU helpers) never count.
    const isOwn = (pid) => this.ancestor(procs, pid, (a) => a === process.pid) !== null;
    const ignore = new Set(limits.ignore || []);
    const hogs = [];
    for (const p of procs.values()) {
      const memPct = (p.rss / this.memTotal) * 100;
      const cpuHot = p.cpu >= limits.cpu;
      const memHot = memPct >= limits.memPct;
      if ((cpuHot || memHot) && (ignore.has(p.name) || isOwn(p.pid))) continue;
      let h = this.hot.get(p.pid);
      if (cpuHot || memHot) {
        if (!h || h.start !== p.start) this.hot.set(p.pid, (h = { since: now, start: p.start }));
      } else {
        this.hot.delete(p.pid);
        continue;
      }
      const secs = (now - h.since) / 1000;
      // CPU spikes are normal (a build, a test run): only a sustained one counts. Memory counts sooner.
      if (!((cpuHot && secs >= limits.cpuSecs) || (memHot && secs >= 4))) continue;
      const sessionPid = this.ancestor(procs, p.pid, (a) => sessionPids.has(a));
      const key = `${p.pid}:${p.start}`;
      hogs.push({
        key,
        pid: p.pid,
        name: p.name,
        cmd: cmdline(p.pid).slice(0, 300),
        cpu: Math.round(p.cpu),
        cpuOfMachine: Math.round(p.cpu / this.cores),
        mem: p.rss,
        memPct: Math.round(memPct * 10) / 10,
        reason: cpuHot && memHot ? 'both' : cpuHot ? 'cpu' : 'mem',
        since: h.since,
        sessionPid,
        fresh: !this.notified.has(key),
      });
      this.notified.add(key);
    }
    for (const pid of this.hot.keys()) if (!procs.has(pid)) this.hot.delete(pid);
    for (const key of this.notified) {
      const [pid, start] = key.split(':');
      const p = procs.get(Number(pid));
      if (!p || p.start !== start) this.notified.delete(key); // that process has ended
    }
    return hogs.sort((a, b) => b.cpu - a.cpu || b.mem - a.mem);
  }

  // Walks up the parent chain from pid; returns the first ancestor (or pid itself) matching test, else null.
  ancestor(procs, pid, test) {
    let cur = pid;
    for (let i = 0; i < 64 && cur > 1; i++) {
      if (test(cur)) return cur;
      const p = procs.get(cur);
      if (!p) return null;
      cur = p.ppid;
    }
    return null;
  }

  // Only a pid that is currently listed as a hog may be signalled, and only if it is still the same process.
  kill(pid, key, force, hogs) {
    const h = hogs.find((x) => x.pid === pid && x.key === key);
    if (!h) throw new Error('Bu işlem artık listede değil');
    const st = readStat(pid);
    if (!st || `${pid}:${st.start}` !== key) throw new Error('İşlem zaten kapanmış');
    process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
    return true;
  }
}

module.exports = { Monitor };
