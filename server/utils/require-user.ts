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
  const session = await requireUserSession(event)
  const user = session.user as SessionUser
  // the sealed cookie is necessary but not sufficient — the server-side
  // session row must still exist (this is what makes sign-out-everywhere real)
  await assertSessionAlive(event, (session as { sessionId?: string }).sessionId, user.id)
  return user
}
