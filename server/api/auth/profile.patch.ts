import { eq, users } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(100)
})

/** Update the signed-in user's display name (and keep the session in sync). */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input', data: result.error.flatten() })
  }

  const [updated] = await useDb()
    .update(users)
    .set({ name: result.data.name })
    .where(eq(users.id, user.id))
    .returning()

  await setUserSession(event, {
    user: { id: updated!.id, email: updated!.email, name: updated!.name }
  })
  return { user: { id: updated!.id, email: updated!.email, name: updated!.name } }
})
