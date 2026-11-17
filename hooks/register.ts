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

import type { EngineInterface, Register } from 'claude-code'
import { newestWithin, sessionLines, transcriptLines } from './history.ts'
import { labelFor, parseModels, sameModel, type ModelEntry } from './models.ts'
import { allAgents, forgetAgent, retain, saveAgent, type AgentRecord } from './records.ts'

const PLUGIN = 'duckky-swarm'
// characters of history a context fork or a resumed subagent is given (~30k tokens)
const FORK_BUDGET = 120_000
const RESUME_BUDGET = 120_000

const descriptionFor = (m: ModelEntry) =>
  `Runs the task on ${m.label} (model ${m.id}). Use this agent type whenever the user asks for a subagent, ` +
  `agent, agents or a swarm on ${m.label}, ${m.id} or "${m.name}": the Agent tool's model parameter cannot ` +
  'select this exact model, this type can. Starts fresh; same tools as the parent.'

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

async function write($: EngineInterface, r: AgentRecord) {
  live.set(r.id, r)
  if (keep) await saveAgent($, r)
}

function showRunning($: EngineInterface) {
  const running = [...live.values()].filter((r) => r.status === 'running')
  $.ui.status(running.length ? `duckky: ${running.length} running · ${running.map((r) => r.label).join(', ')}` : undefined)
}

async function addType($: EngineInterface, name: string, description: string, m: ModelEntry) {
  await $.agent
    .register({ name, description, prompt: promptFor(m), model: m.id })
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

// A subagent's transcript: where SubagentStop said it was, else where Claude
// Code keeps one (<config>/projects/<cwd, every other character a dash>/<session>/subagents/).
async function readTranscript($: EngineInterface, r: AgentRecord): Promise<string | null> {
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${(await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))}/.claude`
  const derived = r.cwd && r.sessionId ? `${config}/projects/${r.cwd.replace(/[^A-Za-z0-9]/g, '-')}/${r.sessionId}/subagents/agent-${r.id}.jsonl` : ''
  for (const path of [r.transcript, derived]) {
    if (!path) continue
    try { return String(await $.fs.read(path)) } catch { /* not there: try the next */ }
  }
  return null
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
  live.clear()

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    cwd = e.cwd
    sessionId = await $.session.id().catch(() => '')
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
        },
        required: ['agent', 'message'],
      },
      isDeferred: false,
    })
    await $.command.register({ name: 'duckky', description: 'Duckky Swarm: your subagents and the model each really ran on' })
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
    })
    if (ours && !sameModel(r.model, ours.id)) $.ui.toast(`${PLUGIN}: asked for ${ours.id}, Claude Code started ${r.model}`)
    if (e.fork && e.model) {
      $.ui.toast(`${PLUGIN}: a real fork runs on ${e.parentModel}, not ${e.model}.` +
        (contextForks ? ' Ask for a fork on a duckky model instead.' : ' Set "Fork on another model" to context in /config.'))
    }
    showRunning($)
    return r
  }).catch(($, e, next) => next(e))

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
    const { agent, message } = e as unknown as { agent?: unknown; message?: unknown }
    const rows = await known($)
    const r = findAgent(rows, String(agent ?? ''))
    if (!r) {
      const recent = rows.slice(0, 5).map((x) => `${x.id.slice(0, 8)} ${x.label}: ${x.description}`).join('; ')
      return { result: `No subagent matches "${String(agent)}". Recent: ${recent || 'none kept'}`, isError: true }
    }
    const jsonl = await readTranscript($, r)
    const history = jsonl ? newestWithin(transcriptLines(jsonl), RESUME_BUDGET) : r.lastAnswer ? `AGENT (its last answer): ${r.lastAnswer}` : ''
    if (!history) return { result: `Found ${r.id}, but not its transcript, so there is nothing to resume from.`, isError: true }

    const model = r.answeredBy ?? r.model
    const m = models.find((x) => sameModel(x.id, model))
    const spawned = await $.agent.spawn({
      prompt: [
        `You are resuming earlier work: a subagent on ${r.label} (${model}). Its transcript is below; continue from where it stopped.`,
        '<earlier-transcript>', history, '</earlier-transcript>', '', 'New instruction:', String(message ?? 'Continue.'),
      ].join('\n'),
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
    return { result: `${answer}\n\n(resumed ${r.id.slice(0, 8)} as ${agentId.slice(0, 8)}, on ${spawned.model})` }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `${PLUGIN}: resume_subagent failed` }))

  on('command.run', { command: 'duckky' }, async ($) => {
    const list = (await known($)).slice(0, 20)
    if (!list.length) return { text: 'No subagents yet. Ask Claude for one on a model, e.g. "use an Opus 4.6 subagent to ...".' }
    const line = (r: AgentRecord) =>
      `${ICON[r.status]} ${r.label.padEnd(10)} ${(r.answeredBy ?? r.model).padEnd(18)} ${r.fork ? '[fork] ' : ''}${r.description}` +
      `  [${r.id.slice(0, 8)}${r.sessionId && r.sessionId !== sessionId ? ', earlier session' : ''}]`
    return { text: list.map(line).join('\n') }
  })
}
