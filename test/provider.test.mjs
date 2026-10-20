import test from 'node:test'
import assert from 'node:assert/strict'

import { apply, inject, name } from '../src/index.js'

function fakeContext() {
  const registered = []
  return {
    registered,
    ctx: {
      skills: {
        registerProvider(create) {
          registered.push(create)
          return () => {}
        },
      },
    },
  }
}

test('declares the skills service and a stable name', () => {
  assert.deepEqual(inject, ['skills'])
  assert.equal(name, 'dsh-plugin-dev')
})

test('registers exactly one provider that lists one candidate', async () => {
  const { ctx, registered } = fakeContext()
  apply(ctx)
  assert.equal(registered.length, 1)
  const provider = registered[0]()
  const candidates = await provider.list()
  assert.equal(candidates.length, 1)
  const [candidate] = candidates
  assert.equal(candidate.name, 'dsh-plugin-dev')
  assert.ok(candidate.description.length > 40)
  assert.deepEqual(candidate.invocation, { modelInvocable: true, userInvocable: true })
  // Rank is lowest-priority-wins; a local copy of the skill must override this one.
  assert.ok(candidate.rank > 600)
  assert.equal(candidate.resourceBase.kind, 'directory')
  assert.ok(candidate.locator.endsWith('SKILL.md'))
})

test('loads the body from the bundled skill file', async () => {
  const { ctx, registered } = fakeContext()
  apply(ctx)
  const provider = registered[0]()
  const [candidate] = await provider.list()
  const definition = await provider.get(candidate)
  assert.equal(definition.name, 'dsh-plugin-dev')
  assert.equal(definition.source, 'package')
  assert.match(definition.content, /^---\nname: dsh-plugin-dev/m)
  assert.match(definition.content, /compose --profile/)
})
