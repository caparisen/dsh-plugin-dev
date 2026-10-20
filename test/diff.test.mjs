import test from 'node:test'
import assert from 'node:assert/strict'

import { diffLines, formatDiff, normalizeText, scanEntries, summarizeDiff } from '../src/lib/diff.mjs'

test('normalizeText strips CRLF, trailing spaces and outer blank lines', () => {
  const lines = normalizeText('\r\n- id: a   \r\n\r\nname: x\r\n\r\n')
  assert.deepEqual(lines, ['- id: a', 'name: x'])
})

test('diffLines reports unchanged, removed and added lines', () => {
  const diff = diffLines(['a', 'b', 'c'], ['a', 'c', 'd'])
  assert.deepEqual(
    diff.map((entry) => `${entry.status}:${entry.line}`),
    ['same:a', 'del:b', 'same:c', 'add:d'],
  )
})

test('summarizeDiff counts additions and removals', () => {
  const summary = summarizeDiff(diffLines(['a'], ['b', 'c']))
  assert.deepEqual(summary, { added: 2, removed: 1, changed: true })
  assert.deepEqual(summarizeDiff(diffLines(['a'], ['a'])), { added: 0, removed: 0, changed: false })
})

test('formatDiff marks changed lines and elides untouched runs', () => {
  const before = Array.from({ length: 20 }, (_, index) => `line ${index}`)
  const after = [...before]
  after[10] = 'line 10 changed'
  const rendered = formatDiff(diffLines(before, after), 1)
  assert.match(rendered, /^- line 10$/m)
  assert.match(rendered, /^\+ line 10 changed$/m)
  assert.match(rendered, /^\.\.\.$/m)
  assert.ok(!rendered.includes('line 3'))
})

test('scanEntries recovers id, name and disabled from composed YAML', () => {
  const dump = `
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    fetchProvider: http
- id: tool-plugin-manager
  name: '@deepseek-ai/dsh-plugin-manager/tools'
  disabled: true
- id: nested
  name: plain-name
  config:
    list:
      - id: not-an-entry
`
  const entries = scanEntries(dump.split('\n'))
  assert.deepEqual(
    entries.map((entry) => [entry.id, entry.name, entry.disabled]),
    [
      ['web', '@deepseek-ai/dsh-web', null],
      ['tool-plugin-manager', '@deepseek-ai/dsh-plugin-manager/tools', true],
      ['nested', 'plain-name', null],
      ['not-an-entry', null, null],
    ],
  )
})
