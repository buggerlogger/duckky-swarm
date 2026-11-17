# Duckky Swarm

**Subagents on the exact model you name.** Tell Claude "use an Opus 4.6
subagent to ..." and it does: the subagent runs on `claude-opus-4-6`, and
Duckky Swarm shows you the model it really ran on.

Claude Code's Agent tool takes only four model aliases (`sonnet`, `opus`,
`haiku`, `fable`), so "Opus 4.6" cannot be said there and Claude declines.
Duckky Swarm turns each model you list into an agent type that Claude picks
by itself when you name that model.

Measured in a real session: asked for "a subagent running on Opus 4.6",
Claude chose `duckky-swarm:opus-4-6` on its own, and every reply in that
subagent's transcript was from `claude-opus-4-6` (the main session ran on
another model).

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install duckky-swarm --marketplace buggerlogger/duckky-swarm
```

From a shell:

```
claude plugin install duckky-swarm --marketplace buggerlogger/duckky-swarm
```

In the desktop app, where `/plugin` does not run: click + next to the prompt
box, then Plugins, Add marketplace with `buggerlogger/duckky-swarm`, then Add
plugin.

## Use

- Ask in plain words: "use an Opus 4.6 subagent to review this file", "run
  three Opus 5 agents on these tasks".
- **Fork onto another model:** "fork onto Opus 4.6 and ...". A built-in fork
  always stays on the main session's model, so Duckky Swarm gives the fork a
  copy of the conversation instead (Fork on another model = `context`).
- **Resume, even after you stop or close the session:** "resume subagent
  ac82d396 and ask it ...", or name it by words from its task. It continues on
  the same model with its earlier transcript, and its answer comes back to you.
- `/duckky` lists your subagents: the model each started on and the model the
  API reported answering, its task, its status and its id (for resuming).
- If Claude Code starts a subagent on a different model than you asked for, a
  toast says so.

Measured in real sessions: a fork onto Opus 4.6 recalled a code word given
earlier in the conversation, on `claude-opus-4-6`; a NEW session then resumed
that fork by its id, and it answered the code word again from its old
transcript alone.

## Settings (`/config`)

| Setting | Default | What it does |
|---|---|---|
| Subagent models | `opus-4-6=claude-opus-4-6, opus-5=claude-opus-5, opus-5-5=claude-opus-5-5` | Each `name=model-id` becomes an agent type |
| Fork on another model | `context` | `context`: a subagent on the chosen model given a copy of the conversation. `true`: a real fork, which always stays on the parent's model |
| Keep subagents across sessions | on | Remember each subagent after the session ends, to resume it later |

## Coming next

1. `/duckky` opens a window split into a grid, one live pane per running
   subagent.
2. The animated Claude Code characters in that window.

## Develop

```
claude --plugin-dir .          a session with this folder loaded; saving a file reloads it
claude plugin validate .       the manifest, the marketplace and the hooks, as the engine reads them
claude plugin test .           hooks/*.test.ts, run against the engine itself
```

## License

Apache-2.0. See [LICENSE](LICENSE).
