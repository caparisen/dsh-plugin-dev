/**
 * Copying a profile so it can be composed or booted outside the application.
 *
 * The desktop profile is managed exclusively by the Electron app: the CLI
 * refuses to compose or boot it, and that refusal is the single most common
 * wall a plugin developer hits. A copy under another name is the supported
 * workaround, so both `compose` and `shadow` build one from the same code.
 *
 * The copy carries the three files that decide composition and *links* the
 * source `node_modules` instead of copying it — pnpm's hoisted layout can be
 * large, and a link keeps the copy honest about which version is installed.
 */

import { join } from 'node:path'
import { profilesDir } from './cli.mjs'
import { copyIfExists, ensureDir, exists, isDirectory, linkDir, readJson, removePath, writeFileAtomic } from './fsx.mjs'
import { CliError } from './report.mjs'

const MARKER = '.dsh-plugin-dev-copy.json'
const FILES = ['package.json', 'cordis.yml', 'cordis.patch.yml']

/**
 * Materialise `name` as a copy of `source`.
 *
 * An existing profile is only replaced when this tool created it, so a name
 * collision can never delete a person's profile.
 *
 * @param {string} source - profile to copy.
 * @param {string} name - profile name to create.
 * @returns {string} the created profile directory.
 */
export function copyProfile(source, name) {
  if (source === name) throw new CliError(`copy: a profile cannot be copied onto itself (${name})`)
  const sourceDir = join(profilesDir(), source)
  if (!isDirectory(sourceDir)) throw new CliError(`copy: no profile "${source}" under ${profilesDir()}`)
  const targetDir = join(profilesDir(), name)

  if (exists(targetDir)) {
    const marker = readJson(join(targetDir, MARKER))
    if (marker?.createdBy !== '@citisen/dsh-plugin-dev') {
      throw new CliError(
        `copy: profile "${name}" already exists and was not created by this tool; choose another --name`,
      )
    }
    removePath(targetDir)
  }

  ensureDir(targetDir)
  for (const file of FILES) copyIfExists(join(sourceDir, file), join(targetDir, file))
  const sourceModules = join(sourceDir, 'node_modules')
  if (isDirectory(sourceModules)) linkDir(sourceModules, join(targetDir, 'node_modules'))
  writeFileAtomic(
    join(targetDir, MARKER),
    `${JSON.stringify({ createdBy: '@citisen/dsh-plugin-dev', source, at: new Date().toISOString() }, null, 2)}\n`,
  )
  return targetDir
}

/** Remove a copy this tool created; a foreign profile is left alone. */
export function removeCopy(name) {
  const dir = join(profilesDir(), name)
  if (!exists(dir)) return
  const marker = readJson(join(dir, MARKER))
  if (marker?.createdBy === '@citisen/dsh-plugin-dev') removePath(dir)
}
