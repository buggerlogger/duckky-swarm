import { expect, test } from 'claude-code/testing'
import { asSession, diverged, resumeCommand, sessionIdFor } from './session-copy.ts'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

// a subagent's transcript as Claude Code writes it: side-chain records with
// its agent id, request bookkeeping between them
const TRANSCRIPT = [
  { type: 'user', uuid: 'u1', parentUuid: 'main-7', isSidechain: true, agentId: 'a1b2c3d4e5', sessionId: 'sess-now', cwd: 'C:\\w', message: { content: 'fix the add bug' } },
  { type: 'api-request-blob', agentId: 'a1b2c3d4e5', sessionId: 'sess-now' },
  { type: 'assistant', uuid: 'u2', parentUuid: 'u1', isSidechain: true, agentId: 'a1b2c3d4e5', sessionId: 'sess-now', message: { model: 'claude-opus-5', content: [{ type: 'text', text: 'Fixed line 2.' }] } },
  { type: 'attachment', uuid: 'u3', parentUuid: 'u2', isSidechain: true, agentId: 'a1b2c3d4e5', sessionId: 'sess-now' },
].map((r) => JSON.stringify(r)).join('\n')

test('a subagent\'s copy has one session id, a UUID as Claude Code names sessions, the same every time', () => {
  const sid = sessionIdFor('a1b2c3d4e5f60718')
  expect(sid).toMatch(UUID_V4)
  expect(sessionIdFor('a1b2c3d4e5f60718')).toBe(sid)
  expect(sessionIdFor('b2c3d4e5f6071829')).not.toBe(sid)
  expect(resumeCommand(sid, 'claude-opus-5')).toBe(`claude --resume ${sid} --model claude-opus-5`)
})

test('the transcript becomes a main session: its own records, off the side chain, the chain started, a title', () => {
  const rows = asSession(TRANSCRIPT, 'sid-1', 'duckky-swarm: fix the add bug').trim().split('\n').map((l) => JSON.parse(l))
  expect(rows.map((r) => r.type)).toEqual(['user', 'assistant', 'attachment', 'ai-title'])   // request blobs stay behind
  for (const r of rows) expect(r.sessionId).toBe('sid-1')
  for (const r of rows.slice(0, 3)) { expect(r.isSidechain).toBe(false); expect('agentId' in r).toBe(false) }
  expect(rows[0].parentUuid).toBe(null)            // the session starts here, not at the main agent's message
  expect(rows[1].parentUuid).toBe('u1')            // the rest of the chain as it was
  expect(rows[1].message.content[0].text).toBe('Fixed line 2.')
  expect(rows[3]).toEqual({ type: 'ai-title', aiTitle: 'duckky-swarm: fix the add bug', sessionId: 'sid-1' })
})

test('a copy the person has worked in is theirs: it holds a message the subagent never had', () => {
  const copy = asSession(TRANSCRIPT, 'sid-1', 't')
  expect(diverged(copy, TRANSCRIPT)).toBe(false)
  const worked = `${copy}${JSON.stringify({ type: 'user', uuid: 'theirs-1', parentUuid: 'u3', sessionId: 'sid-1', message: { content: 'go on' } })}\n`
  expect(diverged(worked, TRANSCRIPT)).toBe(true)
})
