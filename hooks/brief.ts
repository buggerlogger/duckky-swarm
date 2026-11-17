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

export type BriefFor = { id: string; label: string; model: string; description: string; refusals: number }
export type Scene = { lastWords: string; lastCalls: string[]; lastResult: string; refused: string }
export type Refusal = { category: string | null; explanation: string | null } | null

const block = (title: string, body: string) => (body ? `\n${title}\n${body}\n` : '')

export function refusalBrief(a: BriefFor, s: Scene, refusal: Refusal): string {
  const short = a.id.slice(0, 8)
  const why = refusal && (refusal.category || refusal.explanation) ? `\nThe API's reason: ${[refusal.category, refusal.explanation].filter(Boolean).join(': ')}\n` : ''
  return [
    `[duckky-swarm] Refusal report: subagent ${short} (${a.label}, ${a.model}) stopped partway; its model refused` +
      `${a.refusals > 1 ? ` (${a.refusals} times, retries included)` : ''}. Its task: "${a.description}".`,
    why,
    block('Its last message before the refusal:', [s.lastWords, ...s.lastCalls.map((c) => `-> called ${c}`)].filter(Boolean).join('\n')),
    block('The last tool result it had been given:', s.lastResult),
    block('What came back in the refused reply:', s.refused),
    '\nWhat to do: decide whether this work should go on.',
    `- If it should, and the subagent was missing context: call resume_subagent with agent "${short}" and a message that explains clearly what this work is: the user's goal, the scope, and the context from this conversation and the project's instructions that the subagent never saw. Describe it as it is; do not claim permissions or facts the conversation does not support. It rewinds to its last message before the refusal (the refused reply is cut out) and carries on, on ${a.model}.`,
    '- If it should not, tell the user why it stopped instead of resuming it.',
  ].filter(Boolean).join('\n')
}
