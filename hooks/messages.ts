// Copyright 2026 buggerlogger (https://github.com/buggerlogger)
// SPDX-License-Identifier: Apache-2.0
//
// Every text Duckky Swarm sends to Claude, by name: what the main agent reads
// (agent types, tool descriptions and results, reports) and what subagents
// read (their prompt, a fork's, a resume's). The words live in messages.json
// at the plugin's root, read at session start (register.ts). These are the
// same texts built in, for any the file leaves out or gets wrong: one typo in
// the file must not leave a subagent without its instructions. Pure.
//
// A text is a string, or a list of lines joined by line breaks. `{name}` is
// filled in where the text is sent; a name it is not given stays as written.

export type Template = string | readonly string[]

export const DEFAULT_MESSAGES = {
  agentType: {
    description:
      'Runs the task on {label} (model {id}). Use this agent type whenever the user asks for a subagent, agent, agents or a swarm on {label}, {id} or "{name}": the Agent tool\'s model parameter cannot select this exact model, this type can. Starts fresh; same tools as the parent. {effort}',
    effort: 'Its effort (how hard it thinks) is the Agent call\'s `effort` ({levels}){whenLeftOut}; set_subagent_effort changes it while it runs.',
    whenLeftOut: ', {effort} when left out',
    noEffort: '{label} takes no effort: leave the Agent call\'s `effort` out.',
    forkDescription:
      'A FORK on {label} (model {id}): starts with this whole conversation as its context, then does its task. Use it when the user asks to fork onto {label}, {id} or "{name}" (a built-in fork cannot change model).',
    prompt: [
      'You are a subagent of Claude Code, running on {label} ({id}) because the user asked for that model.',
      '',
      'Do the task you are given completely with the tools you have, then end with a clear report of what you found or changed: the agent that started you sees only your final message.',
      '',
      'Be concrete: file paths, line numbers, commands and their real output. Never claim a result you did not check.',
      '',
      'You cannot ask the user anything. Where the task is ambiguous, take the most reasonable reading and say which.',
    ],
  },
  fork: {
    prompt: [
      'You are a fork of the conversation below, now running on {label} ({id}). You have its context;',
      'the person and the main agent see your work only when you report.',
      '<conversation>',
      '{conversation}',
      '</conversation>',
      '',
      'Your task:',
      '{task}',
    ],
  },
  resumeTool: {
    description:
      'Resume a subagent from this session or an EARLIER one: it continues on the same model, in the background, with its earlier transcript as context. This call returns at once; the resumed subagent\'s answer to your message comes to you as a message of its own when it finishes, so do not start another agent for the same work. Use it when the user asks to resume, continue or go back to a subagent. `agent` is its id (the first 8 characters are enough, as /duckky shows) or words from its task.',
    agent: 'The subagent: its id or id prefix, or words from its task',
    message: 'What to tell it now',
    effort: 'Optional: how hard it thinks from now on ({levels}, or a token budget)',
    started:
      'Resumed {from} as {id} on {model}{withEffort}, in the background: it carries on from its transcript, and its answer will come to you as a message when it finishes. Do not start another agent for this work meanwhile.',
    withEffort: ', effort {effort}',
    noMatch: 'No subagent matches "{query}". Recent: {recent}',
    noneKept: 'none kept',
    noTranscript: 'Found {id}, but not its transcript, so there is nothing to resume from.',
    couldNot: 'Could not resume {id}: {reason}',
    effortDoesNotFit: 'Effort {effort} does not fit {id}: {fits}. Resume it with one of those, or without an effort.',
    agentDescription: 'resume: {task}',
  },
  resumePrompt: {
    intro: 'You are resuming earlier work: a subagent on {label} ({model}). Its transcript is below; continue from where it stopped.',
    introAfterRefusal:
      'You are resuming your own earlier work, as a subagent on {label} ({model}). Below is your transcript up to your last message before you stopped; the reply where you stopped is not part of it. The agent that started you has read where you stood and sends the message after it. Carry on from there.',
    body: ['{intro}', '<earlier-transcript>', '{history}', '</earlier-transcript>', '', 'New instruction:', '{message}'],
    defaultMessage: 'Continue.',
    lastAnswerOnly: 'AGENT (its last answer): {answer}',
  },
  resumedAnswer: {
    finished: ['[duckky-swarm] Resumed subagent {from} (now {id}, {label}) finished. Its answer:', '', '{answer}'],
    noWords: '(it ended without a word)',
    stopped: '[duckky-swarm] Resumed subagent {from} (now {id}, {label}) was stopped before it finished.{lastWords}',
    refused: '[duckky-swarm] Resumed subagent {from} (now {id}, {label}) stopped on a refusal.{lastWords}',
    ended: '[duckky-swarm] Resumed subagent {from} (now {id}, {label}) ended ({ending}) before it finished.{lastWords}',
    lastWords: [' Its last words:', '', '{answer}'],
  },
  effortTool: {
    description:
      'Change how hard a RUNNING subagent thinks (its effort): from its next model request on. Use it when the user asks to raise or lower a subagent\'s effort, or when a subagent needs more (or less) thinking for its task. `agent` is its id (the first 8 characters are enough) or words from its task; `effort` is {levels}, or a token budget. For a subagent that has finished, resume it with resume_subagent and an effort instead.',
    agent: 'The subagent: its id or id prefix, or words from its task',
    effort: '{levels}, or a token budget',
    noMatch: 'No subagent matches "{query}".',
    notRunning: '{id} is not running ({status}). To go on with it at effort {effort}, resume it with resume_subagent and effort "{effort}".',
    doesNotFit: 'Effort {effort} does not fit {id}: {fits}.',
    set: '{id} ("{task}", {label}) thinks at effort {effort} from its next model request on{was}.',
    was: ' (it was {effort})',
  },
  effort: {
    notAnEffort: '"{effort}" is not an effort: use {levels}, or a token budget.',
    takes: '{label} takes effort {levels}',
    takesNone: '{label} does not take an effort',
  },
  refusalReport: {
    header: '[duckky-swarm] Refusal report: subagent {id} ({label}, {model}) stopped partway; its model refused{times}. Its task: "{task}".',
    times: ' ({count} times, retries included)',
    reason: 'The API\'s reason: {reason}',
    lastMessage: 'Its last message before the refusal:',
    called: '-> called {call}',
    lastResult: 'The last tool result it had been given:',
    refusedReply: 'What came back in the refused reply:',
    whatToDo: [
      '',
      'What to do: decide whether this work should go on.',
      '- If it should, and the subagent was missing context: call resume_subagent with agent "{id}" and a message that explains clearly what this work is: the user\'s goal, the scope, and the context from this conversation and the project\'s instructions that the subagent never saw. Describe it as it is; do not claim permissions or facts the conversation does not support. It rewinds to its last message before the refusal (the refused reply is cut out) and carries on, on {model}.',
      '- If it should not, tell the user why it stopped instead of resuming it.',
    ],
  },
  sendMessage: {
    refused:
      'duckky-swarm: {id} stopped on a refusal. Resume it with resume_subagent (agent "{id}"), which rewinds it to its last message before the refusal; a SendMessage would carry the refused reply on.',
  },
  hookFailed: {
    text: 'duckky-swarm: {tool} failed: {why}',
    timeout: 'it ran past the 10 s a hook has',
    threw: 'it threw',
  },
} as const satisfies Record<string, Record<string, Template>>

