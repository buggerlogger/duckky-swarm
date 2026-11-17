import type { On, TurnStepChunk, TurnStepInput, TurnStepResult } from 'claude-code'
import { expect, test } from 'claude-code/testing'

// A model beneath the plugin that refuses its first `refusals` requests, then
// answers. It counts every request that really reaches it.
function model(on: On, refusals: number) {
  const seen = { requests: 0 }
  on('turn.step', async function* (_, e) {
    seen.requests += 1
    const refuse = seen.requests <= refusals
    const text = refuse ? `refused #${seen.requests}` : 'the work, done'
    yield { kind: 'text', index: 0, text } satisfies TurnStepChunk
    yield { kind: 'stop', stopReason: refuse ? 'refusal' : 'end_turn', usage: null } satisfies TurnStepChunk
    return { turnId: e.turnId, index: e.index, answer: text, toolUses: [], stopReason: refuse ? 'refusal' : 'end_turn', usage: null } satisfies TurnStepResult
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  return seen
}

const step = (agentId?: string): TurnStepInput => ({ turnId: 't1', index: 0, model: 'claude-opus-4-6', messageCount: 3, ...(agentId ? { agentId } : {}) })

// Reads a step to its end: its text chunks, and its result (the generator's
// return value: the test's `$.turn.step` stream has no `.result`).
async function run(s: AsyncGenerator<TurnStepChunk, TurnStepResult>) {
  const texts: string[] = []
  for (;;) {
    const n = await s.next()
    if (n.done) return { texts, result: n.value }
    if (n.value.kind === 'text') texts.push(n.value.text)
  }
}

test('a subagent refused twice is asked again; only the answer is kept', async ($, on) => {
  const seen = model(on, 2)
  const { texts, result } = await run($.turn.step(step('a1b2c3d4e5')))
  expect(seen.requests).toBe(3)                 // the request really went to the model three times
  expect(texts).toEqual(['the work, done'])     // the refused responses never left the hook
  expect(result.stopReason).toBe('end_turn')
})

test('refused more times than the retries: it stops as refused, after 1 + 3 requests', async ($, on) => {
  const seen = model(on, 99)
  const { texts, result } = await run($.turn.step(step('a1b2c3d4e5')))
  expect(seen.requests).toBe(4)
  expect(result.stopReason).toBe('refusal')
  expect(texts).toEqual(['refused #4'])         // the last refusal goes through, so the subagent stops
})

test('the retries are per subagent, across its whole run', async ($, on) => {
  const seen = model(on, 99)
  await run($.turn.step(step('a1b2c3d4e5')))    // spends all 3
  const { result } = await run($.turn.step({ ...step('a1b2c3d4e5'), index: 1 }))
  expect(seen.requests).toBe(5)                 // its next step gets no more retries
  expect(result.stopReason).toBe('refusal')
})

test('the main conversation is never retried', async ($, on) => {
  const seen = model(on, 1)
  const { result } = await run($.turn.step(step()))
  expect(seen.requests).toBe(1)
  expect(result.stopReason).toBe('refusal')
})

test('with Refusal retries = 0 nothing is asked again', { options: { refusalRetries: 0 } }, async ($, on) => {
  const seen = model(on, 1)
  const { result } = await run($.turn.step(step('a1b2c3d4e5')))
  expect(seen.requests).toBe(1)
  expect(result.stopReason).toBe('refusal')
})
