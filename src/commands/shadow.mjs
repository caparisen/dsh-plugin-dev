/**
 * `dsh-plugin-dev shadow` — boot a throwaway copy of a profile.
 *
 * The copy is what makes testing safe: the running application keeps its
 * profile, the shadow gets the same bundles, patches and `node_modules`
 * (linked, not copied), an OS-assigned port, and a name nobody else uses.
 *
 * The readiness contract is the launcher's own output line
 * `dsh web: http://127.0.0.1:<port>/?token=<token>`; the token matters because
 * the GUI answers 401 without it.
 */

import { execFileSync, spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isWindows,
  parseWebUrl,
  profilesDir,
  quoteArg,
  resolveDsh,
} from '../lib/cli.mjs'
import { CliError, info, printJson, warn } from '../lib/report.mjs'
import { copyProfile, removeCopy } from '../lib/profile-copy.mjs'
import { ensureDir, isDirectory, timestamp } from '../lib/fsx.mjs'

export const summary = 'boot a throwaway copy of a profile and print its URL and token'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @param {string[]} argv
 */
export async function main(argv) {
  const options = parseOptions(argv)
  if (options.help) return
  const cli = await resolveDsh({ explicit: options.dsh })
  const sourceName = options.from
  if (!sourceName) throw new CliError('shadow: pass --from <profile> (the profile to copy)')
  if (!isDirectory(join(profilesDir(), sourceName))) {
    throw new CliError(`shadow: no profile "${sourceName}" under ${profilesDir()}`)
  }
  const name = options.name ?? 'dev-shadow'
  copyProfile(sourceName, name)
  const shadowDir = join(profilesDir(), name)

  const logPath = join(tmpdir(), 'dsh-plugin-dev', `${name}-${timestamp()}.log`)
  ensureDir(join(tmpdir(), 'dsh-plugin-dev'))
  const log = createWriteStream(logPath, { flags: 'a' })
  const child = spawn(
    [quoteArg(cli.command), ...['--profile', name, '--no-open', '--port', String(options.port)].map(quoteArg)].join(' '),
    {
      shell: true,
      windowsHide: true,
      detached: !isWindows,
      env: { ...process.env, ...(options.env ?? {}) },
    },
  )
  child.stdout.on('data', (chunk) => log.write(chunk))
  child.stderr.on('data', (chunk) => log.write(chunk))

  let output = ''
  let exited = false
  let exitCode = null
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  child.on('exit', (code) => { exited = true; exitCode = code })

  const boot = await waitForUrl(() => output, () => exited, options.timeoutMs)
  if (!boot) {
    killTree(child)
    log.end()
    const tail = output.trim().split(/\r?\n/).slice(-12).join('\n')
    if (!options.keep) removeCopy(name)
    throw new CliError(`shadow: profile "${name}" did not print a web URL within ${options.timeoutMs} ms.\n${tail}`)
  }

  const ready = await waitForHttp(boot.url, options.timeoutMs)
  if (!ready) {
    killTree(child)
    log.end()
    if (!options.keep) removeCopy(name)
    throw new CliError(`shadow: ${boot.url} did not answer 200 within ${options.timeoutMs} ms (log: ${logPath})`)
  }

  const result = {
    profile: name,
    source: sourceName,
    url: boot.url,
    token: boot.token,
    pid: child.pid,
    log: logPath,
    sharedHome: process.env.DSH_HOME || null,
    startedAt: new Date().toISOString(),
  }

  const stopping = { killed: false }
  if (options.hold) {
    if (options.json) printJson(result)
    else {
      info(`shadow profile: ${name}  (source: ${sourceName})`)
      info(`url:  ${boot.url}`)
      info(`log:  ${logPath}`)
      info('ctrl-c to stop and clean up')
    }
    const stop = async () => {
      stopping.killed = true
      killTree(child)
      log.end()
      if (!options.keep) removeCopy(name)
      process.exit(0)
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    await new Promise(() => {})
    return
  }

  stopping.killed = true
  killTree(child)
  log.end()
  await sleep(300)
  if (!options.keep) removeCopy(name)

  if (options.json) printJson(result)
  else {
    info(`shadow boot ok: ${name} (from ${sourceName})`)
    info(`url:  ${boot.url}`)
    info(`log:  ${logPath}`)
    if (options.keep) info(`kept profile: ${shadowDir}`)
  }

  if (!stopping.killed && exitCode !== null && exitCode !== 0) {
    warn(`shadow: the launcher exited with code ${exitCode} before it was stopped; see ${logPath}`)
  }
}

async function waitForUrl(readOutput, hasExited, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const parsed = parseWebUrl(readOutput())
    if (parsed) return parsed
    if (hasExited()) return undefined
    await sleep(100)
  }
  return undefined
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      // The token exchange is itself a redirect: `GET /?token=…` answers 303
      // with an auth cookie before the shell is served, so anything below 400
      // means the listener is up and answering.
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
      await response.arrayBuffer().catch(() => {})
      if (response.status >= 200 && response.status < 400) return true
    } catch {
      /* not listening yet */
    }
    await sleep(250)
  }
  return false
}

/** Kill the launcher and everything it started. */
export function killTree(child) {
  if (!child || child.exitCode !== null) return
  try {
    if (isWindows) {
      execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
    } else {
      process.kill(-child.pid, 'SIGTERM')
      setTimeout(() => {
        try { process.kill(-child.pid, 'SIGKILL') } catch { /* gone */ }
      }, 2000).unref?.()
    }
  } catch {
    try { child.kill('SIGKILL') } catch { /* gone */ }
  }
}

function parseOptions(argv) {
  const options = { port: 0, timeoutMs: 120_000 }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--from') options.from = argv[++index]
    else if (arg === '--name') options.name = argv[++index]
    else if (arg === '--port') options.port = Number(argv[++index])
    else if (arg === '--timeout') options.timeoutMs = Number(argv[++index])
    else if (arg === '--dsh') options.dsh = argv[++index]
    else if (arg === '--hold') options.hold = true
    else if (arg === '--keep') options.keep = true
    else if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'usage: dsh-plugin-dev shadow --from <profile> [--name <shadow>] [--port 0] [--hold] [--keep] [--timeout <ms>] [--json] [--dsh <path>]\n',
      )
      options.help = true
    } else {
      throw new Error(`shadow: unknown argument ${arg}`)
    }
  }
  return options
}
