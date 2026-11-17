// node --test characters/ducks.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as ducks from './ducks.mjs'
import * as clawd from './sprites.mjs'
import { ACTIVITIES, canvasFor, CANVAS_H, CANVAS_W, CELL_COLS, CELL_ROWS, cellsOf, LABEL, rasterCells, SKINS, YELLOW } from './ducks.mjs'

const glyphs = (canvas) => cellsOf(canvas).map((row) => row.map((c) => c.ch).join(''))

// a frame where it stands still with its eyes open
function resting(skin) {
  for (let tick = 0; tick < 40; tick++) {
    const c = canvasFor('a1', 'working', tick, skin)
    const g = glyphs(c)
    if (g[0] === '    ▗▖      ' && (skin === 'hero' || g[2] === '  █▄▀▀▄█    ')) return { g, cells: cellsOf(c) }
  }
  assert.fail(`no resting ${skin} frame`)
}

test('at rest, the duckling: tuft, head, eyes over its beak, wings, feet', () => {
  const { g, cells } = resting('duckling')
  assert.deepEqual(g, [
    '    ▗▖      ',
    '  ▄████▄    ',
    '  █▄▀▀▄█    ',
    ' ▄██████▄   ',
    ' ▝▀▀▀▀▀▀▘   ',
  ])
  assert.equal(cells[2][4].fg, YELLOW)        // the beak: yellow over orange
  assert.equal(cells[2][4].bg, '#F2621F')
  assert.equal(cells[2][3].bg, null)          // an eye is a hole
})

test('at rest, the hero: a bar of shades with a glint, its beak over the hoodie', () => {
  const { g, cells } = resting('hero')
  assert.deepEqual(g.slice(1, 4), ['  ▄████▄    ', '  ▙▀▀▀▀▟    ', ' ▄██▀▀██▄   '])
  assert.equal(cells[2][2].bg, '#F2F2F2')     // the glint
  assert.equal(cells[2][3].fg, '#141414')     // the shades
  assert.equal(cells[3][4].fg, '#F2621F')     // the beak, over the hoodie
  assert.equal(cells[3][4].bg, '#3B3F47')
})

test('every activity has its own scene in both skins, and a label', () => {
  for (const skin of SKINS) {
    const scenes = new Map()
    for (const activity of ACTIVITIES) {
      const look = Array.from({ length: 8 }, (_, t) => JSON.stringify(canvasFor('a1', activity, t, skin))).join()
      assert.ok(!scenes.has(look), `${skin}: ${activity} looks like ${scenes.get(look)}`)
      scenes.set(look, activity)
      assert.ok(LABEL[activity], `${activity} has no label`)
    }
  }
})

// A cell shows two colours (a glyph and its background), so a third is
// dropped: that is how a one-pixel side-step broke the face, a book's spine
// bobbing into the beak went black, and shades beside the beak became fangs.
// Each of those, put back, makes this fail (37, 100 and 159 cells).
test('no cell ever needs three colours: every pixel drawn is shown', () => {
  for (const skin of SKINS) for (const activity of ACTIVITIES) for (let t = 0; t < 28; t++) {
    const c = canvasFor('a1', activity, t, skin)
    for (let y = 0; y < CANVAS_H; y += 2) for (let x = 0; x < CANVAS_W; x += 2) {
      const colours = new Set([c[y][x], c[y][x + 1], c[y + 1][x], c[y + 1][x + 1]].filter(Boolean))
      assert.ok(colours.size <= 2, `${skin} ${activity} tick ${t}: cell (${x / 2}, ${y / 2}) has ${[...colours].join(' ')}`)
    }
  }
})

test('the ducks move for every activity, and a swarm is not in lockstep', () => {
  for (const activity of ['running', 'editing', 'searching', 'reading', 'done', 'stopped', 'thinking', 'web', 'delegating', 'retrying']) {
    const frames = new Set(Array.from({ length: 12 }, (_, t) => JSON.stringify(canvasFor('a1', activity, t))))
    assert.ok(frames.size > 1, `${activity} never moves`)
  }
  const run = (id) => Array.from({ length: 8 }, (_, t) => JSON.stringify(canvasFor(id, 'running', t))).join()
  assert.ok(new Set(['a1', 'b2', 'c3', 'd4', 'e5', 'f6'].map(run)).size > 1)
})

test('the same canvas and cells as Clawd, so the band and the window can draw them', () => {
  assert.equal(CELL_COLS, clawd.CELL_COLS)
  assert.equal(CELL_ROWS, clawd.CELL_ROWS)
  for (const name of ['ACTIVITIES', 'ansiLines', 'canvasFor', 'cellsOf', 'CELL_COLS', 'CELL_ROWS', 'LABEL', 'rasterCells']) {
    assert.equal(typeof ducks[name], typeof clawd[name], name)
  }
  for (const skin of SKINS) {
    const bytes = Buffer.from(rasterCells(canvasFor('a1', 'editing', 3, skin)), 'base64')
    assert.equal(bytes.length, CELL_COLS * CELL_ROWS * 12)
    for (const line of ducks.ansiLines(canvasFor('a1', 'building', 1, skin))) {
      assert.equal([...line.replace(/\x1b\[[0-9;]*m/g, '')].length, CELL_COLS)
    }
  }
})
