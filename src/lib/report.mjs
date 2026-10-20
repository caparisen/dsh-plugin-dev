/** Output and exit-code conventions shared by every command. */

import { writeFileSync } from 'node:fs'

export class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}

export function info(message) {
  process.stdout.write(`${message}\n`)
}

export function warn(message) {
  process.stderr.write(`${message}\n`)
}

export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

/** Render an aligned two-column table for human output. */
export function table(rows) {
  const width = rows.reduce((max, [key]) => Math.max(max, key.length), 0)
  for (const [key, value] of rows) info(`${key.padEnd(width)}  ${value}`)
}

export function writeFile(path, value) {
  writeFileSync(path, value, 'utf8')
}
