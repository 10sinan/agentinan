// Relations between sessions, for the orbit map: who works in the same folder, and who is editing the same file.
//   project   pairs of sessions started in the same folder
//   conflicts pairs that both wrote to the same file recently (a possible clash, e.g. two sessions overwriting each other)
const CONFLICT_WINDOW_MS = 15 * 60 * 1000;

// sessions: [{ id, cwd, edits: [{ file, ts }] }]  →  { project: [[idA, idB]], conflicts: [{ a, b, file, ts }] }
function findLinks(sessions, now = Date.now()) {
  const project = [];
  const conflicts = [];
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      const a = sessions[i];
      const b = sessions[j];
      if (a.cwd && a.cwd === b.cwd) project.push([a.id, b.id]);

      // the most recent file both touched, if both touched it inside the window
      let hit = null;
      const mine = new Map();
      for (const e of a.edits || []) if (now - e.ts <= CONFLICT_WINDOW_MS) mine.set(e.file, e.ts);
      for (const e of b.edits || []) {
        if (now - e.ts > CONFLICT_WINDOW_MS || !mine.has(e.file)) continue;
        const ts = Math.max(e.ts, mine.get(e.file));
        if (!hit || ts > hit.ts) hit = { a: a.id, b: b.id, file: e.file, ts };
      }
      if (hit) conflicts.push(hit);
    }
  }
  return { project, conflicts };
}

module.exports = { findLinks, CONFLICT_WINDOW_MS };
