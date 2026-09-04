/** Issue a short-lived WS auth ticket for the current agent. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const sessionId = await currentSessionId(event)
  if (!sessionId) throw createError({ statusCode: 401, statusMessage: 'Session expired' })
  const secret = requireRealtimeSecret(event)
  return { ticket: signTicket({ role: 'agent', uid: user.id, sid: sessionId }, secret) }
})
