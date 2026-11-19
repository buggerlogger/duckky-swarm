#!/usr/bin/env node
// Copyright 2026 buggerlogger (https://github.com/buggerlogger)
// SPDX-License-Identifier: Apache-2.0
//
// duckky: every duckky subagent session on this computer, in every project,
// and opens one as a normal Claude Code session, from any folder.
//
//   duckky                       the list, then asks which to open
//   duckky list [words]          the list (only those matching the words)
//   duckky <name|number|id>      opens it in its own project folder
//   duckky open <...> --here     opens it in the folder you are in
//   duckky open <...> --print    prints the command instead of running it
//   duckky open <...> -- <args>  passes <args> on to claude (e.g. -p "...")
//   --config <dir>               Claude Code's folder (else CLAUDE_CONFIG_DIR, else ~/.claude)
//
// Install: npm install -g github:buggerlogger/duckky-swarm

import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { INDEX_DIR, listing, matchSessions, openLine, parseEntries, projectKey } from './sessions.mjs'

const all = process.argv.slice(2)
const cut = all.indexOf('--')
const args = cut >= 0 ? all.slice(0, cut) : all
const passOn = cut >= 0 ? all.slice(cut + 1) : []
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }
const has = (name) => args.includes(`--${name}`)
const words = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--config')

if (has('help') || args.includes('-h')) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//   ') || l.startsWith('// Install')).map((l) => l.slice(3)).join('\n'))
  process.exit(0)
}

const configDir = flag('config') || process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
const indexDir = join(configDir, ...INDEX_DIR.split('/'))
const entries = parseEntries(existsSync(indexDir)
  ? readdirSync(indexDir).filter((f) => f.endsWith('.json')).map((f) => { try { return readFileSync(join(indexDir, f), 'utf8') } catch { return '' } })
  : [])

// Quoted for cmd.exe, which runs claude.cmd on Windows: an argument with a
// space or a quote is one argument still.
const quote = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)

function open(e) {
  const here = has('here')
  const cwd = here ? process.cwd() : e.cwd
  const argv = ['--resume', e.sessionId, ...(e.model ? ['--model', e.model] : []), ...passOn]
  if (has('print')) { console.log(here ? `claude ${argv.map(quote).join(' ')}` : openLine(e) + (passOn.length ? ` ${passOn.map(quote).join(' ')}` : '')); return }
  if (!existsSync(e.file)) { console.error(`Its session file is gone: ${e.file}`); process.exit(1) }
  if (here) {
    // Claude Code looks for a session in the folder it runs in: copy it there
    const target = join(configDir, 'projects', projectKey(cwd), `${e.sessionId}.jsonl`)
    if (!existsSync(target)) { mkdirSync(join(configDir, 'projects', projectKey(cwd)), { recursive: true }); copyFileSync(e.file, target) }
  } else if (!existsSync(cwd)) {
    console.error(`Its project folder is gone: ${cwd}\nOpen it in the folder you are in: duckky open ${e.name} --here`)
    process.exit(1)
  }
  console.log(`Opening ${e.name}\nin ${cwd}`)
  // On Windows claude is claude.cmd, which only a shell runs: one command line,
  // quoted here (Node warns about an argument list given to a shell)
  const child = process.platform === 'win32'
    ? spawn(['claude', ...argv.map(quote)].join(' '), { cwd, stdio: 'inherit', shell: true })
    : spawn('claude', argv, { cwd, stdio: 'inherit' })
  child.on('exit', (code) => process.exit(code ?? 0))
  child.on('error', (err) => { console.error(`Could not start claude: ${err.message}`); process.exit(1) })
}

function choose(query) {
  const found = matchSessions(entries, query)
  if (found.length === 1) return open(found[0])
  if (!found.length) { console.error(`No duckky session matches "${query}". duckky list shows them all.`); process.exit(1) }
  console.error(`Several sessions match "${query}":`)
  for (const line of listing(found)) console.error(line)
  console.error('Name one, or use its number from duckky list.')
  process.exit(1)
}

const [verb = '', ...rest] = words
if (verb === 'open') choose(rest.join(' '))
else if (verb === 'list' || (!verb && !process.stdin.isTTY)) {
  const shown = rest.length ? matchSessions(entries, rest.join(' ')) : entries
  for (const line of listing(shown)) console.log(line)
} else if (!verb) {
  for (const line of listing(entries)) console.log(line)
  if (!entries.length) process.exit(0)
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  rl.question('\nOpen which one? A number or a name (Enter to quit): ', (answer) => {
    rl.close()
    if (answer.trim()) choose(answer)
  })
} else choose(words.join(' '))
