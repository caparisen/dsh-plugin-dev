/**
 * `dsh-plugin-dev shot` — render a URL in a real Chromium and capture it.
 *
 * A plain `chrome --headless --screenshot` never returns for the dsh GUI: the
 * app keeps a websocket open, so Chrome's virtual-time budget never expires.
 * This command drives the DevTools protocol instead, waits for an explicit
 * readiness predicate, and records console errors and uncaught exceptions —
 * which is the part a screenshot alone cannot tell you.
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, platform, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { CliError, info, printJson } from '../lib/report.mjs'

export const summary = 'render a URL in headless Chromium and capture a PNG plus console errors'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Browser executables to try, per platform. */
function browserCandidates() {
  const env = []
  if (process.env.CHROME_PATH) env.push(process.env.CHROME_PATH)
  if (platform() === 'win32') {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    return [
      ...env,
      join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]
  }
  if (platform() === 'darwin') {
    return [
      ...env,
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]
  }
  return [...env, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']
}

/**
 * Find a Chromium to drive.
 *
 * @param {string} [explicit]
 * @returns {string}
 */
export function findBrowser(explicit) {
  const candidates = explicit ? [explicit, ...browserCandidates()] : browserCandidates()
  for (const candidate of candidates) {
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (existsSync(candidate)) return candidate
      continue
    }
    const probe = spawnSync(candidate, ['--version'], { stdio: 'ignore' })
    if (probe.status === 0) return candidate
  }
  throw new CliError(
    'shot: no Chromium-based browser found. Pass --browser <path> or set CHROME_PATH.\n' +
      `tried: ${candidates.join(', ')}`,
  )
}

/**
 * @param {string[]} argv
 */
export async function main(argv) {
  const options = parseOptions(argv)
  if (options.help) return
  if (!options.url) throw new CliError('shot: pass --url <url> (the shadow URL, token included)')
  if (!options.out) throw new CliError('shot: pass --out <file.png>')

  const browser = findBrowser(options.browser)
  const profileDir = options.profileDir
    ? (mkdirSync(options.profileDir, { recursive: true }), options.profileDir)
    : mkdtempSync(join(tmpdir(), 'dsh-plugin-dev-shot-'))
  const temporaryProfile = !options.profileDir

  const started = Date.now()
  const child = spawn(browser, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    `--window-size=${options.width},${options.height}`,
    'about:blank',
  ], { stdio: 'ignore' })

  let socket
  let nextId = 0
  const pending = new Map()
  const consoleErrors = []

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify(sessionId === undefined ? { id, method, params } : { id, method, params, sessionId }))
    })

  try {
    const port = await waitForDevToolsPort(profileDir)
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
    socket = new WebSocket(version.webSocketDebuggerUrl)
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id === undefined) {
        collectEvent(message)
        return
      }
      const slot = pending.get(message.id)
      if (!slot) return
      pending.delete(message.id)
      if (message.error) slot.reject(new Error(JSON.stringify(message.error)))
      else slot.resolve(message.result)
    })
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', () => reject(new Error('devtools websocket failed')), { once: true })
    })

    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    await send('Page.enable', {}, sessionId)
    await send('Runtime.enable', {}, sessionId)
    await send('Log.enable', {}, sessionId)
    await send(
      'Emulation.setDeviceMetricsOverride',
      { width: options.width, height: options.height, deviceScaleFactor: 1, mobile: false },
      sessionId,
    )
    if (options.scheme) {
      await send(
        'Emulation.setEmulatedMedia',
        { media: '', features: [{ name: 'prefers-color-scheme', value: options.scheme }] },
        sessionId,
      )
    }

    await send('Page.navigate', { url: options.url }, sessionId)

    const probe = `(() => {
      const ready = document.readyState === 'complete';
      const nodes = document.querySelectorAll('*').length;
      const text = (document.body && document.body.innerText || '').trim().slice(0, 200);
      const selectorFound = ${JSON.stringify(options.waitSelector ?? null)} === null
        ? true
        : !!document.querySelector(${JSON.stringify(options.waitSelector ?? '')});
      return { ready, nodes, text, selectorFound };
    })()`

    const deadline = Date.now() + options.timeoutMs
    let state
    while (Date.now() < deadline) {
      state = await evaluate(probe, sessionId)
      if (state?.ready && state.nodes > 20 && state.text.length > 0 && state.selectorFound) break
      await sleep(200)
    }
    await sleep(options.settleMs)

    const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
    mkdirSync(dirname(options.out), { recursive: true })
    writeFileSync(options.out, Buffer.from(shot.data, 'base64'))

    const result = {
      url: options.url,
      out: options.out,
      width: options.width,
      height: options.height,
      elapsedMs: Date.now() - started,
      domNodes: state?.nodes ?? 0,
      renderedTextStart: state?.text ?? '',
      waitedForSelector: options.waitSelector ?? null,
      consoleErrors,
    }

    if (options.json) printJson(result)
    else {
      info(`captured ${options.out} (${options.width}x${options.height}, ${result.elapsedMs} ms, ${result.domNodes} nodes)`)
      if (consoleErrors.length > 0) {
        info(`console errors: ${consoleErrors.length}`)
        for (const item of consoleErrors.slice(0, 10)) info(`  [${item.source}] ${item.text.split('\n')[0]}`)
      }
    }

    if (options.failOnConsoleError && consoleErrors.length > 0) {
      process.exitCode = 1
    }

    async function evaluate(expression, target) {
      const outcome = await send(
        'Runtime.evaluate',
        { expression, returnByValue: true, awaitPromise: true },
        target,
      )
      return outcome?.result?.value
    }

    function collectEvent(message) {
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params?.exceptionDetails
        const text = details?.exception?.description ?? details?.text ?? 'uncaught exception'
        consoleErrors.push({ source: 'exception', text })
      } else if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
        const text = (message.params.args ?? [])
          .map((arg) => arg.value ?? arg.description ?? arg.type)
          .join(' ')
        consoleErrors.push({ source: 'console', text })
      } else if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
        const entry = message.params.entry
        consoleErrors.push({ source: entry.source ?? 'log', text: `${entry.text ?? ''} ${entry.url ?? ''}`.trim() })
      }
    }
  } finally {
    try { socket?.close() } catch { /* already closed */ }
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
      else child.kill('SIGKILL')
    } catch {
      try { child.kill('SIGKILL') } catch { /* gone */ }
    }
    await sleep(200)
    if (temporaryProfile) {
      try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* best effort */ }
    }
  }
}

