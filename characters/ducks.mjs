// Copyright 2026 buggerlogger (https://github.com/buggerlogger)
// SPDX-License-Identifier: Apache-2.0
//
// The Duckky Swarm ducks: the project's own mascot (the duckling of the logo,
// and the hero in sunglasses and a hoodie), acting out what a subagent is doing
// the way Clawd does in sprites.mjs: the same canvas, the same quadrant
// blocks, the same MOTION table (its wings are Clawd's arms), and a prop for
// every activity. Character = Duckky Ducks in /config draws the duckling
// (index.mjs); `node viewer/duckky-view.mjs --gallery --character ducks` shows
// every scene. The hero skin is drawn and tested, not offered in /config yet.

import { ACTIVITIES, ansiLines as ansiOf, C, CANVAS_H, CANVAS_W, CELL_COLS, CELL_ROWS, cellsOf as cellsWith, hash, LABEL, MOTION, rasterCells as rasterOf } from './sprites.mjs'

export { ACTIVITIES, CANVAS_H, CANVAS_W, CELL_COLS, CELL_ROWS, LABEL }

// A duck is 16 x 9 pixels: a pixel is half a cell wide and half a cell tall,
// so twice as tall as it is wide on screen, and a round duck is drawn wide.
// U body, T its tuft, E an eye (a hole, filled in when it blinks or sleeps),
// A the beak, F a foot. The wings are drawn by pose, either side of row 6.
const DUCK = [
  '.......TT.......',
  '....UUUUUUUU....',
  '..UUUUUUUUUUUU..',
  '..UUEEUUUUEEUU..',
  '..UUUUAAAAUUUU..',
  '.UUUUUUUUUUUUUU.',
  '.UUUUUUUUUUUUUU.',
  '.UUUUUUUUUUUUUU.',
  '....FF....FF....',
]

// The logo's colours.
export const YELLOW = '#FFCB2F'
const WING = '#F59E1B'
const BEAK = '#F2621F'
const SHADES = '#141414'
const HOODIE = '#3B3F47'
const DIM_YELLOW = '#A8862A'
const DIM_WING = '#9A6A1A'
// The duck's own colours: where a cell's colours tie, the prop over them wins.
export const BODY = new Set([YELLOW, WING, BEAK, HOODIE, DIM_YELLOW, DIM_WING])

export const SKINS = ['duckling', 'hero']

// Prop colours: Clawd's, and the duck's own for a little one.
const P = { ...C, U: YELLOW, A: BEAK, k: SHADES }

// Rows of letters at (x, y); `.` leaves a pixel as it is.
function art(set, x, y, rows) {
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => { if (ch !== '.') set(x + dx, y + dy, P[ch] ?? ch) }))
}

// The hero's sunglasses, the duckling's when it is done: one dark bar across
// the eyes, a glint at its end. Measured against four other shapes on the
// sheet: lenses dropping beside the beak frame it like an open mouth with
// fangs, and black the width of the head cuts it in two (black on a dark
// terminal reads as a gap). The glint sits where its cell holds only yellow
// and white: a cell shows two colours.
function shades(set, x, y) {
  art(set, x + 3, y + 3, ['Wkkkkkkkkk'])
}

// A prop held in front stays where the duck holds it at rest while its head
// bobs: a half-cell bob would put the beak, a page and its edge in one cell,
// and a cell shows two colours.
const HELD_Y = 6

// --- what a duck holds or shows, per activity --------------------------------
// Each draws relative to the duck at (x, y) (its top-left), or at fixed canvas
// spots, right of its head, for icons that must not leave the canvas when it hops.

