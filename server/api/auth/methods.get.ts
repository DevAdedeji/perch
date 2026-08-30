export default defineEventHandler(event => ({
  google: googleOAuthConfigured(event)
}))
