/**
 * Roster bootstrap: everyone on the site right now, straight from the
 * in-memory visitor-presence registry (no DB hit — the registry carries an
 * identity snapshot). Live deltas then arrive over the `visitors:{id}` channel.
 */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  await requireMembership(event, workspaceId)

  return { visitors: liveVisitors(workspaceId) }
})
