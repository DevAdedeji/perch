/**
 * Baseline security headers. The one carve-out is the widget frame: `/widget`
 * exists to be iframed by any customer site, so it advertises
 * `frame-ancestors *` — everything else (dashboard, auth, API) refuses to be
 * framed at all (clickjacking protection for an app full of other companies'
 * customer conversations).
 */
export default defineEventHandler((event) => {
  const path = event.path.split('?')[0] ?? ''

  if (path === '/widget') {
    setResponseHeader(event, 'Content-Security-Policy', 'frame-ancestors *')
  } else {
    setResponseHeader(event, 'X-Frame-Options', 'DENY')
    setResponseHeader(event, 'Content-Security-Policy', 'frame-ancestors \'none\'')
  }

  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'Referrer-Policy', 'strict-origin-when-cross-origin')
  setResponseHeader(event, 'Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  // HSTS only matters (and is only safe) over TLS — i.e. production
  if (!import.meta.dev) {
    setResponseHeader(event, 'Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
})
