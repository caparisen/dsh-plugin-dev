/**
 * `dsh-plugin-dev doctor` — what this machine can actually test.
 *
 * Every bug report about the kit starts here: which `dsh`, which version,
 * which profiles, whether the chosen profile can even be composed outside the
 * application, and which browser a render check would use.
 */

import { existsSync } from 'node:fs'
import { arch, platform, release } from 'node:os'
import { listProfileNames, dshHome, resolveDsh } from '../lib/cli.mjs'
import { composeProfile } from '../lib/compose.mjs'
import { printJson, table, warn } from '../lib/report.mjs'
import { findBrowser } from './shot.mjs'

export const summary = 'report the dsh, profiles and browser this kit can use'

/**
 * @param {string[]} argv
 */
export async function main(argv) {
  const options = parseOptions(argv)
  if (options.help) return
  const cli = await resolveDsh({ explicit: options.dsh })
  const home = dshHome()
  const profiles = listProfileNames()
  const profile = options.profile ?? process.env.DSH_PROFILE ?? 'desktop'

  let composition
  if (profiles.includes(profile)) {
    const result = await composeProfile(cli, profile)
    composition = result.code === 0
      ? {
          ok: true,
          lines: result.stdout.split(/\r?\n/).length,
          ...(result.copiedFrom === null ? {} : { copiedFrom: result.copiedFrom }),
        }
      : { ok: false, error: firstLines(result.stderr || result.stdout, 3) }
  } else {
    composition = { ok: false, error: `profile "${profile}" not found under ${home}` }
  }

  const browser = (() => {
    try {
      return findBrowser(options.browser)
    } catch {
      return undefined
    }
  })()

  const report = {
    platform: `${platform()} ${release()} ${arch()}`,
    node: process.version,
    dshHome: home,
    dshHomeExists: existsSync(home),
    dsh: { command: cli.command, source: cli.source, version: cli.version },
    profiles,
    profile,
    composition,
    browser: browser ?? null,
  }

  if (options.json) {
    printJson(report)
    return
  }

  table([
    ['platform', report.platform],
    ['node', report.node],
    ['DSH_HOME', `${home}${report.dshHomeExists ? '' : ' (missing)'}`],
    ['dsh', `${cli.version || '(no version)'} [${cli.source}] ${cli.command}`],
    ['profiles', profiles.length > 0 ? profiles.join(', ') : '(none)'],
    ['profile', profile],
    ['composition', composition.ok
      ? `ok, ${composition.lines} lines${composition.copiedFrom ? ` (via a copy of ${composition.copiedFrom})` : ''}`
      : `FAILED: ${composition.error}`],
    ['browser', browser ?? '(none found; pass --browser)'],
  ])

  if (!composition.ok) {
    warn('\nThis profile cannot be composed outside the application (or the patch layer is broken).')
    warn('`compose` and `shadow` will fail the same way; fix the patch, or use another profile.')
  }
}

function firstLines(text, count) {
  return String(text).trim().split(/\r?\n/).slice(0, count).join(' | ')
}

function parseOptions(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') options.json = true
    else if (arg === '--profile') options.profile = argv[++index]
    else if (arg === '--dsh') options.dsh = argv[++index]
    else if (arg === '--browser') options.browser = argv[++index]
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(`usage: dsh-plugin-dev doctor [--profile <name>] [--dsh <path>] [--browser <path>] [--json]\n`)
      options.help = true
    } else {
      throw new Error(`doctor: unknown argument ${arg}`)
    }
  }
  return options
}
