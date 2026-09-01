import { describe, expect, it } from 'vitest'
import { messageTextSegments } from '../app/utils/message-links'

describe('message links', () => {
  it('turns public HTTP(S) URLs into safe link segments', () => {
    expect(messageTextSegments('Read https://useperch.xyz/help/ws_123/article.')).toEqual([
      { text: 'Read ' },
      { text: 'https://useperch.xyz/help/ws_123/article', href: 'https://useperch.xyz/help/ws_123/article' },
      { text: '.' }
    ])
  })

  it('does not link URLs containing credentials', () => {
    expect(messageTextSegments('https://user:secret@example.com/help')).toEqual([
      { text: 'https://user:secret@example.com/help' }
    ])
  })

  it('preserves plain text and multiple links', () => {
    expect(messageTextSegments('One http://example.com and https://useperch.xyz')).toEqual([
      { text: 'One ' },
      { text: 'http://example.com', href: 'http://example.com/' },
      { text: ' and ' },
      { text: 'https://useperch.xyz', href: 'https://useperch.xyz/' }
    ])
  })

  it('keeps balanced URL parentheses but excludes sentence punctuation', () => {
    expect(messageTextSegments('(See https://example.com/help_(guide)).')).toEqual([
      { text: '(See ' },
      { text: 'https://example.com/help_(guide)', href: 'https://example.com/help_(guide)' },
      { text: ').' }
    ])
  })
})
