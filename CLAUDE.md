# Duckky Swarm

A Claude Code plugin of function hooks: subagents on the exact model the user
names. `.claude-plugin/plugin.json` (with the `/config` settings under
`userConfig`), the hooks module `hooks/register.ts` (named by
`hooks/hooks.json`), and `.claude-plugin/marketplace.json` with
`"source": "./"`, so the repo itself is the marketplace.

- `hooks/models.ts`: the /config model list -> agent types (pure, tested alone)
- `hooks/history.ts`: a conversation / transcript as text within a budget (pure)
- `hooks/records.ts`: one `$.store` record per subagent, key `agent:<id>`
- `hooks/register.ts`: the types (`<name>` and `<name>-fork`), the context-fork
  prompt rewrite, records, the `resume_subagent` tool, `/duckky`

## Checked in a real claude (do it again after changing these paths)

- Exact model: `claude -p "Use a subagent running on Opus 4.6 to ..." --plugin-dir .`
- Context fork: turn 1 gives a code word (`--session-id X`); turn 2
  (`--resume X`) "fork onto Opus 4.6 and have the fork tell me the code word".
- Resume: a NEW session, "resume subagent <id> and ask it the code word".
Proof is the subagent's `.meta.json` (`agentType`) and every `"model"` in its
`.jsonl`. Afterwards delete the temp folder, its `projects/<cwd>` folder and
`~/.claude/plugins/store/duckky-swarm_inline-*.json` (the test records).

## The loop

- `claude plugin validate .` after every change: it reads the manifests and
  the module the way a session will. It must end `Validation passed`.
- `claude plugin test .` runs `hooks/*.test.ts` against the engine. The
  test's `$` is the engine's own: its calls take an event's WHOLE input.
- Type-check with tsc against this build's types file (see the plugin-authoring
  skill for its path); `.claude-plugin/types/` holds it once an interactive
  `claude --plugin-dir .` has loaded the folder.
- `claude --plugin-dir .` to try it in a real session. Try a slash command
  INTERACTIVELY: measured on 2.1.311, `claude -p "/duckky" --plugin-dir .`
  lists the command yet sends the prompt to the model; `command.run` never
  fires. Agent types DO work under `-p`.
- Proof of the model a subagent ran on is on disk:
  `~/.claude/projects/<cwd>/<session>/subagents/agent-<id>.meta.json`
  (`agentType`) and every `"model"` in `agent-<id>.jsonl`.

## Rules

- ⛔ `$` may only be passed to a function declared at the TOP of a file (or
  imported from one): the engine refuses to load a module that hands `$` to
  a closure inside `register`. Module state lives at the top too.
- `$.agent.register` rejects until the session is bound: call it after
  `next(e)` in `session.start`.
- A real fork ignores `model` and always runs on the parent's model.
- ⛔ A plugin tool's `result` is a STRING (or content blocks). An object was
  refused live ("does not match its output shape") AFTER the agent ran, and
  the test kit does not catch it.
- Claude Code reports a started model as `claude-opus-4-6[1m]` (1M-context
  variant); compare with `sameModel()`, never `===`.
- `$.fs.read` paths arrive normalised (`C:/a` as `C:\a`): a test's fake fs
  must compare them that way.
- In the test kit a spawn the PLUGIN makes reaches the test's `agent.spawn`
  hook as the Agent tool's input (`subagent_type`), and gets no agent id back
  (ids are "set by core"): what follows a plugin spawn is proved live.
- A plugin name cannot start with `claude-`, `anthropic-` or `cc-plugin-`.
- Never guess a field: grep the types. `$.plugin` has `name` and `root`, no
  `version`.
- Bump `version` in `.claude-plugin/plugin.json` when the hooks change, so
  `claude plugin update` sees a new version.
- Commits are authored `buggerlogger <buggerlogger@github.com>` (set in this
  repo's git config) with no Co-Authored-By line. Commit and push only when
  the user says so.
