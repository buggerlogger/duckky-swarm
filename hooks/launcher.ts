// Copyright 2026 buggerlogger (https://github.com/buggerlogger)
// SPDX-License-Identifier: Apache-2.0
//
// How /duckky opens the swarm window on Windows: PowerShell's Start-Process
// starts node in a console window of its own and returns at once ($.process.run
// waits for its child, so the viewer cannot be that child).
//
// Nothing that varies is on a command line. The viewer's path and the folder
// it watches go in as environment variables, and the script is passed with
// -EncodedCommand (base64 of its UTF-16LE text), so no quote or space in a
// user's path can break it. The script is fixed, so its encoding is a
// constant; viewer/viewer.test.mjs checks that the two below agree.

export const LAUNCH_SCRIPT = `Start-Process -FilePath node -ArgumentList ('"' + $env:DUCKKY_VIEWER + '"')`

export const LAUNCH_ENCODED =
  'UwB0AGEAcgB0AC0AUAByAG8AYwBlAHMAcwAgAC0ARgBpAGwAZQBQAGEAdABoACAAbgBvAGQAZQAgAC0AQQByAGcAdQBtAGUAbgB0AEwAaQBzAHQAIAAoACcAIgAnACAAKwAgACQAZQBuAHYAOgBEAFUAQwBLAEsAWQBfAFYASQBFAFcARQBSACAAKwAgACcAIgAnACkA'

export const launchArgv = ['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', LAUNCH_ENCODED] as const

// Where Claude Code keeps one session's subagent transcripts:
// <config>/projects/<the session's folder, every other character a dash>/<session>/subagents
export const subagentsDir = (configDir: string, cwd: string, sessionId: string) =>
  `${configDir}/projects/${cwd.replace(/[^A-Za-z0-9]/g, '-')}/${sessionId}/subagents`
