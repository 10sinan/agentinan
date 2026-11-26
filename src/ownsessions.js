// Which sessions Agentinan ran itself should be resumed at the next start.
// `ownTerms`: [{ pid, resumeId, cwd }] for the interactive claude processes Agentinan started.
// `sessions`: the sessions of the last snapshot (they carry the real session id once Claude Code has registered it).
// A session that was resumed this run is known by its old id and folder even before it shows up in a snapshot,
// so quitting right after a start does not forget it.
function ownSessionList(ownTerms, sessions) {
  const byPid = new Map((sessions || []).map((s) => [s.pid, s]));
  const out = [];
  const seen = new Set();
  for (const t of ownTerms || []) {
    const s = byPid.get(t.pid);
    const id = s?.id || t.resumeId;
    const cwd = s?.cwd || t.cwd;
    if (!id || !cwd || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, cwd });
  }
  return out;
}

module.exports = { ownSessionList };
