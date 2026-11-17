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
  prompt rewrite, records, the `resume_subagent` and `set_subagent_effort`
  tools, `/duckky`
- `hooks/launcher.ts`: how `/duckky` opens the window (PowerShell Start-Process
  via `-EncodedCommand`; the paths go in as DUCKKY_VIEWER / DUCKKY_DIR, never
  on a command line). Change the script and you must re-encode it:
  `Buffer.from(script, 'utf16le').toString('base64')`; a viewer test checks.
- `characters/sprites.mjs`: Clawd (18 x 5 px on a 24 x 10 canvas, 12 x 5
  cells) and a scene per activity: MOTION (moves, arms, feet) + PROPS (book,
  laptop, goggles, hard hat, rocket, tea...). Every scene must look different
  (a test holds it) and have a LABEL. Pure, shared by the window (ANSI) and
  the band (Raster cells). Drawn in QUADRANT blocks, 2 x 2 px a cell, as
  Claude Code's banner draws it: at rest it is exactly `▐▛███▜▌` /
  `▝▜█████▛▘` / `▘▘ ▝▝` (a test holds that). A quadrant cell has ONE
  foreground: `cellsOf` puts a second colour in the cell's background when
  the cell is fully covered by two (a prop over Clawd). Eyes are holes; a
  blink fills them. `--gallery` shows every scene; check new art there.
- The Character setting (`/config`: "Clawd (recommended)", the default, or
  "Duckky Ducks"): `characters/index.mjs` `characterFor()` maps it to a
  character ({ name, canvasFor, ansiLines, rasterCells }); anything without
  "duck" in it is Clawd. The band gets it from register.ts; the window gets
  it as DUCKKY_CHARACTER in /duckky's env (inherited through Start-Process,
  so the encoded launch script is unchanged) or `--character ducks`.
- `characters/ducks.mjs`: the project's own ducks (the logo's duckling, and
  the hero in shades and a hoodie, `skin`; only the duckling is offered).
  `node viewer/duckky-view.mjs --gallery --character ducks` shows them. Same
  canvas, MOTION and exports as sprites.mjs. A pixel is twice as tall as it
  is wide, so a round duck is drawn
  wide. ⛔ A cell shows TWO colours: a third is dropped, and every duck bug
  so far was one (a one-pixel side-step breaking the face, so ducks step
  2 px; a book's spine bobbing into the beak; shades beside the beak read as
  fangs). A test checks no cell ever needs three, in every skin, scene and
  frame; put back, each of those bugs fails it. Black on a dark terminal
  reads as a gap: keep yellow around the shades.
- `viewer/model.mjs` decides the scene: `activityOf(tool, input)` (a shell
  command by its words: deploy > git at the start > install > test > build),
  pass/fail from the tool result of a test, and `shownActivity()` turns a
  command running past 20 s into tea and a test result back into thinking
  after 4 s. The hooks use the same functions, so the band and the window
  agree. Each Clawd's phase comes from its id
  through FNV + fmix32: FNV alone put six agents in one rhythm. Clawd's
  design is Anthropic's: keep the README's credit and no-affiliation note.
  Nothing of wigglet is copied (no licence).
- `hooks/band.tsx`: the band above the prompt (`ui.render` AbovePrompt), a
  stage per running subagent with a `Raster`; layout only, no `$`. The
  ticker that repaints the Rasters (`$.ui.blit`) starts in `session.start`:
  timers outlive a dispatch only there. Raster cells are base64 of LE u32
  [codePoint, fg 0xRRGGBB, bg] (0x01000000 = default); one bad cell refuses
  the tree. A plugin cannot draw inside Claude Code's own agent list: the
  band is the nearest place.
- A plain `tool.call` hook (no matcher) watches every call for a subagent's
  `agentId` to set its activity; it never changes the call.
- Refusal retries: a `turn.step` hook on SUBAGENT steps (`e.agentId`) holds
  each response until it ends; a `stopReason` of `refusal` is dropped (never
  yielded, so never shown or recorded: what leaves the outermost hook is what
  the engine keeps) and `next(e)` is called again. MEASURED in the test kit:
  a second `next(e)` in a step hook really sends the request again (the fake
  model counted 3 requests), it does not replay. The budget is per subagent
  (`refusalsOf`), across its run; past it the refusal goes through. The
  request's messages are pinned, so nothing can be added: it is asked again
  unchanged, by design. Not tested against a live refusal (that would mean
  sending something meant to be refused).
