// node --test viewer/viewer.test.mjs   (plain Node: the window runs outside Claude Code)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { activityOf, applyMeta, applyRecord, commandActivity, labelOf, newAgent, shownActivity, stateOf, toolSummary } from './model.mjs'
import { fit, frame, grid, pane, wrap } from './render.mjs'

const plain = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

function agent(id, { model = 'claude-opus-4-6', finished = false, tools = [] } = {}) {
  const a = newAgent(id)
  applyMeta(a, { agentType: 'duckky-swarm:opus-4-6', description: `task ${id}`, finished })
  applyRecord(a, { type: 'user', timestamp: '2026-11-17T10:00:00Z', message: { content: `do the thing ${id}` } })
  for (const [name, input] of tools) {
    applyRecord(a, { type: 'assistant', timestamp: '2026-11-17T10:00:05Z', message: { model, usage: { output_tokens: 7 }, content: [{ type: 'tool_use', name, input }] } })
  }
  return a
}

test('a transcript becomes an agent: task, real model, tools, what it is doing now', () => {
  const a = agent('a1', { tools: [['Read', { file_path: 'C:\\src\\orders.ts' }], ['Bash', { command: 'npm test' }]] })
  assert.equal(a.task, 'do the thing a1')
  assert.equal(a.model, 'claude-opus-4-6')
  assert.equal(labelOf(a), 'Opus 4.6')
  assert.equal(a.tools, 2)
  assert.equal(a.outTokens, 14)
  assert.deepEqual(a.lines.map((l) => l.text), ['Read orders.ts', 'Bash npm test'])
  assert.equal(a.activity, 'testing')
  applyMeta(a, { finished: true })
  assert.equal(a.activity, 'done')
})

test('a command is classified by its words', () => {
  const cases = {
    'npm test': 'testing', 'pytest -q tests/': 'testing', 'go test ./...': 'testing', 'cargo test': 'testing',
    'npm run build': 'building', 'tsc -p .': 'building', 'make all': 'building',
    'git status': 'git', 'git commit -m "fix build"': 'git', 'gh pr view 12': 'git',
    'npm install': 'installing', 'pip install requests': 'installing', 'go get ./...': 'installing',
    'npm publish': 'deploying', 'docker push app:1': 'deploying', 'gh release create v1': 'deploying',
    'ls -la': 'running', 'node script.mjs': 'running',
  }
  for (const [cmd, want] of Object.entries(cases)) assert.equal(commandActivity(cmd), want, cmd)
})

test('a test that comes back shows pass or fail, then thinking; a long command is tea', () => {
  const run = (isError) => {
    const a = newAgent('t1')
    applyRecord(a, { type: 'assistant', timestamp: '2026-11-17T10:00:00Z', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'npm test' } }] } })
    assert.equal(a.activity, 'testing')
    applyRecord(a, { type: 'user', timestamp: '2026-11-17T10:00:09Z', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', is_error: isError, content: 'x' }] } })
    return a
  }
  const at = Date.parse('2026-11-17T10:00:09Z')
  const ok = run(false)
  assert.equal(ok.activity, 'pass')
  assert.equal(shownActivity(ok.activity, ok.activityAt, at + 1000), 'pass')
  assert.equal(shownActivity(ok.activity, ok.activityAt, at + 10_000), 'thinking')
  assert.equal(run(true).activity, 'fail')
  assert.equal(shownActivity('building', at, at + 5_000), 'building')
  assert.equal(shownActivity('building', at, at + 25_000), 'tea')
})

test('a subagent that ended on a refusal shows as refused, not done', () => {
  const a = newAgent('r1')
  applyRecord(a, { type: 'assistant', timestamp: '2026-11-17T10:00:00Z', message: { stop_reason: 'refusal', content: [{ type: 'text', text: 'I cannot help with that.' }] } })
  applyMeta(a, { finished: true })
  assert.equal(stateOf(a, Date.parse('2026-11-17T10:01:00Z')), 'refused')
  const head = frame([a], 120, 20, 0, Date.parse('2026-11-17T10:01:00Z')).split('\n')[0]
  assert.match(head.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''), /1 refused/)
})

test('tool calls are summed up in a few words', () => {
  assert.equal(toolSummary('Grep', { pattern: 'TODO', path: '/w/src' }), 'Grep "TODO" in src')
  assert.equal(activityOf('Edit'), 'editing')
  assert.equal(activityOf('WebSearch'), 'web')
})

