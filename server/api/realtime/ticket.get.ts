/** Issue a short-lived WS auth ticket for the current agent. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const secret = requireRealtimeSecret(event)
  return { ticket: signTicket({ role: 'agent', uid: user.id }, secret) }
})
