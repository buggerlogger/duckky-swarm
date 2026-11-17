// node --test characters/sprites.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ACTIVITIES, ansiLines, base64, canvasFor, CANVAS_H, CANVAS_W, CELL_COLS, CELL_ROWS, cellsOf, LABEL, rasterCells } from './sprites.mjs'

const glyphs = (canvas) => cellsOf(canvas).map((row) => row.map((c) => c.ch).join(''))

test('at rest, Clawd is Claude Code\'s own banner glyphs', () => {
  // a frame where it stands still with its eyes open: Clawd is cell rows 2-4,
  // columns 1-9 of the 12 x 5 canvas
  let frame
  for (let tick = 0; tick < 40 && !frame; tick++) {
    const g = glyphs(canvasFor('a1', 'working', tick)).map((r) => r.slice(1, 10))
    if (g[2] === ' ▐▛███▜▌ ') frame = g
  }
  assert.ok(frame, 'no resting frame with open eyes')
  assert.equal(frame[3], '▝▜█████▛▘')
  assert.equal(frame[4], '  ▘▘ ▝▝  ')
})

test('every activity has its own scene: no two look the same', () => {
  const look = (activity) => Array.from({ length: 8 }, (_, t) => JSON.stringify(canvasFor('a1', activity, t))).join()
  const scenes = new Map()
  for (const activity of ACTIVITIES) {
    const l = look(activity)
    assert.ok(!scenes.has(l), `${activity} looks like ${scenes.get(l)}`)
    scenes.set(l, activity)
    assert.ok(LABEL[activity], `${activity} has no label`)
  }
})

test('a prop over Clawd keeps both colours: the cell background carries the second', () => {
  // the book is white and grey over orange: at rest it fills whole cells, but
  // as Clawd bobs half a cell its edge shares cells with the body
  const cells = Array.from({ length: 12 }, (_, t) => cellsOf(canvasFor('a1', 'reading', t)).flat()).flat()
  assert.ok(cells.some((c) => c.fg && c.bg && c.fg !== c.bg))
})

test('the canvas and its cells keep their sizes', () => {
  const c = canvasFor('a1', 'running', 0)
  assert.equal(c.length, CANVAS_H)
  for (const row of c) assert.equal(row.length, CANVAS_W)
  const cells = cellsOf(c)
  assert.equal(cells.length, CELL_ROWS)
  for (const row of cells) assert.equal(row.length, CELL_COLS)
  for (const line of ansiLines(c)) assert.equal([...line.replace(/\x1b\[[0-9;]*m/g, '')].length, CELL_COLS)
})

test('Clawd moves for every activity', () => {
  for (const activity of ['running', 'editing', 'searching', 'reading', 'done', 'stopped', 'thinking', 'web', 'delegating']) {
    const frames = new Set(Array.from({ length: 12 }, (_, t) => JSON.stringify(canvasFor('a1', activity, t))))
    assert.ok(frames.size > 1, `${activity} never moves`)
  }
})

test('running: Clawd hops up and waves its arms', () => {
  const top = (c) => c.findIndex((row) => row.some(Boolean))
  const tops = new Set(Array.from({ length: 4 }, (_, t) => top(canvasFor('a1', 'running', t))))
  assert.ok(tops.size > 1)
})

test('a swarm is not in lockstep', () => {
  // the running cycle repeats every 2 frames, so two agents match half the
  // time; six in step would mean the phase is ignored
  const run = (id) => Array.from({ length: 8 }, (_, t) => JSON.stringify(canvasFor(id, 'running', t))).join()
  const rhythms = new Set(['a1', 'b2', 'c3', 'd4', 'e5', 'f6'].map(run))
  assert.ok(rhythms.size > 1)
})

test('Raster cells: base64 of (code point, fg, bg) for every cell, quadrant glyphs only', () => {
  assert.equal(base64(new Uint8Array([77, 97, 110])), 'TWFu')
  assert.equal(base64(new Uint8Array([77, 97])), 'TWE=')
  const bytes = Buffer.from(rasterCells(canvasFor('a1', 'working', 0)), 'base64')
  assert.equal(bytes.length, CELL_COLS * CELL_ROWS * 12)
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4)
  for (let i = 0; i < words.length; i += 3) {
    const cp = words[i]
    assert.ok(cp === 0x20 || cp === 0x2580 || cp === 0x2584 || cp === 0x2588 || cp === 0x258c || cp === 0x2590 || (cp >= 0x2596 && cp <= 0x259f), `U+${cp.toString(16)}`)
    for (const col of [words[i + 1], words[i + 2]]) assert.ok(col === 0x01000000 || col <= 0xffffff)
  }
})
