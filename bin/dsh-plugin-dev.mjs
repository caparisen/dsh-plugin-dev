#!/usr/bin/env node
/**
 * `dsh-plugin-dev` — one dispatcher, five commands, no dependencies.
 *
 * The bin exists so the skill's recipes can name a stable command instead of a
 * path inside an installed package, and so CI can run the same gates a person
 * runs. It is not a daemon and holds no state.
 */

import { readFileSync } from 'node:fs'
import { CliError } from '../src/lib/report.mjs'

const COMMANDS = {
  doctor: () => import('../src/commands/doctor.mjs'),
  compose: () => import('../src/commands/compose.mjs'),
  shadow: () => import('../src/commands/shadow.mjs'),
  shot: () => import('../src/commands/shot.mjs'),
  snapshot: () => import('../src/commands/snapshot.mjs'),
}

const USAGE = `dsh-plugin-dev — development kit for DeepSeek Harness plugins

usage: dsh-plugin-dev <command> [options]

commands:
  doctor    report the dsh, profiles and browser this kit can use
  compose   compose a profile through the real launcher, diff it against a baseline
  shadow    boot a throwaway copy of a profile and print its URL and token
  shot      render a URL in headless Chromium and capture a PNG plus console errors
  snapshot  save, list and restore the files that decide a profile composition

common options:
  --dsh <path>   launcher to use (default: $DSH_CLI, dsh on PATH, then the desktop app)
  --json         machine-readable output
  --help         this text, or a command's own usage

examples:
  dsh-plugin-dev doctor
  dsh-plugin-dev compose --profile desktop --save dev/composition.json
  dsh-plugin-dev shadow --from desktop --hold
  dsh-plugin-dev shot --url "$URL" --out dev/shots/settings.png --scheme dark
`

async function main(argv) {
  const [command, ...rest] = argv
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(USAGE)
    return
  }
  if (command === '--version' || command === '-v') {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    process.stdout.write(`${manifest.version}\n`)
    return
  }
  const load = COMMANDS[command]
  if (!load) {
    throw new CliError(`unknown command "${command}"\n\n${USAGE}`)
  }
  const module = await load()
  await module.main(rest)
}

try {
  await main(process.argv.slice(2))
} catch (error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  process.stderr.write(`dsh-plugin-dev: ${error?.message ?? message}\n`)
  if (process.env.DSH_PLUGIN_DEV_DEBUG) process.stderr.write(`${error?.stack ?? ''}\n`)
  process.exitCode = error?.exitCode ?? 1
}
