import type { On, TurnStepChunk, TurnStepInput, TurnStepResult } from 'claude-code'
import { expect, test } from 'claude-code/testing'

// A model beneath the plugin. It writes its reply in two pieces and waits at
// `gate` between them, so a test can see whether the first piece left the
// hook before the reply ended; it refuses its first `refusals` requests.
function model(on: On, refusals = 0) {
  const seen = { requests: 0, finished: false }
  let open = () => {}
  const gate = new Promise<void>((resolve) => { open = resolve })
  on('turn.step', async function* (_, e) {
    seen.requests += 1
    const refuse = seen.requests <= refusals
    yield { kind: 'text', index: 0, text: refuse ? 'refused' : 'the work, ' } satisfies TurnStepChunk
    await gate
    if (!refuse) yield { kind: 'text', index: 0, text: 'done' } satisfies TurnStepChunk
    yield { kind: 'stop', stopReason: refuse ? 'refusal' : 'end_turn', usage: null } satisfies TurnStepChunk
    seen.finished = true
    return { turnId: e.turnId, index: e.index, answer: refuse ? 'refused' : 'the work, done', toolUses: [], stopReason: refuse ? 'refusal' : 'end_turn', usage: null } satisfies TurnStepResult
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  return { seen, open: () => open() }
}

const step = (agentId?: string): TurnStepInput => ({ turnId: 't1', index: 0, model: 'claude-opus-4-6', messageCount: 3, ...(agentId ? { agentId } : {}) })

// The rest of a step after the first chunk: its texts and its result (the
// generator's return value: the test's `$.turn.step` stream has no `.result`).
async function rest(s: AsyncGenerator<TurnStepChunk, TurnStepResult>) {
  const texts: string[] = []
  for (;;) {
    const n = await s.next()
    if (n.done) return { texts, result: n.value }
    if (n.value.kind === 'text') texts.push(n.value.text)
  }
}

test('a subagent\'s reply streams through as it comes: its first piece is out before the reply ends', async ($, on) => {
  const m = model(on)
  const s = $.turn.step(step('a1b2c3d4e5'))
  const first = await s.next()
  expect(first.value).toEqual({ kind: 'text', index: 0, text: 'the work, ' })
  expect(m.seen.finished).toBe(false)   // shown while the model is still writing
  m.open()
  const { texts, result } = await rest(s)
  expect(texts).toEqual(['done'])
  expect(result.stopReason).toBe('end_turn')
})

test('a refused reply goes through once, unchanged: Claude Code handles a refusal beneath the plugin', async ($, on) => {
  const m = model(on, 1)
  const s = $.turn.step(step('a1b2c3d4e5'))
  expect((await s.next()).value).toEqual({ kind: 'text', index: 0, text: 'refused' })
  m.open()
  const { result } = await rest(s)
  expect(result.stopReason).toBe('refusal')
  expect(m.seen.requests).toBe(1)   // never asked again by the plugin
})

test('the main conversation\'s steps pass straight by', async ($, on) => {
  const m = model(on)
  const s = $.turn.step(step())
  expect((await s.next()).value).toEqual({ kind: 'text', index: 0, text: 'the work, ' })
  m.open()
  expect((await rest(s)).result.stopReason).toBe('end_turn')
})
