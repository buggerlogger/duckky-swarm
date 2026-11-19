// Copyright 2026 buggerlogger (https://github.com/buggerlogger)
// SPDX-License-Identifier: Apache-2.0
//
// A subagent as a main session: its transcript written as a session file of
// Claude Code's own, so `claude --resume <id>` opens it and the person works
// with it as the main agent. Measured: a subagent's records are a session's
// (the same uuid/parentUuid chain, cwd, version) less `isSidechain: true` and
// its `agentId`; rewritten so, `claude --resume` opened one and its model
// answered from that transcript alone. The subagent itself is never touched.
// Pure: the file's text in, the copy's text out.

import { hash } from '../characters/sprites.mjs'

// The records a conversation is made of; the request blobs (each request
// whole, again) and engine bookkeeping stay behind.
const KEEP = new Set(['user', 'assistant', 'attachment', 'system'])

// The session id of a subagent's copy: one per subagent, so its
// `claude --resume` command never changes. A UUID (v4 form), as Claude Code
// names sessions: 128 bits from four rounds of the FNV + fmix32 hash.
export function sessionIdFor(agentId: string): string {
  const hex = [0, 1, 2, 3].map((i) => hash(`duckky-session:${i}:${agentId}`).toString(16).padStart(8, '0')).join('')
  const variant = ((parseInt(hex[16] as string, 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

const records = (jsonl: string) =>
  jsonl.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l) as Record<string, unknown> } catch { return null } })
    .filter((r): r is Record<string, unknown> => r !== null)

const isTurn = (r: Record<string, unknown>) => r.type === 'user' || r.type === 'assistant'

// The subagent's transcript as a main session: its own records, each moved
// to the session (`sessionId`), off the side chain, without its agent id;
// the first starts the chain. Its title is a CUSTOM title, what /rename
// writes: `claude --resume <title>` opens a session by its exact title
// (measured), and Claude Code's own AI titles never replace a custom one.
// The title record also says how many turns the plugin wrote (`duckkyTurns`),
// so a copy the person has typed in is told apart (diverged).
export function asSession(jsonl: string, sessionId: string, title: string): string {
  const out: string[] = []
  let first = true
  let turns = 0
  for (const r of records(jsonl)) {
    if (!KEEP.has(String(r.type))) continue
    const { agentId: _agent, ...rest } = r
    const row: Record<string, unknown> = { ...rest, isSidechain: false, sessionId }
    if (first) { row.parentUuid = null; first = false }
    if (isTurn(r)) turns += 1
    out.push(JSON.stringify(row))
  }
  out.push(JSON.stringify({ type: 'custom-title', customTitle: title, sessionId, duckkyTurns: turns }))
  return `${out.join('\n')}\n`
}

// The person has worked in the copy as a session of its own (`claude
// --resume` appends to it): it holds more turns than the plugin wrote. Then
// the copy is theirs and is not written over. Counting, not matching ids,
// holds when a subagent that carried on as a NEW one writes the copy its
// first generation made. A copy without the count (0.3.4) falls back to ids.
export function diverged(copy: string, jsonl: string): boolean {
  const rows = records(copy)
  const mark = rows.find((r) => r.type === 'custom-title' && typeof r.duckkyTurns === 'number')
  if (mark) return rows.filter(isTurn).length > (mark.duckkyTurns as number)
  const ours = new Set(records(jsonl).map((r) => r.uuid).filter(Boolean))
  return rows.some((r) => isTurn(r) && typeof r.uuid === 'string' && !ours.has(r.uuid))
}

// What to type in a terminal in the project folder: the session's title
// (its workspace folder's name) or its id, either opens it.
export const resumeCommand = (sessionOrTitle: string, model: string) => `claude --resume ${sessionOrTitle}${model ? ` --model ${model}` : ''}`
