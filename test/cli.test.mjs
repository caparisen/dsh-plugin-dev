import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const bin = fileURLToPath(new URL('../bin/dsh-plugin-dev.mjs', import.meta.url))

function run(args) {
  return spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' })
}

test('prints usage', () => {
  const result = run(['--help'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /doctor/)
  assert.match(result.stdout, /snapshot/)
})

test('prints its own version', () => {
  const result = run(['--version'])
  assert.equal(result.status, 0)
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/)
})

test('every command answers --help without touching a profile', () => {
  for (const command of ['doctor', 'compose', 'shadow', 'shot', 'snapshot']) {
    const result = run([command, '--help'])
    assert.equal(result.status, 0, `${command} --help exited ${result.status}: ${result.stderr}`)
    assert.match(result.stdout, /usage:/i, `${command} --help printed no usage`)
  }
})

test('an unknown command fails loudly', () => {
  const result = run(['nonsense'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /unknown command/)
})

test('argument errors come before launcher discovery', () => {
  // A missing flag must be reported even where no `dsh` is installed: the
  // argument is the caller's problem, the launcher is the machine's.
  for (const [args, needle] of [
    [['shadow'], /--from/],
    [['compose'], /--profile/],
  ]) {
    const result = run(args)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, needle)
    assert.doesNotMatch(result.stderr, /no usable `dsh` launcher/)
  }
})
