import type { H3Event } from 'h3'

export interface SessionUser {
  id: string
  email: string
  name: string
}

/**
 * Require an authenticated session and return the typed session user.
 *
 * Wraps nuxt-auth-utils' `requireUserSession` (which types `user` as the
 * re-exported, un-augmentable `#auth-utils` `User`) so every endpoint gets a
 * concrete `{ id, email, name }` without repeating the assertion.
 */
export async function requireUser(event: H3Event): Promise<SessionUser> {
  const { user } = await requireUserSession(event)
  return user as SessionUser
}
