import { z } from 'zod'

export function parseCursorPagination(query: Record<string, unknown>, defaultLimit: number) {
  const parsed = z.object({
    limit: z.coerce.number().int().positive().transform(value => Math.min(value, 100)).default(defaultLimit),
    before: z.uuid().optional()
  }).safeParse(query)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid pagination parameters' })
  return { limit: parsed.data.limit, beforeId: parsed.data.before ?? null }
}
