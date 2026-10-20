/**
 * `dsh-plugin-dev compose` — the profile tree the launcher would mount.
 *
 * Never re-derives patch precedence: asks the real `dsh --dump-config`. That
 * makes the command version-honest and turns "what did my patch change" into a
 * text diff between two real compositions.
 *
 * `--save` records a baseline; `--check` compares against it and exits 1 on any
 * drift, so a patch that silently rewrites a whole row (the classic dsh trap:
 * a patch replaces the targeted row's entire `config`) shows up as removed keys.
 */

import { resolveDsh, dshHome } from '../lib/cli.mjs'
import { composeProfile } from '../lib/compose.mjs'
import { CliError, info, printJson, warn } from '../lib/report.mjs'
import {
  diffLines,
  formatDiff,
  normalizeText,
  scanEntries,
  summarizeDiff,
} from '../lib/diff.mjs'
import { readJson, sha256, writeFileAtomic } from '../lib/fsx.mjs'

export const summary = 'compose a profile through the real launcher, diff it against a baseline'

/**
 * @param {string[]} argv
 */
export async function main(argv) {
  const options = parseOptions(argv)
  if (options.help) return
  const profile = options.profile
  if (!profile) throw new CliError('compose: pass --profile <name>')
  const cli = await resolveDsh({ explicit: options.dsh })

  const result = await composeProfile(cli, profile, { patches: options.patches, copy: options.copy })

  if (result.code !== 0) {
    throw new CliError(
      `compose: \`dsh --profile ${profile} --dump-config\` failed (exit ${result.code}).\n` +
        (result.stderr.trim() || result.stdout.trim()),
    )
  }

  const lines = normalizeText(result.stdout)
  const hash = sha256(lines.join('\n'))
  const entries = scanEntries(lines)
  const duplicates = findDuplicates(entries.map((entry) => entry.id))
  if (result.copiedFrom !== null) {
    warn(`compose: ${result.copiedFrom} is application-managed; composed a temporary copy instead`)
  }

  if (options.save) {
    writeFileAtomic(
      options.save,
      `${JSON.stringify({ profile, savedAt: new Date().toISOString(), dsh: cli.version, hash, lines }, null, 2)}\n`,
    )
    info(`saved composition baseline: ${options.save} (${lines.length} lines, ${entries.length} entries)`)
    return
  }

  if (options.check) {
    const baseline = readJson(options.check)
    if (!baseline || !Array.isArray(baseline.lines)) {
      throw new CliError(`compose: ${options.check} is not a composition baseline written by --save`)
    }
    const diff = diffLines(baseline.lines, lines)
    const summary = summarizeDiff(diff)
    if (!summary.changed) {
      info(`composition matches ${options.check} (${entries.length} entries, sha256 ${hash.slice(0, 12)})`)
      return
    }
    warn(formatDiff(diff))
    warn(
      `\ncomposition drifted from ${options.check}: +${summary.added} -${summary.removed} ` +
        `(baseline ${baseline.savedAt}, dsh ${baseline.dsh ?? '?'})`,
    )
    process.exitCode = 1
    return
  }

  if (options.json) {
    printJson({
      profile,
      copiedFrom: result.copiedFrom,
      dsh: cli.version,
      home: dshHome(),
      lines: lines.length,
      hash,
      entries,
      duplicates,
    })
    return
  }

  process.stdout.write(`${lines.join('\n')}\n`)
  if (duplicates.length > 0) {
    warn(`\nwarning: duplicate entry ids: ${duplicates.join(', ')}`)
  }
}

function findDuplicates(values) {
  const seen = new Set()
  const duplicates = new Set()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    else seen.add(value)
  }
  return [...duplicates]
}

function parseOptions(argv) {
  const options = { patches: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--profile') options.profile = argv[++index]
    else if (arg === '--json') options.json = true
    else if (arg === '--save') options.save = argv[++index]
    else if (arg === '--check') options.check = argv[++index]
    else if (arg === '--patch') options.patches.push(argv[++index])
    else if (arg === '--copy') options.copy = true
    else if (arg === '--dsh') options.dsh = argv[++index]
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'usage: dsh-plugin-dev compose --profile <name> [--patch <file>]... [--copy] [--json] [--save <file>] [--check <file>] [--dsh <path>]\n',
      )
      options.help = true
    } else {
      throw new Error(`compose: unknown argument ${arg}`)
    }
  }
  return options
}
