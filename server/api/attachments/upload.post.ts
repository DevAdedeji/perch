import { z } from 'zod'

const authSchema = z.object({
  site_id: z.string().min(1).optional(),
  visitor_session: z.string().min(1).max(2048).optional()
})

/** Authenticated, size-bounded image upload proxy. */
export default defineEventHandler(async (event) => {
  assertRateLimit('attach-upload:ip', requestIp(event), { max: 30, windowMs: 60 * 1000 })
  const declaredLength = Number(getHeader(event, 'content-length') || 0)
  // Multipart framing adds a little overhead around the 1 MB file.
  if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0) {
    throw createError({ statusCode: 411, statusMessage: 'A content length is required' })
  }
  if (declaredLength > ATTACHMENT_MAX_BYTES + 64 * 1024) {
    throw createError({ statusCode: 413, statusMessage: 'Images must be smaller than 1 MB' })
  }

  const parts = await readMultipartFormData(event)
  if (!parts) throw createError({ statusCode: 400, statusMessage: 'Upload is missing' })
  const file = parts.find(part => part.name === 'file' && part.filename)
  const fields = Object.fromEntries(parts
    .filter(part => part.name && !part.filename)
    .map(part => [part.name!, part.data.toString('utf8')]))
  const auth = authSchema.safeParse(fields)
  if (!auth.success || !file) throw createError({ statusCode: 400, statusMessage: 'Invalid upload' })
  if (!file.type?.startsWith('image/') || file.data.length > ATTACHMENT_MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Only images smaller than 1 MB are allowed' })
  }

  const session = await getUserSession(event)
  if (session.user) {
    const user = await requireUser(event)
    assertRateLimit('attach-upload:user', user.id, { max: 30, windowMs: 60 * 1000 })
  } else {
    const { site_id, visitor_session } = auth.data
    if (!site_id || !visitor_session) {
      throw createError({ statusCode: 401, statusMessage: 'Sign in or provide a widget session' })
    }
    const { visitor } = await requireVisitorSession(event, site_id, visitor_session)
    assertRateLimit('attach-upload:visitor', visitor.id, { max: 10, windowMs: 60 * 1000 })
  }

  const { cloudName, apiKey, apiSecret } = cloudinaryConfig()
  if (!cloudName || !apiKey || !apiSecret) {
    throw createError({ statusCode: 503, statusMessage: 'Attachments are not configured' })
  }
  const timestamp = Math.floor(Date.now() / 1000)
  const params = { timestamp, folder: 'perch', allowed_formats: ATTACHMENT_FORMATS }
  const form = new FormData()
  const bytes = Uint8Array.from(file.data)
  form.append('file', new Blob([bytes], { type: file.type }), file.filename)
  form.append('api_key', apiKey)
  form.append('timestamp', String(timestamp))
  form.append('folder', params.folder)
  form.append('allowed_formats', params.allowed_formats)
  form.append('signature', signCloudinaryParams(params, apiSecret))

  const response = await $fetch<{ secure_url: string, resource_type: string, bytes: number }>(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
    { method: 'POST', body: form }
  )
  if (response.resource_type !== 'image' || response.bytes > ATTACHMENT_MAX_BYTES
    || !isOwnCloudinaryImageUrl(response.secure_url, cloudName)) {
    throw createError({ statusCode: 502, statusMessage: 'Image host returned an invalid upload' })
  }
  return { url: response.secure_url, type: file.type }
})
