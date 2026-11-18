// Copyright 2026 buggerlogger (https://github.com/buggerlogger)
// SPDX-License-Identifier: Apache-2.0
//
// The refusal report: what the agent that started a subagent gets when that
// subagent's model refused partway. Where it stood, in full, and how to go on.
// Pure.
//
// It leaves the call to the agent with the whole picture. A subagent sees only
// its task, so a refusal is often missing context: then the agent resumes it
// with a clear, accurate account of the work (the person's goal, the scope,
// what the conversation and the project's instructions say). A refusal can
// also be right: then the work stops and the person is told why.

import type { HookFailure } from 'claude-code'
import { text } from './messages.ts'

export type BriefFor = { id: string; label: string; model: string; description: string; refusals: number }

// What the main agent reads when a subagent it resumed ends: resume_subagent
// returns at once (a hook has 10 s of its own time), so the answer comes
// later, as a message of its own.
export type Resumed = { from: string; id: string; label: string; ending: string; answer: string }

export function resumedReport(r: Resumed): string {
  const answer = r.answer.trim()
  const who = { from: r.from.slice(0, 8), id: r.id.slice(0, 8), label: r.label }
  if (r.ending === 'done') return text('resumedAnswer', 'finished', { ...who, answer: answer || text('resumedAnswer', 'noWords') })
  const lastWords = answer ? text('resumedAnswer', 'lastWords', { answer }) : ''
  const how = r.ending === 'aborted' ? 'stopped' : r.ending === 'refusal' ? 'refused' : 'ended'
  return text('resumedAnswer', how, { ...who, ending: r.ending, lastWords })
}

// What one of the plugin's own tools answers when its hook failed: said
// plainly, where the engine's own default only says no hook answered.
export const hookFailed = (tool: string, error: HookFailure) =>
  text('hookFailed', 'text', { tool, why: error.kind === 'timeout' ? text('hookFailed', 'timeout') : error.message ?? text('hookFailed', 'threw') })
export type Scene = { lastWords: string; lastCalls: string[]; lastResult: string; refused: string }
export type Refusal = { category: string | null; explanation: string | null } | null

const block = (title: string, body: string) => (body ? `\n${title}\n${body}\n` : '')

export function refusalBrief(a: BriefFor, s: Scene, refusal: Refusal): string {
  const short = a.id.slice(0, 8)
  const reason = refusal && (refusal.category || refusal.explanation) ? [refusal.category, refusal.explanation].filter(Boolean).join(': ') : ''
  return [
    text('refusalReport', 'header', {
      id: short, label: a.label, model: a.model, task: a.description,
      times: a.refusals > 1 ? text('refusalReport', 'times', { count: a.refusals }) : '',
    }),
    reason ? `\n${text('refusalReport', 'reason', { reason })}\n` : '',
    block(text('refusalReport', 'lastMessage'), [s.lastWords, ...s.lastCalls.map((call) => text('refusalReport', 'called', { call }))].filter(Boolean).join('\n')),
    block(text('refusalReport', 'lastResult'), s.lastResult),
    block(text('refusalReport', 'refusedReply'), s.refused),
    text('refusalReport', 'whatToDo', { id: short, model: a.model }),
  ].filter(Boolean).join('\n')
}
