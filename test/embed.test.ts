import { describe, expect, it } from 'vitest'
import { buildEmbedSnippet } from '../app/utils/embed'

describe('buildEmbedSnippet', () => {
  it('builds the canonical asynchronous loader tag', () => {
    expect(buildEmbedSnippet('https://useperch.xyz', 'ws_abc123')).toBe(
      '<script src="https://useperch.xyz/widget.js" data-site-id="ws_abc123" async></script>'
    )
  })

  it('normalizes the input to an origin and preserves development ports', () => {
    expect(buildEmbedSnippet('http://localhost:2222/settings', 'ws_0123abcd')).toContain(
      'src="http://localhost:2222/widget.js"'
    )
  })

  it('rejects unsafe origins and malformed site ids', () => {
    expect(() => buildEmbedSnippet('javascript:alert(1)', 'ws_abc123')).toThrow('HTTP(S) origin')
    expect(() => buildEmbedSnippet('https://user:pass@useperch.xyz', 'ws_abc123')).toThrow('without credentials')
    expect(() => buildEmbedSnippet('https://useperch.xyz', 'ws_bad" onload="alert(1)')).toThrow('Invalid Perch site id')
  })
})
