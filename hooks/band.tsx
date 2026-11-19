// Copyright 2026 buggerlogger (https://github.com/buggerlogger)
// SPDX-License-Identifier: Apache-2.0
//
// The band above Claude Code's prompt, beside its own list of agents: one
// stage per running subagent, its character on top (Clawd or a duck: a Raster
// the ticker in register.ts repaints with $.ui.blit), its model and what it is
// doing below. Layout only: it is handed the element table, never `$`.

import type { Elements } from 'claude-code'
import { characterFor } from '../characters/index.mjs'
import { CELL_COLS, CELL_ROWS, LABEL } from '../characters/sprites.mjs'

export type Character = ReturnType<typeof characterFor>

export type BandAgent = {
  id: string
  label: string
  activity: string
}

export const STAGE_W = 18   // "Opus 5 fork xhigh" whole; the character is 12
export const rasterKey = (id: string) => `dk-${id}`

const cut = (s: string) => (s.length > STAGE_W ? `${s.slice(0, STAGE_W - 1)}…` : s)

// How many stages fit across `columns` cells (a column of space between each).
export const stagesFor = (columns: number) => Math.max(1, Math.floor((columns + 1) / (STAGE_W + 1)))

export function bandTree(t: Elements['terminal'], agents: readonly BandAgent[], tick: number, character: Character) {
  const { Box, Text, Raster } = t
  return (
    <Box flexDirection="row" columnGap={1}>
      {agents.map((a) => (
        <Box key={a.id} flexDirection="column" width={STAGE_W} alignItems="center">
          <Raster key={rasterKey(a.id)} columns={CELL_COLS} rows={CELL_ROWS} cells={character.rasterCells(character.canvasFor(a.id, a.activity, tick))} />
          <Text bold wrap="truncate-end">{cut(a.label)}</Text>
          <Text dimColor wrap="truncate-end">{cut((LABEL as Record<string, string>)[a.activity] ?? a.activity)}</Text>
        </Box>
      ))}
    </Box>
  )
}
