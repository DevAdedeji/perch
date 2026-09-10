import { googleOAuthConfigured } from '@@/server/integrations/google-oauth'

export default defineEventHandler(event => ({
  google: googleOAuthConfigured(event)
}))
