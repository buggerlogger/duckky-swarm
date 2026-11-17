// Copyright 2026 buggerlogger (https://github.com/buggerlogger)
// SPDX-License-Identifier: Apache-2.0
//
// Who acts out the subagents' work: the Character setting in /config
// ("Clawd (recommended)" or "Duckky Ducks"), read by the band (hooks/) and
// the swarm window (viewer/, from DUCKKY_CHARACTER). Duckky Ducks are the
// project's own mascot, as the logo's ducklings. Both draw on the same
// canvas, so nothing else changes.

import * as clawd from './sprites.mjs'
import * as ducks from './ducks.mjs'

const CLAWD = {
  name: 'Clawd',
  canvasFor: clawd.canvasFor,
  ansiLines: clawd.ansiLines,
  rasterCells: clawd.rasterCells,
}

const DUCKS = {
  name: 'Duckky Ducks',
  canvasFor: (who, activity, tick) => ducks.canvasFor(who, activity, tick, 'duckling'),
  ansiLines: ducks.ansiLines,
  rasterCells: ducks.rasterCells,
}

// The setting's value, or the window's flag ("ducks"), to a character;
// anything else is Clawd, the default.
export const characterFor = (name) => (/duck/i.test(String(name ?? '')) ? DUCKS : CLAWD)
