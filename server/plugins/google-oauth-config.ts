import { googleOAuthConfigured } from '@@/server/integrations/google-oauth'
/** Fail at startup when only half of the Google OAuth credentials are set. */
export default defineNitroPlugin(() => {
  googleOAuthConfigured()
})
