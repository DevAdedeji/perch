import { workspaceMembers, workspaces } from '@perch/db'
import type { Workspace } from '@perch/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  const result = await readValidatedBody(event, body => createWorkspaceSchema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input', data: result.error.flatten() })
  }
  const { name, widgetPrimaryColor, logoUrl } = result.data

  const db = useDb()

  // insert with a fresh site_id, retrying on the (rare) unique collision
  let workspace: Workspace | undefined
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [row] = await db.insert(workspaces).values({
        name,
        siteId: generateSiteId(),
        widgetPrimaryColor: widgetPrimaryColor ?? undefined,
        logoUrl: logoUrl ?? null
      }).returning()
      workspace = row
      break
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === '23505' && attempt < 4) continue // duplicate site_id → retry
      throw err
    }
  }
  if (!workspace) {
    throw createError({ statusCode: 500, statusMessage: 'Could not create workspace' })
  }

  // the creator becomes the workspace admin/owner, and is online right now
  await db.insert(workspaceMembers).values({
    workspaceId: workspace.id,
    userId: user.id,
    role: 'admin',
    presence: 'online',
    lastSeenAt: new Date()
  })

  setResponseStatus(event, 201)
  return { workspace: serializeWorkspace(workspace) }
})
