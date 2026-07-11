/**
 * server/utils files rely on Nitro's auto-imports. Provide shape-compatible
 * stand-ins for the ones the units under test actually touch (h3 is a
 * transitive dependency, so we mirror its createError semantics instead of
 * importing it).
 */

interface ErrorInput {
  statusCode?: number
  statusMessage?: string
}

class H3LikeError extends Error {
  statusCode: number
  statusMessage?: string

  constructor(input: ErrorInput) {
    super(input.statusMessage ?? 'Error')
    this.statusCode = input.statusCode ?? 500
    this.statusMessage = input.statusMessage
  }
}

Object.assign(globalThis, {
  createError: (input: ErrorInput) => new H3LikeError(input)
})
