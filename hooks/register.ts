// Copyright 2026 buggerlogger (https://github.com/buggerlogger)
// SPDX-License-Identifier: Apache-2.0
//
// Duckky Swarm: subagents on the exact model you name.
//
// The built-in Agent tool's `model` takes four aliases (sonnet, opus, haiku,
// fable), so "use Opus 4.6" cannot be said there and Claude declines. An agent
// TYPE carries any model id. Each model in /config becomes one,
// `duckky-swarm:<name>`, whose description tells Claude when to pick it.
//
// A built-in fork runs on the parent's model (the engine ignores `model` for
// forks). With Fork on another model = context, each model also gets
// `duckky-swarm:<name>-fork`: its Agent call is made Claude Code's own fork
// (the whole conversation), and the fork's requests go to that model.
//
// Every subagent is recorded with three models: the one asked for, the one
// Claude Code resolved when it started (`agent.spawn`), and the one the API
// reported answering (`turn.complete`'s usage). /duckky shows them, and the
// resume_subagent tool continues one, from this session or an earlier one, on
// the same model with its old transcript.

import type { EngineInterface, Register, RenderElement } from 'claude-code'
import { INDEX_DIR, listing, matchSessions, openLine, parseEntries } from '../bin/sessions.mjs'
import { characterFor } from '../characters/index.mjs'
import { activityOf, shownActivity } from '../viewer/model.mjs'
import { bandTree, rasterKey, stagesFor, type BandAgent } from './band.tsx'
import { hookFailed, refusalBrief, resumedReport, subagentReport } from './brief.ts'
import { asSession, diverged, forkContextRef, resumeCommand, sessionIdFor, withForkContext } from './session-copy.ts'
import { newWorkspace, workspaceFiles, workspaceKey, workspaceRules, type Workspace } from './workspace.ts'
import { text, useMessages } from './messages.ts'
import { newestWithin, parseTranscript, refusalAt, refusalScene, sessionLines, transcriptLines } from './history.ts'
import { launchArgv, subagentsDir } from './launcher.ts'
import { EFFORTS, effortFits, effortsFor, effortsText, labelFor, parseEffort, parseModels, sameModel, type Effort, type ModelEntry } from './models.ts'
import { allAgents, forgetAgent, retain, saveAgent, type AgentRecord } from './records.ts'

const PLUGIN = 'duckky-swarm'
// characters of history a context fork or a resumed subagent is given (~30k tokens)
const FORK_BUDGET = 120_000
const RESUME_BUDGET = 120_000

// The words of every text sent to Claude are in messages.json (hooks/messages.ts).
const descriptionFor = (m: ModelEntry) => {
  const levels = effortsFor(m.id)
  const effort = levels.length
    ? text('agentType', 'effort', { levels: levels.join(', '), whenLeftOut: m.effort === undefined ? '' : text('agentType', 'whenLeftOut', { effort: m.effort }) })
    : text('agentType', 'noEffort', { label: m.label })
  return text('agentType', 'description', { label: m.label, id: m.id, name: m.name, effort })
}

const forkDescriptionFor = (m: ModelEntry) => text('agentType', 'forkDescription', { label: m.label, id: m.id, name: m.name })

// An agent type's prompt REPLACES the session's system prompt, so it says
// everything a subagent needs on its own.
const promptFor = (m: ModelEntry) => text('agentType', 'prompt', { label: m.label, id: m.id })

const ICON: Record<AgentRecord['status'], string> = { running: '●', done: '✓', aborted: '■', error: '✗', refusal: '✗' }

// Module state: a reload starts it over, as it does the session's hooks.
// ⛔ It lives up here, not inside register: the engine refuses a module that
// passes `$` to anything but a function declared at the top of the file.
const live = new Map<string, AgentRecord>()   // this session's, by agent id
// resumed agent id -> the subagent it resumed: its answer goes to the main
// agent as a message when it ends (resume_subagent itself returns at once)
const delivering = new Map<string, { from: string; label: string; workspace?: string }>()
let models: ModelEntry[] = []
let keep = true
let sessionId = ''
let cwd = ''
let tick = 0                  // the band's animation frame
let bandId: string | null = null   // the band's requestId while it shows stages
let drawn = ''                // the band's stages as last laid out: a change re-lays it
let character = characterFor('Clawd')   // who acts out the work: the Character setting
const byToolUse = new Map<string, string>()    // the Agent call's tool_use_id -> the agent it started
// A duckky fork on its way: its Agent call's tool_use_id -> the model it forks
// onto, and its description (its first request can come before agent.spawn
// has its id; turn.step then finds it by its row)
const forkTo = new Map<string, { m: ModelEntry; description: string }>()
const noFork = new Set<string>()   // loops Claude Code would not fork in ('' is main): a text copy there
const briefs = new Map<string, string>()       // refused agent id -> its refusal report, until delivered
const effortFor = new Map<string, Effort>()    // agent id -> the effort the main agent set for it
// A resume with an effort: matched to its agent at turn.start by its prompt,
// which comes before its first model request (the spawn's id can come after).
const pendingEffort = new Map<string, Effort>()
const promptKey = (text: string) => `${text.length}:${text.slice(0, 400)}`
let workspacesOn = true       // the Workspace folders setting
// Subagent reports setting: which finished subagents report
let reports: 'background' | 'all' | 'off' = 'background'
const reportsFor = (setting: unknown): typeof reports =>
  /every/i.test(String(setting ?? '')) ? 'all' : /off/i.test(String(setting ?? '')) ? 'off' : 'background'
// Reports go to setting: the person's prompt box (they send it: their own
// message, which they can rewind to and edit) or straight into the chat.
// ⛔ Claude Code lets a person rewind only to what a person sent: its rewind
// list takes a message whose origin is human (Sg: kind "human") and whose
// turnOrigin is human or sdk, and a plugin's $.prompt.submit is stored
// origin plugin, promptSource and turnOrigin "system", asUser or not (read
// in its own code, and in the user's transcript after a rewind failed).
// ⛔⛔ And a plugin's message WAITS: Claude Code queues it "later" (it runs
// once the main agent is idle; no option changes that) and an interrupt
// deletes it (measured in the user's session: queued 14:32:12, delivered
// 60 s later after the turn; queued 14:38:29, "queue remove" at 14:47:19 on
// Esc, never delivered). So by default a report goes to Claude AT ONCE: on
// the main agent's next tool result while it works (`context`, read
// mid-turn), sent at once while it is idle, and sent the moment a turn ends
// (or is stopped) with reports still undelivered.
let reportsTo: 'now' | 'box' = 'now'
const reportsToFor = (setting: unknown): typeof reportsTo => (/box/i.test(String(setting ?? '')) ? 'box' : 'now')
const pendingReports: string[] = []   // waiting for the person's prompt box to be empty
const forClaude: string[] = []        // for the main agent's next tool result
let mainTurn = false                   // the main agent is in a turn
let flushAt = 0                        // when to send what a stopped turn left (the clock)
// One file per session copy, in every project, in Claude Code's own folder
// (INDEX_DIR, bin/sessions.mjs): what /duckky sessions and `duckky` list.
export type SessionEntry = {
  sessionId: string; name: string; cwd: string; file: string; model: string; task: string
  agentId: string; workspace?: string; updated: string
}
// A subagent that carries on as a new one keeps its workspace: resume_subagent
// writes the workspace into the prompt and leaves it here, by that prompt, for
// the spawn hook, which then makes no new one and adds nothing to the prompt.
const pendingWorkspace = new Map<string, Workspace>()

