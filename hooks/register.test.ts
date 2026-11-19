import type { AgentSpawnInput, CommandRunInput, On } from 'claude-code'
import { expect, test, type Engine } from 'claude-code/testing'
import { effortsFor, labelFor, parseModels } from './models.ts'
import { asSession, sessionIdFor } from './session-copy.ts'

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
    // `*/name`: a file wherever it is, as the plugin's root differs per machine
    const hit = Object.keys(files).find((k) => (k.startsWith('*/') ? slashes(e.path).endsWith(k.slice(1)) : slashes(k) === slashes(e.path)))
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

// the model each request went to, from turn.step
function stepModels(on: On) {
  const went: string[] = []
  on('turn.step', async function* (_, e) {
    went.push(e.model)
    yield { kind: 'stop', stopReason: 'end_turn', usage: null } as const
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as const
  })
  return went
}
const forkCall = (tool_use_id = 'toolu_fork') =>
  ({ tool: 'Agent', tool_use_id, description: 'say the code word', prompt: 'say the code word', subagent_type: 'duckky-swarm:opus-4-6-fork' }) as never

test('a duckky fork is Claude Code\'s own fork: its task as the main agent wrote it, every request sent to the model it forks onto', async ($, on) => {
  const { spawned, store } = engine(on)
  const calls: { subagent_type?: string }[] = []
  on('tool.call', (_, e) => (calls.push(e as never), { result: 'launched' }))
  const went = stepModels(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.tool.call(forkCall())
  expect(calls[0]?.subagent_type).toBe('fork')   // the whole conversation, every tool result: no text copy
  await $.agent.spawn({ ...spawn('fork', 'say the code word'), tool_use_id: 'toolu_fork', fork: true })
  expect(spawned[0]?.prompt).toMatch(/^say the code word\n\n## Your workspace \(a hard rule\)/)
  expect(store.get('agent:a1b2c3d4e5')).toMatchObject({ type: 'duckky-swarm:opus-4-6-fork', fork: true, label: 'Opus 4.6', routeModel: 'claude-opus-4-6' })
  await drain($.turn.step(stepOf('a1b2c3d4e5', 0)) as never)
  await drain($.turn.step(stepOf('a1b2c3d4e5', 1)) as never)
  expect(went).toEqual(['claude-opus-4-6', 'claude-opus-4-6'])   // not the parent's claude-opus-5-5
})

test('a duckky fork\'s first request, out before Claude Code has said its id, already goes to the model it forks onto', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: 'launched' }))
  on('agent.list', () => ({ value: [
    { id: 'f0rk00000001', type: 'fork', description: 'say the code word', status: 'running' },
    { id: 'other0000001', type: 'general-purpose', description: 'say the code word', status: 'running' },
  ] }) as never)
  const went = stepModels(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.tool.call(forkCall())
  await drain($.turn.step(stepOf('f0rk00000001', 0)) as never)
  await drain($.turn.step(stepOf('other0000001', 0)) as never)   // no fork: left on its own model
  expect(went).toEqual(['claude-opus-4-6', 'claude-opus-5-5'])
})

test('where Claude Code will not fork, the main agent is told to call the type again, and that call is left a duckky subagent', async ($, on) => {
  const { toasts } = engine(on)
  const calls: { subagent_type?: string }[] = []
  on('tool.call', (_, e) => {
    const x = e as { subagent_type?: string }
    calls.push(x)
    return x.subagent_type === 'fork' ? { result: '', text: 'Forking is not available here', isError: true } : { result: 'launched' }
  })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const first = await $.tool.call(forkCall()) as { deny?: string }
  expect(first.deny).toContain('Claude Code would not fork here (Forking is not available here). Call the Agent tool again with the same agent type, duckky-swarm:opus-4-6-fork')
  await $.tool.call(forkCall('toolu_fork2'))
  expect(calls.map((c) => c.subagent_type)).toEqual(['fork', 'duckky-swarm:opus-4-6-fork'])   // not tried as a fork again
  expect(toasts.join('\n')).toContain('would not fork here')
})

