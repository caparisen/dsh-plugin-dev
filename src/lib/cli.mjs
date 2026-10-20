/**
 * Locating and running the installed `dsh`.
 *
 * Everything this kit does is delegated to the real launcher — composition,
 * booting, patching. Reimplementing those would make the kit lie about the
 * version it is testing, so the only thing this module knows is how to find a
 * `dsh` and how to start one with arguments.
 */

import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

export const isWindows = platform() === 'win32'

/** The Harness home: `$DSH_HOME`, else `~/.dsh`. */
export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** Directory holding one directory per profile. */
export function profilesDir() {
  return join(dshHome(), 'profiles')
}

/** Profile names present on disk, sorted. */
export function listProfileNames() {
  try {
    return readdirSync(profilesDir(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

/** Desktop application install locations, per platform. */
function desktopCandidates() {
  if (isWindows) {
    const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    const app = join(local, 'Programs', 'DeepSeek Harness')
    return [
      join(app, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'),
      join(app, 'resources', 'runtime', 'cli', 'bin', 'dsh.exe'),
    ]
  }
  if (platform() === 'darwin') {
    return [
      '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh',
      join(homedir(), 'Applications', 'DeepSeek Harness.app', 'Contents', 'Resources', 'runtime', 'cli', 'bin', 'dsh'),
    ]
  }
  return [
    '/opt/DeepSeek Harness/resources/runtime/cli/bin/dsh',
    '/opt/deepseek-harness/resources/runtime/cli/bin/dsh',
  ]
}

/** Quote one argument for a shell command line. */
export function quoteArg(value) {
  const text = String(value)
  if (text !== '' && /^[A-Za-z0-9_@%+=:,./\\-]+$/.test(text)) return text
  return `"${text.replaceAll('"', '\\"')}"`
}

/**
 * Build one shell command line. The launcher path itself may contain spaces
 * (the desktop app lives under "DeepSeek Harness"), so it is quoted like any
 * other argument and the whole line goes to the shell as a single string.
 *
 * @param {{ command: string }} cli
 * @param {string[]} argv
 * @returns {string}
 */
export function buildCommandLine(cli, argv) {
  return [quoteArg(cli.command), ...argv.map(quoteArg)].join(' ')
}

/**
 * Run one `dsh` invocation and buffer its output.
 *
 * @param {{ command: string }} cli - resolved launcher.
 * @param {string[]} argv - arguments, unquoted.
 * @param {{ timeoutMs?: number, env?: Record<string, string>, cwd?: string }} [options]
 * @returns {Promise<{ code: number, stdout: string, stderr: string, timedOut: boolean }>}
 */
export function runCli(cli, argv, options = {}) {
  return new Promise((resolve) => {
    let timedOut = false
    let settled = false
    const child = spawn(buildCommandLine(cli, argv), {
      shell: true,
      windowsHide: true,
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
    })
    let stdout = ''
    let stderr = ''
    const finish = (code, extra = '') => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr: stderr + extra, timedOut })
    }
    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill() } catch { /* already gone */ }
    }, options.timeoutMs ?? 60_000)
    child.stdout?.on('data', (chunk) => { stdout += chunk })
    child.stderr?.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => finish(-1, String(error)))
    child.on('close', (code) => finish(code ?? -1))
  })
}

/**
 * Resolve the launcher to use.
 *
 * Order: `--dsh`, `$DSH_CLI`, `dsh` on PATH, then the desktop application's
 * bundled CLI. Each candidate is validated by asking it for its version, so a
 * stale path is rejected here rather than halfway through a boot.
 *
 * @param {{ explicit?: string }} [options]
 * @returns {Promise<{ command: string, source: string, version: string }>}
 */
export async function resolveDsh(options = {}) {
  const candidates = []
  if (options.explicit) candidates.push({ command: options.explicit, source: 'flag' })
  if (process.env.DSH_CLI) candidates.push({ command: process.env.DSH_CLI, source: 'env' })
  candidates.push({ command: isWindows ? 'dsh.cmd' : 'dsh', source: 'path' })
  for (const candidate of desktopCandidates()) candidates.push({ command: candidate, source: 'desktop' })

  const tried = []
  for (const candidate of candidates) {
    if (candidate.source === 'desktop' && !existsSync(candidate.command)) {
      tried.push(`${candidate.command} (missing)`)
      continue
    }
    const result = await runCli(candidate, ['--version'], { timeoutMs: 20_000 })
    if (result.code === 0 && !result.timedOut) {
      const version = (result.stdout.trim().split(/\r?\n/).pop() ?? '').trim()
      return { command: candidate.command, source: candidate.source, version }
    }
    tried.push(`${candidate.command} (exit ${result.code}${result.timedOut ? ', timed out' : ''})`)
  }
  const error = new Error(
    'no usable `dsh` launcher found. Install the desktop app or the CLI, or pass --dsh <path>.\n' +
      `tried:\n  ${tried.join('\n  ')}`,
  )
  error.exitCode = 1
  throw error
}

/**
 * Extract the browser URL and token from a `dsh web` boot line.
 *
 * @param {string} text - captured stdout so far.
 * @returns {{ url: string, token: string | null } | undefined}
 */
export function parseWebUrl(text) {
  const match = /dsh web:\s+(http:\/\/\S+)/.exec(text)
  if (!match) return undefined
  const url = match[1]
  let token = null
  try {
    token = new URL(url).searchParams.get('token')
  } catch {
    /* ignore malformed line */
  }
  return { url, token }
}
