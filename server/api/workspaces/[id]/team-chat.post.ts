import { teamMessages } from '@perch/db'
import { channels } from '@perch/shared'
import { z } from 'zod'

/** Say something in the team lounge — broadcast to every online teammate. */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { user, member } = await requireMembership(event, workspaceId)
  assertRateLimit('team-chat:member', member.id, { max: 30, windowMs: 60 * 1000 })

  const result = await readValidatedBody(event, body => z.object({
    content: z.string().trim().min(1, 'Say something').max(2000)
  }).safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? 'Invalid input' })
  }

  const [row] = await useDb().insert(teamMessages).values({
    workspaceId,
    memberId: member.id,
    content: result.data.content
  }).returning()

  const payload = {
    id: row!.id,
    workspace_id: workspaceId,
    member_id: member.id,
    member_name: user.name,
    content: row!.content,
    created_at: row!.createdAt.toISOString()
  }
  // the workspace channel is already agents-only — visitors can never join it
  publish(channels.workspace(workspaceId), { type: 'team.message', payload })

  setResponseStatus(event, 201)
  return payload
})
