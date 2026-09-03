import { findOrCreateGoogleUser } from '../../services/google-auth'

const googleOAuthHandler = defineOAuthGoogleEventHandler({
  config: {
    scope: ['openid', 'email', 'profile'],
    userURL: 'https://openidconnect.googleapis.com/v1/userinfo'
  },

  async onSuccess(event, { user: googleUser }) {
    const { redirect, source } = consumeGoogleOAuthContext(event)

    try {
      const user = await findOrCreateGoogleUser(googleUser)
      await createDbSession(event, { id: user.id, email: user.email, name: user.name })
      return sendRedirect(event, redirect)
    } catch (error) {
      console.error('[auth] Google sign-in could not complete', {
        statusCode: typeof error === 'object' && error && 'statusCode' in error
          ? Number(error.statusCode)
          : 500
      })
      return sendRedirect(event, googleOAuthFailurePath(source, 'account'))
    }
  },

  onError(event, error) {
    const { source } = consumeGoogleOAuthContext(event)
    console.error('[auth] Google OAuth provider error', { statusCode: error.statusCode })
    return sendRedirect(event, googleOAuthFailurePath(source, 'provider'))
  }
})

export default defineEventHandler(async (event) => {
  try {
    return await googleOAuthHandler(event)
  } catch (error) {
    const { source } = consumeGoogleOAuthContext(event)
    console.error('[auth] Google OAuth exchange failed', {
      statusCode: typeof error === 'object' && error && 'statusCode' in error
        ? Number(error.statusCode)
        : 500
    })
    return sendRedirect(event, googleOAuthFailurePath(source, 'provider'))
  }
})
