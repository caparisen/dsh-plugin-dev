/**
 * Host half of `@citisen/dsh-plugin-dev`.
 *
 * The package's product is a skill: the procedure for building, booting and
 * verifying a dsh plugin. Publishing it from the package (rather than asking
 * people to copy a `SKILL.md` into a scanned directory) makes it versioned,
 * updatable with `dsh plugin add …@latest`, and disableable like any row.
 *
 * The CLI (`bin/dsh-plugin-dev.mjs`) is a sibling payload, not a dependency of
 * this module: this half only reads `skills/dsh-plugin-dev/SKILL.md` and
 * registers one provider, so it cannot fail a profile boot.
 *
 * @module @citisen/dsh-plugin-dev
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/** Cordis plugin name, used by loader diagnostics. */
export const name = 'dsh-plugin-dev'

/** The skill registry this provider contributes to. */
export const inject = ['skills']

/** Rank is lowest-priority-wins, so a local copy of the skill overrides this one. */
const SKILL_RANK = 700

const SKILL_DIR = new URL('../skills/dsh-plugin-dev/', import.meta.url)
const SKILL_FILE = new URL('SKILL.md', SKILL_DIR)

const CANDIDATE = {
  name: 'dsh-plugin-dev',
  description:
    'Develop, verify and debug DeepSeek Harness plugins: compose a profile tree, boot a throwaway shadow profile, smoke-test the host half, render and capture the client half, and roll back a broken profile. Use whenever authoring, changing, or troubleshooting a dsh plugin or bundle.',
  invocation: { modelInvocable: true, userInvocable: true },
  provider: 'dsh-plugin-dev',
  source: 'package',
  resourceBase: { kind: 'directory', path: fileURLToPath(SKILL_DIR) },
  rank: SKILL_RANK,
  locator: fileURLToPath(SKILL_FILE),
}

const provider = {
  name: 'dsh-plugin-dev',
  list: () => Promise.resolve([CANDIDATE]),
  async get() {
    return {
      name: CANDIDATE.name,
      description: CANDIDATE.description,
      invocation: CANDIDATE.invocation,
      provider: CANDIDATE.provider,
      source: CANDIDATE.source,
      resourceBase: CANDIDATE.resourceBase,
      content: await readFile(SKILL_FILE, 'utf8'),
    }
  },
}

/**
 * Register the bundled skill provider.
 *
 * @param ctx - context whose `skills` registry receives the provider.
 */
export function apply(ctx) {
  ctx.skills.registerProvider(() => provider)
}

export default { name, inject, apply }
