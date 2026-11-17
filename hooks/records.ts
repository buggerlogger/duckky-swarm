// Copyright 2026 buggerlogger (https://github.com/buggerlogger)
// SPDX-License-Identifier: Apache-2.0
//
// One record per subagent, kept in $.store (which outlives the session) when
// keepAgents is on. One key per agent, `agent:<id>`, not one shared list: two
// sessions writing a shared list at once would each drop the other's rows.

import type { EngineInterface } from 'claude-code'

export type AgentRecord = {
  /** The agent id, as `$.agent.list()`, `agent.spawn` and `turn.complete` give it. */
  id: string
  /** The agent type it ran as: `duckky-swarm:opus-4-6`, `general-purpose`, `fork`. */
  type: string
  /** How a person says the model: "Opus 4.6". */
  label: string
  /** The model Claude Code resolved for it when it started. */
  model: string
  /** The model that was asked for (a duckky type's id, or the Agent call's `model`). */
  requested: string | null
  /** The model the API itself reported answering, from `turn.complete`'s usage. */
  answeredBy: string | null
  description: string
  fork: boolean
  sessionId: string
  cwd: string
  startedAt: number
  endedAt?: number
  status: 'running' | 'done' | 'aborted' | 'error' | 'refusal'
  resumes: number
  outputTokens: number
  /** Its transcript file, as Claude Code's SubagentStop gave it. */
  transcript?: string
  /** Its final message, as SubagentStop gave it. */
  lastAnswer?: string
  /** The subagent this one resumed, when it was started by resume_subagent. */
  resumedFrom?: string
}

const PREFIX = 'agent:'

export async function saveAgent($: EngineInterface, r: AgentRecord): Promise<void> {
  await $.store.set(`${PREFIX}${r.id}`, r)
}

export async function allAgents($: EngineInterface): Promise<AgentRecord[]> {
  const keys = (await $.store.keys()).filter((k) => k.startsWith(PREFIX))
  const rows = await Promise.all(keys.map((k) => $.store.get(k)))
  return rows.filter((r): r is AgentRecord => !!r && typeof r === 'object' && 'id' in r)
}

export async function forgetAgent($: EngineInterface, id: string): Promise<void> {
  await $.store.delete(`${PREFIX}${id}`)
}

const DAY = 24 * 60 * 60 * 1000
const MAX_KEPT = 100

// Which kept subagents survive, run at every session start. Without a limit
// the store only ever grows: every subagent of every session, forever. One
// stopped (or never finished) is the one a person comes back to, so it is kept
// longest; a finished one goes sooner; and only the newest MAX_KEPT stay.
export function retain(records: readonly AgentRecord[], now: number): AgentRecord[] {
  const keepFor = (r: AgentRecord) => (r.status === 'aborted' || r.status === 'running' ? 30 : 14) * DAY
  return records
    .filter((r) => now - (r.endedAt ?? r.startedAt) <= keepFor(r))
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, MAX_KEPT)
}
