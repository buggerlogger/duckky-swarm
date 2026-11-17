// Copyright 2026 buggerlogger (https://github.com/buggerlogger)
// SPDX-License-Identifier: Apache-2.0
//
// The swarm window: a grid of panes, one per subagent, each in its own colour.
// Pure: agents in, one frame of text (with ANSI colour) out. Every line of a
// pane is cut or padded to its exact width BEFORE colour is added, so the
// grid lines up whatever the agents wrote.

import { characterFor } from '../characters/index.mjs'
import { ACTIVITIES, CELL_COLS, CELL_ROWS, LABEL } from '../characters/sprites.mjs'
import { labelOf, nowLine, shownActivity, stateOf } from './model.mjs'

// Who acts out the work (the Character setting): Clawd unless told otherwise.
const CLAWD = characterFor('Clawd')

const ESC = '\x1b['
const color = (n) => `${ESC}38;5;${n}m`
const RESET = `${ESC}0m`
const DIM = `${ESC}2m`
const BOLD = `${ESC}1m`

// one colour per pane, in order
export const PALETTE = [39, 208, 141, 78, 203, 220, 45, 213, 250]

export const FIGURE_W = CELL_COLS + 1   // the corner each pane keeps for its Clawd, a space before it
export const FIGURE_H = CELL_ROWS
const MIN_INNER_FOR_FIGURE = 30         // narrower panes leave Clawd out

// Text as one visible line of exactly `w` columns: control characters out,
// tabs as spaces, cut with an ellipsis or padded.
export function fit(s, w) {
  if (w <= 0) return ''
  const clean = String(s).replace(/\t/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '')
  return clean.length > w ? `${clean.slice(0, Math.max(0, w - 1))}…` : clean.padEnd(w)
}

// Words over lines no wider than `w`.
export function wrap(s, w, max = 50) {
  const out = []
  let line = ''
  for (const word of String(s).split(' ')) {
    if (!line) line = word
    else if (line.length + 1 + word.length <= w) line += ` ${word}`
    else { out.push(line); line = word }
    while (line.length > w) { out.push(line.slice(0, w)); line = line.slice(w) }
    if (out.length >= max) break
  }
  if (line && out.length < max) out.push(line)
  return out
}

// n panes over a W x H screen: as many columns as keep a pane at least 34
// wide, then rows; a terminal cell is about twice as tall as it is wide, so a
// square-looking grid has about as many columns as rows.
export function grid(n, W, H) {
  if (n <= 0) return { cols: 0, rows: 0, rects: [] }
  let cols = Math.ceil(Math.sqrt(n))
  while (cols > 1 && Math.floor(W / cols) < 34) cols -= 1
  const rows = Math.ceil(n / cols)
  const rects = []
  for (let i = 0; i < n; i++) {
    const c = i % cols
    const r = Math.floor(i / cols)
    const x = Math.floor((c * W) / cols)
    const y = Math.floor((r * H) / rows)
    rects.push({ x, y, w: Math.floor(((c + 1) * W) / cols) - x, h: Math.floor(((r + 1) * H) / rows) - y })
  }
  return { cols, rows, rects }
}

