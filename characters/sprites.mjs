// Copyright 2026 buggerlogger (https://github.com/buggerlogger)
// SPDX-License-Identifier: Apache-2.0
//
// Every subagent is Clawd, Claude Code's mascot, acting out what its agent is
// doing with a prop for each kind of work: a book when it reads, a laptop when
// it edits, goggles and a test tube when it runs tests, a hard hat when it
// builds, a rocket when it deploys, tea when a command runs long, a night cap
// when it was stopped. Clawd's design is Anthropic's; this is an unofficial fan
// rendering, and every prop here is drawn for this project (see the README).
// Pure data and math, shared by the swarm window (viewer/, as ANSI) and the
// band above Claude Code's prompt (hooks/, as Raster cells).
//
// Clawd is 18 x 5 pixels, drawn as Claude Code's banner draws it: quadrant
// blocks, 2 x 2 pixels a cell, its eyes two holes. The canvas is 24 x 10
// pixels (12 x 5 cells): room above for hats and icons, beside for tools.

export const CANVAS_W = 24
export const CANVAS_H = 10
export const CELL_COLS = CANVAS_W / 2
export const CELL_ROWS = CANVAS_H / 2

// # body, E an eye (a hole, filled in when it blinks or sleeps).
const CLAWD = [
  '...############...',
  '...##E######E##...',
  '.################.',
  '...############...',
  '....#.#....#.#....',
]
export const ORANGE = '#D77757'
const DIM_ORANGE = '#9A5440'
// The body's own colours: where a cell's colours tie, the prop over them wins.
const BODY = new Set([ORANGE, DIM_ORANGE])

// Prop colours, one letter each.
export const C = {
  O: ORANGE, W: '#F2F2F2', w: '#B8B8CC', G: '#9AA0A6', K: '#30353D', B: '#4A90E2', b: '#8EC5FF',
  N: '#5DBB63', Y: '#F7D046', R: '#E85D5D', P: '#A77BDB', T: '#8B5E3C', D: '#3A4A9C',
}

// FNV-1a over the id, then murmur3's finaliser: each Clawd's own animation
// phase, so a swarm of them does not move in step. ⛔ FNV alone is not enough:
// its low bit is just the XOR of the characters' low bits, so `% 8` put six
// agents in one rhythm (measured); fmix32 spreads every bit into the low ones.
export function hash(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

// Rows of letters at (x, y); `.` leaves a pixel as it is.
function art(set, x, y, rows) {
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => { if (ch !== '.') set(x + dx, y + dy, C[ch] ?? ch) }))
}

// --- what Clawd holds or shows, per activity --------------------------------
// Each draws relative to Clawd's body at (x, y) (its top-left), or at fixed
// canvas spots for icons that must not leave the canvas when Clawd hops.

