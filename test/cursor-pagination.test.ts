import { describe, expect, it } from 'vitest'
import { parseCursorPagination } from '@@/server/utils/cursor-pagination'

describe('cursor pagination validation', () => {
  it('uses the endpoint default, parses integers and caps large pages', () => {
    expect(parseCursorPagination({}, 30)).toEqual({ limit: 30, beforeId: null })
    expect(parseCursorPagination({ limit: '20' }, 50).limit).toBe(20)
    expect(parseCursorPagination({ limit: '500' }, 50).limit).toBe(100)
  })

  it.each(['0', '-1', '1.5', 'NaN', 'Infinity', ''])('rejects invalid limits: %s', (limit) => {
    expect(() => parseCursorPagination({ limit }, 30)).toThrow('Invalid pagination parameters')
  })

  it('rejects malformed cursors before querying UUID columns', () => {
    expect(() => parseCursorPagination({ before: 'not-a-uuid' }, 30)).toThrow('Invalid pagination parameters')
    const before = '11111111-1111-4111-8111-111111111111'
    expect(parseCursorPagination({ before }, 30).beforeId).toBe(before)
  })
})