// A finished agent stays on the band this long, jumping, before it leaves.
const SHOW_DONE_MS = 8000
const TICK_MS = 160

async function write($: EngineInterface, r: AgentRecord) {
  live.set(r.id, r)
  if (keep) await saveAgent($, r)
}

// Who stands on the band: running agents, and ones that finished a moment ago.
function onStage(now: number): BandAgent[] {
  return [...live.values()]
    .filter((r) => r.status === 'running' || (r.endedAt !== undefined && now - r.endedAt < SHOW_DONE_MS))
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((r) => ({
      id: r.id,
      label: `${r.label}${r.fork ? ' fork' : ''}${r.effort === undefined ? '' : ` ${r.effort}`}`,
      activity: r.status === 'running' ? shownActivity(r.activity ?? 'starting', r.activityAt, now)
        : r.status === 'done' ? 'done' : r.status === 'refusal' ? 'refused' : 'stopped',
    }))
}

const layout = (stage: readonly BandAgent[]) => stage.map((a) => `${a.id}:${a.activity}`).join()

// One animation frame for every character on the band. Started once, from
// session.start (timers outlive a dispatch only there); with nothing on the
// band it returns at once. A scene that changed with time alone (tea after a
// long command, a test result fading) re-lays the band for its label.
async function animate($: EngineInterface) {
  if (!bandId) return
  const stage = onStage(Date.now())
  if (layout(stage) !== drawn) { restage($); return }
  tick += 1
  for (const a of stage) {
    await $.ui.blit({ requestId: bandId, key: rasterKey(a.id), cells: character.rasterCells(character.canvasFor(a.id, a.activity, tick)) }).catch(() => undefined)
  }
}

// Who is on the band, or what one is doing, changed: draw it again.
function restage($: EngineInterface) {
  $.ui.invalidate('ui.render')
}

// A refused response of a subagent: counted on its record, and its character
// holds up the red sign.
function noteRefusal($: EngineInterface, agentId: string, count: number) {
  const r = live.get(agentId)
  if (!r) return
  r.refusals = count
  // the red sign, not "retrying": the plugin no longer asks again, Claude Code
  // does (beneath it); a step after it moves the scene on
  setActivity($, r, 'refused')
}

function setActivity($: EngineInterface, r: AgentRecord, activity: string) {
  if (r.activity === activity) return
  r.activity = activity
  r.activityAt = Date.now()
  restage($)
}

function showRunning($: EngineInterface) {
  const running = [...live.values()].filter((r) => r.status === 'running')
  $.ui.status(running.length ? `duckky: ${running.length} running · ${running.map((r) => r.label).join(', ')}` : undefined)
}

async function addType($: EngineInterface, name: string, description: string, m: ModelEntry) {
  await $.agent
    .register({ name, description, prompt: promptFor(m), model: m.id, ...(m.effort === undefined ? {} : { effort: m.effort }) })
    .catch((err: Error) => $.ui.log(`${PLUGIN}: could not add the ${name} agent type: ${err.message}`))
}

// Every record this plugin knows, newest first: the kept ones and this session's.
async function known($: EngineInterface): Promise<AgentRecord[]> {
  const rows = new Map<string, AgentRecord>()
  if (keep) for (const r of await allAgents($)) rows.set(r.id, r)
  for (const r of live.values()) rows.set(r.id, r)
  return [...rows.values()].sort((a, b) => b.startedAt - a.startedAt)
}

// "a2f57463" (an id or its first characters, as /duckky shows it), or words
// from its task; the newest match wins.
// Every subagent a query names: its id, every id the prefix starts, or every
// task holding all the words. A subagent that carried on as a new one is one
// lineage, not two: the generation it resumed is dropped, the newest kept.
export function findMatches(rows: readonly AgentRecord[], query: string): AgentRecord[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const exact = rows.find((r) => r.id.toLowerCase() === q)
  if (exact) return [exact]
  const byPrefix = q.length >= 4 ? rows.filter((r) => r.id.toLowerCase().startsWith(q)) : []
  const words = q.split(/\s+/)
  const hits = byPrefix.length ? byPrefix : rows.filter((r) => words.every((w) => r.description.toLowerCase().includes(w)))
  const superseded = new Set(hits.map((r) => r.resumedFrom).filter(Boolean))
  return hits.filter((r) => !superseded.has(r.id))
}

// The one subagent a query names; none when it names several: a guess could
// resume the wrong subagent, so the caller lists them (`ambiguous`).
export function findAgent(rows: readonly AgentRecord[], query: string): AgentRecord | undefined {
  const m = findMatches(rows, query)
  return m.length === 1 ? m[0] : undefined
}

const ambiguous = (rows: readonly AgentRecord[], query: string) => {
  const m = findMatches(rows, query)
  return m.length > 1 ? text('resumeTool', 'ambiguous', { query, list: m.slice(0, 8).map((r) => `${r.id.slice(0, 8)} "${r.description}"`).join(', ') }) : ''
}

// Claude Code's own folder: CLAUDE_CONFIG_DIR, else ~/.claude.
async function configDir($: EngineInterface): Promise<string> {
  return (await $.env.get('CLAUDE_CONFIG_DIR')) || `${(await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))}/.claude`
}

// A subagent's transcript: where SubagentStop said it was, else where Claude
// Code keeps one.
async function readTranscript($: EngineInterface, r: AgentRecord): Promise<string | null> {
  const derived = r.cwd && r.sessionId ? `${subagentsDir(await configDir($), r.cwd, r.sessionId)}/agent-${r.id}.jsonl` : ''
  for (const path of [r.transcript, derived]) {
    if (!path) continue
    let jsonl: string
    try { jsonl = String(await $.fs.read(path)) } catch { continue }   // not there: try the next
    // a real fork's file only points at the conversation it inherited: the
    // copy, a resume and a refusal report each get it whole
    const ref = forkContextRef(jsonl)
    if (!ref || !r.cwd) return jsonl
    const parent = `${await configDir($)}/projects/${r.cwd.replace(/[^A-Za-z0-9]/g, '-')}/${ref.parentSessionId}.jsonl`
    return withForkContext(jsonl, await $.fs.read(parent).then((t) => String(t), () => ''))
  }
  return null
}

