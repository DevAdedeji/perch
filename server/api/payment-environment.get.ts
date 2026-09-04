export default defineEventHandler((event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const config = useRuntimeConfig(event)
  const environment = String(config.bachsEnvironment || process.env.BACHS_ENV || '')
  const key = String(config.bachsSecretKey || process.env.BACHS_SECRET_KEY || '')
  const mode = environment === 'sandbox' && key.startsWith('sk_sandbox_')
    ? 'sandbox'
    : environment === 'live' && key.startsWith('sk_live_') ? 'live' : 'disabled'
  return { mode }
})
