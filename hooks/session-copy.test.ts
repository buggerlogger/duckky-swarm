import { expect, test } from 'claude-code/testing'
import { asSession, diverged, forkContextRef, resumeCommand, sessionIdFor, withForkContext } from './session-copy.ts'

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
  expect(rows.map((r) => r.type)).toEqual(['user', 'assistant', 'attachment', 'custom-title'])   // request blobs stay behind
  for (const r of rows) expect(r.sessionId).toBe('sid-1')
  for (const r of rows.slice(0, 3)) { expect(r.isSidechain).toBe(false); expect('agentId' in r).toBe(false) }
  expect(rows[0].parentUuid).toBe(null)            // the session starts here, not at the main agent's message
  expect(rows[1].parentUuid).toBe('u1')            // the rest of the chain as it was
  expect(rows[1].message.content[0].text).toBe('Fixed line 2.')
  // a custom title (what /rename writes): --resume opens it by that exact
  // title, and the count of turns the plugin wrote
  expect(rows[3]).toEqual({ type: 'custom-title', customTitle: 'duckky-swarm: fix the add bug', sessionId: 'sid-1', duckkyTurns: 2 })
})

test('typing in a copy makes it the person\'s: a turn more than the plugin wrote, whatever made the copy', () => {
  const copy = asSession(TRANSCRIPT, 'sid-1', 't')
  const later = TRANSCRIPT.replace(/u1|u2|u3/g, (u) => `next-${u}`)   // a new subagent's transcript: other ids
  expect(diverged(copy, later)).toBe(false)                          // still the plugin's own: written over
  const typed = `${copy}${JSON.stringify({ type: 'user', uuid: 'theirs', sessionId: 'sid-1', message: { content: 'go on' } })}\n`
  expect(diverged(typed, later)).toBe(true)
})

test('a copy the person has worked in is theirs: it holds a message the subagent never had', () => {
  const copy = asSession(TRANSCRIPT, 'sid-1', 't')
  expect(diverged(copy, TRANSCRIPT)).toBe(false)
  const worked = `${copy}${JSON.stringify({ type: 'user', uuid: 'theirs-1', parentUuid: 'u3', sessionId: 'sid-1', message: { content: 'go on' } })}\n`
  expect(diverged(worked, TRANSCRIPT)).toBe(true)
})

// a real fork's transcript: a pointer to the conversation it inherited, then
// its own records, the first starting a chain of its own
const PARENT = [
  { type: 'user', uuid: 'p1', parentUuid: null, sessionId: 'sess-now', message: { content: 'read notes.txt' } },
  { type: 'api-request-blob', sessionId: 'sess-now' },
  { type: 'assistant', uuid: 'p2', parentUuid: 'p1', sessionId: 'sess-now', message: { content: [{ type: 'text', text: 'SECRET=ZEBRA-81' }] } },
  { type: 'attachment', uuid: 'p3', parentUuid: 'p2', sessionId: 'sess-now' },
  { type: 'user', uuid: 'p4', parentUuid: 'p3', sessionId: 'sess-now', message: { content: 'what the parent said AFTER the fork' } },
  { type: 'user', uuid: 'q1', parentUuid: 'p1', sessionId: 'sess-now', message: { content: 'a branch rewound away' } },
].map((r) => JSON.stringify(r)).join('\n')
const FORK = [
  { type: 'fork-context-ref', agentId: 'a1b2c3d4e5', parentSessionId: 'sess-now', parentLastUuid: 'p3', contextLength: 3 },
  { type: 'assistant', uuid: 'f1', parentUuid: null, isSidechain: true, agentId: 'a1b2c3d4e5', sessionId: 'sess-now', message: { content: [{ type: 'tool_use', name: 'Agent' }] } },
  { type: 'user', uuid: 'f2', parentUuid: 'f1', isSidechain: true, agentId: 'a1b2c3d4e5', sessionId: 'sess-now', message: { content: 'say the secret' } },
].map((r) => JSON.stringify(r)).join('\n')

test('a real fork\'s transcript, its inherited conversation inlined: the parent\'s chain up to the fork, then its own, unbroken', () => {
  expect(forkContextRef(FORK)).toEqual({ parentSessionId: 'sess-now', parentLastUuid: 'p3' })
  const rows = withForkContext(FORK, PARENT).trim().split('\n').map((l) => JSON.parse(l))
  // only the chain the fork saw: not what the parent said after it, not a branch rewound away
  expect(rows.map((r) => r.uuid)).toEqual(['p1', 'p2', 'p3', 'f1', 'f2'])
  expect(rows[3].parentUuid).toBe('p3')   // its first record follows the parent's last
  expect(rows[4].parentUuid).toBe('f1')
  // as a session: the parent's records too, off no side chain, one chain
  const session = asSession(withForkContext(FORK, PARENT), 'sid-1', 't').trim().split('\n').map((l) => JSON.parse(l))
  expect(session.map((r) => r.uuid ?? r.type)).toEqual(['p1', 'p2', 'p3', 'f1', 'f2', 'custom-title'])
})

test('a transcript that is no fork\'s, or a parent file without the chain, is left as it is', () => {
  expect(forkContextRef(TRANSCRIPT)).toBe(null)
  expect(withForkContext(TRANSCRIPT, PARENT)).toBe(TRANSCRIPT)
  expect(withForkContext(FORK, '')).toBe(FORK)
})
