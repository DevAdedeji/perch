import { eq, workspaces } from '@perch/db'
import { z } from 'zod'
import { PERCH_PRO_PLAN } from '@perch/shared'

const dayHours = z.object({
  open: z.string().regex(TIME_RE, 'Times must be HH:MM'),
  close: z.string().regex(TIME_RE, 'Times must be HH:MM')
}).refine(d => d.open < d.close, { message: 'Closing time must be after opening time' }).nullable()

const schema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  prechatFormEnabled: z.boolean().optional(),
  identityVerificationEnabled: z.boolean().optional(),
  ...widgetCustomizationSchema.shape,
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
  timezone: z.string().max(64).refine(isValidTimezone, 'Unknown timezone').nullable().optional(),
  unansweredReminderEnabled: z.boolean().optional(),
  unansweredReminderDelayMinutes: z.number().int().min(5).max(1440).optional(),
  unansweredReminderBusinessHoursOnly: z.boolean().optional(),
  visitorReplyEmailEnabled: z.boolean().optional()
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
  if (patch.visitorReplyEmailEnabled === true && !visitorReplyEmailFeatureEnabled(event)) {
    throw createError({ statusCode: 409, statusMessage: 'Visitor reply emails are not available' })
  }
  const entitlement = await workspaceEntitlement(workspaceId)
  if (!entitlement.isPro) {
    if (patch.unansweredReminderBusinessHoursOnly) {
      throw createError({ statusCode: 402, statusMessage: 'Business-hours-only reminders are available on Perch Pro.' })
    }
    if (patch.widgetShowBranding === false) {
      throw createError({ statusCode: 402, statusMessage: 'Removing Perch branding is available on Perch Pro.' })
    }
    if (patch.unansweredReminderEnabled !== undefined || patch.unansweredReminderDelayMinutes !== undefined) {
      patch.unansweredReminderDelayMinutes = PERCH_PRO_PLAN.freeReminderMinutes
    }
    if (patch.unansweredReminderEnabled !== undefined) {
      patch.unansweredReminderBusinessHoursOnly = false
    }
  }
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
  // Validate the resulting pair, not just fields present in this PATCH. This
  // also prevents clearing the timezone while retaining an existing schedule.
  const current = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) })
  const resultingHours = patch.businessHours === undefined ? current?.businessHours : patch.businessHours
  const resultingTimezone = patch.timezone === undefined ? current?.timezone : patch.timezone
  if (resultingHours && !resultingTimezone) {
    throw createError({ statusCode: 400, statusMessage: 'Pick a timezone for your business hours' })
  }

  const workspace = Object.keys(patch).length
    ? await db.transaction(async (tx) => {
        const [lockedWorkspace] = await tx.select().from(workspaces)
          .where(eq(workspaces.id, workspaceId)).for('update')
        if (!lockedWorkspace) throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })
        const updatePatch: typeof patch & { logoAssetId?: string | null } = { ...patch }
        if (patch.logoUrl !== undefined && patch.logoUrl !== lockedWorkspace.logoUrl) {
          if (patch.logoUrl) {
            const asset = await claimLogoAttachment(tx, {
              workspaceId,
              secureUrl: patch.logoUrl,
              uploaderUserId: user.id
            })
            updatePatch.logoAssetId = asset.id
          } else {
            updatePatch.logoAssetId = null
          }
          if (lockedWorkspace.logoAssetId) {
            await queueAssetCleanup(tx, lockedWorkspace.logoAssetId, patch.logoUrl ? 'logo_replaced' : 'logo_removed')
          } else if (lockedWorkspace.logoUrl) {
            await queueLegacyLogoCleanup(tx, {
              workspaceId,
              uploaderUserId: user.id,
              secureUrl: lockedWorkspace.logoUrl,
              reason: patch.logoUrl ? 'logo_replaced' : 'logo_removed'
            })
          }
        }
        const [updated] = await tx.update(workspaces).set(updatePatch)
          .where(eq(workspaces.id, workspaceId)).returning()
        return updated!
      })
    : await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) })

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