// A subagent the store does not know (a cleared store, keepAgents off):
// found in Claude Code's own folders for this project, newest sessions
// first, and rebuilt from its meta file and transcript. An id or id prefix
// is matched on file names alone; words from its task read the meta files.
async function findOnDisk($: EngineInterface, query: string): Promise<AgentRecord | undefined> {
  const q = query.trim().toLowerCase()
  if (!q || !cwd) return undefined
  const project = `${await configDir($)}/projects/${cwd.replace(/[^A-Za-z0-9]/g, '-')}`
  const sessions = (await $.fs.list(project).catch(() => []))
    .filter((s) => s.kind === 'dir').sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 50)
  const metas: { dir: string; session: string; name: string; at: number }[] = []
  for (const s of sessions) {
    const dir = `${project}/${s.name}/subagents`
    for (const f of await $.fs.list(dir).catch(() => [])) {
      if (f.kind === 'file' && /^agent-[A-Za-z0-9]+\.meta\.json$/.test(f.name)) metas.push({ dir, session: s.name, name: f.name, at: f.mtimeMs })
    }
  }
  const idOf = (name: string) => name.slice('agent-'.length, -'.meta.json'.length)
  const words = q.split(/\s+/)
  let hit = q.length >= 4 ? metas.find((m) => idOf(m.name).toLowerCase().startsWith(q)) : undefined
  let meta: { agentType?: string; description?: string; finished?: boolean; isFork?: boolean } = {}
  const readMeta = async (m: (typeof metas)[number]) => { try { return JSON.parse(String(await $.fs.read(`${m.dir}/${m.name}`))) } catch { return {} } }
  if (hit) meta = await readMeta(hit)
  else {
    for (const m of metas.slice(0, 200)) {
      const read = await readMeta(m)
      if (words.every((w) => String(read.description ?? '').toLowerCase().includes(w))) { hit = m; meta = read; break }
    }
  }
  if (!hit) return undefined
  const id = idOf(hit.name)
  const transcript = `${hit.dir}/agent-${id}.jsonl`
  const jsonl = String(await $.fs.read(transcript).catch(() => ''))
  // the model it started on: its first reply's. Not the last "model" in the
  // file: a refusal can move replies to a fallback model, and Claude Code's
  // request records name other models too (its advisor).
  const firstReply = jsonl.split('\n').map((l) => { try { return JSON.parse(l) } catch { return null } })
    .find((x) => x?.type === 'assistant' && typeof x.message?.model === 'string')
  const model: string = firstReply?.message.model ?? ''
  return {
    id, type: meta.agentType ?? 'general-purpose', label: model ? labelFor(model) : 'subagent', model, requested: null,
    answeredBy: model || null, description: meta.description ?? '', fork: !!meta.isFork, sessionId: hit.session, cwd,
    startedAt: hit.at, endedAt: hit.at, resumes: 0, outputTokens: 0, transcript,
    status: refusalAt(parseTranscript(jsonl)) >= 0 ? 'refusal' : meta.finished ? 'done' : 'aborted',
  }
}

// /duckky: the swarm window for this session's subagents (viewer/duckky-view.mjs).
async function openSwarm($: EngineInterface): Promise<string> {
  const dir = subagentsDir(await configDir($), cwd, sessionId)
  const viewer = `${$.plugin.root}/viewer/duckky-view.mjs`
  const byHand = `node "${viewer}" "${dir}"${character.name === 'Clawd' ? '' : ' --character ducks'}`
  const node = await $.process.run(['node', '--version'], { timeoutMs: 10_000 }).catch(() => null)
  if (!node || node.exitCode !== 0) return `The swarm window runs on Node.js, which was not found on PATH. With Node installed: ${byHand}`
  if ((await $.env.get('OS')) !== 'Windows_NT') return `Open a terminal and run: ${byHand}`
  const r = await $.process
    .run([...launchArgv], { env: { DUCKKY_VIEWER: viewer, DUCKKY_DIR: dir, DUCKKY_CHARACTER: character.name }, timeoutMs: 20_000 })
    .catch((err: Error) => ({ exitCode: 1, stderr: err.message }))
  if (r.exitCode !== 0) return `Could not open the swarm window (${r.stderr.replace(/#< CLIXML[\s\S]*/, '').trim().slice(0, 200) || `exit ${r.exitCode}`}). Run it yourself: ${byHand}`
  return 'Opened the Duckky Swarm window: one pane per subagent of this session, live. Press q in it to close.'
}

// A duckky fork whose request came before agent.spawn knew its id: its row in
// the agent list (a fork) matched to its Agent call by its description.
async function forkRoute($: EngineInterface, agentId: string): Promise<string | undefined> {
  const row = (await $.agent.list().catch(() => [])).find((a) => a.id === agentId)
  if (row?.type !== 'fork') return undefined
  return [...forkTo.values()].find((f) => f.description === row.description)?.m.id
}

async function forkPrompt($: EngineInterface, m: ModelEntry, task: string): Promise<string> {
  const history = newestWithin(sessionLines(await $.session.messages()), FORK_BUDGET)
  return text('fork', 'prompt', { label: m.label, id: m.id, conversation: history, task })
}

// The model a subagent was started for: its duckky type's, else what it was
// asked for or resolved to. Never the model that last answered: a refusal can
// move a reply to a fallback model (an opus-5 fork was answered by opus-4-8),
// and a resume there would leave the model the person chose.
function startedModel(r: AgentRecord): string {
  const t = models.find((m) => r.type === `${PLUGIN}:${m.name}` || r.type === `${PLUGIN}:${m.name}-fork`)
  return t?.id ?? r.requested ?? r.model
}

