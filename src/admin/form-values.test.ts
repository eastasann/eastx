import { describe, expect, it } from 'vitest'
import { rebaseValues } from './form-values'

describe('rebaseValues', () => {
  const sent = { slug: 'a', ja: { title: ' 題 ', body: '本文\n' }, stacks: ['s1'] }

  it('送ってから変えていなければ、保存した値にする', () => {
    const saved = { slug: 'a', ja: { title: '題', body: '本文' }, stacks: ['s1'] }
    expect(rebaseValues(sent, sent, saved)).toEqual(saved)
  })

  it('送ってから書き換えた欄は今の値のまま残し、ほかの欄は保存した値にする', () => {
    const current = { slug: 'a', ja: { title: ' 題 ', body: '本文\n続き' }, stacks: ['s1', 's2'] }
    const saved = { slug: 'a', ja: { title: '題', body: '本文' }, stacks: ['s1'] }
    expect(rebaseValues(sent, current, saved)).toEqual({
      slug: 'a',
      ja: { title: '題', body: '本文\n続き' },
      stacks: ['s1', 's2'],
    })
  })
})
