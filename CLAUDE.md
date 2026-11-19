# Duckky Swarm

A Claude Code plugin of function hooks: subagents on the exact model the user
names. `.claude-plugin/plugin.json` (with the `/config` settings under
`userConfig`), the hooks module `hooks/register.ts` (named by
`hooks/hooks.json`), and `.claude-plugin/marketplace.json` with
`"source": "./"`, so the repo itself is the marketplace.

- `messages.json` (root) + `hooks/messages.ts`: EVERY text sent to Claude
  (agent types, subagent/fork/resume prompts, tool descriptions and results,
  refusal report, resumed answer). Code asks `text(section, key, vars)` and
  never writes agent-facing words itself; a new text gets a key in
  `DEFAULT_MESSAGES` AND in messages.json (regenerate the file from the
  defaults rather than hand-copying). Read at session.start
  (`loadMessages`), laid over the built-in texts key by key; each mistake is
  a toast + log line and only that text falls back. `fill` is one pass, so a
  value holding "{task}" is never filled again. `messages.test.mjs` (plain
  Node) checks the file as edited. Toasts and /duckky output are for the
  person, not Claude, and stay in code.
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
- ⛔⛔ The `turn.step` hook on SUBAGENT steps (`e.agentId`) STREAMS every
  chunk straight through (`yield* next(ask)`); it applies effort, flips the
  band from starting to thinking, and counts a refusal it sees. Never hold a
  reply back: what the agent's view shows is what leaves the hooks, live.
  Up to 0.3.2 it held each reply until it ended, to ask again unchanged on a
  refusal: the agent's view stayed EMPTY while a reply ran (the user saw no
  chat for 50 s), and live the retry never ran, because Claude Code handles
  a classifier refusal BENEATH plugin hooks: it withholds the reply, adds an
  isMeta note ("stopped by a safety classifier... do not produce that content
  again"), asks again, and can fall back to another model (an opus-5 fork's
  third request went to claude-opus-4-8, which answered). So the Refusal
  retries setting is gone. `refusal.test.ts` proves the first chunk is out
  before the model finishes; the old holding hook times out on it (control
  run).
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
- The default model list is every current model of the claude-api skill's
  table (Mythos left out: Project Glasswing only). Take new ids from that
  table, never from memory. Not every model takes every effort:
  `effortsFor()` in models.ts (Haiku 4.5 none, Opus/Sonnet 4.6 no xhigh);
  set_subagent_effort, resume_subagent and a `@effort` default check it, and
  turn.step never ADDS an effort to a request Claude Code sent without one.
  Each model costs about 180 tokens of agent-type descriptions per session.
- `resume_subagent` falls back to `findOnDisk()` when the store has no
  record (a cleared store, keepAgents off): Claude Code's own
  `projects/<cwd>/<session>/subagents/agent-<id>.meta.json` + `.jsonl` for
  THIS cwd, by id prefix or by words from the meta's `description`. Proved
  live with a subagent the store had never seen.
- ⛔⛔ `resume_subagent` resumes a subagent of THIS session ITSELF with
  `$.session.send({ to: { agentId }, text })` (Claude Code's own resume: same
  id, transcript, list entry; Claude Code notifies the main agent). The user
  asked for this after a resume made a NEW agent in its place.
  "Of this session" = the record's `sessionId`, NOT `$.agent.list()`: the
  engine drops a finished subagent from that list soon after, exactly when
  it is resumed (measured live: a new agent was made). Only when the send is
  refused (one the person stopped) or the agent is from an earlier session
  does it spawn a new subagent given the transcript. Proved live: one
  transcript file, "KIWI-9" answered by the same agent.
