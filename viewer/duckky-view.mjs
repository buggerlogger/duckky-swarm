#!/usr/bin/env node
// Copyright 2026 buggerlogger (https://github.com/buggerlogger)
// SPDX-License-Identifier: Apache-2.0
//
// The Duckky Swarm window: every subagent of one Claude Code session, live, in
// a grid of panes. /duckky opens it; it also runs by hand:
//
//   node duckky-view.mjs <session's subagents folder>
//   node duckky-view.mjs <folder> --once [--width 120 --height 40]   one frame, no colour
//   node duckky-view.mjs --gallery [--character ducks]               every scene
//
// The character is Clawd unless DUCKKY_CHARACTER (set by /duckky from the
// Character setting) or --character names the ducks.
//
// The folder is Claude Code's own: <config>/projects/<cwd>/<session>/subagents,
// one agent-<id>.jsonl (its messages) and agent-<id>.meta.json per subagent.
// Only the bytes added since the last look are read.

import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { characterFor } from '../characters/index.mjs'
import { applyMeta, applyRecord, newAgent } from './model.mjs'
import { frame, gallery } from './render.mjs'

const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }
const VALUED = ['width', 'height', 'character']   // flags that take the next argument
const dir = process.env.DUCKKY_DIR || args.find((a, i) => !a.startsWith('--') && !VALUED.some((f) => args[i - 1] === `--${f}`))
const once = args.includes('--once')
const showGallery = args.includes('--gallery')   // every scene the character plays, no session needed
const character = characterFor(flag('character') ?? process.env.DUCKKY_CHARACTER)

const agents = new Map()   // id -> agent
const offsets = new Map()  // id -> { at, rest }: bytes read so far, and a half-written last line

function readNew(id, file) {
  const seen = offsets.get(id) ?? { at: 0, rest: '' }
  const size = statSync(file).size
  if (size < seen.at) { seen.at = 0; seen.rest = '' }   // rewritten: read it again
  if (size === seen.at) return
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(size - seen.at)
    readSync(fd, buf, 0, buf.length, seen.at)
    seen.at = size
    const text = seen.rest + buf.toString('utf8')
    const lines = text.split('\n')
    seen.rest = lines.pop() ?? ''   // the last piece may still be being written
    const a = agents.get(id)
    for (const line of lines) {
      if (!line.trim()) continue
      try { applyRecord(a, JSON.parse(line)) } catch { /* a line cut mid-write: skip */ }
    }
  } finally {
    closeSync(fd)
  }
  offsets.set(id, seen)
}

function scan() {
  if (!dir || !existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    const m = /^agent-([A-Za-z0-9]+)\.(jsonl|meta\.json)$/.exec(name)
    if (!m) continue
    const id = m[1]
    if (!agents.has(id)) agents.set(id, newAgent(id))
    const file = join(dir, name)
    try {
      if (m[2] === 'jsonl') readNew(id, file)
      else applyMeta(agents.get(id), JSON.parse(readFileSync(file, 'utf8')))
    } catch { /* being written: next look */ }
  }
}

const plain = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
const all = () => [...agents.values()]

const screen = (W, H, t) => (showGallery ? gallery(W, H, t, character) : frame(all(), W, H, t, Date.now(), character))

if (once) {
  scan()
  const W = Number(flag('width')) || 120
  const H = Number(flag('height')) || 40
  process.stdout.write(`${plain(screen(W, H, 0))}\n`)
  process.exit(0)
}

if (!dir && !showGallery) {
  console.error('usage: node duckky-view.mjs <session subagents folder> [--character ducks]   (or set DUCKKY_DIR)\n       node duckky-view.mjs --gallery [--character ducks]')
  process.exit(2)
}

// Full screen: the alternate buffer, cursor hidden; both put back on the way out.
const out = process.stdout
out.write(`\x1b]0;${showGallery ? 'Duckky Gallery' : 'Duckky Swarm'}\x07\x1b[?1049h\x1b[?25l`)
let tick = 0
let last = ''
function draw() {
  try { scan() } catch { /* the folder moved: keep the last frame */ }
  const next = screen(out.columns || 120, out.rows || 40, tick++)
  if (next !== last) { out.write(`\x1b[H${next.split('\n').map((l) => `${l}\x1b[K`).join('\n')}\x1b[J`); last = next }
}
function quit(code = 0) {
  clearInterval(timer)
  out.write('\x1b[?25h\x1b[?1049l')
  process.exit(code)
}
const timer = setInterval(draw, 250)
out.on('resize', () => { last = ''; draw() })
draw()

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on('data', (k) => { const s = k.toString(); if (s === 'q' || s === 'Q' || s === '\u0003') quit() })
}
process.on('SIGINT', () => quit())
process.on('uncaughtException', (err) => {
  out.write('\x1b[?25h\x1b[?1049l')
  console.error(`Duckky Swarm stopped: ${err.stack || err.message}\nPress Enter to close.`)
  process.stdin.setRawMode?.(false)
  process.stdin.once('data', () => process.exit(1))
})
