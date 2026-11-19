// node --test bin/sessions.test.mjs   (plain Node: the duckky command)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listing, matchSessions, openLine, parseEntries, projectKey } from './sessions.mjs'

const entry = (name, updated, more = {}) => ({
  sessionId: `${name.slice(-8)}-0000-4000-8000-000000000000`, name, cwd: 'C:\\work\\app', file: 'x', model: 'claude-opus-5-5',
  task: 'a task', agentId: 'a1b2c3d4e5', updated, ...more,
})

test('index files become entries, newest first; a broken one is skipped', () => {
  const es = parseEntries([JSON.stringify(entry('claude-opus-5-5-aaaa1111-old', '2026-11-01')), '{ half', JSON.stringify(entry('claude-opus-5-5-bbbb2222-new', '2026-11-19'))])
  assert.deepEqual(es.map((e) => e.name), ['claude-opus-5-5-bbbb2222-new', 'claude-opus-5-5-aaaa1111-old'])
})

test('a session is named by its number, its name, a start of it, or words of it', () => {
  const es = [entry('claude-opus-5-5-bbbb2222-compare-trace-shapes', '2026-11-19'), entry('claude-haiku-5-5-aaaa1111-test-add', '2026-11-18', { task: 'Test add() in math.mjs' })]
  assert.equal(matchSessions(es, '2')[0].name, 'claude-haiku-5-5-aaaa1111-test-add')
  assert.equal(matchSessions(es, 'claude-opus-5-5-bbbb2222-compare-trace-shapes').length, 1)
  assert.equal(matchSessions(es, 'claude-haiku')[0].name, 'claude-haiku-5-5-aaaa1111-test-add')
  assert.equal(matchSessions(es, 'math add')[0].name, 'claude-haiku-5-5-aaaa1111-test-add')
  assert.equal(matchSessions(es, 'claude').length, 2)   // several: the command lists them
  assert.deepEqual(matchSessions(es, 'nothing'), [])
})

test('the list and the open line', () => {
  const e = entry('claude-opus-5-5-bbbb2222-x', new Date(Date.now() - 3 * 3600_000).toISOString())
  assert.deepEqual(listing([e]), ['  1  claude-opus-5-5-bbbb2222-x   3 h ago', '     C:\\work\\app  · claude-opus-5-5'])
  assert.equal(openLine(e), `cd "C:\\work\\app"; claude --resume ${e.sessionId} --model claude-opus-5-5`)
  assert.equal(projectKey('C:\\Users\\me\\my app'), 'C--Users-me-my-app')
})

const DUCKKY = fileURLToPath(new URL('./duckky.mjs', import.meta.url))
const run = (config, ...args) => spawnSync(process.execPath, [DUCKKY, '--config', config, ...args], { encoding: 'utf8', input: '' })

test('duckky lists every project\'s sessions, prints how it would open one, and --here copies it to this folder', () => {
  const config = mkdtempSync(join(tmpdir(), 'duckky-cfg-'))
  const here = mkdtempSync(join(tmpdir(), 'duckky-here-'))
  try {
    mkdirSync(join(config, 'duckky-swarm', 'sessions'), { recursive: true })
    const file = join(config, 'projects', 'C--work-app', 'bbbb2222-0000-4000-8000-000000000000.jsonl')
    mkdirSync(join(config, 'projects', 'C--work-app'), { recursive: true })
    writeFileSync(file, '{"type":"custom-title"}\n')
    const e = entry('claude-opus-5-5-bbbb2222-compare-trace-shapes', '2026-11-19T10:00:00.000Z', { file })
    writeFileSync(join(config, 'duckky-swarm', 'sessions', `${e.sessionId}.json`), JSON.stringify(e))
    writeFileSync(join(config, 'duckky-swarm', 'sessions', 'other.json'), JSON.stringify(entry('claude-haiku-5-5-aaaa1111-test-add', '2026-11-18T10:00:00.000Z', { cwd: 'D:\\other' })))

    const list = run(config, 'list').stdout
    assert.match(list, /^ {2}1 {2}claude-opus-5-5-bbbb2222-compare-trace-shapes/)
    assert.match(list, / {2}2 {2}claude-haiku-5-5-aaaa1111-test-add/)
    assert.match(list, /D:\\other/)

    assert.equal(run(config, 'open', 'compare trace', '--print').stdout.trim(), `cd "C:\\work\\app"; claude --resume ${e.sessionId} --model claude-opus-5-5`)
    assert.equal(run(config, 'open', '1', '--print', '--', '-p', 'what did you find?').stdout.trim(), `cd "C:\\work\\app"; claude --resume ${e.sessionId} --model claude-opus-5-5 -p "what did you find?"`)
    assert.match(run(config, 'claude').stderr, /Several sessions match "claude"/)
    assert.match(run(config, 'nothing-like-it').stderr, /No duckky session matches/)

    // --here: Claude Code looks in the folder it runs in, so the session is copied there
    const printed = spawnSync(process.execPath, [DUCKKY, '--config', config, 'open', 'claude-opus-5-5-bbbb2222-compare-trace-shapes', '--here', '--print'], { encoding: 'utf8', cwd: here }).stdout.trim()
    assert.equal(printed, `claude --resume ${e.sessionId} --model claude-opus-5-5`)
  } finally {
    rmSync(config, { recursive: true, force: true })
    rmSync(here, { recursive: true, force: true })
  }
})

test('duckky with no sessions says how they come', () => {
  const config = mkdtempSync(join(tmpdir(), 'duckky-empty-'))
  try {
    assert.match(run(config, 'list').stdout, /No duckky sessions yet/)
    assert.equal(existsSync(join(config, 'duckky-swarm')), false)   // listing writes nothing
  } finally { rmSync(config, { recursive: true, force: true }) }
})
