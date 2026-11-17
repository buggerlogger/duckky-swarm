// Copyright 2026 buggerlogger (https://github.com/buggerlogger)
// SPDX-License-Identifier: Apache-2.0
//
// One subagent as the swarm window shows it, built up from Claude Code's own
// files as they grow: agent-<id>.meta.json (its type, task, whether it is
// finished) and agent-<id>.jsonl (every message). Pure: no fs, no terminal.

const KEEP_LINES = 200

export function newAgent(id) {
  return {
    id,
    type: '',
    description: '',
    isFork: false,
    finished: false,
    model: '',          // the model the API answered as, from the transcript
    task: '',           // the first prompt it was given
    lines: [],          // what it did, newest last: { kind, text }
    tools: 0,
    outTokens: 0,
    firstAt: 0,
    lastAt: 0,
    activity: 'starting', // what it is doing now: its Clawd acts this out
    activityAt: 0,        // since when
    pending: {},          // tool_use id -> the activity it started, until its result
  }
}

export function applyMeta(a, meta) {
  if (typeof meta.agentType === 'string') a.type = meta.agentType
  if (typeof meta.description === 'string') a.description = meta.description
  a.isFork = !!meta.isFork
  a.finished = !!meta.finished
  if (a.finished) a.activity = 'done'
}

// What kind of command a shell command is, by its words. In this order: a
// deploy can install or build on the way; `git commit -m "fix build"` is git.
export function commandActivity(command) {
  const c = String(command ?? '')
  if (/\b(deploy|docker\s+push|kubectl\s+apply|helm\s+(install|upgrade)|terraform\s+apply|vercel|fly\s+deploy|gh\s+release|npm\s+publish)\b/i.test(c)) return 'deploying'
  if (/^\s*(git|gh)\s/i.test(c)) return 'git'
  if (/\b(npm|pnpm|yarn|bun)\s+(i|install|add|ci)\b|\bpip3?\s+install\b|\bapt(-get)?\s+install\b|\bbrew\s+install\b|\bgo\s+(get|mod\s+download)\b|\bcargo\s+add\b|\bwinget\s+install\b|\bchoco\s+install\b/i.test(c)) return 'installing'
  if (/\b(test|tests|pytest|jest|vitest|mocha|phpunit|rspec|ctest)\b|\bgo\s+test\b|\bcargo\s+test\b|--test\b/i.test(c)) return 'testing'
  if (/\b(build|make|tsc|webpack|esbuild|gradle|mvn|cmake|msbuild)\b|\bcargo\s+build\b|\bgo\s+build\b/i.test(c)) return 'building'
  if (/(^|[;&|]\s*)(git|gh)\s/i.test(c)) return 'git'
  return 'running'
}

// A tool call -> what its Clawd acts out. `input` is the call's arguments.
export function activityOf(tool, input) {
  if (/^(Read|NotebookRead)$/.test(tool)) return 'reading'
  if (/^(Glob|Grep|LS|ToolSearch)$/.test(tool)) return 'searching'
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(tool)) return 'editing'
  if (/^(Bash|PowerShell)$/.test(tool)) return commandActivity(input?.command)
  if (/^Monitor$/.test(tool)) return 'running'
  if (/^(WebFetch|WebSearch)$/.test(tool) || /^mcp__.*(fetch|browser|web)/i.test(tool)) return 'web'
  if (/^(Agent|Task|SendMessage)$/.test(tool)) return 'delegating'
  return 'working'
}

const COMMANDS = new Set(['running', 'testing', 'building', 'installing', 'deploying', 'git'])
export const TEA_AFTER_MS = 20_000   // a command still running this long: tea
export const RESULT_MS = 4_000       // how long "tests pass / fail" shows

// What Clawd shows now, which can change with time alone: a long command
// becomes a tea break, and a test result goes back to thinking.
export function shownActivity(activity, since, now) {
  if (COMMANDS.has(activity) && since && now - since > TEA_AFTER_MS) return 'tea'
  if ((activity === 'pass' || activity === 'fail') && since && now - since > RESULT_MS) return 'thinking'
  return activity
}

