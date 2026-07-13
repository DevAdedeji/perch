import { eq, workspaces } from '@perch/db'
import { z } from 'zod'

const dayHours = z.object({
  open: z.string().regex(TIME_RE, 'Times must be HH:MM'),
  close: z.string().regex(TIME_RE, 'Times must be HH:MM')
}).refine(d => d.open < d.close, { message: 'Closing time must be after opening time' }).nullable()

const schema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  prechatFormEnabled: z.boolean().optional(),
  identityVerificationEnabled: z.boolean().optional(),
  widgetPrimaryColor: hexColor.optional(),
  allowedDomains: z.array(z.string().trim().min(1).max(253)).max(20).optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  businessHours: z.object({
    sun: dayHours.optional(),
    mon: dayHours.optional(),
    tue: dayHours.optional(),
    wed: dayHours.optional(),
    thu: dayHours.optional(),
    fri: dayHours.optional(),
    sat: dayHours.optional()
  }).nullable().optional(),
  timezone: z.string().max(64).refine(isValidTimezone, 'Unknown timezone').nullable().optional()
})

/** Update workspace settings (admin only). */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { user } = await requireMembership(event, workspaceId, { admin: true })

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input', data: result.error.flatten() })
  }

  const db = useDb()
  const patch = { ...result.data }
  // logos ride the same signed-upload pipeline as attachments — own cloud only
  if (patch.logoUrl && !isOwnCloudinaryImageUrl(patch.logoUrl, cloudinaryConfig().cloudName)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid logo upload' })
  }
  if (patch.allowedDomains) {
    // normalize + validate each entry ("https://App.Example.com/x" -> "app.example.com")
    const normalized: string[] = []
    for (const entry of patch.allowedDomains) {
      const domain = normalizeDomain(entry)
      if (!domain) {
        throw createError({ statusCode: 400, statusMessage: `"${entry}" is not a valid domain` })
      }
      if (!normalized.includes(domain)) normalized.push(domain)
    }
    patch.allowedDomains = normalized
  }
  // a schedule is meaningless without a timezone to evaluate it in
  if (patch.businessHours && !patch.timezone) {
    const current = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) })
    if (!current?.timezone) {
      throw createError({ statusCode: 400, statusMessage: 'Pick a timezone for your business hours' })
    }
  }

  const [workspace] = Object.keys(patch).length
    ? await db.update(workspaces).set(patch).where(eq(workspaces.id, workspaceId)).returning()
    : [await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) })]

  if (Object.keys(patch).length) {
    logAudit(workspaceId, user, 'settings.updated', { changed: Object.keys(patch) })
  }

  return {
    workspace: {
      ...serializeWorkspace(workspace!),
      identityVerificationEnabled: workspace!.identityVerificationEnabled
    }
  }
})
