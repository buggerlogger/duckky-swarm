import { expect, test } from 'claude-code/testing'
import { newestWithin, sessionLines, transcriptLines } from './history.ts'
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
