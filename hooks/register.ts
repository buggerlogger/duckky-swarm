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
// A real fork always runs on the parent's model (the engine ignores `model`
// for forks). With Fork on another model = context, each model also gets
// `duckky-swarm:<name>-fork`: a subagent whose prompt is rewritten here to the
// conversation so far plus its task.
//
// Every subagent is recorded with three models: the one asked for, the one
// Claude Code resolved when it started (`agent.spawn`), and the one the API
// reported answering (`turn.complete`'s usage). /duckky shows them, and the
// resume_subagent tool continues one, from this session or an earlier one, on
// the same model with its old transcript.

import type { EngineInterface, Register, RenderElement, TurnStepChunk } from 'claude-code'
import { characterFor } from '../characters/index.mjs'
import { activityOf, shownActivity } from '../viewer/model.mjs'
import { bandTree, rasterKey, stagesFor, type BandAgent } from './band.tsx'
import { refusalBrief } from './brief.ts'
import { newestWithin, parseTranscript, refusalAt, refusalScene, sessionLines, transcriptLines } from './history.ts'
import { launchArgv, subagentsDir } from './launcher.ts'
import { EFFORTS, effortFits, effortsText, labelFor, parseEffort, parseModels, sameModel, type Effort, type ModelEntry } from './models.ts'
import { allAgents, forgetAgent, retain, saveAgent, type AgentRecord } from './records.ts'

const PLUGIN = 'duckky-swarm'
// characters of history a context fork or a resumed subagent is given (~30k tokens)
const FORK_BUDGET = 120_000
const RESUME_BUDGET = 120_000

const descriptionFor = (m: ModelEntry) =>
  `Runs the task on ${m.label} (model ${m.id}). Use this agent type whenever the user asks for a subagent, ` +
  `agent, agents or a swarm on ${m.label}, ${m.id} or "${m.name}": the Agent tool's model parameter cannot ` +
  'select this exact model, this type can. Starts fresh; same tools as the parent. ' +
  `Its effort (how hard it thinks) is the Agent call's \`effort\` (${EFFORTS.join(', ')})${m.effort ? `, ${m.effort} when left out` : ''}; ` +
  'set_subagent_effort changes it while it runs.'

const forkDescriptionFor = (m: ModelEntry) =>
  `A FORK on ${m.label} (model ${m.id}): starts with this whole conversation as its context, then does its task. ` +
  `Use it when the user asks to fork onto ${m.label}, ${m.id} or "${m.name}" (a built-in fork cannot change model).`

// An agent type's prompt REPLACES the session's system prompt, so it says
// everything a subagent needs on its own.
const promptFor = (m: ModelEntry) => [
  `You are a subagent of Claude Code, running on ${m.label} (${m.id}) because the user asked for that model.`,
  'Do the task you are given completely with the tools you have, then end with a clear report of what you found ' +
    'or changed: the agent that started you sees only your final message.',
  'Be concrete: file paths, line numbers, commands and their real output. Never claim a result you did not check.',
  'You cannot ask the user anything. Where the task is ambiguous, take the most reasonable reading and say which.',
].join('\n\n')

const ICON: Record<AgentRecord['status'], string> = { running: '●', done: '✓', aborted: '■', error: '✗', refusal: '✗' }

// Module state: a reload starts it over, as it does the session's hooks.
// ⛔ It lives up here, not inside register: the engine refuses a module that
// passes `$` to anything but a function declared at the top of the file.
const live = new Map<string, AgentRecord>()   // this session's, by agent id
const waiting = new Map<string, (answer: string) => void>()   // resumed agents a tool call awaits
let models: ModelEntry[] = []
let keep = true
let sessionId = ''
let cwd = ''
let tick = 0                  // the band's animation frame
let bandId: string | null = null   // the band's requestId while it shows stages
let drawn = ''                // the band's stages as last laid out: a change re-lays it
let retries = 3               // asks again per subagent when its model refuses
let character = characterFor('Clawd')   // who acts out the work: the Character setting
const refusalsOf = new Map<string, number>()   // agent id -> refusals asked again so far
const byToolUse = new Map<string, string>()    // the Agent call's tool_use_id -> the agent it started
const briefs = new Map<string, string>()       // refused agent id -> its refusal report, until delivered
const effortFor = new Map<string, Effort>()    // agent id -> the effort the main agent set for it
// A resume with an effort: matched to its agent at turn.start by its prompt,
// which comes before its first model request (the spawn's id can come after).
const pendingEffort = new Map<string, Effort>()
const promptKey = (text: string) => `${text.length}:${text.slice(0, 400)}`

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

