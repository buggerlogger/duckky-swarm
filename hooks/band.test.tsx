import type { AgentSpawnInput, On } from 'claude-code'
import { expect, test, type Engine } from 'claude-code/testing'

const BAND = {
  plugin: 'duckky-swarm',
  component: 'AbovePrompt',
  requestId: 'band',
  surface: 'terminal',
  props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const spawn = (subagentType: string): AgentSpawnInput => ({
  tool_use_id: 'toolu_test', prompt: 'x', description: 'x', subagentType,
  provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false,
})

// the engine beneath the plugin: what these tests need of it
function engine(on: On, toolAnswer: { result: unknown; isError?: true } = { result: 'ok' }) {
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => (store.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_, e) => (store.delete(e.key), { value: undefined }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.id', () => ({ value: 'sess-band' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.register', (_, e) => ({ value: { agent: `duckky-swarm:${e.name}` } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__duckky-swarm__${e.name}` } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('agent.spawn', () => ({ model: 'claude-opus-4-6', agentId: 'a1b2c3d4e5' }))
  on('tool.call', () => toolAnswer)
  // what the engine itself draws above the prompt
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
}

test('a running subagent stands on the band: its character, model and what it does', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-4-6'))

  const ui = await $.ui.mount(BAND)
  // the character: one Raster, 12 x 5 cells (a bad cell would refuse the whole tree)
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^Opus 4\.6$/ }))?.text).toBe('Opus 4.6')
  expect((await ui.find({ type: 'Text', text: /^starting$/ }))?.text).toBe('starting')
  expect((await ui.find({ type: 'Text', text: /engine band/ }))?.text).toBe('engine band')   // what was there stays
  await ui.unmount()
})

// The Raster's cells, decoded: every colour it draws, foreground and
// background (the duck's beak is the background under its yellow).
async function bandColours($: Engine, on: On) {
  engine(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-4-6'))
  const ui = await $.ui.mount(BAND)
  const cells = String((await ui.find({ type: 'Raster' }))?.props.cells ?? '')
  await ui.unmount()
  const bytes = Uint8Array.from(atob(cells), (c) => c.charCodeAt(0))
  const words = new Uint32Array(bytes.buffer)
  return new Set(Array.from({ length: words.length / 3 }, (_, i) => [words[i * 3 + 1], words[i * 3 + 2]]).flat())
}

test('Character: Clawd unless /config says otherwise', async ($, on) => {
  const colours = await bandColours($, on)
  expect(colours.has(0xd77757)).toBe(true)    // Clawd's orange
  expect(colours.has(0xffcb2f)).toBe(false)
})

test('Character: Duckky Ducks puts a duckling on the band', { options: { character: 'Duckky Ducks' } }, async ($, on) => {
  const colours = await bandColours($, on)
  expect(colours.has(0xffcb2f)).toBe(true)    // the duck's yellow
  expect(colours.has(0xf2621f)).toBe(true)    // its beak
  expect(colours.has(0xd77757)).toBe(false)
})

for (const [label, answer, shows] of [
  ['passes', { result: 'ok' }, 'tests pass'],
  ['fails', { result: 'FAIL orders.test.ts', isError: true }, 'tests fail'],
] as const) {
  test(`a subagent's test command that ${label} shows "${shows}"`, async ($, on) => {
    engine(on, answer)
    await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
    await $.agent.spawn(spawn('duckky-swarm:opus-4-6'))
    await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'a1b2c3d4e5' } as never)

    const ui = await $.ui.mount(BAND)
    expect((await ui.find({ type: 'Text', text: new RegExp(`^${shows}$`) }))?.text).toBe(shows)
    await ui.unmount()
  })
}

test('after any other tool its Clawd goes back to thinking', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('duckky-swarm:opus-4-6'))
  await $.tool.call({ tool: 'Read', file_path: 'C:/w/orders.ts', agentId: 'a1b2c3d4e5' } as never)

  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /^thinking$/ }))?.text).toBe('thinking')
  await ui.unmount()
})

test('with no subagents the band is left as it was', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /engine band/ }))?.text).toBe('engine band')
  expect(await ui.find({ type: 'Text', text: /^Opus/ })).toBeUndefined()
  await ui.unmount()
})