const PROPS = {
  reading: (set, x, y, t) => art(set, x + 6, y + 2, t % 8 < 2 ? ['WWWWWW', 'WWGGWW'] : ['WWGGWW', 'WWGGWW']),
  editing: (set, x, y, t) => {
    const typed = 'b'.repeat(8).split('').map((ch, i) => (i < (t % 9) ? 'W' : ch)).join('')
    art(set, x + 4, y + 2, [`K${'b'.repeat(8)}K`, `K${typed}K`, 'GGGGGGGGGG'])
  },
  searching: (set, x, y, t) => art(set, x + 16, y - 2, ['.GG.', `Gb${t % 4 < 2 ? 'W' : 'b'}G`, 'GbbG', '.GG.', '.T..']),
  web: (set, x, y, t) => {
    const land = [['BNBB', 'BBNB'], ['BBNB', 'NBBN'], ['NBBN', 'BNBB'], ['BBBN', 'BNBB']][t % 4]
    art(set, x + 16, y, ['.BB.', land[0], land[1], '.BB.'])
  },
  testing: (set, x, y, t) => {
    art(set, x + 4, y, ['GGG....GGG', 'G.G....G.G'])                      // goggles round the eyes
    art(set, x + 16, y - 3, ['WW', 'WW', 'PP', 'PP'])                     // the test tube, held up
    if (t % 2) set(x + 17, y - 4, C.w)                                    // a bubble
  },
  pass: (set) => art(set, 16, 0, ['....NN', '...NN.', 'NN.NN.', '.NNN..']),
  fail: (set) => art(set, 18, 0, ['R..R', '.RR.', '.RR.', 'R..R']),
  building: (set, x, y, t) => {
    art(set, x + 4, y - 2, ['.YYYYYYYY.', 'YYYYYYYYYY'])                  // hard hat
    if (t % 2) art(set, x + 16, y - 3, ['GGG', '.T.', '.T.', '.T.'])      // hammer up
    else art(set, x + 16, y + 1, ['TTGG', '..GG'])                        // hammer down
  },
  git: (set, x, y, t) => art(set, 16, 0, (t % 4 < 2 ? ['W...W.', 'W..W..', 'WWW...', 'W.....'] : ['w...W.', 'w..W..', 'wWW...', 'w.....'])),
  installing: (set, x, y, t) => {
    art(set, x + 6, y + 2, ['TTYYTT', 'TTTTTT'])                          // the box
    art(set, 10, t % 4 < 2 ? 0 : 1, ['.WW.', '.WW.', 'WWWW', '.WW.'])     // the arrow, going in
  },
  deploying: (set, x, y, t) => {
    const lift = 9 - (t % 14)                                             // the rocket climbs, again and again
    art(set, 19, lift - 4, ['.R.', 'WWW', 'WbW', 'WWW', t % 2 ? 'Y.Y' : '.Y.'])
  },
  tea: (set, x, y, t) => {
    art(set, x + 8, y + 2, ['WWWG', 'WWW.'])                              // the cup
    const s = t % 2
    set(x + 9 - s, y + 1, C.w); set(x + 8 + s, y, C.w); set(x + 9 - s, y - 1, C.w)   // steam
  },
  thinking: (set, x, y, t) => {
    const n = t % 4
    if (n > 0) set(18, 3, C.W)
    if (n > 1) { set(19, 1, C.W); set(20, 1, C.W) }
    if (n > 2) { art(set, 21, 0, ['WW', 'WW']) }
  },
  writing: (set, x, y, t) => {
    // a speech bubble, its three dots appearing one by one
    const dots = ['WWWWWWWW', 'WKWWWWWW', 'WKWWKWWW', 'WKWWKWWK'][t % 4]
    art(set, 15, 0, ['.WWWWWWW', dots, '.WWWWWWW', '.WW.....'])
  },
  delegating: (set, x, y, t) => art(set, 18, t % 2 ? 5 : 6, ['.OOOO.', 'OKOOKO', 'OOOOOO', '.O..O.']),
  // the model refused and the step is being asked again: a turning arrow
  retrying: (set, x, y, t) => art(set, 16, 0, [
    ['.WWW.', 'W...W', 'W....', '.W.W.'], ['.WWW.', 'W...W', '....W', '.W.W.'],
    ['.W.W.', 'W...W', 'W...W', '.WWW.'], ['.W.W.', '....W', 'W...W', '.WWW.'],
  ][t % 4]),
  // refused every time it was asked: a red no-entry sign
  refused: (set) => art(set, 16, 0, ['.RRRR.', 'RWWWWR', 'RRRRRR', '.RRRR.']),
  done: (set, x, y, t, dy) => { if (dy > 0) { set(0, t % 2, C.Y); set(23, 1 - (t % 2), C.Y); set(22, 4, C.W); set(1, 4, C.W) } },
  stopped: (set, x, y, t) => {
    art(set, x + 4, y - 3, ['....DDD...', '..DDDDDDD.', 'DDDDDDDDDD'])   // the night cap
    set(x + 14, y - 2, C.D); set(x + 15, y - 1, C.W)                      // its pompom, drooping
    const rise = t % 6 < 3 ? 0 : 1
    art(set, 19, 1 - rise, ['WWW', '.W.', 'WWW'].map((r) => r.replace(/W/g, 'w')))
  },
}