const base = (p) => String(p).split(/[\\/]/).pop()
const oneLine = (s, n = 160) => String(s).replace(/\s+/g, ' ').trim().slice(0, n)
// what an agent wrote, without the markdown that is noise in a narrow pane
const tidy = (s, n = 400) => oneLine(String(s).replace(/```[a-z]*|`|\*\*|__|^#+\s*|\s#+\s/gm, ' '), n)

// The few words that say what a tool call was about.
export function toolSummary(name, input = {}) {
  const i = input ?? {}
  const what = i.file_path ? base(i.file_path)
    : i.notebook_path ? base(i.notebook_path)
    : i.command ? oneLine(i.command, 70)
    : i.pattern ? `"${oneLine(i.pattern, 50)}"${i.path ? ` in ${base(i.path)}` : ''}`
    : i.url ? oneLine(i.url, 70)
    : i.query ? `"${oneLine(i.query, 60)}"`
    : i.description ? oneLine(i.description, 60)
    : i.prompt ? oneLine(i.prompt, 60)
    : ''
  return what ? `${name} ${what}` : name
}

function push(a, kind, text) {
  a.lines.push({ kind, text })
  if (a.lines.length > KEEP_LINES) a.lines.splice(0, a.lines.length - KEEP_LINES)
}

const textOf = (content) =>
  typeof content === 'string' ? content
    : Array.isArray(content) ? content.map((b) => (typeof b === 'string' ? b : b?.text ?? '')).join(' ')
    : ''

// One transcript record (one parsed line of agent-<id>.jsonl).
export function applyRecord(a, r) {
  if (!r || (r.type !== 'user' && r.type !== 'assistant') || r.isMeta || !r.message) return
  const at = Date.parse(r.timestamp ?? '') || 0
  if (at) { a.firstAt = a.firstAt || at; a.lastAt = Math.max(a.lastAt, at) }
  const content = r.message.content

  if (r.type === 'user') {
    if (typeof content === 'string') {
      if (!a.task) a.task = oneLine(content, 400)
      return
    }
    for (const b of Array.isArray(content) ? content : []) {
      if (b?.type === 'tool_result') {
        push(a, b.is_error ? 'error' : 'result', b.is_error ? oneLine(textOf(b.content), 120) || 'error' : 'ok')
        // a test that came back: pass or fail, for a moment; anything else: back to thinking
        const was = a.pending[b.tool_use_id]
        delete a.pending[b.tool_use_id]
        act(a, was === 'testing' ? (b.is_error ? 'fail' : 'pass') : 'thinking', at)
      } else if (b?.type === 'text' && !a.task) a.task = oneLine(b.text, 400)
    }
    return
  }

  if (typeof r.message.model === 'string' && r.message.model) a.model = r.message.model
  // the effort the request was sent with, as Claude Code recorded it
  if (typeof r.effort === 'string' || typeof r.effort === 'number') a.effort = r.effort
  a.outTokens += Number(r.message.usage?.output_tokens) || 0
  // a refused response reaches the transcript only when no retry was left
  if (r.message.stop_reason === 'refusal') { a.refused = true; act(a, 'refused', at) }
  for (const b of Array.isArray(content) ? content : []) {
    if (b?.type === 'thinking' || b?.type === 'redacted_thinking') act(a, 'thinking', at)
    else if (b?.type === 'text' && b.text?.trim()) { push(a, 'text', tidy(b.text)); act(a, 'writing', at) }
    else if (b?.type === 'tool_use') {
      a.tools += 1
      push(a, 'tool', toolSummary(b.name, b.input))
      const now = activityOf(b.name, b.input)
      if (b.id) a.pending[b.id] = now
      act(a, now, at)
    }
  }
  if (a.finished) a.activity = 'done'
}

function act(a, activity, at) {
  if (a.finished) return
  if (activity !== a.activity) a.activityAt = at
  a.activity = activity
}

// Silent this long and never marked finished: it was stopped (Esc, a closed
// session). A long Bash call writes nothing while it runs, so this is generous.
export const STALE_MS = 30 * 60 * 1000

export function stateOf(a, now) {
  if (a.refused) return 'refused'   // it ended on a refusal: not "done"
  if (a.finished) return 'done'
  return a.lastAt && now - a.lastAt > STALE_MS ? 'stopped' : 'running'
}

// The one line that says where it is: its last action while it runs, its last
// words once it has finished.
export function nowLine(a) {
  for (let i = a.lines.length - 1; i >= 0; i--) {
    const l = a.lines[i]
    if (a.finished ? l.kind === 'text' : l.kind === 'tool' || l.kind === 'text') return `${a.finished ? 'result' : 'now'}: ${l.text}`
  }
  return `task: ${a.description || a.task}`
}

// claude-opus-4-6 -> Opus 4.6; failing that, the agent type's short name.
export function labelOf(a) {
  const id = a.model.replace(/\[[^\]]*\]$/, '')
  if (/^claude-/.test(id)) {
    const parts = id.replace(/^claude-/, '').replace(/-\d{8}$/, '').split('-')
    const family = parts.shift() ?? ''
    const version = parts.filter((p) => /^\d+$/.test(p)).join('.')
    return `${family.charAt(0).toUpperCase()}${family.slice(1)}${version ? ` ${version}` : ''}`
  }
  return a.type.replace(/^duckky-swarm:/, '') || 'subagent'
}
