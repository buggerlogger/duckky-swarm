import type { AgentSpawnInput, CommandRunInput, On } from 'claude-code'
import { expect, test, type Engine } from 'claude-code/testing'
import { effortsFor, labelFor, parseModels } from './models.ts'

// the test environment has a timer at run time; its types do not declare one
declare function setTimeout(run: () => void, ms: number): unknown

// The test's `$` is the engine's own, so its calls take an event's whole input.
const spawn = (subagentType: string, description = 'x'): AgentSpawnInput => ({
  tool_use_id: 'toolu_test', prompt: description, description, subagentType,
  provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false,
})
const duckky = (args = ''): CommandRunInput => ({
  command: 'duckky', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 },
})

test('model list: names, ids and labels from /config', () => {
  const { models, skipped } = parseModels('opus-4-6=claude-opus-4-6, claude-opus-5,  , bad name=x, opus-5=dup')
  expect(models.map((m) => [m.name, m.id, m.label])).toEqual([
    ['opus-4-6', 'claude-opus-4-6', 'Opus 4.6'],
    ['opus-5', 'claude-opus-5', 'Opus 5'],
  ])
  expect(skipped).toEqual(['bad name=x', 'opus-5=dup'])
  expect(labelFor('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(labelFor('claude-opus-5-5')).toBe('Opus 5.5')
})

// the engine beneath the plugin, as far as these tests need it; its store is a
// Map the test reads back
function engine(on: On, answered = 'claude-opus-4-6', files: Record<string, string> = {}, env: Record<string, string> = { USERPROFILE: 'C:/Users/t' }) {
  const registered: { name: string; model?: string; description: string }[] = []
  const spawned: { subagentType: string; prompt: string; model?: string }[] = []
  const store = new Map<string, unknown>()
  const toasts: string[] = []
  on('session.id', () => ({ value: 'sess-now' }))
  on('session.messages', () => ({ value: [
    { role: 'user', text: 'the code word is PELICAN-42', toolUses: [] },
    { role: 'assistant', text: 'noted', toolUses: [] },
  ] }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__duckky-swarm__${e.name}` } }))
  on('env.get', (_, e) => ({ value: env[e.name] }))
  // the engine hands fs.read a normalised path (C:/a/b arrives as C:\a\b)
  const slashes = (p: string) => p.replace(/\\/g, '/')
  on('fs.read', (_, e) => {
    const hit = Object.keys(files).find((k) => slashes(k) === slashes(e.path))
    if (hit === undefined) throw new Error(`no file ${e.path}`)
    return { value: files[hit] as string }
  })
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => (store.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_, e) => (store.delete(e.key), { value: undefined }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_, e) => (toasts.push(String((e as { text?: string }).text ?? e)), { value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.register', (_, e) => {
    registered.push(e)
    return { value: { agent: `duckky-swarm:${e.name}` } }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  // A spawn the PLUGIN makes reaches here as the Agent tool's input
  // (subagent_type, snake case); one the test makes, as the engine's.
  on('agent.spawn', (_, e) => {
    const x = e as typeof e & { subagent_type?: string }
    const subagentType = String(x.subagentType ?? x.subagent_type ?? '')
    spawned.push({ subagentType, prompt: e.prompt, model: e.model })
    return { model: subagentType.startsWith('duckky-swarm:') ? answered : 'claude-opus-5-5', agentId: 'a1b2c3d4e5' }
  })
  on('turn.complete', (_, e) => ({ text: e.answer, usage: e.usage }))
  return { registered, spawned, store, toasts }
}

const finished = (agentId: string, model: string) => ({
  answer: 'found it', durationMs: 900, isAborted: false, turnId: 't1', agentId, reason: 'answer',
  category: null, explanation: null,
  usage: { model, input_tokens: 10, output_tokens: 42, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
}) as never

// Every current model of the Claude API reference (2026-10), most capable
// first; Claude Mythos 5.1 is left out: Project Glasswing only.
const ALL = [
  'fable-5-1', 'fable-5', 'opus-5-5', 'opus-5', 'opus-4-8', 'opus-4-7', 'opus-4-6',
  'sonnet-5-5', 'sonnet-5', 'sonnet-4-6', 'haiku-5-5', 'haiku-4-5',
]

test('by default every current model becomes an agent type on that exact model, and a fork of it', async ($, on) => {
  const { registered } = engine(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  expect(registered.map((r) => [r.name, r.model])).toEqual(ALL.flatMap((n) => [[n, `claude-${n}`], [`${n}-fork`, `claude-${n}`]]))
  const opus46 = registered.findIndex((r) => r.name === 'opus-4-6')
  expect(registered[opus46]?.description).toContain('Opus 4.6')
  expect(registered[opus46 + 1]?.description).toContain('FORK on Opus 4.6')
  expect(registered.find((r) => r.name === 'fable-5-1')?.description).toContain('Fable 5.1 (model claude-fable-5-1)')
})

test('with Fork on another model = true, no fork types are added', { options: { forkMode: 'true' } }, async ($, on) => {
  const { registered } = engine(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  expect(registered.map((r) => r.name)).toEqual(ALL)
})

test('each model takes only the effort levels it has', () => {
  expect(effortsFor('claude-opus-5-5')).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  expect(effortsFor('claude-haiku-5-5')).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  expect(effortsFor('claude-opus-4-6[1m]')).toEqual(['low', 'medium', 'high', 'max'])   // xhigh came with Opus 4.7
  expect(effortsFor('claude-sonnet-4-6')).toEqual(['low', 'medium', 'high', 'max'])
  expect(effortsFor('claude-opus-4-7')).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  expect(effortsFor('claude-opus-4-5')).toEqual(['low', 'medium', 'high'])
  for (const none of ['claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-5', 'claude-opus-4-1', 'claude-3-7-sonnet-latest']) expect(effortsFor(none)).toEqual([])
  // a /config default that the model does not take is skipped, not sent
  expect(parseModels('claude-haiku-4-5@high, claude-opus-4-6@xhigh, claude-opus-4-6@max').skipped).toEqual(['claude-haiku-4-5@high', 'claude-opus-4-6@xhigh'])
})

test('a context fork starts with the conversation so far, then its task', async ($, on) => {
  const { spawned, store } = engine(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-4-6-fork', 'say the code word'))
  expect(spawned[0]?.prompt).toContain('USER: the code word is PELICAN-42')
  expect(spawned[0]?.prompt).toMatch(/Your task:\nsay the code word$/)
  expect(store.get('agent:a1b2c3d4e5')).toMatchObject({ fork: true, requested: 'claude-opus-4-6' })
})

test('resume_subagent continues an earlier session\'s subagent on its model, with its transcript', async ($, on) => {
  const path = 'C:/Users/t/.claude/projects/C--old/sess-old/subagents/agent-old1234567.jsonl'
  const jsonl = [
    { type: 'user', message: { content: 'find the slow query' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'It is the N+1 in orders.ts line 88.' }] } },
  ].map((r) => JSON.stringify(r)).join('\n')
  const { spawned, store } = engine(on, 'claude-opus-4-6', { [path]: jsonl })
  store.set('agent:old1234567', {
    id: 'old1234567', type: 'duckky-swarm:opus-4-6', label: 'Opus 4.6', model: 'claude-opus-4-6', requested: 'claude-opus-4-6',
    answeredBy: 'claude-opus-4-6', description: 'find the slow query', fork: false, sessionId: 'sess-old', cwd: 'C:\\old',
    startedAt: Date.now() - 3_600_000, endedAt: Date.now() - 3_000_000, status: 'aborted', resumes: 0, outputTokens: 5, transcript: path,
  })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })

  const call = $.tool.call({ tool: 'mcp__duckky-swarm__resume_subagent', agent: 'slow query', message: 'now fix it' } as never)
  for (let i = 0; i < 200 && !spawned.length; i++) await new Promise<void>((r) => setTimeout(r, 5))
  expect(spawned[0]?.subagentType).toBe('duckky-swarm:opus-4-6')
  expect(spawned[0]?.prompt).toContain('AGENT: It is the N+1 in orders.ts line 88.')
  expect(spawned[0]?.prompt).toMatch(/New instruction:\nnow fix it$/)
  // The rest (the resumed agent's answer coming back as the tool's result) is
  // not testable here: an agent id is "set by core", and a test hook that
  // answers agent.spawn starts no agent, so the plugin's spawn gets none back.
  // It is checked in a real claude instead (see CLAUDE.md).
  const answered = (await call) as { result?: unknown }
  expect(typeof answered.result).toBe('string')   // a plugin tool's result must be a string
  expect(String(answered.result)).toContain('no agent started')
})

test('a subagent is recorded with the model it started on and the model that answered', async ($, on) => {
  const { store, toasts } = engine(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const spawned = await $.agent.spawn(spawn('duckky-swarm:opus-4-6', 'find the bug'))
  expect(spawned.agentId).toBe('a1b2c3d4e5')
  await $.turn.complete(finished('a1b2c3d4e5', 'claude-opus-4-6'))
  expect(store.get('agent:a1b2c3d4e5')).toMatchObject({ model: 'claude-opus-4-6', requested: 'claude-opus-4-6', answeredBy: 'claude-opus-4-6', status: 'done', outputTokens: 42 })
  expect(toasts).toEqual([])
  const shown = await $.command.run(duckky('list'))
  expect(shown.text).toMatch(/✓ Opus 4\.6 +claude-opus-4-6 +find the bug/)
})

// The Character setting reaches the window as DUCKKY_CHARACTER, like the paths.
for (const [setting, sent] of [[undefined, 'Clawd'], ['Duckky Ducks', 'Duckky Ducks']] as const) {
  test(`/duckky opens the swarm window on this session's subagents, with nothing variable on the command line (Character: ${setting ?? 'default'})`, { options: setting ? { character: setting } : {} }, async ($, on) => {
    const runs: { argv: readonly string[]; env?: Record<string, string> }[] = []
    engine(on, 'claude-opus-4-6', {}, { USERPROFILE: 'C:/Users/t', OS: 'Windows_NT' })
    on('process.run', (_, e) => {
      runs.push({ argv: e.argv, env: e.init?.env })
      return { value: { exitCode: 0, stdout: e.argv[0] === 'node' ? 'v24.0.0' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    await $.session.start({ cwd: 'C:\\work\\my app', surface: 'terminal', isInteractive: true })
    const r = await $.command.run(duckky())
    expect(r.text).toContain('Opened the Duckky Swarm window')
    const launch = runs.find((x) => x.argv[0] === 'powershell.exe')
    expect(launch?.argv.slice(0, 4)).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand'])
    expect(launch?.argv.join(' ')).not.toContain('my app')   // paths travel as variables only
    expect(launch?.env?.DUCKKY_DIR).toBe('C:/Users/t/.claude/projects/C--work-my-app/sess-now/subagents')
    expect(launch?.env?.DUCKKY_VIEWER).toMatch(/viewer\/duckky-view\.mjs$/)
    expect(launch?.env?.DUCKKY_CHARACTER).toBe(sent)
  })
}

test('/duckky without Node says how to run it instead', async ($, on) => {
  engine(on)
  on('process.run', () => { throw new Error('node: not found') })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const r = await $.command.run(duckky())
  expect(r.text).toMatch(/Node\.js, which was not found.*node ".*duckky-view\.mjs"/)
})

test('the 1M-context variant of the asked model is not called out', async ($, on) => {
  // measured live: Claude Code reports a started subagent as claude-opus-4-6[1m]
  const { toasts, store } = engine(on, 'claude-opus-4-6[1m]')
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-4-6'))
  expect(toasts).toEqual([])
  expect(store.get('agent:a1b2c3d4e5')).toMatchObject({ label: 'Opus 4.6' })
})

test('a model other than the one asked for is called out', async ($, on) => {
  const { toasts } = engine(on, 'claude-opus-5-5')
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-4-6'))
  expect(toasts.join(' ')).toContain('asked for claude-opus-4-6, Claude Code started claude-opus-5-5')
})

test('with keepAgents off, nothing is written to the store', { options: { keepAgents: false } }, async ($, on) => {
  const { store } = engine(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-5'))
  expect([...store.keys()]).toEqual([])
})

// --- the refusal report ------------------------------------------------------

// a1b2c3d4e5's transcript where Claude Code keeps it for this test's session
const TRANSCRIPT = 'C:/Users/t/.claude/projects/-w/sess-now/subagents/agent-a1b2c3d4e5.jsonl'
const REFUSED = [
  { type: 'user', message: { content: 'reverse obf.js and compute _0xa(5)' } },
  { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'obf.js' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', content: 'function _0xa(n) { /* 3 rounds */ }' }] } },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'It loops 3 times; now the arithmetic.' }] } },
  { type: 'assistant', message: { stop_reason: 'refusal', content: [{ type: 'text', text: 'REFUSED-TEXT' }] } },
].map((r) => JSON.stringify(r)).join('\n')

const refusedTurn = (agentId: string) => ({
  answer: '', durationMs: 10, isAborted: false, turnId: 't1', agentId, reason: 'refusal',
  refusal: { category: 'cyber', explanation: null },
}) as never

test('foreground: the Agent call that waited on a refused subagent carries the refusal report', async ($, on) => {
  engine(on, 'claude-opus-4-6', { [TRANSCRIPT]: REFUSED })
  on('tool.call', () => ({ result: 'the subagent stopped' }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-4-6', 'reverse obf.js'))
  await $.turn.complete(refusedTurn('a1b2c3d4e5'))

  const out = await $.tool.call({ tool: 'Agent', description: 'reverse obf.js', prompt: 'x', tool_use_id: 'toolu_test' } as never) as { context?: readonly string[] }
  const report = (out.context ?? []).join('\n')
  expect(report).toContain('Refusal report: subagent a1b2c3d4')
  expect(report).toContain('It loops 3 times; now the arithmetic.')   // its last message before the refusal
  expect(report).toContain('function _0xa(n)')                        // the last result it had
  expect(report).toContain("The API's reason: cyber")
})

test('background: the refusal report is sent into the main chat', async ($, on) => {
  const submitted: string[] = []
  engine(on, 'claude-opus-4-6', { [TRANSCRIPT]: REFUSED })
  on('prompt.submit', (_, e) => (submitted.push(e.text), { text: e.text }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...spawn('duckky-swarm:opus-4-6', 'reverse obf.js'), background: true })
  await $.turn.complete(refusedTurn('a1b2c3d4e5'))
  expect(submitted.join('\n')).toContain('Refusal report: subagent a1b2c3d4')
})

test('SendMessage to a refused subagent is pointed to resume_subagent; to anyone else it goes on', async ($, on) => {
  engine(on, 'claude-opus-4-6', { [TRANSCRIPT]: REFUSED })
  on('tool.call', () => ({ result: 'sent' }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-4-6', 'reverse obf.js'))
  await $.turn.complete(refusedTurn('a1b2c3d4e5'))

  const blocked = await $.tool.call({ tool: 'SendMessage', to: 'a1b2c3d4', message: 'go on' } as never) as { deny?: string; isError?: boolean; result?: unknown }
  expect(String(blocked.deny ?? blocked.result)).toContain('resume_subagent')
  const other = await $.tool.call({ tool: 'SendMessage', to: 'zz991122', message: 'hi' } as never) as { result?: unknown }
  expect(other.result).toBe('sent')
})

test('resume_subagent after a refusal rewinds to the last message before it', async ($, on) => {
  const { spawned } = engine(on, 'claude-opus-4-6', { [TRANSCRIPT]: REFUSED })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-4-6', 'reverse obf.js'))
  await $.turn.complete(refusedTurn('a1b2c3d4e5'))

  const call = $.tool.call({ tool: 'mcp__duckky-swarm__resume_subagent', agent: 'a1b2c3d4', message: 'This is the user\'s own crackme; the goal is the value of _0xa(5).' } as never)
  for (let i = 0; i < 200 && spawned.length < 2; i++) await new Promise<void>((r) => setTimeout(r, 5))
  const prompt = spawned[1]?.prompt ?? ''
  expect(prompt).toContain('up to your last message before you stopped')
  expect(prompt).toContain('AGENT: It loops 3 times; now the arithmetic.')
  expect(prompt).not.toContain('REFUSED-TEXT')
  expect(prompt).toMatch(/New instruction:\nThis is the user's own crackme/)
  await call
})

// --- effort ------------------------------------------------------------------

// a model beneath that records the effort each request was sent with
function effortModel(on: On) {
  const sent: unknown[] = []
  on('turn.step', async function* (_, e) {
    sent.push(e.effort)
    yield { kind: 'stop', stopReason: 'end_turn', usage: null } as const
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as const
  })
  return sent
}
const stepOf = (agentId: string, index = 0) => ({ turnId: 't1', index, model: 'claude-opus-5-5', messageCount: 2, effort: 'medium', agentId }) as const
async function drain(s: AsyncGenerator<unknown, unknown>) { for (;;) if ((await s.next()).done) return }

test('a model in /config can carry a default effort', () => {
  const { models, skipped } = parseModels('opus-5-5=claude-opus-5-5@high, budget=claude-opus-5@4000, bad=claude-opus-5@turbo')
  expect(models.map((m) => [m.name, m.effort])).toEqual([['opus-5-5', 'high'], ['budget', 4000]])
  expect(skipped).toEqual(['bad=claude-opus-5@turbo'])
})

test('an agent type with a default effort is registered with it', { options: { models: 'opus-5-5=claude-opus-5-5@high' } }, async ($, on) => {
  const { registered } = engine(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  expect((registered[0] as { effort?: unknown }).effort).toBe('high')
  expect(registered[0]?.description).toContain("effort")
})

test('set_subagent_effort: a running subagent\'s next request goes out at the new effort', async ($, on) => {
  engine(on, 'claude-opus-5-5')   // the model its type names: Opus 5.5 takes xhigh
  const sent = effortModel(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-5-5', 'map the code'))
  await drain($.turn.step(stepOf('a1b2c3d4e5', 0)) as never)
  const set = await $.tool.call({ tool: 'mcp__duckky-swarm__set_subagent_effort', agent: 'a1b2c3d4', effort: 'xhigh' } as never) as { result?: unknown }
  expect(String(set.result)).toContain('thinks at effort xhigh from its next model request on (it was medium)')
  await drain($.turn.step(stepOf('a1b2c3d4e5', 1)) as never)
  expect(sent).toEqual(['medium', 'xhigh'])   // the request after the change, not the one before
  const listed = await $.command.run(duckky('list'))
  expect(listed.text).toContain('effort xhigh')
})

test('set_subagent_effort refuses a bad effort, and a subagent that is not running', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-5-5', 'map the code'))
  const bad = await $.tool.call({ tool: 'mcp__duckky-swarm__set_subagent_effort', agent: 'a1b2c3d4', effort: 'turbo' } as never) as { result?: unknown }
  expect(String(bad.result)).toContain('is not an effort')
  await $.turn.complete(finished('a1b2c3d4e5', 'claude-opus-5-5'))
  const done = await $.tool.call({ tool: 'mcp__duckky-swarm__set_subagent_effort', agent: 'a1b2c3d4', effort: 'high' } as never) as { result?: unknown }
  expect(String(done.result)).toContain('resume it with resume_subagent and effort "high"')
})

test('resume_subagent with an effort: the resumed subagent\'s first request already uses it', async ($, on) => {
  const { spawned } = engine(on, 'claude-opus-4-6', { [TRANSCRIPT]: REFUSED })
  const sent = effortModel(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-4-6', 'reverse obf.js'))
  await $.turn.complete(refusedTurn('a1b2c3d4e5'))
  const call = $.tool.call({ tool: 'mcp__duckky-swarm__resume_subagent', agent: 'a1b2c3d4', message: 'go on', effort: 'max' } as never)
  for (let i = 0; i < 200 && spawned.length < 2; i++) await new Promise<void>((r) => setTimeout(r, 5))
  // the engine starts the resumed agent: its first turn, with the prompt it was spawned with
  await $.turn.start({ text: spawned[1]?.prompt ?? '', turnId: 't9', agentId: 'resumed1' } as never)
  await drain($.turn.step(stepOf('resumed1', 0)) as never)
  expect(sent).toEqual(['max'])
  await call
})

// A subagent of an earlier session that the store no longer holds: only
// Claude Code's own files for it are on disk.
const LOST_PROJECT = 'C:/Users/t/.claude/projects/-w'
const LOST_DIR = `${LOST_PROJECT}/sess-old/subagents`
const entry = (name: string, kind: 'file' | 'dir') => ({ name, kind, size: 10, mtimeMs: 1, isLink: false })

async function resumeLost($: Engine, on: On, query: string) {
  const transcript = [
    { type: 'user', message: { content: 'fix the add bug' } },
    { type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Fixed add on line 2.' }] } },
  ].map((r) => JSON.stringify(r)).join('\n')
  const { spawned, store } = engine(on, 'claude-opus-5-5', {
    [`${LOST_DIR}/agent-a94d12e8d032a017c.meta.json`]: JSON.stringify({ agentType: 'duckky-swarm:opus-5-5', description: 'fix the add bug', finished: true }),
    [`${LOST_DIR}/agent-a94d12e8d032a017c.jsonl`]: transcript,
  })
  on('fs.list', (_, e) => {
    const p = e.path.split('\\').join('/')
    if (p === LOST_PROJECT) return { value: [entry('sess-old', 'dir')] }
    if (p === LOST_DIR) return { value: [entry('agent-a94d12e8d032a017c.meta.json', 'file'), entry('agent-a94d12e8d032a017c.jsonl', 'file')] }
    return { value: [] }
  })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  expect([...store.keys()]).toEqual([])   // the store knows nothing of it
  const call = $.tool.call({ tool: 'mcp__duckky-swarm__resume_subagent', agent: query, message: 'which line?' } as never)
  for (let i = 0; i < 200 && !spawned.length; i++) await new Promise<void>((r) => setTimeout(r, 5))
  expect(spawned[0]?.subagentType).toBe('duckky-swarm:opus-5-5')     // same model, from its transcript
  expect(spawned[0]?.prompt).toContain('AGENT: Fixed add on line 2.')
  await call
  expect(store.get('agent:a94d12e8d032a017c')).toMatchObject({ description: 'fix the add bug', model: 'claude-opus-5-5', sessionId: 'sess-old' })
}

test('resume_subagent finds a subagent the store lost by its id, in Claude Code\'s own folders', ($, on) => resumeLost($, on, 'a94d12e8'))
test('resume_subagent finds a subagent the store lost by words from its task', ($, on) => resumeLost($, on, 'add bug'))

test('set_subagent_effort refuses an effort the subagent\'s model does not take', async ($, on) => {
  engine(on, 'claude-haiku-4-5')
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:haiku-4-5', 'list the files'))
  const r = await $.tool.call({ tool: 'mcp__duckky-swarm__set_subagent_effort', agent: 'a1b2c3d4', effort: 'high' } as never) as { result?: unknown }
  expect(String(r.result)).toContain('Haiku 4.5 does not take an effort')
})

test('set_subagent_effort: no xhigh for Opus 4.6, which has no such level', async ($, on) => {
  engine(on, 'claude-opus-4-6')
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-4-6', 'map the code'))
  const r = await $.tool.call({ tool: 'mcp__duckky-swarm__set_subagent_effort', agent: 'a1b2c3d4', effort: 'xhigh' } as never) as { result?: unknown }
  expect(String(r.result)).toContain('Opus 4.6 takes effort low, medium, high, max')
})

test('an effort is never added to a request Claude Code sent without one', async ($, on) => {
  engine(on, 'claude-opus-5-5')
  const sent = effortModel(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-5-5', 'map the code'))
  await $.tool.call({ tool: 'mcp__duckky-swarm__set_subagent_effort', agent: 'a1b2c3d4', effort: 'max' } as never)
  await drain($.turn.step({ ...stepOf('a1b2c3d4e5', 0), effort: undefined }) as never)
  await drain($.turn.step(stepOf('a1b2c3d4e5', 1)) as never)
  expect(sent).toEqual([undefined, 'max'])
})