async function waitForDevToolsPort(profileDir) {
  const portFile = join(profileDir, 'DevToolsActivePort')
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (existsSync(portFile)) {
      const port = Number(readFileSync(portFile, 'utf8').split('\n')[0])
      if (port > 0) return port
    }
    await sleep(100)
  }
  throw new CliError('shot: the browser never opened a DevTools port')
}

function parseOptions(argv) {
  const options = {
    width: 1440,
    height: 900,
    settleMs: 2500,
    timeoutMs: 30_000,
    scheme: undefined,
    waitSelector: undefined,
    failOnConsoleError: false,
    json: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--url') options.url = argv[++index]
    else if (arg === '--out') options.out = argv[++index]
    else if (arg === '--width') options.width = Number(argv[++index])
    else if (arg === '--height') options.height = Number(argv[++index])
    else if (arg === '--scheme') options.scheme = argv[++index]
    else if (arg === '--settle') options.settleMs = Number(argv[++index])
    else if (arg === '--timeout') options.timeoutMs = Number(argv[++index])
    else if (arg === '--wait-selector') options.waitSelector = argv[++index]
    else if (arg === '--browser') options.browser = argv[++index]
    else if (arg === '--profile-dir') options.profileDir = argv[++index]
    else if (arg === '--fail-on-console-error') options.failOnConsoleError = true
    else if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'usage: dsh-plugin-dev shot --url <url> --out <file.png> [--width 1440] [--height 900] [--scheme light|dark] [--wait-selector <css>] [--settle <ms>] [--timeout <ms>] [--browser <path>] [--profile-dir <dir>] [--fail-on-console-error] [--json]\n',
      )
      options.help = true
    } else {
      throw new Error(`shot: unknown argument ${arg}`)
    }
  }
  return options
}
