import { z } from 'zod'
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MIME_TYPES } from '@perch/shared'

const authSchema = z.object({
  site_id: z.string().min(1).optional(),
  visitor_session: z.string().min(1).max(2048).optional(),
  workspace_id: z.string().uuid().optional(),
  purpose: z.enum(['message', 'logo'])
})

const cloudinaryResponseSchema = z.object({
  secure_url: z.string().url(),
  resource_type: z.literal('image'),
  bytes: z.number().int().nonnegative(),
  public_id: z.string().min(1).max(255)
})

const CLOUDINARY_TIMEOUT_MS = 15_000

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
  if (!file.type || !(ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
    throw createError({ statusCode: 415, statusMessage: 'Use a JPG, PNG, GIF, or WebP image' })
  }
  if (file.data.length > ATTACHMENT_MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Images must be smaller than 1 MB' })
  }

  const session = await getUserSession(event)
  let workspaceId: string | null = null
  let uploaderUserId: string | null = null
  let visitorRef: string | null = null
  if (session.user) {
    const user = await requireUser(event)
    assertRateLimit('attach-upload:user', user.id, { max: 30, windowMs: 60 * 1000 })
    uploaderUserId = user.id
    if (auth.data.purpose === 'message') {
      if (!auth.data.workspace_id) throw createError({ statusCode: 400, statusMessage: 'Workspace is required' })
      await requireMembership(event, auth.data.workspace_id)
      workspaceId = auth.data.workspace_id
    } else if (auth.data.workspace_id) {
      await requireMembership(event, auth.data.workspace_id, { admin: true })
      workspaceId = auth.data.workspace_id
    }
  } else {
    const { site_id, visitor_session } = auth.data
    if (auth.data.purpose !== 'message') throw createError({ statusCode: 401, statusMessage: 'Sign in to upload a logo' })
    if (!site_id || !visitor_session) {
      throw createError({ statusCode: 401, statusMessage: 'Sign in or provide a widget session' })
    }
    const { workspace, visitor } = await requireVisitorSession(event, site_id, visitor_session)
    assertRateLimit('attach-upload:visitor', visitor.id, { max: 10, windowMs: 60 * 1000 })
    await assertVisitorCanMessage(visitor)
    workspaceId = workspace.id
    visitorRef = visitor.id
  }

  const { cloudName, apiKey, apiSecret } = cloudinaryConfig()
  if (!cloudinaryUploadAvailable({ cloudName, apiKey, apiSecret })) {
    throw createError({ statusCode: 503, statusMessage: 'Attachments are not configured' })
  }
  const timestamp = Math.floor(Date.now() / 1000)
  const folder = workspaceId ? `perch/${workspaceId}` : `perch/users/${uploaderUserId}`
  const params = {
    timestamp,
    folder,
    allowed_formats: ATTACHMENT_FORMATS,
    overwrite: 'false',
    unique_filename: 'true',
    use_filename: 'false'
  }
  const form = new FormData()
  const bytes = Uint8Array.from(file.data)
  form.append('file', new Blob([bytes], { type: file.type }), file.filename)
  form.append('api_key', apiKey)
  form.append('timestamp', String(timestamp))
  form.append('folder', params.folder)
  form.append('allowed_formats', params.allowed_formats)
  form.append('overwrite', params.overwrite)
  form.append('unique_filename', params.unique_filename)
  form.append('use_filename', params.use_filename)
  form.append('signature', signCloudinaryParams(params, apiSecret))

  const rawResponse = await $fetch<unknown>(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
    { method: 'POST', body: form, timeout: CLOUDINARY_TIMEOUT_MS }
  )
  const parsedResponse = cloudinaryResponseSchema.safeParse(rawResponse)
  if (!parsedResponse.success) {
    throw createError({ statusCode: 502, statusMessage: 'Image host returned an invalid upload' })
  }
  const providerUpload = parsedResponse.data
  const expectedPrefix = workspaceId ? `perch/${workspaceId}/` : `perch/users/${uploaderUserId}/`
  if (providerUpload.bytes > ATTACHMENT_MAX_BYTES
    || !isOwnCloudinaryImageUrl(providerUpload.secure_url, cloudName)
    || !providerUpload.public_id.startsWith(expectedPrefix)) {
    if (providerUpload.public_id.startsWith(expectedPrefix)) {
      try {
        await destroyAttachmentAsset(providerUpload.public_id)
      } catch (cleanupError) {
        console.error('[attachments] rejected upload cleanup failed', {
          requestId: event.context.requestId,
          ...safeErrorSummary(cleanupError)
        })
      }
    }
    throw createError({ statusCode: 502, statusMessage: 'Image host returned an invalid upload' })
  }
  try {
    await registerAttachmentAsset({
      workspaceId,
      uploaderUserId,
      visitorRef,
      kind: auth.data.purpose,
      publicId: providerUpload.public_id,
      secureUrl: providerUpload.secure_url,
      mimeType: file.type,
      byteSize: providerUpload.bytes
    })
  } catch (error) {
    try {
      await destroyAttachmentAsset(providerUpload.public_id)
    } catch (cleanupError) {
      console.error('[attachments] upload rollback cleanup failed', {
        requestId: event.context.requestId,
        ...safeErrorSummary(cleanupError)
      })
    }
    console.error('[attachments] upload registration failed', {
      requestId: event.context.requestId,
      ...safeErrorSummary(error)
    })
    throw createError({ statusCode: 503, statusMessage: 'The upload could not be saved. Please try again.' })
  }
  return { url: providerUpload.secure_url, type: file.type }
})
