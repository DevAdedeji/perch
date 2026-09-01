/** Public resources must not mint anonymous auth-session cookies. */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', (event) => {
    const installationPreview = event.path.startsWith('/widget') && getQuery(event).preview === '1'
    if (isCookieFreePublicRequest(event.path, installationPreview)) {
      removeResponseHeader(event, 'set-cookie')
    }
  })
})
