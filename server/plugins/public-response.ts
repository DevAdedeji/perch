/** Public assets must not mint anonymous auth-session cookies. */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', (event) => {
    const path = event.path.split('?')[0]
    if (path === '/' || path === '/widget.js') removeResponseHeader(event, 'set-cookie')
  })
})
