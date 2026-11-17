// Copyright 2026 buggerlogger (https://github.com/buggerlogger)
// SPDX-License-Identifier: Apache-2.0
//
// A conversation as plain text that fits a budget: what a context fork is
// given (from $.session.messages()) and what a resumed subagent is given (from
// its transcript file). Pure: no `$`, so it is tested on its own.
//
// The NEWEST messages are kept: the end of a conversation is what the next
// agent needs most. Tool output is clipped hardest, because one file read can
// outweigh the whole rest of the conversation.

const CLIP_INPUT = 300
const CLIP_RESULT = 1500
const CLIP_TEXT = 8000

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)} [... ${s.length - n} more chars]` : s)
const json = (v: unknown) => { try { return JSON.stringify(v) ?? '' } catch { return String(v) } }

// Newest lines that fit `budget` characters, oldest first, with a marker
// where older ones were left out.
export function newestWithin(lines: readonly string[], budget: number): string {
  const kept: string[] = []
  let used = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? ''
    if (used + line.length + 1 > budget) {
      kept.unshift(`[${i + 1} earlier message(s) left out to fit]`)
      break
    }
    kept.unshift(line)
    used += line.length + 1
  }
  return kept.join('\n')
}

type SessionLike = {
  role: 'user' | 'assistant'
  text: string
  toolUses?: readonly { tool: string; input: Record<string, unknown>; text?: string }[]
}

// $.session.messages() rows -> lines
export function sessionLines(messages: readonly SessionLike[]): string[] {
  const lines: string[] = []
  for (const m of messages) {
    if (m.text.trim()) lines.push(`${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${clip(m.text, CLIP_TEXT)}`)
    for (const t of m.toolUses ?? []) {
      lines.push(`ASSISTANT used ${t.tool} ${clip(json(t.input), CLIP_INPUT)}`)
      if (t.text) lines.push(`RESULT: ${clip(t.text, CLIP_RESULT)}`)
    }
  }
  return lines
}

type Block = { type?: string; text?: string; name?: string; input?: unknown; content?: unknown }

const blockText = (content: unknown): string =>
  typeof content === 'string' ? content
    : Array.isArray(content) ? content.map((b: Block) => (typeof b === 'string' ? b : b?.text ?? '')).join('\n')
    : ''

type Rec = { type?: string; isMeta?: boolean; message?: { content?: unknown; stop_reason?: string } }

// The conversation records of a transcript, in order (the rest skipped).
export function parseTranscript(jsonl: string): Rec[] {
  const recs: Rec[] = []
  for (const raw of jsonl.split('\n')) {
    if (!raw.trim()) continue
    let r: Rec
    try { r = JSON.parse(raw) } catch { continue }
    if ((r.type !== 'user' && r.type !== 'assistant') || r.isMeta || !r.message) continue
    recs.push(r)
  }
  return recs
}

// Where the model refused: the first reply that stopped on a refusal; -1 for none.
export function refusalAt(recs: readonly Rec[]): number {
  return recs.findIndex((r) => r.type === 'assistant' && r.message?.stop_reason === 'refusal')
}

const blocks = (r: Rec) => (Array.isArray(r.message?.content) ? r.message.content : []) as Block[]
const FULL = 20_000   // what "in full" means for the newest entries

// A subagent's transcript file (agent-<id>.jsonl) -> lines. `beforeRefusal`
// rewinds it to the agent's last message before its model refused: the
// refused reply and everything after it are left out. The newest `fullTail`
// lines are kept whole (up to FULL characters): they are where it stood.
export function transcriptLines(jsonl: string, { beforeRefusal = false, fullTail = 0 } = {}): string[] {
  let recs = parseTranscript(jsonl)
  const cut = beforeRefusal ? refusalAt(recs) : -1
  if (cut >= 0) recs = recs.slice(0, cut)
  const entries: { line: (n: number) => string }[] = []
  for (const r of recs) {
    const who = r.type === 'user' ? 'USER' : 'AGENT'
    const content = r.message?.content
    if (typeof content === 'string') {
      if (content.trim()) entries.push({ line: (n) => `${who}: ${clip(content, Math.max(n, CLIP_TEXT))}` })
      continue
    }
    for (const b of blocks(r)) {
      if (b.type === 'text' && b.text?.trim()) { const t = b.text; entries.push({ line: (n) => `${who}: ${clip(t, Math.max(n, CLIP_TEXT))}` }) }
      else if (b.type === 'tool_use') { const u = json(b.input); entries.push({ line: (n) => `AGENT used ${b.name} ${clip(u, Math.max(n, CLIP_INPUT))}` }) }
      else if (b.type === 'tool_result') { const t = blockText(b.content); entries.push({ line: (n) => `RESULT: ${clip(t, Math.max(n, CLIP_RESULT))}` }) }
    }
  }
  return entries.map((e, i) => e.line(i >= entries.length - fullTail ? FULL : 0))
}

// Where a refused subagent stood, for the agent that started it: its last
// message before the refusal (its words and tool calls, in full), the last
// tool result it had been given, and any text of the refused reply.
export function refusalScene(jsonl: string): { lastWords: string; lastCalls: string[]; lastResult: string; refused: string } {
  const recs = parseTranscript(jsonl)
  let cut = refusalAt(recs)
  if (cut < 0) cut = recs.length   // no reply marked refused: everything is "before"
  const refused = cut < recs.length ? blocks(recs[cut]!).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim() : ''
  let lastWords = ''
  const lastCalls: string[] = []
  let lastResult = ''
  for (let i = cut - 1; i >= 0 && (!lastWords && !lastCalls.length || !lastResult); i--) {
    const r = recs[i]!
    if (r.type === 'assistant' && !lastWords && !lastCalls.length) {
      lastWords = clip(blocks(r).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim(), FULL)
      for (const b of blocks(r)) if (b.type === 'tool_use') lastCalls.push(`${b.name} ${clip(json(b.input), 2000)}`)
    } else if (r.type === 'user' && !lastResult) {
      const res = blocks(r).filter((b) => b.type === 'tool_result').map((b) => blockText(b.content)).join('\n').trim()
      if (res) lastResult = clip(res, 8000)
    }
  }
  return { lastWords, lastCalls, lastResult, refused: clip(refused, 4000) }
}
