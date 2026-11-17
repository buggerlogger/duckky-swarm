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

// A subagent's transcript file (agent-<id>.jsonl) -> lines
export function transcriptLines(jsonl: string): string[] {
  const lines: string[] = []
  for (const raw of jsonl.split('\n')) {
    if (!raw.trim()) continue
    let r: { type?: string; isMeta?: boolean; message?: { content?: unknown } }
    try { r = JSON.parse(raw) } catch { continue }
    if ((r.type !== 'user' && r.type !== 'assistant') || r.isMeta || !r.message) continue
    const who = r.type === 'user' ? 'USER' : 'AGENT'
    const content = r.message.content
    if (typeof content === 'string') {
      if (content.trim()) lines.push(`${who}: ${clip(content, CLIP_TEXT)}`)
      continue
    }
    for (const b of (Array.isArray(content) ? content : []) as Block[]) {
      if (b.type === 'text' && b.text?.trim()) lines.push(`${who}: ${clip(b.text, CLIP_TEXT)}`)
      else if (b.type === 'tool_use') lines.push(`AGENT used ${b.name} ${clip(json(b.input), CLIP_INPUT)}`)
      else if (b.type === 'tool_result') lines.push(`RESULT: ${clip(blockText(b.content), CLIP_RESULT)}`)
    }
  }
  return lines
}