const PROPS = {
  // an open book held up, its pages split on a cell, one turning over
  reading: (set, x, y, t) => art(set, x + 4, HELD_Y, t % 8 < 2 ? ['WWWWWWww', 'WWWWWWww'] : ['WWWWwwww', 'WWWWwwww']),
  // the logo's dark screen, green code being typed on it
  editing: (set, x, y, t) => {
    const typed = [...'KKKKKKKK'].map((ch, i) => (i < (t % 9) ? 'N' : ch)).join('')
    art(set, x + 2, HELD_Y, ['GKKKKKKKKKKG', `GK${typed}KG`, 'GGGGGGGGGGGG'])
  },
  searching: (set, x, y, t) => art(set, 18, 0, ['.GG.', `Gb${t % 4 < 2 ? 'W' : 'b'}G`, 'GbbG', '.GG.', 'T...']),
  web: (set, x, y, t) => {
    const land = [['BNBB', 'BBNB'], ['BBNB', 'NBBN'], ['NBBN', 'BNBB'], ['BBBN', 'BNBB']][t % 4]
    art(set, 18, 1, ['.BB.', land[0], land[1], '.BB.'])
  },
  testing: (set, x, y, t) => {
    art(set, x + 2, y + 3, ['GGbbGGGGbbGG'])                             // goggles over the eyes
    art(set, 20, 1, ['WW', 'WW', 'PP', 'PP'])                             // the test tube, held up
    set(20 + (t % 2), 0, C.w)                                            // a bubble
  },
  pass: (set) => art(set, 17, 0, ['....NN', '...NN.', 'NN.NN.', '.NNN..']),
  fail: (set) => art(set, 18, 0, ['R..R', '.RR.', '.RR.', 'R..R']),
  building: (set, x, y, t) => {
    art(set, x + 4, y, ['WWWWWWWW'])                                      // hard hat
    art(set, x + 2, y + 1, ['WWWWWWWWWWWW'])                              // its brim
    if (t % 2) art(set, 19, 1, ['GGG', '.T.', '.T.', '.T.'])              // hammer up
    else art(set, 18, 6, ['TTGG', '..GG'])                                // hammer down
  },
  git: (set, x, y, t) => art(set, 18, 0, (t % 4 < 2 ? ['W...W.', 'W..W..', 'WWW...', 'W.....'] : ['w...W.', 'w..W..', 'wWW...', 'w.....'])),
  installing: (set, x, y, t) => {
    art(set, 18, 6, ['TTYYTT', 'TTTTTT', 'TTTTTT'])                       // the box, at its feet
    art(set, 19, t % 4 < 2 ? 1 : 2, ['.WW.', '.WW.', 'WWWW', '.WW.'])     // the arrow, going in
  },
  deploying: (set, x, y, t) => {
    const lift = 9 - (t % 14)                                             // the rocket climbs, again and again
    art(set, 20, lift - 4, ['.R.', 'WWW', 'WbW', 'WWW', t % 2 ? 'Y.Y' : '.Y.'])
  },
  tea: (set, x, y, t) => {
    art(set, x + 14, y + 5, ['WWWG', 'WWW.'])                             // the cup, in its wing
    const s = t % 2
    set(x + 16 - s, y + 4, C.w); set(x + 15 + s, y + 3, C.w); set(x + 16 - s, y + 2, C.w)   // steam
  },
  thinking: (set, x, y, t) => {
    const n = t % 4
    if (n > 0) set(18, 4, C.W)
    if (n > 1) { set(19, 2, C.W); set(20, 2, C.W) }
    if (n > 2) art(set, 21, 0, ['WW', 'WW'])
  },
  writing: (set, x, y, t) => {
    // a speech bubble, its three dots appearing one by one
    const dots = ['WWWWWWWW', 'WKWWWWWW', 'WKWWKWWW', 'WKWWKWWK'][t % 4]
    art(set, 16, 0, ['.WWWWWWW', dots, '.WWWWWWW', '.WW.....'])
  },
  // a duckling of its own, hopping beside it
  delegating: (set, x, y, t) => art(set, 18, t % 2 ? 5 : 6, ['.UUUU.', 'UUUUUU', 'UUAAUU', '.U..U.']),
  retrying: (set, x, y, t) => art(set, 17, 0, [
    ['.WWW.', 'W...W', 'W....', '.W.W.'], ['.WWW.', 'W...W', '....W', '.W.W.'],
    ['.W.W.', 'W...W', 'W...W', '.WWW.'], ['.W.W.', '....W', 'W...W', '.WWW.'],
  ][t % 4]),
  refused: (set) => art(set, 17, 0, ['.RRRR.', 'RWWWWR', 'RRRRRR', '.RRRR.']),
  // done: sunglasses on, the logo's sparkles twinkling round it
  done: (set, x, y, t, dy, skin) => {
    if (skin !== 'hero') shades(set, x, y)
    const plus = ['.Y.', 'YYY', '.Y.']
    if (t % 2) { art(set, 0, 0, plus); set(22, 6, C.Y) } else { set(1, 1, C.Y); art(set, 20, 5, plus) }
  },
  stopped: (set, x, y, t) => {
    art(set, x + 5, y, ['DDDDDDD'])                                       // the night cap
    art(set, x + 3, y + 1, ['DDDDDDDDDDDD'])
    set(x + 15, y + 1, C.D); set(x + 15, y + 2, C.W)                      // its pompom, drooping
    const rise = t % 6 < 3 ? 0 : 1
    art(set, 19, 1 - rise, ['www', '.w.', 'www'])
  },
}

