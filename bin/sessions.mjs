// Copyright 2026 buggerlogger (https://github.com/buggerlogger)
// SPDX-License-Identifier: Apache-2.0
//
// The index of every duckky session copy, in every project: one JSON file per
// copy in <Claude Code's folder>/duckky-swarm/sessions/, written by the plugin
// each time it writes a copy. Read by /duckky sessions (the plugin) and by the
// `duckky` command (bin/duckky.mjs). Pure: entries in, matches and lines out.

export const INDEX_DIR = 'duckky-swarm/sessions'

// Claude Code's folder for a project: its path, every other character a dash.
export const projectKey = (cwd) => String(cwd).replace(/[^A-Za-z0-9]/g, '-')

// The index files' texts -> entries, newest first; a broken file is skipped.
export function parseEntries(texts) {
  const entries = []
  for (const t of texts) {
    try {
      const e = JSON.parse(t)
      if (e && typeof e.sessionId === 'string' && typeof e.name === 'string') entries.push(e)
    } catch { /* half written, or not ours */ }
  }
  return entries.sort((a, b) => String(b.updated ?? '').localeCompare(String(a.updated ?? '')))
}

// What a query names: its number in the list (1 = newest), its exact name or
// session id, then a name, id or agent id it starts, then the sessions whose
// name and task hold all its words. Several matches: the caller lists them.
export function matchSessions(entries, query) {
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return []
  if (/^\d+$/.test(q) && Number(q) >= 1 && Number(q) <= entries.length) return [entries[Number(q) - 1]]
  const exact = entries.filter((e) => e.name.toLowerCase() === q || e.sessionId.toLowerCase() === q)
  if (exact.length) return exact
  const starts = entries.filter((e) => [e.name, e.sessionId, e.agentId ?? ''].some((s) => s.toLowerCase().startsWith(q)))
  if (starts.length) return starts
  const words = q.split(/\s+/)
  return entries.filter((e) => words.every((w) => `${e.name} ${e.task ?? ''}`.toLowerCase().includes(w)))
}

const ago = (iso, now) => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (!Number.isFinite(s)) return ''
  return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`
}

// The list: a number, the name, when; the project and model under it.
export function listing(entries, now = Date.now()) {
  if (!entries.length) return ['No duckky sessions yet. A duckky subagent gets one when it stops (plugin 0.3.6 or later).']
  return entries.flatMap((e, i) => [
    `${String(i + 1).padStart(3)}  ${e.name}${e.updated ? `   ${ago(e.updated, now)}` : ''}`,
    `     ${e.cwd}${e.model ? `  · ${e.model}` : ''}`,
  ])
}

// The line that opens one in any terminal: in its own project folder.
export const openLine = (e) => `cd "${e.cwd}"; claude --resume ${e.sessionId}${e.model ? ` --model ${e.model}` : ''}`
