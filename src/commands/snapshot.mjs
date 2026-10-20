/**
 * `dsh-plugin-dev snapshot` — the part that works when the app will not boot.
 *
 * Saves the three files that decide a profile's composition, restores them
 * atomically, and always takes a fresh snapshot before restoring so a rescue is
 * itself reversible.
 */

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome, profilesDir } from '../lib/cli.mjs'
import { CliError, info, printJson, warn } from '../lib/report.mjs'
import {
  copyIfExists,
  ensureDir,
  exists,
  isDirectory,
  readJson,
  readText,
  sha256,
  timestamp,
  writeFileAtomic,
} from '../lib/fsx.mjs'

export const summary = 'save, list and restore the files that decide a profile composition'

const FILES = ['package.json', 'cordis.yml', 'cordis.patch.yml']

/**
 * @param {string[]} argv
 */
export async function main(argv) {
  const options = parseOptions(argv)
  if (options.help) return
  const action = options.action
  if (!action) throw new CliError('snapshot: expected save, list or restore')
  const outRoot = options.out ?? join(dshHome(), 'snapshots', 'plugin-dev')

  if (action === 'list') {
    const ids = listSnapshots(outRoot, options.profile)
    if (options.json) {
      printJson({ profile: options.profile, out: outRoot, snapshots: ids })
      return
    }
    if (ids.length === 0) {
      info(`no snapshots for ${options.profile} under ${outRoot}`)
      return
    }
    for (const id of ids) {
      const manifest = readJson(join(outRoot, options.profile, id, 'manifest.json'))
      info(`${id}  ${manifest?.at ?? ''}  ${Object.keys(manifest?.files ?? {}).length} files`)
    }
    return
  }

  if (!options.profile) throw new CliError(`snapshot ${action}: pass --profile <name>`)
  const profileDir = join(profilesDir(), options.profile)
  if (!isDirectory(profileDir)) throw new CliError(`snapshot: no profile "${options.profile}"`)

  if (action === 'save') {
    const id = saveSnapshot(profileDir, outRoot, options.profile, options.label)
    if (options.json) printJson({ saved: id, out: join(outRoot, options.profile, id) })
    else info(`saved ${options.profile} as ${id} (${join(outRoot, options.profile, id)})`)
    return
  }

  if (action === 'restore') {
    const ids = listSnapshots(outRoot, options.profile)
    if (ids.length === 0) throw new CliError(`snapshot restore: no snapshots for ${options.profile}`)
    const id = options.from ?? ids[0]
    if (!ids.includes(id)) {
      throw new CliError(`snapshot restore: no snapshot "${id}" (have: ${ids.join(', ')})`)
    }
    const source = join(outRoot, options.profile, id)
    const safety = saveSnapshot(profileDir, outRoot, options.profile, 'prerestore')
    const restored = []
    for (const file of FILES) {
      const content = readText(join(source, file))
      if (content === undefined) {
        warn(`snapshot restore: ${file} absent in ${id}; leaving the current file alone`)
        continue
      }
      writeFileAtomic(join(profileDir, file), content)
      restored.push(file)
    }
    warn(`snapshot restore: current state saved first as ${safety}`)
    if (options.json) printJson({ restored: id, files: restored, safety })
    else info(`restored ${options.profile} from ${id}: ${restored.join(', ')}`)
    return
  }

  throw new CliError(`snapshot: unknown action ${action}`)
}

function saveSnapshot(profileDir, outRoot, profile, label) {
  const id = `${timestamp()}${label ? `-${label}` : ''}`
  const dir = ensureDir(join(outRoot, profile, id))
  const files = {}
  for (const file of FILES) {
    const from = join(profileDir, file)
    if (!exists(from)) continue
    copyIfExists(from, join(dir, file))
    files[file] = sha256(readText(from) ?? '')
  }
  writeFileAtomic(
    join(dir, 'manifest.json'),
    `${JSON.stringify({ profile, at: new Date().toISOString(), label: label ?? null, files }, null, 2)}\n`,
  )
  return id
}

function listSnapshots(outRoot, profile) {
  if (!profile) return []
  const dir = join(outRoot, profile)
  if (!isDirectory(dir)) return []
  return requireReaddir(dir).sort().reverse()
}

function requireReaddir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function parseOptions(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === 'save' || arg === 'list' || arg === 'restore') options.action = arg
    else if (arg === '--profile') options.profile = argv[++index]
    else if (arg === '--out') options.out = argv[++index]
    else if (arg === '--from') options.from = argv[++index]
    else if (arg === '--label') options.label = argv[++index]
    else if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'usage: dsh-plugin-dev snapshot <save|list|restore> --profile <name> [--out <dir>] [--from <id>] [--label <text>] [--json]\n',
      )
      options.help = true
    } else {
      throw new Error(`snapshot: unknown argument ${arg}`)
    }
  }
  return options
}
