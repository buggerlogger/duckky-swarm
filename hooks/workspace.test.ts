import { expect, test } from 'claude-code/testing'
import { newWorkspace, slug, workspaceFiles, workspaceKey, workspaceRules } from './workspace.ts'

test('a task becomes a folder-safe name: letters, digits and dots, no dot or dash at either end', () => {
  expect(slug('Comparing hostreads.json trace shapes')).toBe('comparing-hostreads.json-trace-shapes')
  expect(slug('Close the last ~1,140 B gap!')).toBe('close-the-last-1-140-b-gap')
  expect(slug('  ...weird:  <name>?.  ')).toBe('weird-name')
  expect(slug('***')).toBe('task')
  expect(slug('x'.repeat(200)).length).toBe(48)
})

test('the folder is duckky-swarm/<model>-<key>-<task> in the project, in its own path style', () => {
  const key = workspaceKey('toolu_1:42')
  expect(key).toMatch(/^[0-9a-f]{8}$/)
  expect(workspaceKey('toolu_1:42')).toBe(key)
  const win = newWorkspace('C:\\work\\my app', 'claude-opus-5-5', key, 'Comparing hostreads.json trace shapes')
  expect(win.name).toBe(`claude-opus-5-5-${key}-comparing-hostreads.json-trace-shapes`)
  expect(win.folder).toBe(`C:\\work\\my app\\duckky-swarm\\${win.name}`)
  expect(newWorkspace('/home/me/app/', 'claude-opus-5', 'abcd1234', 'x').folder).toBe('/home/me/app/duckky-swarm/claude-opus-5-abcd1234-x')
})

test('a workspace starts with its five notes, temp/, and a .gitignore for the whole duckky-swarm folder', () => {
  const ws = newWorkspace('/p', 'claude-opus-5-5', 'abcd1234', 'map the code')
  const files = workspaceFiles('/p', ws, 'map the code', 'claude-opus-5-5', '2026-11-19 14:30')
  const base = '/p/duckky-swarm/claude-opus-5-5-abcd1234-map-the-code'
  expect(Object.keys(files)).toEqual([
    '/p/duckky-swarm/.gitignore',
    `${base}/findings.md`, `${base}/opening.md`, `${base}/closed.md`, `${base}/block.md`, `${base}/devlogs.md`, `${base}/temp/README.md`,
  ])
  expect(files['/p/duckky-swarm/.gitignore']).toContain('\n*\n')
  expect(files[`${base}/devlogs.md`]).toContain('claude --resume claude-opus-5-5-abcd1234-map-the-code')
  expect(files[`${base}/findings.md`]).toContain('Task: map the code')
  for (const body of Object.values(files)) expect(body.endsWith('\n')).toBe(true)
})

test('the rules name the folder and every file, and say where scratch work and reports go', () => {
  const ws = newWorkspace('/p', 'claude-opus-5', 'abcd1234', 'map the code')
  const rules = workspaceRules(ws)
  expect(rules).toContain(`This task has its own folder: ${ws.folder}`)
  for (const name of ['findings.md', 'opening.md', 'closed.md', 'block.md', 'devlogs.md', 'temp/']) expect(rules).toContain(name)
  expect(rules).toContain('copy them into temp/')
  expect(rules).toContain('report or .md file the main agent asks for goes in this folder')
  expect(rules).toContain('End your final message with')
})
