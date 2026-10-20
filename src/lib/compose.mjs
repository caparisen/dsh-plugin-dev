/**
 * Composing a profile, including the one the CLI refuses to touch.
 *
 * `dsh --profile desktop --dump-config` answers "profile desktop is managed
 * exclusively by the Electron application". That is a launcher policy, not a
 * broken profile, so the only honest way to see that composition is to copy the
 * profile under another name and dump the copy.
 */

import { runCli } from './cli.mjs'
import { copyProfile, removeCopy } from './profile-copy.mjs'

const APP_MANAGED = /managed exclusively by the Electron application/i

/** Name used for the temporary copy; stable so a crashed run is recognisable. */
const TEMP_NAME = 'dev-compose'

/**
 * Compose one profile through the real launcher.
 *
 * @param {{ command: string }} cli - resolved launcher.
 * @param {string} profile - profile to compose.
 * @param {{ patches?: string[], copy?: boolean }} [options] - `copy` forces the
 *   copied-profile path even when the CLI would accept the name.
 * @returns {Promise<{ code: number, stdout: string, stderr: string, copiedFrom: string | null }>}
 */
export async function composeProfile(cli, profile, options = {}) {
  const first = await runCli(cli, dumpArgs(profile, options.patches), { timeoutMs: 90_000 })
  if (first.code === 0 || (!options.copy && !APP_MANAGED.test(first.stderr))) {
    return { ...first, copiedFrom: null }
  }

  copyProfile(profile, TEMP_NAME)
  try {
    const second = await runCli(cli, dumpArgs(TEMP_NAME, options.patches), { timeoutMs: 90_000 })
    return { ...second, copiedFrom: profile, stderr: first.stderr ? `${first.stderr}\n${second.stderr}` : second.stderr }
  } finally {
    removeCopy(TEMP_NAME)
  }
}

function dumpArgs(profile, patches = []) {
  const args = ['--profile', profile, '--dump-config']
  for (const patch of patches) args.push('--patch', patch)
  return args
}
