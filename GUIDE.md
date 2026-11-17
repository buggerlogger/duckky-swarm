# Guide

[README](README.md) is the short version. This file is the rest.

Version in `.claude-plugin/plugin.json` is the version Claude Code updates from.

## Why the agent types exist

The Agent tool's `model` field is an alias, not a model id. "Opus 4.6" cannot be passed through it, and Claude declines the request.

Each entry in Subagent models becomes an agent type `duckky-swarm:<name>`. Claude selects that type when you name the model. The id on the type is what the subagent calls.

A started model is sometimes reported as `claude-opus-4-6[1m]`. That is the same id with a context-window suffix. The mismatch toast compares the base id.

## Settings

Open `/config` after install. The defaults are already filled in. Claude Code may say they are "not yet set". That message is wrong. Change a field only if you want something other than the default.

| Setting | Default | |
|---|---|---|
| Subagent models | every current id, comma separated | `name=model-id`, or a bare id. `@effort` sets the type default: `opus-5-5=claude-opus-5-5@high`. Effort is `low`, `medium`, `high`, `xhigh`, `max`, or a token budget. A bad entry is skipped. One typo does not drop the rest of the list. |
| Fork on another model | `context` | `context` starts a subagent on the named model and gives it a copy of the conversation. `true` is a real fork, which stays on the parent model. |
| Keep subagents across sessions | on | The store keeps model, task, and transcript so a later session can resume. |
| Character | Clawd | Clawd or Duckky Ducks, above the prompt and in `/duckky`. |
| Refusal retries | 3 | Same request, from the message before the refusal, up to this many times. `0` turns it off. |

The shipped default list is long: Fable, Opus, Sonnet, and Haiku ids from 4.5 upward. Each type is added to the session prompt. Delete the ones you do not use.

Not every model accepts every effort. Opus 4.5 takes `low`, `medium`, `high`. Opus 4.6 and Sonnet 4.6 take those plus `max`, not `xhigh`. Haiku 4.5, Sonnet 4.5, and Claude 3 take none. An effort the model rejects is a 400 and the subagent stops. A number is a token budget, and only on a model that takes effort at all.

## Resume

"Resume subagent ac82d396" or words from its task. `resume_subagent` rewinds to the last message before a refusal when that is how the turn ended.

If Keep subagents is off, or the store was cleared, the plugin looks in Claude Code's own files for this project: `projects/<cwd>/<session>/subagents/agent-<id>.meta.json` and the matching `.jsonl`.

## Effort after spawn

The spawn uses the Agent call's `effort` if you set one, otherwise the `@effort` on the type.

"Set that subagent's effort to high" calls `set_subagent_effort`. The next request from that subagent uses it. "Resume a39e1b46 with effort max" sets effort on the resumed agent before its first request, which can leave before the spawn returns an id.

The window reads `"effort"` off each reply in the transcript.

## Refusals

A `stopReason` of `refusal` is dropped. The same request is sent again, unchanged, up to Refusal retries. A retry that gets through continues from the message before the refusal. The refused text is not kept.

After the last retry the subagent stops. The parent gets a report: last message before the refusal, last tool result, the refused text, and the API reason. It can `resume_subagent` with a clearer task, or tell you to stop. `SendMessage` to a refused subagent is pointed at `resume_subagent`, because a normal message would carry the refused reply forward.

This covers a refusal that was a glitch. It does not rephrase the request to get past a real one.

## The window and the band

`/duckky` lays the session's subagents in a grid. Four agents is 2 x 2. Each pane has the character, model, task, status, current activity, and the latest tool calls.

Above the prompt, a band shows one stage per running subagent. A finished one stays for a few seconds, then leaves. The band is separate from Claude Code's own agent list. A plugin cannot draw inside that list.

If the model that started is not the one you asked for, a toast says so.

`/duckky list` prints the model the agent was started with, the model the API reported, the task, the status, and the id.

## Scenes

The character follows the tool the subagent is in.

| Scene | Tool |
|---|---|
| book, page turning | reading a file |
| laptop | editing a file |
| magnifier | search |
| globe | web fetch |
| goggles, test tube | tests (`npm test`, `pytest`, `go test`) |
| green check, or a red X | that test run passed or failed |
| hard hat | build (`build`, `make`, `tsc`) |
| branch | `git` or `gh` |
| box, arrow in | install |
| rocket | deploy (`deploy`, `docker push`, `npm publish`) |
| tea | a command still running after 20 seconds |
| speech bubble | writing the answer |
| thought dots | thinking |
| a smaller character beside it | it started its own subagent |
| jump | finished |
| night cap | stopped |
| red no-entry sign | refused after the last retry |

```
node viewer/duckky-view.mjs --gallery
node viewer/duckky-view.mjs --gallery --character ducks
```

<p align="center"><img src="assets/gallery-clawd.png" width="640" alt="Clawd in every scene"></p>
<p align="center"><img src="assets/gallery-ducks.png" width="640" alt="Duckky Ducks in every scene"></p>

Clawd is the default. Duckky Ducks uses the same moves. The done duck wears sunglasses. A done Clawd jumps.

<p align="center"><img src="assets/band.png" width="720" alt="The band above the prompt"></p>

## Work on it

```
claude --plugin-dir .          this folder as the plugin; save reloads it
claude plugin validate .       manifest, marketplace, hooks
claude plugin test .           hooks/*.test.ts
node --test viewer/viewer.test.mjs characters/sprites.test.mjs
node viewer/duckky-view.mjs <subagents folder> --once
```

`claude -p "/duckky"` lists the command and then sends the text to the model. `command.run` does not fire. Agent types do work under `-p`. Run `/duckky` in an interactive session.

Proof of the model is on disk: `~/.claude/projects/<cwd>/<session>/subagents/agent-<id>.meta.json` (`agentType`) and every `"model"` and `"effort"` in `agent-<id>.jsonl`.

Changing the PowerShell launch script means re-encoding it. `viewer/viewer.test.mjs` checks the constant in `hooks/launcher.ts` against that encoding.
