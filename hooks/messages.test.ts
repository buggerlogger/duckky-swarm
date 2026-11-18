import { expect, test } from 'claude-code/testing'
import { DEFAULT_MESSAGES, fill, placeholders, text, useMessages } from './messages.ts'

test('a text fills its names in one pass: a value put in is never read for names', () => {
  expect(fill('on {label} ({id})', { label: 'Opus 4.6', id: 'claude-opus-4-6' })).toBe('on Opus 4.6 (claude-opus-4-6)')
  expect(fill(['a {x}', '', 'b'], { x: 1 })).toBe('a 1\n\nb')
  expect(fill('{task}', { task: 'write "{conversation}" literally' })).toBe('write "{conversation}" literally')
  expect(fill('left {unknown} as written')).toBe('left {unknown} as written')
  expect([...placeholders(DEFAULT_MESSAGES.agentType.description)].sort()).toEqual(['effort', 'id', 'label', 'name'])
})

test('no file: the built-in texts', () => {
  expect(useMessages(null)).toEqual([])
  expect(text('effort', 'takesNone', { label: 'Haiku 4.5' })).toBe('Haiku 4.5 does not take an effort')
})

test('messages.json is laid over the built-in texts key by key; notes (_) are never sent', () => {
  const problems = useMessages(JSON.stringify({
    _readme: ['a note'],
    effort: { _about: 'a note', takesNone: '{label}: no effort, ever' },
    sendMessage: { refused: ['Use resume_subagent for {id}.', 'Not SendMessage.'] },
  }))
  expect(problems).toEqual([])
  expect(text('effort', 'takesNone', { label: 'Haiku 4.5' })).toBe('Haiku 4.5: no effort, ever')
  expect(text('sendMessage', 'refused', { id: 'a1b2c3d4' })).toBe('Use resume_subagent for a1b2c3d4.\nNot SendMessage.')
  expect(text('effort', 'takes', { label: 'Opus 5.5', levels: 'low' })).toBe('Opus 5.5 takes effort low')   // left out: built in
  useMessages(null)
})

test('each mistake in messages.json is named, and only that text falls back to the built-in one', () => {
  expect(useMessages('{ "effort": { "takes": "x", }')[0]).toMatch(/^messages\.json is not valid JSON \(.+\): using the built-in texts$/)
  expect(text('effort', 'takes', { label: 'L', levels: 'low' })).toBe('L takes effort low')
  const problems = useMessages(JSON.stringify({
    effort: { takes: 42, takesNone: 'none for {lable}' },
    refusalReport: { headr: 'typo' },
    nonsense: {},
    fork: 'not an object',
  }))
  expect(problems).toEqual([   // in the order of the file's sections
    'fork is not an object: its built-in texts are used',
    'effort.takes must be a string or a list of strings: its built-in text is used',
    'effort.takesNone uses {lable}, which it is never given: it stays as written',
    'refusalReport.headr is not a text the plugin sends: ignored',
    'nonsense is not a section of messages.json: ignored',
  ])
  expect(text('effort', 'takes', { label: 'L', levels: 'low' })).toBe('L takes effort low')   // the bad one: built in
  expect(text('effort', 'takesNone', { label: 'L' })).toBe('none for {lable}')               // the user's, as written
  useMessages(null)
})