// The subagent's transcript as a session `claude --resume` opens, beside the
// project's own sessions (session-copy.ts). Written again each time it stops,
// unless the person has worked in the copy: then the copy is theirs.
async function copyAsSession($: EngineInterface, r: AgentRecord): Promise<string | null> {
  const jsonl = await readTranscript($, r)
  if (!jsonl || !r.cwd) return null
  // one copy per workspace: a subagent that carried on as a new one writes
  // over its first generation's, titled with the folder's name
  const sid = sessionIdFor(r.workspaceKey ?? r.id)
  const path = `${await configDir($)}/projects/${r.cwd.replace(/[^A-Za-z0-9]/g, '-')}/${sid}.jsonl`
  const before = await $.fs.read(path).then((t) => String(t), () => null)
  const title = r.workspaceName ?? `${PLUGIN}: ${r.description}`
  if (before === null || !diverged(before, jsonl)) await $.fs.write(path, asSession(jsonl, sid, title))
  if (r.sessionCopy !== sid) { r.sessionCopy = sid; await write($, r) }
  // the index every project's copies are listed from (/duckky sessions and
  // the `duckky` command): one file per copy, so two sessions never race
  const entry: SessionEntry = {
    sessionId: sid, name: title, cwd: r.cwd, file: path, model: startedModel(r), task: r.description,
    agentId: r.id, workspace: r.workspace, updated: new Date().toISOString(),
  }
  await $.fs.write(`${await configDir($)}/${INDEX_DIR}/${sid}.json`, `${JSON.stringify(entry, null, 2)}\n`).catch(() => undefined)
  return sid
}

const isDuckky = (r: AgentRecord) => models.some((m) => r.type === `${PLUGIN}:${m.name}` || r.type === `${PLUGIN}:${m.name}-fork`) || !!r.workspace

// A report for Claude, never left waiting (the default): while the main agent
// works, on its next tool result; while it is idle, sent now. Or, chosen in
// /config, into the person's prompt box to edit and send (their own message,
// which they can rewind to).
async function deliver($: EngineInterface, report: string) {
  if (reportsTo === 'box') { pendingReports.push(report); await fillBox($); return }
  if (mainTurn) { forClaude.push(report); return }
  await sendNow($, [report])
}

async function sendNow($: EngineInterface, reports: string[]) {
  if (!reports.length) return
  await $.prompt.submit({ text: reports.join('\n\n---\n\n') }).catch(() => undefined)
  $.ui.toast(`${PLUGIN}: ${reports.length === 1 ? 'a subagent report' : `${reports.length} subagent reports`} sent to Claude`)
}

// What a stopped turn left: sent a moment after it, once Claude Code has
// cleared its own queue (an interrupt empties it; something sent while it
// does would go too). Driven by the clock from session.start.
async function flushLeft($: EngineInterface) {
  if (!flushAt || Date.now() < flushAt || mainTurn) return
  flushAt = 0
  await sendNow($, forClaude.splice(0))
}

// The waiting reports into the prompt box, together, once it is empty: never
// over a draft the person is writing (the clock tries again). Where no box is
// drawn (claude -p) they go into the chat instead.
async function fillBox($: EngineInterface) {
  if (!pendingReports.length) return
  const box = await $.prompt.read().catch(() => null)
  if (box && box.text.trim()) return
  const text = pendingReports.join('\n\n---\n\n')
  const filled = await $.prompt.fill({ text, mode: 'replace' }).catch(() => null)
  if (filled?.isFilled) {
    const n = pendingReports.length
    pendingReports.length = 0
    $.ui.toast(`${PLUGIN}: ${n === 1 ? 'a subagent report is' : `${n} subagent reports are`} in your prompt box. Edit if you like, then press Enter.`)
    return
  }
  if (filled?.refusal === 'dialog') return   // a dialog holds the keys: later
  pendingReports.length = 0
  await $.prompt.submit({ text }).catch(() => undefined)
}

const workspaceOf = (r: AgentRecord): Workspace | undefined =>
  r.workspace && r.workspaceName && r.workspaceKey ? { folder: r.workspace, name: r.workspaceName, key: r.workspaceKey } : undefined

// A workspace's files, each written only where it is missing.
async function makeWorkspace($: EngineInterface, ws: Workspace, task: string, model: string) {
  const files = workspaceFiles(cwd, ws, task, model, new Date().toISOString().replace('T', ' ').slice(0, 16))
  for (const [path, body] of Object.entries(files)) {
    const there = await $.fs.read(path).then(() => true, () => false)
    if (!there) await $.fs.write(path, body)
  }
}

// A stopped subagent's copy, written again a few times after: Claude Code puts
// its last reply in the transcript just AFTER its stop (measured live: a copy
// made at the stop held the question and not the answer, so the session that
// opened it said it had not replied), and a long reply lands later still.
// Driven by the clock from session.start.
const copyDue = new Map<string, number[]>()   // agent id -> when to write its copy again
export const COPY_AGAIN_MS = [3_000, 15_000, 60_000]
async function copyAgain($: EngineInterface) {
  const now = Date.now()
  for (const [id, times] of copyDue) {
    if ((times[0] ?? Infinity) > now) continue
    const left = times.filter((t) => t > now)
    if (left.length) copyDue.set(id, left)
    else copyDue.delete(id)
    const r = live.get(id)
    if (r) await copyAsSession($, r).catch(() => null)
  }
}

// What opens the subagent as a main session, for the person or the main agent.
// by its title (the workspace folder's name) where it has one: what the person
// sees in the project, and what --resume matches exactly
const openCommand = (r: AgentRecord) => (r.sessionCopy ? resumeCommand(r.workspaceName ?? r.sessionCopy, startedModel(r)) : '')
const openText = (r: AgentRecord) => (r.sessionCopy ? text('resumeTool', 'open', { cwd: r.cwd, command: openCommand(r) }) : '')

// The texts sent to Claude, from messages.json at the plugin's root, and the
// person's own over it (~/.claude/duckky-swarm/messages.json: a plugin update
// replaces the plugin's folder, never that one): the built-in ones where
// neither has a text, and each mistake told once.
export const OWN_MESSAGES = 'duckky-swarm/messages.json'
async function loadMessages($: EngineInterface) {
  const read = (path: string) => $.fs.read(path).then((t) => String(t), () => null)
  const problems = useMessages(await read(`${$.plugin.root}/messages.json`), await read(`${await configDir($)}/${OWN_MESSAGES}`))
  for (const p of problems) $.ui.log(`${PLUGIN}: ${p}`)
  if (problems.length) $.ui.toast(`${PLUGIN}: messages.json: ${problems[0]}${problems.length > 1 ? ` (and ${problems.length - 1} more, in the log)` : ''}`)
}

