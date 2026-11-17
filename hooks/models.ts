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
  /** The effort its subagents think at unless the call sets one. */
  effort?: Effort
}

// How hard a model thinks: a level, or a token budget.
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | number
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

// "high" -> high, "4000" -> 4000; anything else is not an effort.
export function parseEffort(text: unknown): Effort | undefined {
  const s = String(text ?? '').trim().toLowerCase()
  if ((EFFORTS as readonly string[]).includes(s)) return s as Effort
  return /^\d+$/.test(s) && Number(s) > 0 ? Number(s) : undefined
}

// What an agent type's name may hold (the engine refuses anything else).
const NAME = /^[A-Za-z0-9_-]{1,64}$/

// The model itself, without a variant suffix: Claude Code reports a started
// subagent as `claude-opus-4-6[1m]` (its 1M-context variant) where the API
// says `claude-opus-4-6` -- the same model, measured live.
export const baseModel = (id: string) => id.replace(/\[[^\]]*\]$/, '')

export const sameModel = (a: string, b: string) => baseModel(a) === baseModel(b)

// The effort levels a model takes, from the Claude API reference (2026-10):
// none on Haiku 4.5 / Sonnet 4.5 / Claude 3, three on Opus 4.5, no xhigh on
// Opus 4.6 / Sonnet 4.6 (it arrived with Opus 4.7), all five from then on.
// Sending one a model does not take is a 400, and the subagent stops.
export function effortsFor(id: string): readonly string[] {
  const m = baseModel(id)
  if (/^claude-(3|(sonnet|haiku)-4-5|(sonnet|opus)-4($|-\d{8}|-[01]$))/.test(m)) return []
  if (/^claude-opus-4-5/.test(m)) return ['low', 'medium', 'high']
  if (/^claude-(opus|sonnet)-4-6/.test(m)) return ['low', 'medium', 'high', 'max']
  return EFFORTS
}

export const effortFits = (id: string, effort: Effort) =>
  typeof effort === 'number' ? effortsFor(id).length > 0 : effortsFor(id).includes(effort)

// What to tell the main agent when an effort does not fit a model.
export const effortsText = (id: string) => {
  const levels = effortsFor(id)
  return levels.length ? `${labelFor(id)} takes effort ${levels.join(', ')}` : `${labelFor(id)} does not take an effort`
}

// claude-opus-4-6 -> Opus 4.6; claude-haiku-4-5-20251001 -> Haiku 4.5
export function labelFor(id: string): string {
  const parts = baseModel(id).replace(/^claude-/, '').replace(/-\d{8}$/, '').split('-')
  const family = parts.shift() ?? id
  const version = parts.filter((p) => /^\d+$/.test(p)).join('.')
  const name = family.charAt(0).toUpperCase() + family.slice(1)
  return version ? `${name} ${version}` : name
}

// "opus-4-6=claude-opus-4-6, claude-opus-5, opus-5-5=claude-opus-5-5@high"
// -> entries. A bare id names itself without the `claude-` prefix; `@effort`
// sets the type's default effort. Bad or repeated entries are skipped, not
// fatal: one typo in /config must not take every model away.
export function parseModels(text: string): { models: ModelEntry[]; skipped: string[] } {
  const models: ModelEntry[] = []
  const skipped: string[] = []
  for (const raw of text.split(/[,\n]/)) {
    const item = raw.trim()
    if (!item) continue
    const eq = item.indexOf('=')
    const [spec = '', effortText] = (eq >= 0 ? item.slice(eq + 1) : item).trim().split('@')
    const id = spec.trim()
    const name = (eq >= 0 ? item.slice(0, eq) : id.replace(/^claude-/, '')).trim()
    const effort = effortText === undefined ? undefined : parseEffort(effortText)
    const effortBad = effortText !== undefined && (effort === undefined || !effortFits(id, effort))
    if (!id || !NAME.test(name) || /\s/.test(id) || models.some((m) => m.name === name) || effortBad) {
      skipped.push(item)
      continue
    }
    models.push({ name, id, label: labelFor(id), ...(effort === undefined ? {} : { effort }) })
  }
  return { models, skipped }
}
