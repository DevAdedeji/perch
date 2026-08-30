import { findOrCreateGoogleUser } from '../../services/google-auth'

export default defineOAuthGoogleEventHandler({
  config: {
    scope: ['openid', 'email', 'profile'],
    userURL: 'https://openidconnect.googleapis.com/v1/userinfo'
  },

  async onSuccess(event, { user: googleUser }) {
    const context = consumeGoogleOAuthContext(event, getQuery(event).state)
    if (!context) {
      return sendRedirect(event, googleOAuthFailurePath('login', 'invalid_state'))
    }

    try {
      const user = await findOrCreateGoogleUser(googleUser)
      await createDbSession(event, { id: user.id, email: user.email, name: user.name })
      return sendRedirect(event, context.redirect)
    } catch (error) {
      console.error('[auth] Google sign-in could not complete', {
        statusCode: typeof error === 'object' && error && 'statusCode' in error
          ? Number(error.statusCode)
          : 500
      })
      return sendRedirect(event, googleOAuthFailurePath(context.source, 'account'))
    }
  },

  onError(event, error) {
    const source = getCookie(event, 'perch_google_oauth_source') === 'signup' ? 'signup' : 'login'
    clearGoogleOAuthContext(event)
    console.error('[auth] Google OAuth provider error', { statusCode: error.statusCode })
    return sendRedirect(event, googleOAuthFailurePath(source, 'provider'))
  }
})