type Defaults = typeof DEFAULT_MESSAGES
export type Section = keyof Defaults
type Messages = { [S in Section]: { [K in keyof Defaults[S]]: Template } }

// The texts in use: the built-in ones until messages.json is read.
let current: Messages = DEFAULT_MESSAGES

const NAME = /\{(\w+)\}/g
export const placeholders = (t: Template) => new Set([...(typeof t === 'string' ? t : t.join('\n')).matchAll(NAME)].map((m) => m[1] as string))

// One pass over the template only: a value put in is never read for names, so
// a conversation that holds "{task}" stays as it is.
export function fill(t: Template, vars: Record<string, string | number> = {}): string {
  return (typeof t === 'string' ? t : t.join('\n')).replace(NAME, (all, name: string) => (name in vars ? String(vars[name]) : all))
}

export function text<S extends Section>(section: S, key: keyof Defaults[S] & string, vars?: Record<string, string | number>): string {
  return fill((current[section] as Record<string, Template>)[key] as Template, vars)
}

const isTemplate = (v: unknown): v is Template =>
  typeof v === 'string' || (Array.isArray(v) && v.every((line) => typeof line === 'string'))

// messages.json's texts over the built-in ones, key by key. `null`: there is
// no file, so the built-in texts. Returns what the file got wrong, each told
// plainly; the built-in text stands in for every one of those.
export function useMessages(json: string | null): string[] {
  current = DEFAULT_MESSAGES
  if (json === null) return []
  let file: unknown
  try { file = JSON.parse(json) } catch (err) {
    return [`messages.json is not valid JSON (${(err as Error).message}): using the built-in texts`]
  }
  if (!file || typeof file !== 'object' || Array.isArray(file)) return ['messages.json is not an object of sections: using the built-in texts']
  const problems: string[] = []
  const given = file as Record<string, unknown>
  const merged = {} as Record<string, Record<string, Template>>
  for (const [section, texts] of Object.entries(DEFAULT_MESSAGES) as [string, Record<string, Template>][]) {
    const fromFile = given[section] as Record<string, unknown> | undefined
    merged[section] = { ...texts }
    if (fromFile === undefined) continue
    if (!fromFile || typeof fromFile !== 'object' || Array.isArray(fromFile)) { problems.push(`${section} is not an object: its built-in texts are used`); continue }
    for (const [key, value] of Object.entries(fromFile)) {
      if (key.startsWith('_')) continue
      if (!(key in texts)) { problems.push(`${section}.${key} is not a text the plugin sends: ignored`); continue }
      if (!isTemplate(value)) { problems.push(`${section}.${key} must be a string or a list of strings: its built-in text is used`); continue }
      const known = placeholders(texts[key] as Template)
      for (const name of placeholders(value)) if (!known.has(name)) problems.push(`${section}.${key} uses {${name}}, which it is never given: it stays as written`)
      merged[section][key] = value
    }
  }
  for (const section of Object.keys(given)) if (!section.startsWith('_') && !(section in DEFAULT_MESSAGES)) problems.push(`${section} is not a section of messages.json: ignored`)
  current = merged as Messages
  return problems
}