export const register: Register = (on, options) => {
  const parsed = parseModels(String(options.models ?? ''))
  models = parsed.models
  const contextForks = options.forkMode !== 'true'
  keep = options.keepAgents !== false
  workspacesOn = options.workspaces !== false
  reports = reportsFor(options.reports)
  reportsTo = reportsToFor(options.reportsTo)
  pendingReports.length = 0
  forClaude.length = 0
  mainTurn = false
  flushAt = 0
  character = characterFor(options.character)
  live.clear()
  forkTo.clear()
  noFork.clear()

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    cwd = e.cwd
    sessionId = await $.session.id().catch(() => '')
    await loadMessages($)   // before anything below sends a text
    $.clock.every(TICK_MS, () => { void animate($) })
    $.clock.every(1000, () => { void copyAgain($); void fillBox($); void flushLeft($) })
    // $.agent.register rejects until the session is bound: after next(e)
    for (const m of models) {
      await addType($, m.name, descriptionFor(m), m)
      if (contextForks) await addType($, `${m.name}-fork`, forkDescriptionFor(m), m)
    }
    if (parsed.skipped.length) $.ui.log(`${PLUGIN}: /config models skipped ${parsed.skipped.map((s) => `"${s}"`).join(', ')}`)
    await $.tool.register({
      name: 'resume_subagent',
      description: text('resumeTool', 'description'),
      inputSchema: {
        type: 'object',
        properties: {
          agent: { type: 'string', description: text('resumeTool', 'agent') },
          message: { type: 'string', description: text('resumeTool', 'message') },
          effort: { type: 'string', description: text('resumeTool', 'effort', { levels: EFFORTS.join(', ') }) },
        },
        required: ['agent', 'message'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'set_subagent_effort',
      description: text('effortTool', 'description', { levels: EFFORTS.join(', ') }),
      inputSchema: {
        type: 'object',
        properties: {
          agent: { type: 'string', description: text('effortTool', 'agent') },
          effort: { type: 'string', description: text('effortTool', 'effort', { levels: EFFORTS.join(', ') }) },
        },
        required: ['agent', 'effort'],
      },
      isDeferred: false,
    })
    await $.command.register({
      name: 'duckky',
      description: 'Duckky Swarm: open the live window of this session\'s subagents (list: the model each really ran on)',
      argumentHint: '[list | open <id> | sessions [words]]',
    })
    if (keep) {
      const kept = await allAgents($)
      const stay = new Set(retain(kept, Date.now()).map((r) => r.id))
      for (const r of kept) if (!stay.has(r.id)) await forgetAgent($, r.id)
    }
    return started
  })

  on('agent.spawn', async ($, e, next) => {
    // A duckky fork is Claude Code's OWN fork (the Agent hook below made its
    // call subagent_type "fork": the whole conversation, every tool result
    // included) whose requests go to the model it forks onto (turn.step,
    // `routeModel`). ⛔ It used to be a duckky subagent handed a TEXT copy cut
    // to 120k characters, tool results to 1,500 each: measured, it could not
    // tell a secret the parent had read at character 5,086 of a file ("its
    // inherited Read result was cut off"). The text copy is left for a loop
    // Claude Code would not fork in, where the duckky type itself spawns.
    const target = e.fork && !e.resume ? forkTo.get(e.tool_use_id) : undefined
    const copyOn = contextForks && !e.resume ? models.find((m) => e.subagentType === `${PLUGIN}:${m.name}-fork`) : undefined
    const ours = target?.m ?? models.find((m) => e.subagentType === `${PLUGIN}:${m.name}` || e.subagentType === `${PLUGIN}:${m.name}-fork`)
    let prompt = copyOn ? await forkPrompt($, copyOn, e.prompt) : e.prompt
    // A duckky subagent's workspace, made BEFORE it starts: its task names the
    // folder, and Claude Code gives it an id only once it has started (so the
    // key is the plugin's own). One that carries on as a new subagent brings
    // its workspace, its prompt already saying so.
    let ws: Workspace | undefined
    const carried = pendingWorkspace.get(promptKey(e.prompt))
    if (carried) { pendingWorkspace.delete(promptKey(e.prompt)); ws = carried }
    else if (ours && workspacesOn && !e.resume && cwd) {
      ws = newWorkspace(cwd, ours.id, workspaceKey(`${e.tool_use_id}:${Date.now()}:${Math.random()}`), e.description)
      prompt = `${prompt}\n${workspaceRules(ws)}`
    }
    if (ws) await makeWorkspace($, ws, e.description, ours?.id ?? e.model ?? '').catch(() => undefined)
    const r = await next(prompt === e.prompt ? e : { ...e, prompt })
    if (r.deny !== undefined || !r.agentId) { forkTo.delete(e.tool_use_id); return r }
    // where a fork's requests go: the model its duckky type names, or the
    // model the main agent passed (Claude Code ignores a fork's `model`)
    const routeModel = target ? target.m.id : e.fork && e.model ? e.model : undefined
    const before = live.get(r.agentId)   // a resume within this session
    await write($, {
      ...before,
      id: r.agentId,
      type: target ? `${PLUGIN}:${target.m.name}-fork` : e.subagentType,
      label: ours?.label ?? labelFor(routeModel ?? r.model),
      model: routeModel ?? r.model,
      requested: ours?.id ?? e.model ?? null,
      answeredBy: before?.answeredBy ?? null,
      description: e.description,
      fork: e.fork || !!copyOn,
      sessionId,
      cwd,
      startedAt: before?.startedAt ?? Date.now(),
      status: 'running',
      resumes: (before?.resumes ?? 0) + (e.resume ? 1 : 0),
      outputTokens: before?.outputTokens ?? 0,
      activity: 'starting',
      background: e.background,
      ...(ws ? { workspace: ws.folder, workspaceName: ws.name, workspaceKey: ws.key } : {}),
      ...(routeModel ? { routeModel } : before?.routeModel ? { routeModel: before.routeModel } : {}),
    })
    byToolUse.set(e.tool_use_id, r.agentId)
    forkTo.delete(e.tool_use_id)   // its record routes it from here
    restage($)
    if (ours && !routeModel && !sameModel(r.model, ours.id)) $.ui.toast(`${PLUGIN}: asked for ${ours.id}, Claude Code started ${r.model}`)
    showRunning($)
    return r
  }).catch(($, e, next) => next(e))

  // A subagent's own tool calls (they carry its agentId): what its Clawd acts
  // out, by the tool and, for a shell command, by its words (npm test is a
  // test). After it: a test shows pass or fail, anything else back to
  // thinking. It only watches; the call and its result go on unchanged.
  on('tool.call', async ($, e, next) => {
    // the main agent's tool call: subagent reports go to Claude on its result,
    // read at once, mid-turn (a message would wait for the turn to end)
    if (!e.agentId) {
      const out = await next(e)
      if (!forClaude.length || out.deny !== undefined) return out
      const reports = forClaude.splice(0)
      $.ui.toast(`${PLUGIN}: ${reports.length === 1 ? 'a subagent report' : `${reports.length} subagent reports`} went to Claude`)
      return { ...out, context: [...(out.context ?? []), ...reports] }
    }
    const r = live.get(e.agentId)
    if (!r) return next(e)
    const doing = activityOf(String(e.tool), e as unknown as Record<string, unknown>)
    setActivity($, r, doing)
    const out = await next(e)
    const failed = out.deny !== undefined || out.isError === true
    setActivity($, r, doing === 'testing' ? (failed ? 'fail' : 'pass') : 'thinking')
    return out
  }).catch(($, e, next) => next(e))

  // The band above the prompt: a stage per running subagent. Whatever else
  // the engine or another plugin draws there stays, under it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.surface !== 'terminal' || e.props.hasSurvey) { bandId = null; return below }
    const stage = onStage(Date.now()).slice(0, stagesFor(e.props.bodyColumns))
    if (!stage.length) { bandId = null; drawn = ''; return below }
    bandId = e.requestId
    drawn = layout(onStage(Date.now()))
    const { Box } = $.ui.resolve(e)
    // h() of a Box is always an element; its type allows null for function tags
    return h(Box, { flexDirection: 'column' }, bandTree($.ui.resolve(e), stage, tick, character), below) as RenderElement
  })

  // A resume_subagent with an effort: its agent's first turn starts with the
  // prompt we spawned it with, before its first model request.
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) mainTurn = true   // the main agent works: a report rides its next tool result
    const effort = e.agentId ? pendingEffort.get(promptKey(e.text)) : undefined
    if (e.agentId && effort !== undefined) {
      pendingEffort.delete(promptKey(e.text))
      effortFor.set(e.agentId, effort)
    }
    return next(e)
  })

  // Each model request of a subagent: its effort, the one the main agent set
  // for it (set_subagent_effort, or a resume's), applied here and recorded as
  // sent. The reply streams straight through, so the agent's view shows it as
  // it comes; the main loop's steps pass by untouched.
  // ⛔ Never hold a reply back. This hook used to hold every reply until it
  // ended, to ask again unchanged when it was refused: the agent's view then
  // showed nothing while a reply ran (50 s live, "not showing the chat"), and
  // the retry never even ran, as Claude Code handles a classifier refusal
  // BENEATH this hook (it withholds the reply, asks again with a note, and
  // can fall back to another model: an opus-5 fork was answered by opus-4-8).
  on('turn.step', async function* ($, e, next) {
    const agentId = e.agentId
    if (!agentId) return yield* next(e)
    const want = effortFor.get(agentId)
    // never add an effort to a request Claude Code sent without one: that
    // model takes none, and a request with one would be refused
    const r0 = live.get(agentId)
    // a duckky fork: its requests go to the model it forks onto, with the
    // parent's whole conversation it inherited (its first can come before
    // agent.spawn has its id: then its row says which fork it is)
    const route = r0 ? r0.routeModel : forkTo.size ? await forkRoute($, agentId) : undefined
    const routed = route ? { ...e, model: route } : e
    const ask = want === undefined || e.effort === undefined ? routed : { ...routed, effort: want }
    if (r0 && ask.effort !== undefined && r0.effort !== ask.effort) { r0.effort = ask.effort; restage($) }
    if (r0?.activity === 'starting') setActivity($, r0, 'thinking')   // its first request is out: it thinks
    const result = yield* next(ask)
    if (result?.stopReason === 'refusal') noteRefusal($, agentId, (r0?.refusals ?? 0) + 1)
    return result
  }).catch(async function* ($, e, next) { return yield* next(e) })

  // The main agent's Agent call: its result says where the subagent's
  // workspace is, so the main agent reads it; and when the subagent it waited
  // on stopped on a refusal, where the subagent stood and how to resume it.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    // A duckky fork is made HERE, as Claude Code's own fork: a spawn hook
    // cannot make one ("a hook's subagentType 'fork' names no agent this call
    // can dispatch", measured). agent.spawn finds its model by this call's id.
    const call = String(e.tool_use_id ?? '')
    const m = contextForks && call && !noFork.has(e.agentId ?? '')
      ? models.find((x) => e.subagent_type === `${PLUGIN}:${x.name}-fork`) : undefined
    if (m) forkTo.set(call, { m, description: e.description })
    const out = await next(m ? { ...e, subagent_type: 'fork' } : e)
    if (m && !byToolUse.has(call) && (out.deny !== undefined || out.isError)) {
      // no fork started: Claude Code would not fork in this loop, so the same
      // type, called again, spawns itself and gets a text copy
      forkTo.delete(call)
      noFork.add(e.agentId ?? '')
      $.ui.toast(`${PLUGIN}: Claude Code would not fork here; the fork will get a text copy of the conversation`)
      return { deny: text('fork', 'refused', { type: `${PLUGIN}:${m.name}-fork`, error: String(out.deny ?? out.text ?? '').slice(0, 300) }) }
    }
    const id = byToolUse.get(call)
    if (!id || out.deny !== undefined) return out
    const notes: string[] = []
    const folder = live.get(id)?.workspace
    if (folder) notes.push(text('workspace', 'mainAgentNote', { folder }))
    const brief = briefs.get(id)
    if (brief) { notes.push(brief); briefs.delete(id) }   // delivered
    return notes.length ? { ...out, context: [...(out.context ?? []), ...notes] } : out
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    const r = live.get(e.agent_id)
    if (r) {
      r.transcript = e.agent_transcript_path
      if (e.last_assistant_message) r.lastAnswer = e.last_assistant_message.slice(0, 4000)
      await write($, r)
      // a duckky subagent's transcript as it stands, openable as a main
      // session; again once its last reply has landed (a built-in subagent
      // gets a copy only from /duckky open: every one would fill /resume)
      if (isDuckky(r)) {
        await copyAsSession($, r).catch(() => null)
        const now = Date.now()
        copyDue.set(r.id, COPY_AGAIN_MS.map((ms) => now + ms))
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))   // SubagentStop can block a stop: a failure here must not

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    // The main agent's turn is over: reports it had no tool call left to carry
    // go now (the session is idle, so nothing waits). After a stop, a moment
    // later: the interrupt clears Claude Code's queue as it ends.
    if (!e.agentId) {
      mainTurn = false
      if (forClaude.length) {
        if (e.isAborted) flushAt = Date.now() + 1500
        else await sendNow($, forClaude.splice(0))
      }
      return done
    }
    const r = live.get(e.agentId)
    if (r) {
      r.status = e.isAborted ? 'aborted' : e.reason === 'answer' ? 'done' : e.reason
      r.endedAt = Date.now()
      r.activity = r.status === 'done' ? 'done' : r.status === 'refusal' ? 'refused' : 'stopped'
      if (r.status === 'refusal') {
        // where it stood, in full, for the agent that started it: on its Agent
        // call's result (see the Agent hook), or, run in the background, as a
        // message of its own in the main chat
        const brief = refusalBrief(
          { id: r.id, label: r.label, model: r.answeredBy ?? r.model, description: r.description, refusals: r.refusals ?? 1 },
          refusalScene((await readTranscript($, r)) ?? ''),
          e.reason === 'refusal' ? e.refusal : null,
        )
        briefs.set(r.id, brief)
        if (r.background) await deliver($, brief)
        $.ui.toast(`${PLUGIN}: "${r.description}" stopped on a refusal; the main agent has where it stood and can resume it`)
      }
      restage($)
      if (e.usage) {
        r.answeredBy = e.usage.model
        r.outputTokens += e.usage.output_tokens
        if (r.requested?.startsWith('claude-') && !sameModel(e.usage.model, r.requested)) {
          $.ui.toast(`${PLUGIN}: ${r.description} asked for ${r.requested}, the API answered as ${e.usage.model}`)
        }
      }
      await write($, r)
      showRunning($)
    }
    // A resumed agent ended: its answer to the main agent, as a message of its
    // own (a refusal already sent its report above).
    const resumed = e.agentId ? delivering.get(e.agentId) : undefined
    if (resumed && e.agentId) {
      delivering.delete(e.agentId)
      const ending = e.isAborted ? 'aborted' : e.reason === 'answer' ? 'done' : e.reason
      if (ending !== 'refusal' || !r?.background) {
        await deliver($, resumedReport({ ...resumed, id: e.agentId, ending, answer: e.answer }))
      }
    } else if (r && r.status !== 'refusal' && isDuckky(r) && (reports === 'all' || (reports === 'background' && r.background))) {
      // Its report, for the person to see: in their prompt box to send (their
      // own message, which they can rewind to and edit), or in the chat. A
      // background subagent's answer otherwise reaches the main agent only as
      // a notice the person does not see. (A refusal sent its report above.)
      await deliver($, subagentReport({ id: r.id, label: r.label, task: r.description, ending: r.status, answer: e.answer, workspace: r.workspace }))
    }
    return done
  })

  // the tool's name written out: the validator reads a matcher's literal only
  on('tool.call', { tool: 'mcp__duckky-swarm__resume_subagent' }, async ($, e) => {
    const { agent, message, effort: effortText } = e as unknown as { agent?: unknown; message?: unknown; effort?: unknown }
    const effort = effortText === undefined || effortText === '' ? undefined : parseEffort(effortText)
    if (effortText !== undefined && effortText !== '' && effort === undefined) {
      return { result: text('effort', 'notAnEffort', { effort: String(effortText), levels: EFFORTS.join(', ') }), isError: true }
    }
    const rows = await known($)
    const several = ambiguous(rows, String(agent ?? ''))
    if (several) return { result: several, isError: true }
    let r = findAgent(rows, String(agent ?? ''))
    if (!r) {
      // not in the store: look where Claude Code keeps it, and keep it again
      r = await findOnDisk($, String(agent ?? ''))
      if (r && keep) await saveAgent($, r)
    }
    if (!r) {
      const recent = rows.slice(0, 5).map((x) => `${x.id.slice(0, 8)} ${x.label}: ${x.description}`).join('; ')
      return { result: text('resumeTool', 'noMatch', { query: String(agent), recent: recent || text('resumeTool', 'noneKept') }), isError: true }
    }
    const model = startedModel(r)
    if (effort !== undefined && model && !effortFits(model, effort)) {
      return { result: text('resumeTool', 'effortDoesNotFit', { effort, id: r.id.slice(0, 8), fits: effortsText(model) }), isError: true }
    }
    const withEffort = effort === undefined ? '' : text('resumeTool', 'withEffort', { effort })
    const say = String(message ?? text('resumePrompt', 'defaultMessage'))

    // A subagent of this session is resumed ITSELF, by Claude Code, as the
    // person's own resume from its transcript view does: the same id and list
    // entry, its own transcript, its own model. The user asked for exactly
    // this after a resume made a NEW agent in its place. Claude Code
    // tells the main agent when it finishes. One it will not resume (one the
    // person stopped), or one of an earlier session, carries on as a new
    // subagent given its transcript, below.
    // ⛔ "Of this session" is its record's session, NOT `$.agent.list()`: the
    // engine drops a finished subagent's task from that list soon after, which
    // is just when it is resumed (measured live: listed false, so a new agent
    // was made), while `session.send` resumes a finished one from its transcript.
    let notItself = ''
    if (r.sessionId && r.sessionId === sessionId) {
      if (effort !== undefined) effortFor.set(r.id, effort)
      const ws0 = workspaceOf(r)
      const sent = await $.session.send({ to: { agentId: r.id }, text: ws0 ? say + text('workspace', 'reminder', { folder: ws0.folder }) : say })
        .catch((err: Error) => ({ isDelivered: false as const, reason: err.message }))
      const where = ws0 ? text('workspace', 'resultNote', { folder: ws0.folder }) : ''
      // still running: the message waits in its queue, nothing was resumed
      if (sent.isDelivered && r.status === 'running') return { result: text('resumeTool', 'queued', { id: r.id.slice(0, 8) }) + where }
      if (sent.isDelivered) {
        r.resumes += 1
        r.background = true   // it runs on while the main agent goes on: its report comes as a message
        await write($, r)
        return { result: text('resumeTool', 'resumedSame', { id: r.id.slice(0, 8), model, withEffort, open: openText(r) }) + where }
      }
      if (effort !== undefined) effortFor.delete(r.id)
      notItself = text('resumeTool', 'notItself', { id: r.id.slice(0, 8), reason: sent.reason })
    }

    const jsonl = await readTranscript($, r)
    // rewound to its last message before a refusal, the newest entries whole
    const history = jsonl
      ? newestWithin(transcriptLines(jsonl, { beforeRefusal: true, fullTail: 4 }), RESUME_BUDGET)
      : r.lastAnswer ? text('resumePrompt', 'lastAnswerOnly', { answer: r.lastAnswer }) : ''
    if (!history) return { result: text('resumeTool', 'noTranscript', { id: r.id }), isError: true }

    const m = models.find((x) => sameModel(x.id, model))
    // it keeps its workspace (a duckky subagent from before workspaces gets
    // one now), the rules after its message; the spawn hook adds none
    const ws = workspacesOn && m ? (workspaceOf(r) ?? newWorkspace(cwd || r.cwd, m.id, workspaceKey(`resume:${r.id}`), r.description)) : undefined
    const body = text('resumePrompt', 'body', {
      intro: text('resumePrompt', r.status === 'refusal' ? 'introAfterRefusal' : 'intro', { label: r.label, model }),
      history,
      message: say,
    })
    const prompt = ws ? `${body}
${workspaceRules(ws)}` : body
    if (ws) pendingWorkspace.set(promptKey(prompt), ws)
    if (effort !== undefined) pendingEffort.set(promptKey(prompt), effort)   // its first turn picks it up
    const spawned = await $.agent.spawn({
      prompt,
      description: text('resumeTool', 'agentDescription', { task: r.description }).slice(0, 80),
      ...(m ? { subagentType: `${PLUGIN}:${m.name}` } : { subagentType: 'general-purpose', model }),
    }).catch((err: Error) => ({ deny: err.message, agentId: undefined, model: undefined }))
    if (spawned.deny !== undefined || !spawned.agentId) {
      return {
        result: notItself + text('resumeTool', 'couldNot', { id: r.id, reason: spawned.deny ?? `no agent started (${JSON.stringify(spawned).slice(0, 200)})` }),
        isError: true,
      }
    }
    const agentId = spawned.agentId
    // before any await: an agent that ends at once must still find it
    delivering.set(agentId, { from: r.id, label: r.label, workspace: ws?.folder })
    const now = live.get(agentId)
    if (now) { now.resumedFrom = r.id; now.background = true; await write($, now) }
    r.resumes += 1
    if (keep) await saveAgent($, r)
    // ⛔ Returns at once, the answer coming later as a message (turn.complete
    // above). A hook has 10 s of its OWN time, and waiting on an agent is no
    // `$` call, so the clock runs through it: a resume that awaited the answer
    // was cut off at 10.4 s live while the resumed agent worked 4.5 minutes
    // on, its answer lost, and the main agent started the same work again.
    // ⛔ A plugin tool's result is a string (or content blocks): an object was
    // refused live as "does not match its output shape".
    return {
      result: notItself + text('resumeTool', 'started', {
        from: r.id.slice(0, 8), id: agentId.slice(0, 8), model: spawned.model, withEffort, open: openText(r),
      }) + (ws ? text('workspace', 'resultNote', { folder: ws.folder }) : ''),
    }
  }).catch(($, e, next) => ({ result: hookFailed('resume_subagent', next.error), isError: true }))

  // The main agent turns a running subagent's effort up or down: from its
  // next model request on (the turn.step hook applies it).
  on('tool.call', { tool: 'mcp__duckky-swarm__set_subagent_effort' }, async ($, e) => {
    const { agent, effort: effortText } = e as unknown as { agent?: unknown; effort?: unknown }
    const effort = parseEffort(effortText)
    if (effort === undefined) return { result: text('effort', 'notAnEffort', { effort: String(effortText), levels: EFFORTS.join(', ') }), isError: true }
    const rows = await known($)
    const several = ambiguous(rows, String(agent ?? ''))
    if (several) return { result: several, isError: true }
    const r = findAgent(rows, String(agent ?? ''))
    if (!r) return { result: text('effortTool', 'noMatch', { query: String(agent) }), isError: true }
    const id = r.id.slice(0, 8)
    if (!live.has(r.id) || r.status !== 'running') {
      return { result: text('effortTool', 'notRunning', { id, status: r.status, effort }), isError: true }
    }
    const model = startedModel(r)   // its requests go to that model, whatever answered last
    if (model && !effortFits(model, effort)) {
      return { result: text('effortTool', 'doesNotFit', { effort, id, fits: effortsText(model) }), isError: true }
    }
    effortFor.set(r.id, effort)
    $.ui.toast(`${PLUGIN}: "${r.description}" now thinks at effort ${effort}`)
    return {
      result: text('effortTool', 'set', {
        id, task: r.description, label: r.label, effort,
        was: r.effort === undefined ? '' : text('effortTool', 'was', { effort: r.effort }),
      }),
    }
  }).catch(($, e, next) => ({ result: hookFailed('set_subagent_effort', next.error), isError: true }))

  on('command.run', { command: 'duckky' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    // /duckky open <id>: the subagent as a main session, written now
    if (verb.toLowerCase() === 'open') {
      const rows = await known($)
      const several = ambiguous(rows, rest.join(' '))
      if (several) return { text: several }
      const r = findAgent(rows, rest.join(' ')) ?? await findOnDisk($, rest.join(' '))
      if (!r) return { text: `No subagent matches "${rest.join(' ')}". /duckky list shows them.` }
      const sid = await copyAsSession($, r).catch(() => null)
      if (!sid) return { text: `Found ${r.id.slice(0, 8)}, but not its transcript, so there is no session to open.` }
      return { text: `${r.description} (${r.id.slice(0, 8)}) as a main session. In a terminal in ${r.cwd}:\n  ${openCommand(r)}\nIt is a copy: the subagent itself is not changed.` }
    }
    // /duckky sessions [words]: every duckky session copy on this computer
    if (verb.toLowerCase() === 'sessions') {
      const dir = `${await configDir($)}/${INDEX_DIR}`
      const files = (await $.fs.list(dir).catch(() => [])).filter((f) => f.kind === 'file' && f.name.endsWith('.json'))
      const all = parseEntries(await Promise.all(files.map((f) => $.fs.read(`${dir}/${f.name}`).then((t) => String(t), () => ''))))
      const shown = rest.length ? matchSessions(all, rest.join(' ')) : all
      return {
        text: [
          ...listing(shown.slice(0, 30)),
          ...(shown.length === 1 ? ['', `  ${openLine(shown[0])}`] : []),
          '',
          'Open one from any terminal: duckky <name or number>, or duckky open <name> --here to work on it in the folder you are in.',
          'Install the command once: npm install -g github:buggerlogger/duckky-swarm',
        ].join('\n'),
      }
    }
    if (verb.toLowerCase() !== 'list') return { text: await openSwarm($) }
    const list = (await known($)).slice(0, 20)
    if (!list.length) return { text: 'No subagents yet. Ask Claude for one on a model, e.g. "use an Opus 4.6 subagent to ...".' }
    const line = (r: AgentRecord) =>
      `${ICON[r.status]} ${r.label.padEnd(10)} ${(r.answeredBy ?? r.model).padEnd(18)} ${r.fork ? '[fork] ' : ''}${r.description}` +
      `${r.effort === undefined ? '' : `  · effort ${r.effort}`}` +
      `${r.refusals ? `  (refused ${r.refusals}x${r.status === 'refusal' ? ', stopped' : ', went on'})` : ''}` +
      `  [${r.id.slice(0, 8)}${r.sessionId && r.sessionId !== sessionId ? ', earlier session' : ''}]` +
      `${r.workspace ? `\n    workspace: ${r.workspace}` : ''}` +
      `${r.sessionCopy ? `\n    as a main session: ${openCommand(r)}` : ''}`
    return { text: list.map(line).join('\n') }
  })
}
