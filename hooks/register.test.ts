import type { AgentSpawnInput, CommandRunInput, On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { labelFor, parseModels } from './models.ts'

// the test environment has a timer at run time; its types do not declare one
declare function setTimeout(run: () => void, ms: number): unknown

// The test's `$` is the engine's own, so its calls take an event's whole input.
const spawn = (subagentType: string, description = 'x'): AgentSpawnInput => ({
  tool_use_id: 'toolu_test', prompt: description, description, subagentType,
  provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false,
})
const duckky: CommandRunInput = {
  command: 'duckky', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 },
}

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
function engine(on: On, answered = 'claude-opus-4-6', files: Record<string, string> = {}) {
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
  on('env.get', (_, e) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/t' : undefined }))
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

test('each model in /config becomes an agent type on that exact model', async ($, on) => {
  const { registered } = engine(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  expect(registered.map((r) => [r.name, r.model])).toEqual([
    ['opus-4-6', 'claude-opus-4-6'], ['opus-4-6-fork', 'claude-opus-4-6'],
    ['opus-5', 'claude-opus-5'], ['opus-5-fork', 'claude-opus-5'],
    ['opus-5-5', 'claude-opus-5-5'], ['opus-5-5-fork', 'claude-opus-5-5'],
  ])
  expect(registered[0]?.description).toContain('Opus 4.6')
  expect(registered[1]?.description).toContain('FORK on Opus 4.6')
})

test('with Fork on another model = true, no fork types are added', { options: { forkMode: 'true' } }, async ($, on) => {
  const { registered } = engine(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  expect(registered.map((r) => r.name)).toEqual(['opus-4-6', 'opus-5', 'opus-5-5'])
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
  const shown = await $.command.run(duckky)
  expect(shown.text).toMatch(/✓ Opus 4\.6 +claude-opus-4-6 +find the bug/)
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
