import { expect, test } from 'claude-code/testing'
import { refusalBrief } from './brief.ts'
import { newestWithin, refusalAt, refusalScene, parseTranscript, sessionLines, transcriptLines } from './history.ts'
import { retain, type AgentRecord } from './records.ts'
import { findAgent } from './register.ts'

test('the newest lines are kept, with a marker for what was left out', () => {
  expect(newestWithin(['one', 'two', 'three'], 100)).toBe('one\ntwo\nthree')
  expect(newestWithin(['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc'], 23)).toBe('[1 earlier message(s) left out to fit]\nbbbbbbbbbb\ncccccccccc')
})

test('session messages become lines, tool output clipped', () => {
  const lines = sessionLines([
    { role: 'user', text: 'the code word is PELICAN-42', toolUses: [] },
    { role: 'assistant', text: 'noted', toolUses: [{ tool: 'Read', input: { file_path: 'a.ts' }, text: 'x'.repeat(5000) }] },
  ])
  expect(lines[0]).toBe('USER: the code word is PELICAN-42')
  expect(lines[2]).toBe('ASSISTANT used Read {"file_path":"a.ts"}')
  expect(lines[3]?.startsWith('RESULT: xxx')).toBe(true)
  expect(lines[3]?.length).toBeLessThan(1600)
})

test('a subagent transcript file becomes lines', () => {
  const jsonl = [
    { type: 'fork-context-ref', agentId: 'a1' },
    { type: 'user', message: { role: 'user', content: 'count the files' } },
    { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'hidden' }, { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'a.ts b.ts' }] }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'There are 2 files.' }] } },
  ].map((r) => JSON.stringify(r)).join('\n')
  expect(transcriptLines(jsonl)).toEqual([
    'USER: count the files',
    'AGENT used Bash {"command":"ls"}',
    'RESULT: a.ts b.ts',
    'AGENT: There are 2 files.',
  ])
})

const rec = (id: string, description: string, status: AgentRecord['status'], daysAgo: number): AgentRecord => ({
  id, type: 'duckky-swarm:opus-4-6', label: 'Opus 4.6', model: 'claude-opus-4-6', requested: 'claude-opus-4-6', answeredBy: null,
  description, fork: false, sessionId: 's', cwd: '/w', startedAt: Date.UTC(2026, 10, 30) - daysAgo * 86_400_000, status, resumes: 0, outputTokens: 0,
})

test('a subagent is found by id, id prefix or words of its task', () => {
  const rows = [rec('a2f574639b5aca7df', 'fix the parser bug', 'done', 1), rec('b9c1', 'write the docs', 'aborted', 2)]
  expect(findAgent(rows, 'a2f57463')?.id).toBe('a2f574639b5aca7df')
  expect(findAgent(rows, 'parser bug')?.id).toBe('a2f574639b5aca7df')
  expect(findAgent(rows, 'DOCS')?.id).toBe('b9c1')
  expect(findAgent(rows, 'nothing like it')).toBeUndefined()
})

test('retain: stopped ones are kept longer than finished ones', () => {
  const now = Date.UTC(2026, 10, 30)
  const kept = retain([rec('done-20d', 'x', 'done', 20), rec('done-5d', 'x', 'done', 5), rec('aborted-20d', 'x', 'aborted', 20), rec('aborted-40d', 'x', 'aborted', 40)], now)
  expect(kept.map((r) => r.id)).toEqual(['done-5d', 'aborted-20d'])
})

// A subagent that read a file, said where it was going, then was refused.
const REFUSED = [
  { type: 'user', message: { content: 'reverse obf.js and compute _0xa(5)' } },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'Reading it first.' }, { type: 'tool_use', name: 'Read', input: { file_path: 'obf.js' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', content: `function _0xa(n) { ${'x'.repeat(3000)} }` }] } },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'It loops 3 times; now the arithmetic.' }] } },
  { type: 'assistant', message: { stop_reason: 'refusal', content: [{ type: 'text', text: 'REFUSED-TEXT' }] } },
].map((r) => JSON.stringify(r)).join('\n')

test('the rewind cuts at the refusal and keeps where it stood whole', () => {
  expect(refusalAt(parseTranscript(REFUSED))).toBe(4)
  const all = transcriptLines(REFUSED)
  expect(all.join('\n')).toContain('REFUSED-TEXT')                    // without the rewind it is there
  const rewound = transcriptLines(REFUSED, { beforeRefusal: true, fullTail: 4 })
  expect(rewound.join('\n')).not.toContain('REFUSED-TEXT')
  expect(rewound.at(-1)).toBe('AGENT: It loops 3 times; now the arithmetic.')   // its last message before
  expect(rewound.find((l) => l.startsWith('RESULT:'))?.length).toBeGreaterThan(3000)   // kept whole, not clipped at 1500
  expect(transcriptLines(REFUSED, { beforeRefusal: true })[0]).toBe(transcriptLines(REFUSED)[0])
})

test('the refusal report: where it stood, in full, and how to go on honestly', () => {
  const s = refusalScene(REFUSED)
  expect(s.lastWords).toBe('It loops 3 times; now the arithmetic.')
  expect(s.lastResult).toContain('function _0xa(n)')
  expect(s.refused).toBe('REFUSED-TEXT')
  const brief = refusalBrief({ id: 'a7b46044ddf67ae57', label: 'Opus 4.6', model: 'claude-opus-4-6', description: 'reverse obf.js', refusals: 4 }, s, { category: 'cyber', explanation: null })
  expect(brief).toContain('Refusal report: subagent a7b46044 (Opus 4.6, claude-opus-4-6)')
  expect(brief).toContain('(4 times, retries included)')
  expect(brief).toContain("The API's reason: cyber")
  expect(brief).toContain('It loops 3 times; now the arithmetic.')
  expect(brief).toContain('resume_subagent with agent "a7b46044"')
  expect(brief).toContain('explains clearly what this work is')
  expect(brief).toContain('do not claim permissions or facts the conversation does not support')
  expect(brief).toContain('tell the user why it stopped')
  expect(brief).not.toContain('refused step yourself')
})