// One frame: CANVAS_H rows of CANVAS_W colours ('#RRGGBB'), null where empty.
// `who` is the agent id (or { id }): it sets the duck's phase. `skin`:
// 'duckling' (the logo's little ones) or 'hero' (sunglasses and a hoodie).
export function canvasFor(who, activity, tick, skin = 'duckling') {
  const id = typeof who === 'string' ? who : who?.id ?? ''
  const t = tick + (hash(String(id)) % 8)
  const canvas = Array.from({ length: CANVAS_H }, () => Array(CANVAS_W).fill(null))
  const set = (x, y, c) => { if (x >= 0 && x < CANVAS_W && y >= 0 && y < CANVAS_H) canvas[y][x] = c }
  const motion = MOTION[activity] ?? MOTION.working
  const [dx, dy] = motion.moves[t % motion.moves.length]
  const hero = skin === 'hero'
  const asleep = activity === 'stopped'
  const body = asleep ? DIM_YELLOW : YELLOW
  const wing = asleep ? DIM_WING : WING
  const eyesShut = asleep || t % 23 === 22
  const wave = t % 2 === 1
  const leftUp = motion.arms === 'up' || (motion.arms === 'wave' && wave)
  const rightUp = motion.arms === 'up' || motion.arms === 'right' || ((motion.arms === 'wave' || motion.arms === 'right-wave') && wave)
  const down = motion.arms === 'down'
  const lifted = motion.feet ? (t % 2 ? 4 : 10) : -1   // waddling: one foot up, then the other
  // a step aside is a whole cell: a one-pixel step puts an eye and the beak
  // in one cell, and the face breaks up
  const x = 2 + 2 * dx
  const y = 1 - dy   // at rest the duck stands on the bottom row; a hop of two loses only its tuft

  DUCK.forEach((row, ry) => {
    ;[...row].forEach((ch, rx) => {
      if (ch === '.') return
      if (ch === 'E') { if (eyesShut) set(x + rx, y + ry, body); return }
      if (ch === 'F') { if (rx !== lifted && rx !== lifted + 1) set(x + rx, y + ry, BEAK); return }
      if (ch === 'A') { set(x + rx, y + ry, hero ? body : BEAK); return }   // the hero's beak sits lower, over its hoodie
      set(x + rx, y + ry, hero && ry >= 5 ? HOODIE : body)
    })
  })
  // the wings: at its sides, raised beside its head, or hanging low
  const wingRow = (up) => (down ? 7 : up ? 4 : 6)
  set(x, y + wingRow(leftUp), wing); set(x + 1, y + wingRow(leftUp), wing)
  set(x + 14, y + wingRow(rightUp), wing); set(x + 15, y + wingRow(rightUp), wing)
  if (hero) {
    art(set, x + 6, y + 5, ['AAAA'])
    shades(set, x, y)
  }

  PROPS[activity]?.(set, x, y, t, dy, skin)
  return canvas
}

// The renderers of sprites.mjs, with the duck's colours as its body.
export const cellsOf = (canvas) => cellsWith(canvas, BODY)
export const ansiLines = (canvas) => ansiOf(canvas, BODY)
export const rasterCells = (canvas) => rasterOf(canvas, BODY)
