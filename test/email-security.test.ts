import { describe, expect, it } from 'vitest'
import { shouldLogEmailPreview } from '../server/utils/email'

describe('email preview logging', () => {
  it('never exposes sensitive preview links in production', () => {
    expect(shouldLogEmailPreview(false, false)).toBe(false)
  })

  it('only exposes an unsent preview during local development', () => {
    expect(shouldLogEmailPreview(false, true)).toBe(true)
    expect(shouldLogEmailPreview(true, true)).toBe(false)
  })
})
