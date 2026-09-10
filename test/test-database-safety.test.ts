import { describe, expect, it } from 'vitest'
import { getTestDatabaseUrl } from '@@/test/helpers/database'

describe('database test safety', () => {
  it('allows an absent URL so database-dependent tests can skip', () => {
    expect(getTestDatabaseUrl('')).toBeUndefined()
  })

  it.each(['perch_test', 'test_perch', 'perch-test-db'])('accepts an explicitly named test database: %s', (name) => {
    const url = `postgres://localhost/${name}`
    expect(getTestDatabaseUrl(url)).toBe(url)
  })

  it.each(['postgres://localhost/perch', 'postgres://localhost/production', 'postgres://localhost/latest', 'https://localhost/perch_test', 'not a URL'])('rejects unsafe targets without revealing credentials', (url) => {
    expect(() => getTestDatabaseUrl(url)).toThrow(/TEST_DATABASE_URL/)
  })
})
