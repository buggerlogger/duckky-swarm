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

// The subagent's transcript as a main session: its own records, each moved
// to the session (`sessionId`), off the side chain, without its agent id;
// the first starts the chain; a title for `/resume` to list it by.
export function asSession(jsonl: string, sessionId: string, title: string): string {
  const out: string[] = []
  let first = true
  for (const r of records(jsonl)) {
    if (!KEEP.has(String(r.type))) continue
    const { agentId: _agent, ...rest } = r
    const row: Record<string, unknown> = { ...rest, isSidechain: false, sessionId }
    if (first) { row.parentUuid = null; first = false }
    out.push(JSON.stringify(row))
  }
  out.push(JSON.stringify({ type: 'ai-title', aiTitle: title, sessionId }))
  return `${out.join('\n')}\n`
}

// The person has worked in the copy as a session of its own: it holds a
// message the subagent never had. Then the copy is theirs and is not
// written over.
export function diverged(copy: string, jsonl: string): boolean {
  const ours = new Set(records(jsonl).map((r) => r.uuid).filter(Boolean))
  return records(copy).some((r) => (r.type === 'user' || r.type === 'assistant') && typeof r.uuid === 'string' && !ours.has(r.uuid))
}

// What to type in a terminal in the subagent's folder.
export const resumeCommand = (sessionId: string, model: string) => `claude --resume ${sessionId}${model ? ` --model ${model}` : ''}`