const elapsed = (a, now, state) => {
  if (!a.firstAt) return ''
  const s = Math.max(0, Math.round(((state === 'running' ? now : a.lastAt) - a.firstAt) / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h${String(Math.floor(s / 60) % 60).padStart(2, '0')}m`
}
const count = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n))

// The character's corner: FIGURE_H lines of FIGURE_W columns, acting out what
// the agent is doing (its own phase, from its id).
export function figure(a, tick, state = a.finished ? 'done' : 'running', now = Date.now(), character = CLAWD) {
  return character.ansiLines(character.canvasFor(a.id, scene(a, state, now), tick)).map((l) => ` ${l}`)
}

// The scene Clawd plays: what the agent does while it runs (a long command
// turns into tea, a test result fades back to thinking), else done / stopped.
export const scene = (a, state, now) => (state === 'running' ? shownActivity(a.activity, a.activityAt, now) : state)

const KIND = { tool: '▸ ', text: '  ', result: '  ', error: '✗ ' }

// One pane: a border in the agent's colour, its title on the top edge, a
// status line, the character's corner, then its latest activity.
export function pane(a, rect, hue, tick, now, character = CLAWD) {
  const { w, h } = rect
  const inner = w - 2
  if (inner < 8 || h < 4) return Array.from({ length: h }, () => ' '.repeat(w))
  const c = color(hue)
  const title = fit(` ${labelOf(a)}${a.isFork ? ' fork' : ''} · ${a.description || a.task || a.id} `, Math.max(0, inner - 2))
  const top = `${c}┌─${BOLD}${title.trimEnd()}${RESET}${c}${'─'.repeat(Math.max(0, inner - 1 - title.trimEnd().length))}┐${RESET}`
  const side = (text, style = '') => `${c}│${RESET}${style}${text}${style ? RESET : ''}${c}│${RESET}`

  const state = stateOf(a, now)
  const quiet = state !== 'running'
  const figW = inner >= MIN_INNER_FOR_FIGURE && h >= FIGURE_H + 3 ? FIGURE_W : 0
  const fig = figW ? figure(a, tick, state, now, character) : []
  const left = [
    { text: `${LABEL[scene(a, state, now)] ?? state} ${elapsed(a, now, state)} · ${a.tools} tools · ${count(a.outTokens)} tok`, style: quiet ? DIM : '' },
    { text: nowLine(a), style: DIM },
    { text: `${a.model || a.type}${a.effort === undefined ? '' : ` · ${a.effort}`}`, style: DIM },
    { text: `id ${a.id.slice(0, 8)}${a.isFork ? ' · fork' : ''}`, style: DIM },
  ]
  const body = []
  for (let i = 0; i < (figW ? FIGURE_H : 2); i++) {
    const l = left[i] ?? { text: '', style: '' }
    const text = fit(l.text, inner - figW)
    body.push(side(`${l.style}${text}${l.style ? RESET : ''}${fig[i] ?? ''}`))
  }

  // newest activity that fits, oldest of those first
  const room = h - 2 - body.length
  const shown = []
  for (let i = a.lines.length - 1; i >= 0 && shown.length < room; i--) {
    const l = a.lines[i]
    if (l.kind === 'result') continue
    const rows = wrap(`${KIND[l.kind] ?? '  '}${l.text}`, inner, room).reverse()
    for (const row of rows) if (shown.length < room) shown.unshift({ kind: l.kind, text: row })
  }
  for (const s of shown) body.push(side(fit(s.text, inner), s.kind === 'error' ? color(203) : s.kind === 'tool' ? color(250) : ''))
  while (body.length < h - 2) body.push(side(' '.repeat(inner)))
  return [top, ...body, `${c}└${'─'.repeat(inner)}┘${RESET}`]
}

// Running agents first, then the most recent; at most `max` panes.
export function choose(agents, max = 9) {
  return [...agents]
    .sort((x, y) => Number(x.finished) - Number(y.finished) || (y.lastAt || y.firstAt) - (x.lastAt || x.firstAt))
    .slice(0, max)
}

// A whole frame: a header line, the grid, and a footer line.
export function frame(agents, W, H, tick, now = Date.now(), character = CLAWD) {
  const states = agents.map((a) => stateOf(a, now))
  const n = (s) => states.filter((x) => x === s).length
  const head = fit(` DUCKKY SWARM · ${n('running')} running · ${n('done')} done${n('stopped') ? ` · ${n('stopped')} stopped` : ''}${n('refused') ? ` · ${n('refused')} refused` : ''}`, W - 10)
  const lines = [`${BOLD}${head}${RESET}${DIM}${fit('q to quit', 10)}${RESET}`]
  const shown = choose(agents)
  if (!shown.length) {
    lines.push('', fit('  Waiting for subagents in this session. Ask Claude for some: "use 4 Opus 4.6 subagents to ..."', W))
    while (lines.length < H) lines.push('')
    return lines.join('\n')
  }
  const { rects } = grid(shown.length, W, H - 1)
  const screen = Array.from({ length: H - 1 }, () => [])
  shown.forEach((a, i) => {
    const rect = rects[i]
    const rows = pane(a, rect, PALETTE[i % PALETTE.length], tick, now, character)
    rows.forEach((row, k) => { screen[rect.y + k]?.push({ x: rect.x, row }) })
  })
  for (const cells of screen) {
    cells.sort((p, q) => p.x - q.x)
    lines.push(cells.map((p) => p.row).join(''))
  }
  return lines.join('\n')
}

// Every scene the character plays, side by side with its name: `--gallery`,
// to see them all without a session that happens to run each kind of work.
export function gallery(W, H, tick, character = CLAWD) {
  const cellW = CELL_COLS + 4
  const cellH = CELL_ROWS + 2
  const perRow = Math.max(1, Math.floor(W / cellW))
  const lines = [`${BOLD}${fit(` DUCKKY SWARM · every scene ${character.name} play${character.name === 'Clawd' ? 's' : ''}`, W - 10)}${RESET}${DIM}${fit('q to quit', 10)}${RESET}`, '']
  for (let i = 0; i < ACTIVITIES.length; i += perRow) {
    const group = ACTIVITIES.slice(i, i + perRow)
    const arts = group.map((act) => character.ansiLines(character.canvasFor(`gallery-${act}`, act, tick)))
    for (let r = 0; r < CELL_ROWS; r++) lines.push(arts.map((a) => `  ${a[r]}  `).join(''))
    lines.push(group.map((act) => `${DIM}${fit(`  ${LABEL[act]}`, cellW)}${RESET}`).join(''))
    lines.push('')
    if (lines.length > H - cellH) break
  }
  while (lines.length < H) lines.push('')
  return lines.slice(0, H).join('\n')
}