test('there, a duckky fork\'s own type gets a text copy: the conversation so far, then its task', async ($, on) => {
  const { spawned, store } = engine(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-4-6-fork', 'say the code word'))
  expect(spawned[0]?.prompt).toContain('USER: the code word is PELICAN-42')
  expect(spawned[0]?.prompt).toMatch(/Your task:\nsay the code word\n\n## Your workspace \(a hard rule\)/)   // its workspace after the task
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
  expect(spawned[0]?.prompt).toMatch(/New instruction:\nnow fix it\n\n## Your workspace \(a hard rule\)/)
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

test('SendMessage reaches any subagent, a refused one too: Claude Code withholds a refused reply itself', async ($, on) => {
  engine(on, 'claude-opus-4-6', { [TRANSCRIPT]: REFUSED })
  on('tool.call', () => ({ result: 'sent' }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-4-6', 'reverse obf.js'))
  await $.turn.complete(refusedTurn('a1b2c3d4e5'))
  const sent = await $.tool.call({ tool: 'SendMessage', to: 'a1b2c3d4', message: 'go on' } as never) as { result?: unknown }
  expect(sent.result).toBe('sent')
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

test('an agent type tells Claude only the effort levels its model has', async ($, on) => {
  const { registered } = engine(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const about = (name: string) => String(registered.find((r) => r.name === name)?.description)
  expect(about('opus-5-5')).toContain('(low, medium, high, xhigh, max)')
  expect(about('opus-4-6')).toContain('(low, medium, high, max)')
  expect(about('haiku-4-5')).toContain('Haiku 4.5 takes no effort')
  expect(about('haiku-4-5')).not.toContain('xhigh')
})

test('messages.json at the plugin root is what Claude is sent: an agent type described in its words', async ($, on) => {
  const file = JSON.stringify({ agentType: { forkDescription: 'Fork onto {label} ({id}), with the chat so far.' } })
  const { registered } = engine(on, 'claude-opus-4-6', { '*/messages.json': file })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  expect(registered.find((r) => r.name === 'opus-4-6-fork')?.description).toBe('Fork onto Opus 4.6 (claude-opus-4-6), with the chat so far.')
  expect(registered.find((r) => r.name === 'opus-4-6')?.description).toContain('Runs the task on Opus 4.6')   // left out: built in
})

test('a broken messages.json says so in a toast, and the built-in texts are sent', async ($, on) => {
  const { registered, toasts } = engine(on, 'claude-opus-4-6', { '*/messages.json': '{ "agentType": ' })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  expect(toasts.join('\n')).toMatch(/duckky-swarm: messages\.json: messages\.json is not valid JSON/)
  expect(registered.find((r) => r.name === 'opus-4-6-fork')?.description).toContain('A FORK on Opus 4.6')
})

// --- the same subagent, and a subagent as a main session ---------------------

test('resume_subagent resumes a subagent of this session ITSELF, through Claude Code: no new subagent', async ($, on) => {
  const { spawned } = engine(on, 'claude-opus-5', { [TRANSCRIPT]: REFUSED })
  const sends: { to: string; text: string }[] = []
  on('session.send', (_, e) => (sends.push({ to: JSON.stringify(e.to), text: e.text }), { isDelivered: true } as never))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-5-fork', 'close the gap'))
  await $.turn.complete(finished('a1b2c3d4e5', 'claude-opus-5'))
  const r = await $.tool.call({ tool: 'mcp__duckky-swarm__resume_subagent', agent: 'a1b2c3d4', message: 'next task: bid 277' } as never) as { result?: unknown }
  expect(sends).toEqual([{ to: expect.stringContaining('a1b2c3d4e5'), text: expect.stringMatching(/^next task: bid 277\n\n\(Keep your workspace current as you go: \/w\/duckky-swarm\/claude-opus-5-[0-9a-f]{8}-close-the-gap\)$/) }])
  expect(spawned.length).toBe(1)   // only the original: nothing new started
  expect(String(r.result)).toContain('Resumed a1b2c3d4 itself on claude-opus-5')
})

test('one Claude Code will not resume itself carries on as a new subagent, on the model it was STARTED for, not a fallback', async ($, on) => {
  const { spawned } = engine(on, 'claude-opus-5', { [TRANSCRIPT]: REFUSED })
  on('session.send', () => ({ isDelivered: false, reason: 'it was stopped by the user and won\'t be resumed' } as never))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-5', 'close the gap'))
  await $.turn.complete(finished('a1b2c3d4e5', 'claude-opus-4-8'))   // a refusal moved its reply to Opus 4.8
  const call = $.tool.call({ tool: 'mcp__duckky-swarm__resume_subagent', agent: 'a1b2c3d4', message: 'go on' } as never)
  for (let i = 0; i < 200 && spawned.length < 2; i++) await new Promise<void>((resolve) => setTimeout(resolve, 5))
  expect(spawned[1]?.subagentType).toBe('duckky-swarm:opus-5')   // the model chosen, not the one that last answered
  expect(String(((await call) as { result?: unknown }).result)).toContain('would not resume a1b2c3d4 itself (it was stopped by the user')
})

test('a subagent that stops is saved as a session claude --resume opens; /duckky list and /duckky open show the command', async ($, on) => {
  const { store } = engine(on, 'claude-opus-4-6', { [TRANSCRIPT]: REFUSED })
  const writes = new Map<string, string>()
  on('fs.write', (_, e) => (writes.set(e.path.split(String.fromCharCode(92)).join('/'), e.text), { value: undefined }))
  on('classic.SubagentStop', () => ({}))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-4-6', 'reverse obf.js'))
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'a1b2c3d4e5', agent_transcript_path: TRANSCRIPT, agent_type: 'duckky-swarm:opus-4-6' } as never)
  const sid = (store.get('agent:a1b2c3d4e5') as { sessionCopy?: string } | undefined)?.sessionCopy ?? ''
  expect(sid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  const copy = writes.get(`C:/Users/t/.claude/projects/-w/${sid}.jsonl`) ?? ''
  expect(copy.trim().split('\n').map((l) => JSON.parse(l).sessionId).every((s) => s === sid)).toBe(true)
  // its title is its workspace folder's name: what --resume opens it by
  const rec = store.get('agent:a1b2c3d4e5') as { workspaceName: string; workspaceKey: string }
  expect(rec.workspaceName).toMatch(/^claude-opus-4-6-[0-9a-f]{8}-reverse-obf\.js$/)
  expect(sid).toBe(sessionIdFor(rec.workspaceKey))
  expect(JSON.parse(copy.trim().split('\n').pop() ?? '{}')).toMatchObject({ type: 'custom-title', customTitle: rec.workspaceName })
  expect((await $.command.run(duckky('list'))).text).toContain(`as a main session: claude --resume ${rec.workspaceName} --model claude-opus-4-6`)
  expect((await $.command.run(duckky('open a1b2c3d4'))).text).toContain(`claude --resume ${rec.workspaceName} --model claude-opus-4-6`)
})

test('a duckky fork\'s session copy holds the conversation it inherited, which its own file only points at', async ($, on) => {
  const jsonl = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join('\n')
  const parent = jsonl([
    { type: 'user', uuid: 'p1', parentUuid: null, sessionId: 'sess-now', message: { content: 'read notes.txt' } },
    { type: 'assistant', uuid: 'p2', parentUuid: 'p1', sessionId: 'sess-now', message: { content: [{ type: 'text', text: 'SECRET=ZEBRA-81' }] } },
  ])
  const fork = jsonl([
    { type: 'fork-context-ref', agentId: 'a1b2c3d4e5', parentSessionId: 'sess-now', parentLastUuid: 'p2', contextLength: 2 },
    { type: 'user', uuid: 'f1', parentUuid: null, isSidechain: true, agentId: 'a1b2c3d4e5', sessionId: 'sess-now', message: { content: 'say the code word' } },
    { type: 'assistant', uuid: 'f2', parentUuid: 'f1', isSidechain: true, agentId: 'a1b2c3d4e5', sessionId: 'sess-now', message: { content: [{ type: 'text', text: 'ZEBRA-81' }] } },
  ])
  const { store } = engine(on, 'claude-opus-4-6', { [TRANSCRIPT]: fork, 'C:/Users/t/.claude/projects/-w/sess-now.jsonl': parent })
  const writes = new Map<string, string>()
  on('fs.write', (_, e) => (writes.set(e.path.split(String.fromCharCode(92)).join('/'), e.text), { value: undefined }))
  on('classic.SubagentStop', () => ({}))
  on('tool.call', () => ({ result: 'launched' }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.tool.call(forkCall())
  await $.agent.spawn({ ...spawn('fork', 'say the code word'), tool_use_id: 'toolu_fork', fork: true })
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'a1b2c3d4e5', agent_transcript_path: TRANSCRIPT, agent_type: 'fork' } as never)
  const sid = (store.get('agent:a1b2c3d4e5') as { sessionCopy?: string } | undefined)?.sessionCopy ?? ''
  const rows = (writes.get(`C:/Users/t/.claude/projects/-w/${sid}.jsonl`) ?? '').trim().split('\n').map((l) => JSON.parse(l))
  expect(rows.map((r) => r.uuid ?? r.type)).toEqual(['p1', 'p2', 'f1', 'f2', 'custom-title'])
  expect(rows[2].parentUuid).toBe('p2')   // its own turns follow the conversation it inherited
})

test('a copy the person has worked in as a session is never written over', { options: { workspaces: false } }, async ($, on) => {
  const sid = sessionIdFor('a1b2c3d4e5')
  const theirs = `${asSession(REFUSED, sid, 't')}${JSON.stringify({ type: 'user', uuid: 'theirs-1', sessionId: sid, message: { content: 'their own work' } })}\n`
  engine(on, 'claude-opus-4-6', { [TRANSCRIPT]: REFUSED, [`C:/Users/t/.claude/projects/-w/${sid}.jsonl`]: theirs })
  const writes: string[] = []
  on('fs.write', (_, e) => (writes.push(e.path), { value: undefined }))
  on('classic.SubagentStop', () => ({}))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-4-6', 'reverse obf.js'))
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'a1b2c3d4e5', agent_transcript_path: TRANSCRIPT, agent_type: 'duckky-swarm:opus-4-6' } as never)
  expect(writes.filter((p) => p.endsWith('.jsonl'))).toEqual([])   // the copy is theirs; only its index entry is refreshed
  expect(writes.map((p) => p.split(String.fromCharCode(92)).join('/'))).toEqual([`C:/Users/t/.claude/duckky-swarm/sessions/${sid}.json`])
})

test('resume_subagent to a subagent still running queues the message for it, and says so: nothing is resumed', async ($, on) => {
  const { store } = engine(on, 'claude-opus-5')
  on('session.send', () => ({ isDelivered: true } as never))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-5', 'close the gap'))
  const r = await $.tool.call({ tool: 'mcp__duckky-swarm__resume_subagent', agent: 'a1b2c3d4', message: 'also check bid 24' } as never) as { result?: unknown }
  expect(String(r.result)).toMatch(/^Sent your message to a1b2c3d4, which is still running/)
  expect((store.get('agent:a1b2c3d4e5') as { resumes: number }).resumes).toBe(0)
})

// --- workspaces ----------------------------------------------------------------

// the test kit hands fs a normalised absolute path (/w/a arrives as C:\w\a)
const plainPath = (p: string) => p.split(String.fromCharCode(92)).join('/').replace(/^[A-Za-z]:/, '')
const WS = /^\/w\/duckky-swarm\/claude-opus-5-5-[0-9a-f]{8}-compare-the-trace-shapes$/

test('a duckky subagent gets its workspace BEFORE it starts: the folder and its files, and the rules after its task', async ($, on) => {
  const { spawned, store } = engine(on, 'claude-opus-5-5')
  const writes = new Map<string, string>()
  on('fs.write', (_, e) => (writes.set(plainPath(e.path), e.text), { value: undefined }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-5-5', 'Compare the trace shapes'))
  const rec = store.get('agent:a1b2c3d4e5') as { workspace: string; workspaceName: string }
  expect(rec.workspace).toMatch(WS)
  const names = [...writes.keys()].map((p) => p.replace(`${rec.workspace}/`, '')).sort()
  expect(names).toEqual(['/w/duckky-swarm/.gitignore', 'block.md', 'closed.md', 'devlogs.md', 'findings.md', 'opening.md', 'temp/README.md'])
  expect(spawned[0]?.prompt).toMatch(/^Compare the trace shapes\n\n## Your workspace \(a hard rule\)/)
  expect(spawned[0]?.prompt).toContain(`This task has its own folder: ${rec.workspace}`)
})

test('the main agent\'s Agent result points it at the workspace', async ($, on) => {
  engine(on, 'claude-opus-5-5')
  on('tool.call', (_, e) => (e.tool === 'Agent' ? { result: 'launched' } : { result: 'ok' }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-5-5', 'Compare the trace shapes'))
  const out = await $.tool.call({ tool: 'Agent', tool_use_id: 'toolu_test', description: 'x', prompt: 'x', subagent_type: 'duckky-swarm:opus-5-5' } as never) as { context?: string[] }
  expect(out.context?.[0]).toMatch(/^\[duckky-swarm\] This subagent's workspace is \/w\/duckky-swarm\/claude-opus-5-5-[0-9a-f]{8}-compare-the-trace-shapes: its findings\.md/)
})

test('no workspace for a subagent that is not a duckky one, nor with Workspace folders off', async ($, on) => {
  const { spawned, store } = engine(on, 'claude-opus-5-5')
  const writes: string[] = []
  on('fs.write', (_, e) => (writes.push(e.path), { value: undefined }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...spawn('general-purpose', 'look around'), tool_use_id: 'toolu_gp' })
  expect(spawned[0]?.prompt).toBe('look around')
  expect((store.get('agent:a1b2c3d4e5') as { workspace?: string }).workspace).toBeUndefined()
  expect(writes.filter((p) => /duckky-swarm[\\/]/.test(p))).toEqual([])
})

test('Workspace folders off: a duckky subagent gets its task as it was', { options: { workspaces: false } }, async ($, on) => {
  const { spawned } = engine(on, 'claude-opus-5-5')
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-5-5', 'Compare the trace shapes'))
  expect(spawned[0]?.prompt).toBe('Compare the trace shapes')
})

test('a subagent that carries on as a new one keeps its workspace: no second folder, the same folder in its prompt', async ($, on) => {
  const { spawned, store } = engine(on, 'claude-opus-5-5', { [TRANSCRIPT]: REFUSED })
  const writes: string[] = []
  on('fs.write', (_, e) => (writes.push(plainPath(e.path)), { value: undefined }))
  on('session.send', () => ({ isDelivered: false, reason: 'stopped by the user' } as never))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-5-5', 'Compare the trace shapes'))
  const folder = (store.get('agent:a1b2c3d4e5') as { workspace: string }).workspace
  await $.turn.complete(finished('a1b2c3d4e5', 'claude-opus-5-5'))
  const made = writes.length
  const call = $.tool.call({ tool: 'mcp__duckky-swarm__resume_subagent', agent: 'a1b2c3d4', message: 'next: bid 24' } as never)
  for (let i = 0; i < 200 && spawned.length < 2; i++) await new Promise<void>((resolve) => setTimeout(resolve, 5))
  expect(spawned[1]?.prompt).toContain(`This task has its own folder: ${folder}`)
  expect(spawned[1]?.prompt.split('## Your workspace (a hard rule)').length).toBe(2)   // the rules once, not twice
  // no new folder (the .gitignore is the whole duckky-swarm folder's)
  expect(writes.slice(made).filter((p) => p.includes('/duckky-swarm/') && !p.startsWith(folder) && !p.endsWith('/duckky-swarm/.gitignore'))).toEqual([])
  await call   // its result needs the new agent's id, which a plugin spawn gets only live
})

// --- subagent reports ---------------------------------------------------------------

// A session with a prompt box holding `draft`; `canFill` false is a session
// with no box (claude -p). What went into the box, and what into the chat.
function box(on: On, draft = '', canFill = true) {
  const filled: string[] = []
  const submitted: string[] = []
  const state = { draft }
  on('prompt.submit', (_, e) => (submitted.push(e.text), { text: e.text }))
  on('prompt.read', () => ({ value: { text: state.draft, cursor: state.draft.length } as never }))
  on('prompt.fill', (_, e) => (canFill
    ? (filled.push(e.text), state.draft = e.text, { isFilled: true, text: e.text, cursor: e.text.length } as never)
    : ({ isFilled: false, refusal: 'no_composer', text: '', cursor: 0 } as never)))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: 'file text' }))
  return { filled, submitted, state }
}

// The main agent's own turn (no agentId) starting and ending.
const mainStarts = ($: Engine) => $.turn.start({ text: 'go on', turnId: 'm1' } as never)
const mainEnds = ($: Engine, isAborted = false) => {
  const { agentId: _none, ...turn } = finished('x', 'claude-opus-4-8') as unknown as Record<string, unknown>
  return $.turn.complete({ ...turn, turnId: 'm1', isAborted } as never)
}

test('a report reaches an idle main agent at once: sent, never left waiting', async ($, on) => {
  engine(on, 'claude-opus-5-5')
  const b = box(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await finish($, true)
  expect(b.submitted.length).toBe(1)
  expect(b.submitted[0]).toMatch(REPORT)
  expect(b.filled).toEqual([])
})

test('while the main agent works, the report comes on its very next tool result: read mid-turn, not queued for the turn\'s end', async ($, on) => {
  engine(on, 'claude-opus-5-5')
  const b = box(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await mainStarts($)
  await finish($, true)
  expect(b.submitted).toEqual([])   // a message now would only be queued "later"
  const out = await $.tool.call({ tool: 'Read', file_path: 'C:/w/x.ts' } as never) as { result?: unknown; context?: string[] }
  expect(out.result).toBe('file text')
  expect(out.context?.length).toBe(1)
  expect(out.context?.[0]).toMatch(REPORT)
  const later = await $.tool.call({ tool: 'Read', file_path: 'C:/w/y.ts' } as never) as { context?: string[] }
  expect(later.context ?? []).toEqual([])   // delivered once
  await mainEnds($)
  expect(b.submitted).toEqual([])
})

test('a report the main agent\'s turn ended before carrying is sent the moment the turn is over', async ($, on) => {
  engine(on, 'claude-opus-5-5')
  const b = box(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await mainStarts($)
  await finish($, true)
  await mainEnds($)
  expect(b.submitted.length).toBe(1)
  expect(b.submitted[0]).toMatch(REPORT)
})

test('stopped mid-turn (Esc): the report is kept, not sent into the queue the interrupt is clearing', async ($, on) => {
  engine(on, 'claude-opus-5-5')
  const b = box(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await mainStarts($)
  await finish($, true)
  await mainEnds($, true)
  expect(b.submitted).toEqual([])   // the clock sends it 1.5 s on (the kit has no clock: proved by the code path)
})

const BOX = { reportsTo: 'Your prompt box' }

// (the engine's spawn answers every spawn with agent a1b2c3d4e5)
async function finish($: Engine, background: boolean, type = 'duckky-swarm:opus-5-5', task = 'Compare the trace shapes') {
  await $.agent.spawn({ ...spawn(type, task), background })
  await $.turn.complete({ ...(finished('a1b2c3d4e5', 'claude-opus-5-5') as object), answer: `${task}: done.` } as never)
}

const REPORT = /^\[duckky-swarm\] Report from subagent a1b2c3d4 \(Opus 5\.5\), task "Compare the trace shapes":\n\nCompare the trace shapes: done\. Its workspace: \/w\/duckky-swarm\/claude-opus-5-5-[0-9a-f]{8}-compare-the-trace-shapes\.$/

test('Reports go to = Your prompt box: there, sent by the person, it is their own message, which they can rewind to', { options: BOX }, async ($, on) => {
  engine(on, 'claude-opus-5-5')
  const b = box(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await finish($, true)
  expect(b.filled.length).toBe(1)
  expect(b.filled[0]).toMatch(REPORT)
  expect(b.submitted).toEqual([])   // not posted by the plugin: Claude Code would not let them rewind to that
})

test('in the prompt box a report never goes over a draft the person is typing; it waits, and two go in together', { options: BOX }, async ($, on) => {
  engine(on, 'claude-opus-5-5')
  const b = box(on, 'half a sentence I am writ')
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await finish($, true)
  expect(b.filled).toEqual([])
  expect(b.state.draft).toBe('half a sentence I am writ')
  b.state.draft = ''   // they sent it
  await finish($, true, 'duckky-swarm:opus-5-5', 'map the code')
  expect(b.filled.length).toBe(1)
  expect(b.filled[0]).toMatch(/Compare the trace shapes: done\.[\s\S]*\n\n---\n\n\[duckky-swarm\] Report from subagent a1b2c3d4 \(Opus 5\.5\), task "map the code":\n\nmap the code: done\./)
})

test('prompt box chosen but none drawn (claude -p): the report is sent instead', { options: BOX }, async ($, on) => {
  engine(on, 'claude-opus-5-5')
  const b = box(on, '', false)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await finish($, true)
  expect(b.submitted.length).toBe(1)
  expect(b.submitted[0]).toMatch(REPORT)
})

test('a foreground subagent\'s report is its Agent result, not delivered again (by default)', async ($, on) => {
  engine(on, 'claude-opus-5-5')
  const b = box(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await finish($, false)
  expect([...b.filled, ...b.submitted]).toEqual([])
})

test('Subagent reports = Every subagent reports a foreground one too', { options: { reports: 'Every subagent' } }, async ($, on) => {
  engine(on, 'claude-opus-5-5')
  const b = box(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await finish($, false)
  expect(b.submitted.length).toBe(1)
})

test('Subagent reports = Off reports none', { options: { reports: 'Off' } }, async ($, on) => {
  engine(on, 'claude-opus-5-5')
  const b = box(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await finish($, true)
  expect([...b.filled, ...b.submitted]).toEqual([])
})

test('a built-in subagent reports nothing', async ($, on) => {
  engine(on, 'claude-opus-5-5')
  const b = box(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await finish($, true, 'general-purpose')
  expect([...b.filled, ...b.submitted]).toEqual([])
})

// --- one subagent, never a guess ---------------------------------------------------

test('words that match several subagents are refused with the list: a guess could resume the wrong one', async ($, on) => {
  const { store } = engine(on, 'claude-opus-5-5')
  const base = { type: 'duckky-swarm:opus-5-5', label: 'Opus 5.5', model: 'claude-opus-5-5', requested: 'claude-opus-5-5', answeredBy: null, fork: false, sessionId: 'old', cwd: '/w', status: 'done', resumes: 0, outputTokens: 0 }
  store.set('agent:aaaa1111', { ...base, id: 'aaaa1111', description: 'trace the bid 277 buffer', startedAt: Date.now() - 1000 })
  store.set('agent:bbbb2222', { ...base, id: 'bbbb2222', description: 'trace the bid 24 buffer', startedAt: Date.now() - 2000 })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const r = await $.tool.call({ tool: 'mcp__duckky-swarm__resume_subagent', agent: 'trace buffer', message: 'go on' } as never) as { result?: unknown }
  expect(String(r.result)).toBe('Several subagents match "trace buffer": aaaa1111 "trace the bid 277 buffer", bbbb2222 "trace the bid 24 buffer". Name the one you mean by its id.')
})

// --- the session index ------------------------------------------------------------

test('every duckky session copy is indexed, and /duckky sessions lists the index, every project\'s', async ($, on) => {
  const index = 'C:/Users/t/.claude/duckky-swarm/sessions'
  const other = { sessionId: '11111111-2222-4333-8444-555555555555', name: 'claude-opus-5-abcd1234-map-the-code', cwd: 'C:\\elsewhere\\app', file: 'x', model: 'claude-opus-5', task: 'map the code', agentId: 'zz', updated: '2026-11-01T00:00:00.000Z' }
  const files: Record<string, string> = { [TRANSCRIPT]: REFUSED, [`${index}/11111111-2222-4333-8444-555555555555.json`]: JSON.stringify(other) }
  const { store } = engine(on, 'claude-opus-4-6', files)
  on('fs.write', (_, e) => { files[e.path.split(String.fromCharCode(92)).join('/')] = e.text; return { value: undefined } })
  on('fs.list', (_, e) => ({ value: e.path.split(String.fromCharCode(92)).join('/') === index
    ? Object.keys(files).filter((k) => k.startsWith(`${index}/`)).map((k) => ({ name: k.slice(index.length + 1), kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false }))
    : [] }))
  on('classic.SubagentStop', () => ({}))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-4-6', 'reverse obf.js'))
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'a1b2c3d4e5', agent_transcript_path: TRANSCRIPT, agent_type: 'duckky-swarm:opus-4-6' } as never)
  const rec = store.get('agent:a1b2c3d4e5') as { sessionCopy: string; workspaceName: string }
  expect(JSON.parse(files[`${index}/${rec.sessionCopy}.json`] ?? '{}')).toMatchObject({ sessionId: rec.sessionCopy, name: rec.workspaceName, model: 'claude-opus-4-6', task: 'reverse obf.js', agentId: 'a1b2c3d4e5' })
  const listed = (await $.command.run(duckky('sessions'))).text
  expect(listed).toMatch(new RegExp(`^  1  ${rec.workspaceName.replace(/\./g, '\\.')}`))   // the newest first
  expect(listed).toContain('  2  claude-opus-5-abcd1234-map-the-code')
  expect(listed).toContain('C:\\elsewhere\\app  · claude-opus-5')
  expect((await $.command.run(duckky('sessions map code'))).text).toContain('cd "C:\\elsewhere\\app"; claude --resume 11111111-2222-4333-8444-555555555555 --model claude-opus-5')
})