- The refusal report (`hooks/brief.ts`, `refusalScene` in history.ts): when a
  subagent's turn ends on a refusal, its transcript gives its last message
  before the refusal, the last tool result and the refused text. The report
  rides the main agent's Agent call as `context` (a `tool.call` hook on
  `Agent`, matched by the spawn's `tool_use_id`), or for a background agent
  is sent with `$.prompt.submit`. It asks the main agent to resume with a
  clear, ACCURATE account of the work, or to tell the user why it stopped;
  keep it that way (no "do the refused step yourself": the user chose a
  refusal report). `resume_subagent` always rewinds with
  `transcriptLines(..., { beforeRefusal: true, fullTail: 4 })`.
- No live test of the refusal path: a nested `claude -p --permission-mode
  bypassPermissions` with a simulated-refusal switch was blocked by Claude
  Code's auto-mode classifier ("Undermining Oversight"), and the switch was
  removed. The test kit fakes a refusing model instead (hooks/refusal.test.ts,
  the refusal report tests in register.test.ts). Do not reintroduce a
  simulation switch or route around that block.
- Effort (how hard a subagent's model thinks): at spawn it is the Agent
  call's own `effort` (Claude Code's; proved live), or a type's default from
  `/config` (`opus-5-5=claude-opus-5-5@high`, registered as the type's
  `effort`). Changed later by the `turn.step` hook: `effortFor` (agent id ->
  effort) rewrites `e.effort` on that subagent's NEXT request.
  `set_subagent_effort` fills it for a running subagent; `resume_subagent`'s
  `effort` is matched to the resumed agent at `turn.start` by its prompt
  (`pendingEffort`), since its first request can come before the spawn
  returns an id. Proved live: a background subagent's replies went 3 x low
  then 7 x high. The window reads each reply's `"effort"` from the transcript.
- `resume_subagent` falls back to `findOnDisk()` when the store has no
  record (a cleared store, keepAgents off): Claude Code's own
  `projects/<cwd>/<session>/subagents/agent-<id>.meta.json` + `.jsonl` for
  THIS cwd, by id prefix or by words from the meta's `description`. Proved
  live with a subagent the store had never seen.
- In the test kit `$.turn.step(...)` has no `.result`: read the generator's
  return value (`{ done: true, value }`). The plugin's own `next(e)` streams
  do have `.result`.
- `viewer/`: the swarm window, plain Node with no dependencies, OUTSIDE the
  hooks environment. `model.mjs` (transcript -> agent) and `render.mjs`
  (grid, panes) are pure; `duckky-view.mjs` reads only new bytes and draws.
  `figure()` in render.mjs is the character's corner (FIGURE_W x FIGURE_H).

## The README's images (`assets/`)

- `logo.png` (640 px) and `social-preview.png` (1280 x 640, for GitHub's
  Settings > Social preview, which has no API) are made from the logo with
  System.Drawing. `band.png` and `swarm-window.png` are the user's own
  screenshots. `gallery-clawd.png` / `gallery-ducks.png`: a new window running
  `viewer/duckky-view.mjs --gallery [--character ducks]`, taken with
  PrintWindow on the exact title "Duckky Gallery", then stopped by PID.
  Retake them when a scene changes. Never put a capture of a real session in
  here without reading it first: the window shows paths, and paths name the
  user.

## Looking at the window

- `node viewer/duckky-view.mjs <subagents folder> --once --width 132 --height 34`
  prints a frame as text: use it first.
- ⛔ To see the real window, render THAT window only: PrintWindow on the one
  window whose title is exactly "Duckky Swarm"
  (scratchpad shot-window.ps1 in the session that built it). Never copy screen
  pixels (CopyFromScreen): Windows refused to raise the window, and the grab
  captured another app's private window instead.
- Stop a test viewer by its PID after checking its command line names
  duckky-view.mjs.

## Checked in a real claude (do it again after changing these paths)

- Exact model: `claude -p "Use a subagent running on Opus 4.6 to ..." --plugin-dir .`
- Context fork: turn 1 gives a code word (`--session-id X`); turn 2
  (`--resume X`) "fork onto Opus 4.6 and have the fork tell me the code word".
- Resume: a NEW session, "resume subagent <id> and ask it the code word".
Proof is the subagent's `.meta.json` (`agentType`) and every `"model"` (and
`"effort"`) in its `.jsonl`. Afterwards delete the temp folder and its
`projects/<cwd>` folder, and from
`~/.claude/plugins/store/duckky-swarm_inline-*.json` ONLY the records whose
`cwd` is that temp folder. ⛔ Never delete the store file: every
`--plugin-dir` session of this folder shares it, the user's own included
(deleting it once wiped the user's sandbox records).

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
