import { eq, workspaces } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  prechatFormEnabled: z.boolean().optional(),
  widgetPrimaryColor: hexColor.optional()
})

/** Update workspace settings (admin only). */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  await requireMembership(event, workspaceId, { admin: true })

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input', data: result.error.flatten() })
  }

  const db = useDb()
  const patch = result.data
  const [workspace] = Object.keys(patch).length
    ? await db.update(workspaces).set(patch).where(eq(workspaces.id, workspaceId)).returning()
    : [await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) })]

  return { workspace: serializeWorkspace(workspace!) }
})