// How each activity moves Clawd, one step per tick: [dx, dy] (dy up is
// positive), and what its arms and feet do.
export const MOTION = {
  starting: { moves: [[0, 0], [0, 1]], arms: 'wave' },
  working: { moves: [[0, 0], [0, 0], [0, 1], [0, 1]] },
  thinking: { moves: [[0, 0]] },
  writing: { moves: [[0, 0], [0, 0], [0, 1], [0, 1]] },
  reading: { moves: [[0, 0], [0, 0], [0, 0], [0, 1], [0, 1], [0, 1]] },
  editing: { moves: [[0, 0], [0, 0], [0, 1], [0, 0]] },
  searching: { moves: [[-1, 0], [-1, 0], [0, 0], [1, 0], [1, 0], [0, 0]], feet: true },
  web: { moves: [[0, 0], [0, 1]] },
  testing: { moves: [[0, 0], [0, 0], [0, 1]], arms: 'right' },
  pass: { moves: [[0, 0], [0, 1], [0, 2], [0, 2], [0, 1], [0, 0]], arms: 'up' },
  fail: { moves: [[0, 0]], arms: 'down' },
  building: { moves: [[0, 0], [0, 1]], arms: 'right-wave' },
  git: { moves: [[0, 0], [0, 0], [0, 1], [0, 1]] },
  installing: { moves: [[0, 0], [0, 1], [0, 0], [0, 0]] },
  deploying: { moves: [[0, 0], [0, 0], [0, 1]], arms: 'up' },
  running: { moves: [[0, 0], [0, 2], [0, 0], [0, 2]], arms: 'wave' },
  tea: { moves: [[0, 0]] },
  delegating: { moves: [[0, 0], [0, 1], [0, 2], [0, 1]], arms: 'wave' },
  retrying: { moves: [[-1, 0], [1, 0], [-1, 0], [1, 0], [0, 0], [0, 0]] },   // shakes its head
  refused: { moves: [[0, 0]], arms: 'down' },
  done: { moves: [[0, 0], [0, 1], [0, 2], [0, 2], [0, 1], [0, 0], [0, 0], [0, 0]], arms: 'wave' },
  stopped: { moves: [[0, 0]], arms: 'down' },
}
export const ACTIVITIES = Object.keys(MOTION)

// One frame: CANVAS_H rows of CANVAS_W colours ('#RRGGBB'), null where empty.
// `who` is the agent id (or { id }): it sets the Clawd's phase.
export function canvasFor(who, activity, tick) {
  const id = typeof who === 'string' ? who : who?.id ?? ''
  const t = tick + (hash(String(id)) % 8)
  const canvas = Array.from({ length: CANVAS_H }, () => Array(CANVAS_W).fill(null))
  const set = (x, y, c) => { if (x >= 0 && x < CANVAS_W && y >= 0 && y < CANVAS_H) canvas[y][x] = c }
  const motion = MOTION[activity] ?? MOTION.working
  const [dx, dy] = motion.moves[t % motion.moves.length]
  const asleep = activity === 'stopped'
  const body = asleep ? DIM_ORANGE : ORANGE
  const eyesShut = asleep || t % 23 === 22
  const wave = t % 2 === 1
  const leftUp = motion.arms === 'up' || (motion.arms === 'wave' && wave)
  const rightUp = motion.arms === 'up' || motion.arms === 'right' || (motion.arms === 'wave' && wave) || (motion.arms === 'right-wave' && wave)
  const armsDown = motion.arms === 'down'
  const stepped = motion.feet && t % 2 === 1
  const x = 2 + dx
  const y = 4 - dy   // at rest Clawd stands on the bottom rows, as in the banner

  CLAWD.forEach((row, ry) => {
    ;[...row].forEach((ch, rx) => {
      if (ch === '.') return
      if (ch === 'E') { if (eyesShut) set(x + rx, y + ry, body); return }
      if (ry === 2 && rx <= 2 && (leftUp || armsDown)) return
      if (ry === 2 && rx >= 15 && (rightUp || armsDown)) return
      if (ry === 4 && stepped) { set(x + rx + (rx < 9 ? 1 : -1), y + ry, body); return }
      set(x + rx, y + ry, body)
    })
  })
  if (leftUp) { set(x + 1, y + 1, body); set(x + 2, y + 1, body) }
  if (rightUp) { set(x + 15, y + 1, body); set(x + 16, y + 1, body) }
  if (armsDown) { set(x + 2, y + 3, body); set(x + 15, y + 3, body) }

  PROPS[activity]?.(set, x, y, t, dy)
  return canvas
}

