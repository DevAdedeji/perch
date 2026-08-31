import { describe, expect, it } from 'vitest'
import { activeMention, insertMention, mentionSegments, selectedMentionIds } from '../app/utils/mentions'

describe('mention composer helpers', () => {
  it('finds a mention after whitespace and supports full-name searches', () => {
    expect(activeMention('Can you check this @Ada Love')).toEqual({ start: 19, query: 'ada love' })
    expect(activeMention('email@example.com')).toBeNull()
  })

  it('inserts full names so duplicate first names remain distinguishable', () => {
    const current = activeMention('Hi @ade')!
    expect(insertMention('Hi @ade', current, 'Ade Okoro')).toBe('Hi @Ade Okoro ')
  })

  it('keeps only selected mentions still present in the sent content', () => {
    const picked = new Map([
      ['member-a', '@Ada Love'],
      ['member-b', '@Ada King']
    ])
    expect(selectedMentionIds('Please check this @Ada King', picked)).toEqual(['member-b'])
  })

  it('highlights only server-confirmed mention tokens', () => {
    const names = new Map([['member-a', 'Ada Love']])
    expect(mentionSegments('Hi @Ada Love and @Unknown', ['member-a'], id => names.get(id) ?? null)).toEqual([
      { text: 'Hi ', mention: false },
      { text: '@Ada Love', mention: true },
      { text: ' and @Unknown', mention: false }
    ])
  })
})
