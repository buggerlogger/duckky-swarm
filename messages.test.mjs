// node --test messages.test.mjs   (plain Node: checks messages.json as you edited it)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { useMessages } from './hooks/messages.ts'

test('messages.json has no mistake the plugin would have to work around', () => {
  const problems = useMessages(readFileSync(new URL('./messages.json', import.meta.url), 'utf8'))
  useMessages(null)
  assert.deepEqual(problems, [], `messages.json:\n- ${problems.join('\n- ')}`)
})
