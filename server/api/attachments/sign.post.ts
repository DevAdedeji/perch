import { eq, workspaces } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  // visitor path — agents authenticate with their session instead
  site_id: z.string().min(1).optional(),
  visitor_id: z.string().min(8).max(128).optional()
})

/**
 * Sign a direct-to-Cloudinary image upload (PRD §5.3). Callable by a
 * signed-in agent or by a widget visitor (site_id + visitor_id). Images only,
 * ≤ 1 MB — the size cap is enforced client-side and the format list is part
 * of the signature, so it can't be altered by the uploader.
 */
export default defineEventHandler(async (event) => {
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig()
  if (!cloudName || !apiKey || !apiSecret) {
    throw createError({ statusCode: 503, statusMessage: 'Attachments are not configured' })
  }

  const session = await getUserSession(event)
  if (session.user) {
    assertRateLimit('attach-sign:user', (session.user as { id: string }).id, { max: 30, windowMs: 60 * 1000 })
  } else {
    assertRateLimit('attach-sign:ip', requestIp(event), { max: 10, windowMs: 60 * 1000 })
    const result = await readValidatedBody(event, body => schema.safeParse(body ?? {}))
    if (!result.success || !result.data.site_id || !result.data.visitor_id) {
      throw createError({ statusCode: 401, statusMessage: 'Sign in or provide a widget session' })
    }
    const workspace = await useDb().query.workspaces.findFirst({
      where: eq(workspaces.siteId, result.data.site_id)
    })
    if (!workspace) {
      throw createError({ statusCode: 404, statusMessage: 'Unknown site' })
    }
  }

  const timestamp = Math.floor(Date.now() / 1000)
  const params = {
    timestamp,
    folder: 'perch',
    allowed_formats: ATTACHMENT_FORMATS
  }

  return {
    cloud_name: cloudName,
    api_key: apiKey,
    ...params,
    signature: signCloudinaryParams(params, apiSecret),
    max_bytes: ATTACHMENT_MAX_BYTES
  }
})
