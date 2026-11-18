<h3 align="center">Claude Code subagents on the exact model you name, with proof of the model they ran on.</h3>
<h1 align="center"><img src="assets/logo.png" width="300" alt="Duckky Swarm"></h1>

<p align="center">
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/github/license/buggerlogger/duckky-swarm?style=flat-square"></a>
  <a href="#install"><img alt="Claude Code plugin" src="https://img.shields.io/badge/Claude%20Code-plugin-D97757?style=flat-square&logo=claude&logoColor=white"></a>
  <a href="#clawd-or-duckky-ducks"><img alt="characters: Clawd, Duckky Ducks" src="https://img.shields.io/badge/characters-Clawd%20%C2%B7%20Duckky%20Ducks-FFCB2F?style=flat-square"></a>
  <a href="https://github.com/buggerlogger/duckky-swarm/stargazers"><img alt="stars" src="https://img.shields.io/github/stars/buggerlogger/duckky-swarm?style=flat-square"></a>
  <a href="https://github.com/buggerlogger/duckky-swarm/commits/main"><img alt="last commit" src="https://img.shields.io/github/last-commit/buggerlogger/duckky-swarm/main?style=flat-square"></a>
  <img alt="status: beta" src="https://img.shields.io/badge/status-beta-orange?style=flat-square">
</p>
<p align="center"><br/>
<code>/plugin install duckky-swarm --marketplace buggerlogger/duckky-swarm</code>
</p>

Claude's Agent tool only takes `sonnet`, `opus`, `haiku`, and `fable`. Say "Opus 4.6" and it shrugs. This plugin turns each model in your list into an agent type, so that sentence runs on `claude-opus-4-6`. The window prints the model id from the transcript, not the name you hoped for.

## Install

In a Claude Code terminal:

```
/plugin install duckky-swarm --marketplace buggerlogger/duckky-swarm
```

Shell: `claude plugin install duckky-swarm --marketplace buggerlogger/duckky-swarm`.

Desktop app has no `/plugin`. Hit + by the prompt, Plugins, add marketplace `buggerlogger/duckky-swarm`, then add the plugin.

## Use

- "Use an Opus 4.6 subagent to review this file."
- "Fork onto Opus 4.6." A normal fork stays on the parent model. This one copies the chat onto the model you named.
- "Resume subagent ac82d396." Same model, same transcript, in the background. The answer comes as a message when it's done. Words from the task work too.
- "Opus 5.5, low effort." "Set that one's effort to high" hits the next request.

`/duckky` opens a pane per subagent. `q` quits. `/duckky list` is model, task, status, id.

Needs Node. Windows opens the window. Other systems get the command to paste.

If the model that actually started is not the one you asked for, you get a toast.

<p align="center"><img src="assets/band.png" width="900" alt="A row of Clawds above the prompt, one per running subagent"><br/>
<sub>Above the prompt: who is running, on which model, and what they are doing.</sub></p>

<p align="center"><img src="assets/swarm-window.png" width="900" alt="The /duckky window, six subagent panes"><br/>
<sub><code>/duckky</code>: one pane each, live, with the model from the transcript.</sub></p>

### Clawd or Duckky Ducks

Clawd is the default. Duckky Ducks is the other option in `/config`. Same scenes. The duck that finishes puts the sunglasses on.

<table>
  <tr>
    <td align="center"><img src="assets/gallery-clawd.png" alt="Clawd in every scene"><br/><sub><b>Clawd</b></sub></td>
    <td align="center"><img src="assets/gallery-ducks.png" alt="Duckky Ducks in every scene"><br/><sub><b>Duckky Ducks</b></sub></td>
  </tr>
</table>

```
node viewer/duckky-view.mjs --gallery
node viewer/duckky-view.mjs --gallery --character ducks
```

## Change the words

Everything the plugin says to Claude is in [messages.json](messages.json): agent types, subagent prompts, fork and resume prompts, tool text, refusal reports. Edit it and save. A mistake shows a toast and that one text falls back to the built-in wording.

Scenes, `/config`, effort, refusals, and the test commands are in [GUIDE.md](GUIDE.md).

## Credit

Clawd is Anthropic's. This drawing is unofficial. The ducks are from the logo, and they are ours.

Not affiliated with, sponsored by, or endorsed by Anthropic. Claude, Claude Code, and Anthropic are trademarks of Anthropic, PBC.

Code is Apache-2.0. See [LICENSE](LICENSE). That does not cover the character or the trademarks.
