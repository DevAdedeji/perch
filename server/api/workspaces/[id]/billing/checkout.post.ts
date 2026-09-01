import { billingIntervals } from '@perch/shared'
import { z } from 'zod'

const schema = z.object({
  interval: z.enum(billingIntervals),
  requestId: z.string().uuid()
})

export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { user } = await requireMembership(event, workspaceId, { admin: true })
  if (!bachsConfigured()) {
    throw createError({ statusCode: 503, statusMessage: 'Billing is not configured on this environment yet.' })
  }
  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) throw createError({ statusCode: 400, statusMessage: 'Choose a valid billing interval.' })
  const customer = await workspaceBillingCustomer(workspaceId, user.id)
  return startWorkspaceCheckout({
    workspaceId,
    interval: result.data.interval,
    requestId: result.data.requestId,
    customer,
    origin: publicOrigin(event)
  })
})
