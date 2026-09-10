export function getTestDatabaseUrl(value = process.env.TEST_DATABASE_URL): string | undefined {
  if (!value?.trim()) return undefined
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('TEST_DATABASE_URL must be a PostgreSQL connection string.')
  }
  const database = decodeURIComponent(url.pathname.slice(1))
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/(^|[-_])test($|[-_])/i.test(database)) {
    throw new Error('Refusing database tests: TEST_DATABASE_URL must name an isolated PostgreSQL test database.')
  }
  return value.trim()
}