// Quadrant blocks by which of a cell's four pixels are set: upper left 1,
// upper right 2, lower left 4, lower right 8.
const QUADRANT = [' ', '▘', '▝', '▀', '▖', '▌', '▞', '▛', '▗', '▚', '▐', '▜', '▄', '▙', '▟', '█']

// 2 x 2 pixels -> one cell: a glyph, its colour, and a background. A cell of
// one colour (and empty pixels) keeps the terminal's background. A cell fully
// covered by exactly two colours (a white book over orange Clawd) draws the
// second one as its background, so props can sit ON Clawd. Anything busier
// keeps its most common colour. `body`: the character's own colours.
export function cellsOf(canvas, body = BODY) {
  const rows = []
  for (let y = 0; y < CANVAS_H; y += 2) {
    const row = []
    for (let x = 0; x < CANVAS_W; x += 2) {
      const px = [canvas[y][x], canvas[y][x + 1], canvas[y + 1][x], canvas[y + 1][x + 1]]
      const counts = new Map()
      for (const c of px) if (c) counts.set(c, (counts.get(c) ?? 0) + 1)
      if (!counts.size) { row.push({ ch: ' ', fg: null, bg: null }); continue }
      // the prop over the body where they tie: what Clawd holds is the news
      const [fg] = [...counts.entries()].sort((a, b) => b[1] - a[1] || (body.has(a[0]) ? 1 : -1))[0]
      const mask = px.reduce((m, c, i) => (c === fg ? m | (1 << i) : m), 0)
      const rest = px.filter((c) => c !== fg)
      const bg = counts.size === 2 && rest.every((c) => c && c === rest[0]) ? rest[0] : null
      row.push({ ch: QUADRANT[mask], fg, bg })
    }
    rows.push(row)
  }
  return rows
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

// For the swarm window: each cell row as a string of 24-bit ANSI colour.
export function ansiLines(canvas, body = BODY) {
  return cellsOf(canvas, body).map((row) =>
    `${row.map(({ ch, fg, bg }) =>
      `${fg ? `\x1b[38;2;${rgb(fg).join(';')}m` : '\x1b[39m'}${bg ? `\x1b[48;2;${rgb(bg).join(';')}m` : '\x1b[49m'}${ch}`).join('')}\x1b[39;49m`)
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
export function base64(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]
    out += c === undefined ? '=' : B64[c & 63]
  }
  return out
}

// For Claude Code's Raster: every cell as little-endian u32 [codePoint,
// foreground, background], base64; a colour is 0x00RRGGBB, the terminal's
// default 0x01000000.
export function rasterCells(canvas, body = BODY) {
  const cells = cellsOf(canvas, body).flat()
  const words = new Uint32Array(cells.length * 3)
  const color = (hex) => (hex ? parseInt(hex.slice(1), 16) : 0x01000000)
  cells.forEach(({ ch, fg, bg }, i) => {
    words[i * 3] = ch.codePointAt(0) ?? 32
    words[i * 3 + 1] = color(fg)
    words[i * 3 + 2] = color(bg)
  })
  return base64(new Uint8Array(words.buffer))
}

// What a person reads under Clawd for each activity.
export const LABEL = {
  starting: 'starting', working: 'working', thinking: 'thinking', writing: 'writing',
  reading: 'reading', editing: 'editing', searching: 'searching', web: 'on the web',
  testing: 'testing', pass: 'tests pass', fail: 'tests fail', building: 'building',
  git: 'git', installing: 'installing', deploying: 'deploying', running: 'running',
  tea: 'tea break', delegating: 'delegating', done: 'done', stopped: 'stopped',
  retrying: 'retrying', refused: 'refused',
}
