// Copyright 2026 buggerlogger (https://github.com/buggerlogger)
// SPDX-License-Identifier: Apache-2.0
//
// The model list from /config, as agent types. Pure: no `$`, so it is tested
// on its own.

export type ModelEntry = {
  /** The agent type's short name: `duckky-swarm:<name>`. */
  name: string
  /** The exact model id the subagent runs on. */
  id: string
  /** How a person says it: claude-opus-4-6 -> "Opus 4.6". */
  label: string
}

// What an agent type's name may hold (the engine refuses anything else).
const NAME = /^[A-Za-z0-9_-]{1,64}$/

// claude-opus-4-6 -> Opus 4.6; claude-haiku-4-5-20251001 -> Haiku 4.5
// The model itself, without a variant suffix: Claude Code reports a started
// subagent as `claude-opus-4-6[1m]` (its 1M-context variant) where the API
// says `claude-opus-4-6` -- the same model, measured live.
export const baseModel = (id: string) => id.replace(/\[[^\]]*\]$/, '')

export const sameModel = (a: string, b: string) => baseModel(a) === baseModel(b)

export function labelFor(id: string): string {
  const parts = baseModel(id).replace(/^claude-/, '').replace(/-\d{8}$/, '').split('-')
  const family = parts.shift() ?? id
  const version = parts.filter((p) => /^\d+$/.test(p)).join('.')
  const name = family.charAt(0).toUpperCase() + family.slice(1)
  return version ? `${name} ${version}` : name
}

// "opus-4-6=claude-opus-4-6, claude-opus-5" -> entries. A bare id names itself
// without the `claude-` prefix. Bad or repeated names are skipped, not fatal:
// one typo in /config must not take every model away.
export function parseModels(text: string): { models: ModelEntry[]; skipped: string[] } {
  const models: ModelEntry[] = []
  const skipped: string[] = []
  for (const raw of text.split(/[,\n]/)) {
    const item = raw.trim()
    if (!item) continue
    const eq = item.indexOf('=')
    const id = (eq >= 0 ? item.slice(eq + 1) : item).trim()
    const name = (eq >= 0 ? item.slice(0, eq) : id.replace(/^claude-/, '')).trim()
    if (!id || !NAME.test(name) || /\s/.test(id) || models.some((m) => m.name === name)) {
      skipped.push(item)
      continue
    }
    models.push({ name, id, label: labelFor(id) })
  }
  return { models, skipped }
}
