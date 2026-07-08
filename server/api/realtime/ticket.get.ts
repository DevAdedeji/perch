/** Issue a short-lived WS auth ticket for the current agent. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const secret = useRuntimeConfig(event).realtimeSecret || process.env.NUXT_SESSION_PASSWORD
  if (!secret) {
    throw createError({ statusCode: 500, statusMessage: 'Realtime is not configured' })
  }
  return { ticket: signTicket({ role: 'agent', uid: user.id }, secret) }
})
