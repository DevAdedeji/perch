import { and, eq, widgetInstallationSignals, workspaces } from '@perch/db'
import { z } from 'zod'
import {
  evaluateInstallationSignal,
  installationPageHash,
  normalizeInstallationPage
} from '../../../../utils/installation'

const schema = z.object({
  url: z.string().trim().min(1).max(2_000)
})

export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { user } = await requireMembership(event, workspaceId, { admin: true })
  assertRateLimit('installation-verify', `${workspaceId}:${user.id}`, { max: 30, windowMs: 60 * 1000 })

  const parsed = await readValidatedBody(event, body => schema.safeParse(body))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Enter a complete website URL' })
  }
  const requested = normalizeInstallationPage(parsed.data.url)
  if (!requested) {
    throw createError({ statusCode: 400, statusMessage: 'Enter a valid HTTP or HTTPS website URL' })
  }

  const workspace = await useDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) })
  if (!workspace) {
    throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })
  }
  if (!isDomainAllowed(requested.url, workspace.allowedDomains)) {
    return {
      installed: false,
      reason: 'domain_not_allowed' as const,
      requested,
      observed: null,
      observedAt: null
    }
  }

  const signal = await useDb().query.widgetInstallationSignals.findFirst({
    where: and(
      eq(widgetInstallationSignals.workspaceId, workspaceId),
      eq(widgetInstallationSignals.pageHash, installationPageHash(requested.url))
    )
  })

  return evaluateInstallationSignal(requested, signal?.pageUrl, signal?.lastSeenAt)
})