test('fit and wrap keep exact widths', () => {
  assert.equal(fit('abc', 5), 'abc  ')
  assert.equal(fit('abcdef', 4), 'abc…')
  assert.equal(fit('a\tb\u0007c', 5), 'a bc ')
  assert.deepEqual(wrap('one two three four', 9), ['one two', 'three', 'four'])
})

test('four agents make a 2 x 2 grid that fills the screen', () => {
  const { cols, rows, rects } = grid(4, 120, 40)
  assert.equal(cols, 2)
  assert.equal(rows, 2)
  assert.deepEqual(rects.map((r) => [r.x, r.y, r.w, r.h]), [[0, 0, 60, 20], [60, 0, 60, 20], [0, 20, 60, 20], [60, 20, 60, 20]])
  assert.equal(grid(4, 60, 40).cols, 1)   // too narrow for two 34-wide columns
})

test('every line of a pane is exactly its width, colour or not', () => {
  const a = agent('a1', { tools: [['Read', { file_path: 'x'.repeat(300) }]] })
  const rows = pane(a, { x: 0, y: 0, w: 50, h: 12 }, 39, 0, Date.parse('2026-11-17T10:01:00Z'))
  assert.equal(rows.length, 12)
  for (const r of rows) assert.equal([...plain(r)].length, 50)
})

test('the launcher\'s encoded command is its script', () => {
  const src = readFileSync(new URL('../hooks/launcher.ts', import.meta.url), 'utf8')
  const script = /LAUNCH_SCRIPT = `([^`]*)`/.exec(src)?.[1]
  const encoded = /LAUNCH_ENCODED =\s*'([^']*)'/.exec(src)?.[1]
  assert.ok(script && encoded)
  assert.equal(Buffer.from(script, 'utf16le').toString('base64'), encoded)
})

test('a frame of four agents lines up, running ones first', () => {
  const agents = [agent('d1', { finished: true }), agent('r1'), agent('r2'), agent('r3')]
  const text = plain(frame(agents, 120, 40, 0, Date.parse('2026-11-17T10:01:00Z')))
  const lines = text.split('\n')
  assert.equal(lines.length, 40)
  assert.match(lines[0], /DUCKKY SWARM · 3 running · 1 done/)
  for (const l of lines.slice(1)) assert.equal([...l].length, 120)
  assert.ok(lines[1].indexOf('task r1') < lines[1].indexOf('task r2'))
  assert.ok(text.indexOf('task d1') > text.indexOf('task r3'))
})

test('the window shows the effort each reply was sent with', () => {
  const a = newAgent('e1')
  applyRecord(a, { type: 'assistant', effort: 'high', timestamp: '2026-11-17T10:00:00Z', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'ok' }] } })
  assert.equal(a.effort, 'high')
  const text = frame([a], 120, 20, 0, Date.parse('2026-11-17T10:00:10Z')).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
  assert.match(text, /claude-opus-5-5 · high/)
})

test('Character: "Clawd (recommended)" and anything unknown are Clawd; "Duckky Ducks" are the ducks', async () => {
  const { characterFor } = await import('../characters/index.mjs')
  for (const name of ['Clawd (recommended)', 'Clawd', undefined, '', 'something else']) assert.equal(characterFor(name).name, 'Clawd', String(name))
  for (const name of ['Duckky Ducks', 'ducks']) assert.equal(characterFor(name).name, 'Duckky Ducks', name)
})

test('the window draws the character it is given: by --character, or DUCKKY_CHARACTER from /duckky', async () => {
  const { spawnSync } = await import('node:child_process')
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'duckky-'))
  try {
    writeFileSync(join(dir, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'duckky-swarm:opus-5-5', description: 'map the code' }))
    writeFileSync(join(dir, 'agent-a1.jsonl'), `${JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), message: { content: 'map the code' } })}\n`)
    const view = (args, env = {}) => spawnSync(process.execPath, [new URL('./duckky-view.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), ...args, '--once', '--width', '100', '--height', '16'], { encoding: 'utf8', env: { ...process.env, DUCKKY_DIR: '', DUCKKY_CHARACTER: '', ...env } }).stdout
    const duck = '▄████▄'
    const clawd = '▐▛███▜▌'
    assert.match(view([dir]), /map the code/)
    assert.ok(view([dir]).includes(clawd) && !view([dir]).includes(duck))
    assert.ok(view(['--character', 'ducks', dir]).includes(duck))        // the flag's value is not taken for the folder
    assert.ok(view([dir], { DUCKKY_CHARACTER: 'Duckky Ducks' }).includes(duck))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