// A refused response of a subagent: counted on its record, and its Clawd
// shakes its head while the request is asked again.
function noteRefusal($: EngineInterface, agentId: string, count: number) {
  const r = live.get(agentId)
  if (!r) return
  r.refusals = count
  setActivity($, r, 'retrying')
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
export function findAgent(rows: readonly AgentRecord[], query: string): AgentRecord | undefined {
  const q = query.trim().toLowerCase()
  if (!q) return undefined
  const byId = rows.find((r) => r.id.toLowerCase() === q) ?? (q.length >= 4 ? rows.find((r) => r.id.toLowerCase().startsWith(q)) : undefined)
  if (byId) return byId
  const words = q.split(/\s+/)
  return rows.find((r) => words.every((w) => r.description.toLowerCase().includes(w)))
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
    try { return String(await $.fs.read(path)) } catch { /* not there: try the next */ }
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
  const model = [...jsonl.matchAll(/"model":"(claude-[^"]+)"/g)].pop()?.[1] ?? ''
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

async function forkPrompt($: EngineInterface, m: ModelEntry, task: string): Promise<string> {
  const history = newestWithin(sessionLines(await $.session.messages()), FORK_BUDGET)
  return [
    `You are a fork of the conversation below, now running on ${m.label} (${m.id}). You have its context;`,
    'the person and the main agent see your work only when you report.',
    '<conversation>', history, '</conversation>', '', 'Your task:', task,
  ].join('\n')
}

export const register: Register = (on, options) => {
  const parsed = parseModels(String(options.models ?? ''))
  models = parsed.models
  const contextForks = options.forkMode !== 'true'
  keep = options.keepAgents !== false
  retries = Math.max(0, Math.floor(Number(options.refusalRetries ?? 3)) || 0)
  character = characterFor(options.character)
  refusalsOf.clear()
  live.clear()

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    cwd = e.cwd
    sessionId = await $.session.id().catch(() => '')
    $.clock.every(TICK_MS, () => { void animate($) })
    // $.agent.register rejects until the session is bound: after next(e)
    for (const m of models) {
      await addType($, m.name, descriptionFor(m), m)
      if (contextForks) await addType($, `${m.name}-fork`, forkDescriptionFor(m), m)
    }
    if (parsed.skipped.length) $.ui.log(`${PLUGIN}: /config models skipped ${parsed.skipped.map((s) => `"${s}"`).join(', ')}`)
    await $.tool.register({
      name: 'resume_subagent',
      description:
        'Resume a subagent from this session or an EARLIER one: it continues on the same model, with its earlier ' +
        'transcript as context, and answers your message. Use it when the user asks to resume, continue or go back ' +
        'to a subagent. `agent` is its id (the first 8 characters are enough, as /duckky shows) or words from its task.',
      inputSchema: {
        type: 'object',
        properties: {
          agent: { type: 'string', description: 'The subagent: its id or id prefix, or words from its task' },
          message: { type: 'string', description: 'What to tell it now' },
          effort: { type: 'string', description: `Optional: how hard it thinks from now on (${EFFORTS.join(', ')}, or a token budget)` },
        },
        required: ['agent', 'message'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'set_subagent_effort',
      description:
        'Change how hard a RUNNING subagent thinks (its effort): from its next model request on. Use it when the user ' +
        'asks to raise or lower a subagent\'s effort, or when a subagent needs more (or less) thinking for its task. ' +
        `\`agent\` is its id (the first 8 characters are enough) or words from its task; \`effort\` is ${EFFORTS.join(', ')}, ` +
        'or a token budget. For a subagent that has finished, resume it with resume_subagent and an effort instead.',
      inputSchema: {
        type: 'object',
        properties: {
          agent: { type: 'string', description: 'The subagent: its id or id prefix, or words from its task' },
          effort: { type: 'string', description: `${EFFORTS.join(', ')}, or a token budget` },
        },
        required: ['agent', 'effort'],
      },
      isDeferred: false,
    })
    await $.command.register({
      name: 'duckky',
      description: 'Duckky Swarm: open the live window of this session\'s subagents (list: the model each really ran on)',
      argumentHint: '[list]',
    })
    if (keep) {
      const kept = await allAgents($)
      const stay = new Set(retain(kept, Date.now()).map((r) => r.id))
      for (const r of kept) if (!stay.has(r.id)) await forgetAgent($, r.id)
    }
    return started
  })

  on('agent.spawn', async ($, e, next) => {
    const forkOn = contextForks && !e.resume ? models.find((m) => e.subagentType === `${PLUGIN}:${m.name}-fork`) : undefined
    const r = await next(forkOn ? { ...e, prompt: await forkPrompt($, forkOn, e.prompt) } : e)
    if (r.deny !== undefined || !r.agentId) return r
    const ours = models.find((m) => e.subagentType === `${PLUGIN}:${m.name}` || e.subagentType === `${PLUGIN}:${m.name}-fork`)
    const before = live.get(r.agentId)   // a resume within this session
    await write($, {
      ...before,
      id: r.agentId,
      type: e.subagentType,
      label: ours?.label ?? labelFor(r.model),
      model: r.model,
      requested: ours?.id ?? e.model ?? null,
      answeredBy: before?.answeredBy ?? null,
      description: e.description,
      fork: e.fork || !!forkOn,
      sessionId,
      cwd,
      startedAt: before?.startedAt ?? Date.now(),
      status: 'running',
      resumes: (before?.resumes ?? 0) + (e.resume ? 1 : 0),
      outputTokens: before?.outputTokens ?? 0,
      activity: 'starting',
      background: e.background,
    })
    byToolUse.set(e.tool_use_id, r.agentId)
    restage($)
    if (ours && !sameModel(r.model, ours.id)) $.ui.toast(`${PLUGIN}: asked for ${ours.id}, Claude Code started ${r.model}`)
    if (e.fork && e.model) {
      $.ui.toast(`${PLUGIN}: a real fork runs on ${e.parentModel}, not ${e.model}.` +
        (contextForks ? ' Ask for a fork on a duckky model instead.' : ' Set "Fork on another model" to context in /config.'))
    }
    showRunning($)
    return r
  }).catch(($, e, next) => next(e))

  // A subagent's own tool calls (they carry its agentId): what its Clawd acts
  // out, by the tool and, for a shell command, by its words (npm test is a
  // test). After it: a test shows pass or fail, anything else back to
  // thinking. It only watches; the call and its result go on unchanged.
  on('tool.call', async ($, e, next) => {
    const r = e.agentId ? live.get(e.agentId) : undefined
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
    const effort = e.agentId ? pendingEffort.get(promptKey(e.text)) : undefined
    if (e.agentId && effort !== undefined) {
      pendingEffort.delete(promptKey(e.text))
      effortFor.set(e.agentId, effort)
    }
    return next(e)
  })

  // Each model request of a subagent. Its effort: the one the main agent set
  // for it (set_subagent_effort, or a resume's), applied here, and recorded as
  // it was sent. Then refusals: ask the same request again from just before
  // the refused response, up to `retries` times for that subagent, then let
  // the refusal through so the subagent stops as refused. Each response is
  // held until it ends, so a refused one is never shown or recorded: what
  // leaves this hook is what the engine keeps. The request's messages are the
  // engine's own and pinned: it is asked again unchanged, nothing added to
  // talk the model round. The main loop's steps pass straight by.
  on('turn.step', async function* ($, e, next) {
    const agentId = e.agentId
    if (!agentId) return yield* next(e)
    const want = effortFor.get(agentId)
    // never add an effort to a request Claude Code sent without one: that
    // model takes none, and a request with one would be refused
    const ask = want === undefined || e.effort === undefined ? e : { ...e, effort: want }
    const r0 = live.get(agentId)
    if (r0 && ask.effort !== undefined && r0.effort !== ask.effort) { r0.effort = ask.effort; restage($) }
    if (retries <= 0) return yield* next(ask)
    for (;;) {
      const stream = next(ask)
      const held: TurnStepChunk[] = []
      for await (const c of stream) held.push(c)
      const result = await stream.result
      const used = refusalsOf.get(agentId) ?? 0
      if (result.stopReason === 'refusal') noteRefusal($, agentId, used + 1)
      if (result.stopReason !== 'refusal' || used >= retries) {
        for (const c of held) yield c
        return result
      }
      refusalsOf.set(agentId, used + 1)
      const r = live.get(agentId)
      $.ui.toast(`${PLUGIN}: ${r ? `"${r.description}"` : 'a subagent'} was refused; asking again (${used + 1}/${retries})`)
    }
  }).catch(async function* ($, e, next) { return yield* next(e) })

  // The main agent's Agent call: when the subagent it waited on stopped on a
  // refusal, its result carries where the subagent stood and how to resume it.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const out = await next(e)
    const id = byToolUse.get(String(e.tool_use_id ?? ''))
    const brief = id ? briefs.get(id) : undefined
    if (!id || !brief || out.deny !== undefined) return out
    briefs.delete(id)   // delivered
    return { ...out, context: [...(out.context ?? []), brief] }
  }).catch(($, e, next) => next(e))

  // SendMessage would wake a refused subagent with its refused reply still in
  // its context; resume_subagent rewinds it to just before. Point to that.
  on('tool.call', { tool: 'SendMessage' }, async ($, e, next) => {
    const to = String((e as unknown as { to?: unknown }).to ?? '').toLowerCase()
    const r = to.length >= 4 ? [...live.values()].find((x) => x.status === 'refusal' && x.id.toLowerCase().startsWith(to)) : undefined
    if (!r) return next(e)
    return { deny: `${PLUGIN}: ${r.id.slice(0, 8)} stopped on a refusal. Resume it with resume_subagent (agent "${r.id.slice(0, 8)}"), which rewinds it to its last message before the refusal; a SendMessage would carry the refused reply on.` }
  }).catch(($, e, next) => (next.called ? next(e) : next(e)))

  on('classic.SubagentStop', async ($, e, next) => {
    const r = live.get(e.agent_id)
    if (r) {
      r.transcript = e.agent_transcript_path
      if (e.last_assistant_message) r.lastAnswer = e.last_assistant_message.slice(0, 4000)
      await write($, r)
    }
    return next(e)
  }).catch(($, e, next) => next(e))   // SubagentStop can block a stop: a failure here must not

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const r = e.agentId ? live.get(e.agentId) : undefined
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
        if (r.background) await $.prompt.submit({ text: brief }).catch(() => undefined)
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
    const waiter = e.agentId ? waiting.get(e.agentId) : undefined
    if (waiter && e.agentId) {
      waiting.delete(e.agentId)
      waiter(e.answer)
    }
    return done
  })

  // the tool's name written out: the validator reads a matcher's literal only
  on('tool.call', { tool: 'mcp__duckky-swarm__resume_subagent' }, async ($, e) => {
    const { agent, message, effort: effortText } = e as unknown as { agent?: unknown; message?: unknown; effort?: unknown }
    const effort = effortText === undefined || effortText === '' ? undefined : parseEffort(effortText)
    if (effortText !== undefined && effortText !== '' && effort === undefined) {
      return { result: `"${String(effortText)}" is not an effort: use ${EFFORTS.join(', ')}, or a token budget.`, isError: true }
    }
    const rows = await known($)
    let r = findAgent(rows, String(agent ?? ''))
    if (!r) {
      // not in the store: look where Claude Code keeps it, and keep it again
      r = await findOnDisk($, String(agent ?? ''))
      if (r && keep) await saveAgent($, r)
    }
    if (!r) {
      const recent = rows.slice(0, 5).map((x) => `${x.id.slice(0, 8)} ${x.label}: ${x.description}`).join('; ')
      return { result: `No subagent matches "${String(agent)}". Recent: ${recent || 'none kept'}`, isError: true }
    }
    const jsonl = await readTranscript($, r)
    // rewound to its last message before a refusal, the newest entries whole
    const history = jsonl ? newestWithin(transcriptLines(jsonl, { beforeRefusal: true, fullTail: 4 }), RESUME_BUDGET) : r.lastAnswer ? `AGENT (its last answer): ${r.lastAnswer}` : ''
    if (!history) return { result: `Found ${r.id}, but not its transcript, so there is nothing to resume from.`, isError: true }

    const model = r.answeredBy ?? r.model
    if (effort !== undefined && model && !effortFits(model, effort)) {
      return { result: `Effort ${effort} does not fit ${r.id.slice(0, 8)}: ${effortsText(model)}. Resume it with one of those, or without an effort.`, isError: true }
    }
    const m = models.find((x) => sameModel(x.id, model))
    const prompt = [
      r.status === 'refusal'
        ? `You are resuming your own earlier work, as a subagent on ${r.label} (${model}). Below is your transcript up to your last message before you stopped; the reply where you stopped is not part of it. The agent that started you has read where you stood and sends the message after it. Carry on from there.`
        : `You are resuming earlier work: a subagent on ${r.label} (${model}). Its transcript is below; continue from where it stopped.`,
      '<earlier-transcript>', history, '</earlier-transcript>', '', 'New instruction:', String(message ?? 'Continue.'),
    ].join('\n')
    if (effort !== undefined) pendingEffort.set(promptKey(prompt), effort)   // its first turn picks it up
    const spawned = await $.agent.spawn({
      prompt,
      description: `resume: ${r.description}`.slice(0, 80),
      ...(m ? { subagentType: `${PLUGIN}:${m.name}` } : { subagentType: 'general-purpose', model }),
    }).catch((err: Error) => ({ deny: err.message, agentId: undefined, model: undefined }))
    if (spawned.deny !== undefined || !spawned.agentId) {
      return {
        result: `Could not resume ${r.id}: ${spawned.deny ?? `no agent started (${JSON.stringify(spawned).slice(0, 200)})`}`,
        isError: true,
      }
    }
    const agentId = spawned.agentId
    const now = live.get(agentId)
    if (now) { now.resumedFrom = r.id; await write($, now) }
    r.resumes += 1
    if (keep) await saveAgent($, r)
    const answer = await new Promise<string>((resolve) => waiting.set(agentId, resolve))
    // ⛔ a plugin tool's result is a string (or content blocks): an object was
    // refused live as "does not match its output shape", after the agent ran
    return { result: `${answer}\n\n(resumed ${r.id.slice(0, 8)} as ${agentId.slice(0, 8)}, on ${spawned.model}${effort === undefined ? '' : `, effort ${effort}`})` }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `${PLUGIN}: resume_subagent failed` }))

  // The main agent turns a running subagent's effort up or down: from its
  // next model request on (the turn.step hook applies it).
  on('tool.call', { tool: 'mcp__duckky-swarm__set_subagent_effort' }, async ($, e) => {
    const { agent, effort: effortText } = e as unknown as { agent?: unknown; effort?: unknown }
    const effort = parseEffort(effortText)
    if (effort === undefined) return { result: `"${String(effortText)}" is not an effort: use ${EFFORTS.join(', ')}, or a token budget.`, isError: true }
    const r = findAgent(await known($), String(agent ?? ''))
    if (!r) return { result: `No subagent matches "${String(agent)}".`, isError: true }
    if (!live.has(r.id) || r.status !== 'running') {
      return { result: `${r.id.slice(0, 8)} is not running (${r.status}). To go on with it at effort ${effort}, resume it with resume_subagent and effort "${effort}".`, isError: true }
    }
    const model = r.answeredBy ?? r.model
    if (model && !effortFits(model, effort)) {
      return { result: `Effort ${effort} does not fit ${r.id.slice(0, 8)}: ${effortsText(model)}.`, isError: true }
    }
    effortFor.set(r.id, effort)
    $.ui.toast(`${PLUGIN}: "${r.description}" now thinks at effort ${effort}`)
    return { result: `${r.id.slice(0, 8)} ("${r.description}", ${r.label}) thinks at effort ${effort} from its next model request on${r.effort === undefined ? '' : ` (it was ${r.effort})`}.` }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `${PLUGIN}: set_subagent_effort failed` }))

  on('command.run', { command: 'duckky' }, async ($, e) => {
    if (e.args.trim().toLowerCase() !== 'list') return { text: await openSwarm($) }
    const list = (await known($)).slice(0, 20)
    if (!list.length) return { text: 'No subagents yet. Ask Claude for one on a model, e.g. "use an Opus 4.6 subagent to ...".' }
    const line = (r: AgentRecord) =>
      `${ICON[r.status]} ${r.label.padEnd(10)} ${(r.answeredBy ?? r.model).padEnd(18)} ${r.fork ? '[fork] ' : ''}${r.description}` +
      `${r.effort === undefined ? '' : `  · effort ${r.effort}`}` +
      `${r.refusals ? `  (refused ${r.refusals}x${r.status === 'refusal' ? ', stopped' : ', went on'})` : ''}` +
      `  [${r.id.slice(0, 8)}${r.sessionId && r.sessionId !== sessionId ? ', earlier session' : ''}]`
    return { text: list.map(line).join('\n') }
  })
}