- A resume runs on `startedModel(r)` (the duckky type's model), never
  `answeredBy`: Claude Code's refusal fallback can answer an opus-5 fork with
  opus-4-8, and resuming there left the model the user chose.
- `hooks/session-copy.ts`: every subagent is also written as a main session
  (`projects/<cwd>/<sessionIdFor(agentId)>.jsonl`: its user/assistant/
  attachment/system records, `isSidechain:false`, no `agentId`, first
  `parentUuid:null`, an `ai-title`) at SubagentStop and again 3 s later
  (Claude Code writes the last reply just AFTER the stop: the first copy
  lacked it, measured), and by `/duckky open <id>`. `claude --resume <id>`
  opens it as the main agent (proved live with -p). Its title is a
  `custom-title` record (what /rename writes; AI titles never replace it)
  with `duckkyTurns`, the turns the plugin wrote: a copy with more turns
  (the person typed in it) is never written over. `--resume` takes a
  session's exact TITLE but not an id prefix (measured), so the title is the
  workspace folder's name.
- `hooks/workspace.ts`: a duckky subagent's folder
  `<cwd>/duckky-swarm/<model>-<key>-<slug(task)>/` with findings/opening/
  closed/block/devlogs.md and temp/ (+ `duckky-swarm/.gitignore` = `*`),
  made in the `agent.spawn` hook BEFORE `next(e)`, its rules appended to the
  task. ⛔ The key is the plugin's own (`workspaceKey`), not the agent id: a
  `turn.start` hook cannot change the turn, and the agent id exists only
  after the spawn, so the task that names the folder is written first. The
  session copy's id is `sessionIdFor(workspaceKey)`, one copy per workspace.
  A subagent that carries on as a new one keeps its workspace:
  resume_subagent appends the rules itself and leaves the workspace in
  `pendingWorkspace` (by prompt key) so the spawn hook adds nothing (adding
  would also break `pendingEffort`'s prompt key). Files are written only
  where missing. Proved live: the subagent kept all five notes and put its
  test script in temp/, src/ untouched, and `claude --resume <folder name>`
  opened it. Setting: `workspaces` (on).
- Reports in the chat (`reports`: background by default, every, off): at a
  duckky subagent's `turn.complete` its report (`subagentReport`, messages
  `report`) goes to `$.prompt.submit`, a real user message the person sees,
  Claude reads, and the person can rewind and edit (proved live: isMeta
  false, "The duckky-swarm plugin sent a message: [duckky-swarm] Report
  from subagent..."). Claude Code still sends its own hidden task notice, so
  Claude gets it twice; it handled that fine live. Not on a refusal (the
  refusal report went already), not for built-in subagents.
- The session index: `copyAsSession` also writes
  `<config>/duckky-swarm/sessions/<sid>.json` (one file per copy, so two
  sessions never race), even when it leaves a diverged copy alone.
  `bin/sessions.mjs` (pure, shared) reads it for `/duckky sessions` and for
  `bin/duckky.mjs`, the `duckky` command (package.json `bin`; installed with
  `npm install -g github:buggerlogger/duckky-swarm`). `duckky` opens a
  session in its own project folder (Claude Code finds sessions by the
  folder it runs in) or, `--here`, copies it into the current folder's
  project first; `--print` and `-- <args>` exist for testing without a
  window. On Windows claude is claude.cmd: one quoted command line to a
  shell (an args array with shell:true prints DEP0190). Plugins cannot add
  flags to `claude` ("error: unknown option '--duckky'"), so `duckky shell`
  adds a shell function named claude (`shellBlock`, between marker lines,
  `withBlock` idempotent, `--remove`): PowerShell's CurrentUserAllHosts
  profile (never the person's own per-host file) and pwsh's, plus
  .bashrc/.zshrc if they exist. It passes every other call to the real
  claude (claude.ps1, else claude.cmd) and piped input only when there is
  some: an empty pipe makes claude think its input is not a terminal. The
  user's `cc` profile switcher calls `claude` too, so it goes through it.
  Proved in a real PowerShell (test): --duckky reaches duckky, --version
  reaches claude.
- Your own texts: `~/.claude/duckky-swarm/messages.json`, laid over the
  plugin's file (`useMessages(plugin, own)`), so an update keeps them.
- Matching: `findMatches` returns every match; `findAgent` returns one or
  none, and the tools answer `resumeTool.ambiguous` with the list instead of
  guessing. A subagent and the one it carried on as are one lineage
  (`resumedFrom`): only the newest counts.
- ⛔ Write test code with backslashes (regexes, Windows paths) with the
  Edit/Write tools, never through a bash heredoc or `node -e`: the
  backslashes are lost on the way (five times in one session).
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
Proof is the subagent's `.meta.json` (`agentType`) and `message.model` (and
`effort`) on every `assistant` record of its `.jsonl`. ⛔ Not every `"model"`
string: Claude Code's `api-request-shape` record names other models too (its
advisor, measured: `claude-opus-5-5` in a Haiku 5.5 subagent's transcript
whose replies were all Haiku). Afterwards delete the temp folder and its
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
  (`agentType`) and `message.model` on the `assistant` records of
  `agent-<id>.jsonl` (not every `"model"` string; see above).

## Rules

- ⛔⛔ A hook has 10 s of its OWN time (`HookBudget.ms`). The clock stops only
  while a `next(e)` or a `$` call is in flight; awaiting a Promise the plugin
  made itself counts in full. `resume_subagent` used to await the resumed
  agent's answer that way: live it was cut off at 10.4 s with "no tool.call
  hook answered" while the agent worked 4.5 minutes on, its answer lost, and
  the main agent started the same work again. A plugin's spawn always runs in
  the background, so the tool returns at once and `turn.complete` delivers
  the answer with `$.prompt.submit` (`delivering`, `resumedReport`). The test
  kit does NOT enforce the budget, and a plugin spawn there gets no agent id:
  anything that waits must be proved live with a run longer than 10 s.
- A failing hook of the plugin's OWN tool answers its own error from
  `.catch` (`hookFailed`): passing it down (`next(e)`) reaches the engine's
  "no tool.call hook answered", which says nothing of why.
- Under `claude -p` a plugin-spawned background agent dies when the main
  turn ends; an interactive session keeps it. A live test of delivery keeps
  the main turn busy past the agent's end.
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
