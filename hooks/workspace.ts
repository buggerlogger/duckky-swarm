// Copyright 2026 buggerlogger (https://github.com/buggerlogger)
// SPDX-License-Identifier: Apache-2.0
//
// A duckky subagent's workspace: its own folder in the project,
// `duckky-swarm/<model>-<key>-<task>/`, where it keeps findings.md,
// opening.md, closed.md, block.md and devlogs.md current as it works, and does
// all its scratch work in temp/, so the project's own folders stay clean. The
// folder's name is also the title of the subagent's session copy, so
// `claude --resume <folder name>` opens it as a main session (measured:
// --resume takes a session's exact title). Pure: names and file texts; the
// words are in messages.json (`workspace`).

import { hash } from '../characters/sprites.mjs'
import { text } from './messages.ts'

export type Workspace = {
  /** `claude-opus-5-5-a1b2c3d4-comparing-hostreads.json-trace-shapes` */
  name: string
  /** The 8 hex characters in its name; its session copy's id is made from it. */
  key: string
  /** Its absolute path. */
  folder: string
}

export const ROOT = 'duckky-swarm'
const MAX_TASK = 48

// "Comparing hostreads.json trace shapes" -> comparing-hostreads.json-trace-shapes.
// Letters, digits and dots; nothing Windows refuses in a folder name, and no
// dot or dash at either end (Windows drops a trailing dot).
export function slug(task: string): string {
  const s = task.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/-{2,}/g, '-').slice(0, MAX_TASK)
  return s.replace(/^[-.]+|[-.]+$/g, '') || 'task'
}

// The key: chosen when the subagent is started, before Claude Code gives it
// an id (its task, which names the folder, is written then).
export const workspaceKey = (seed: string) => hash(`duckky-workspace:${seed}`).toString(16).padStart(8, '0')

// The project folder joined in its own style (C:\a\b, or /a/b).
const join = (base: string, ...parts: string[]) => {
  const sep = base.includes('\\') ? '\\' : '/'
  return [base.replace(/[\\/]+$/, ''), ...parts].join(sep)
}

export function newWorkspace(projectDir: string, model: string, key: string, task: string): Workspace {
  const name = `${model}-${key}-${slug(task)}`
  return { name, key, folder: join(projectDir, ROOT, name) }
}

// The files a new workspace starts with, by path, each written only where it
// is missing (a subagent that carries on as a new one keeps its folder). The
// .gitignore keeps the whole duckky-swarm folder out of git.
export function workspaceFiles(projectDir: string, ws: Workspace, task: string, model: string, started: string): Record<string, string> {
  const vars = { task, model, name: ws.name, folder: ws.folder, started }
  const file = (key: 'findings' | 'opening' | 'closed' | 'block' | 'devlogs' | 'temp') => `${text('workspace', key, vars).trimEnd()}\n`
  return {
    [join(projectDir, ROOT, '.gitignore')]: `${text('workspace', 'gitignore').trimEnd()}\n`,
    [join(ws.folder, 'findings.md')]: file('findings'),
    [join(ws.folder, 'opening.md')]: file('opening'),
    [join(ws.folder, 'closed.md')]: file('closed'),
    [join(ws.folder, 'block.md')]: file('block'),
    [join(ws.folder, 'devlogs.md')]: file('devlogs'),
    [join(ws.folder, 'temp', 'README.md')]: file('temp'),
  }
}

// What the subagent is told about its workspace, after its task.
export const workspaceRules = (ws: Workspace) => text('workspace', 'rules', { folder: ws.folder, name: ws.name })
