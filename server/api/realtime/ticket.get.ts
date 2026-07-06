/** Issue a short-lived WS auth ticket for the current agent. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const secret = useRuntimeConfig(event).realtimeSecret
  if (!secret) {
    throw createError({ statusCode: 500, statusMessage: 'Realtime is not configured' })
  }
  return { ticket: signTicket(user.id, secret) }
})
