/** Requeue one exhausted cleanup job. Repeating the request fails closed. */
export default defineEventHandler(async (event) => {
  assertRateLimit('admin-attachment-retry:ip', requestIp(event), { max: 20, windowMs: 60 * 1000 })
  await requirePlatformAdmin(event)
  const assetId = getRouterParam(event, 'id')!
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assetId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid cleanup id' })
  }
  await retryFailedAttachmentCleanup(assetId)
  return { ok: true }
})
