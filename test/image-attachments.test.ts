import { describe, expect, it } from 'vitest'
import { ATTACHMENT_MAX_BYTES, validateImageAttachment } from '../packages/shared/src/constants'

describe('image attachment validation', () => {
  it.each(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])(
    'accepts a supported %s image',
    (type) => {
      expect(validateImageAttachment({ type, size: ATTACHMENT_MAX_BYTES })).toBeNull()
    }
  )

  it('rejects formats the image provider is not configured to store', () => {
    expect(validateImageAttachment({ type: 'image/svg+xml', size: 100 })).toBe('Use a JPG, PNG, GIF, or WebP image')
    expect(validateImageAttachment({ type: 'image/heic', size: 100 })).toBe('Use a JPG, PNG, GIF, or WebP image')
    expect(validateImageAttachment({ type: 'text/plain', size: 100 })).toBe('Use a JPG, PNG, GIF, or WebP image')
  })

  it('rejects supported images larger than one megabyte', () => {
    expect(validateImageAttachment({ type: 'image/png', size: ATTACHMENT_MAX_BYTES + 1 }))
      .toBe('Images must be smaller than 1 MB')
  })
})
