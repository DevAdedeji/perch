import { CONVERSATION_PRIORITIES, CONVERSATION_STATUSES } from '@perch/shared'
import type { ConversationPriority, ConversationStatus, SavedInboxFilters } from '@perch/shared'
import { and, eq, inArray, tags, workspaceMembers } from '@perch/db'
import { z } from 'zod'

const uuid = z.string().uuid()
const assigneeSchema = z.union([
  z.enum(['any', 'me', 'unassigned']),
  uuid
])

function list(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value]
  return values.flatMap(item => typeof item === 'string' ? item.split(',') : [])
    .map(item => item.trim())
    .filter(Boolean)
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

export interface InboxFilters {
  status: ConversationStatus | undefined
  assignee: 'any' | 'me' | 'unassigned' | string
  priorities: ConversationPriority[]
  tagIds: string[]
  snoozed: 'exclude' | 'include' | 'only'
}

export function parseInboxFilters(query: Record<string, unknown>) {
  return z.object({
    status: z.preprocess(value => typeof value === 'string' && value ? value : undefined, z.enum(CONVERSATION_STATUSES).optional()),
    assignee: z.preprocess(value => typeof value === 'string' && value ? value : 'any', assigneeSchema),
    priorities: z.preprocess(value => unique(list(value)), z.array(z.enum(CONVERSATION_PRIORITIES)).max(CONVERSATION_PRIORITIES.length)),
    tagIds: z.preprocess(value => unique(list(value)), z.array(uuid).max(10)),
    snoozed: z.preprocess(value => typeof value === 'string' && value ? value : 'exclude', z.enum(['exclude', 'include', 'only']))
  }).safeParse({
    status: query.status,
    assignee: query.assignee,
    priorities: query.priority,
    tagIds: query.tag,
    snoozed: query.snoozed
  })
}

export const savedInboxFiltersSchema: z.ZodType<SavedInboxFilters> = z.object({
  status: z.union([z.literal('all'), z.enum(CONVERSATION_STATUSES)]),
  assignee: assigneeSchema,
  priorities: z.array(z.enum(CONVERSATION_PRIORITIES)).max(CONVERSATION_PRIORITIES.length).transform(unique),
  tag_ids: z.array(uuid).max(10).transform(unique),
  snoozed: z.enum(['exclude', 'include', 'only'])
}).strict()

export const conversationOrganizationSchema = z.object({
  priority: z.enum(CONVERSATION_PRIORITIES).optional(),
  snoozed_until: z.union([
    z.null(),
    z.iso.datetime({ offset: true }).transform(value => new Date(value))
  ]).optional()
}).strict().refine(value => value.priority !== undefined || value.snoozed_until !== undefined, {
  message: 'Choose a priority or snooze time'
})

export function validateSnoozeDate(date: Date | null | undefined, now = new Date()): string | null {
  if (date == null) return null
  if (date.getTime() <= now.getTime()) return 'Snooze time must be in the future'
  const oneYear = new Date(now)
  oneYear.setUTCFullYear(oneYear.getUTCFullYear() + 1)
  return date > oneYear ? 'Snooze time cannot be more than one year away' : null
}

export async function assertInboxFilterReferences(workspaceId: string, filters: SavedInboxFilters) {
  if (!['any', 'me', 'unassigned'].includes(filters.assignee)) {
    const member = await useDb().query.workspaceMembers.findFirst({
      where: and(eq(workspaceMembers.id, filters.assignee), eq(workspaceMembers.workspaceId, workspaceId))
    })
    if (!member) throw createError({ statusCode: 400, statusMessage: 'Saved view contains an invalid assignee' })
  }

  if (filters.tag_ids.length) {
    const rows = await useDb().select({ id: tags.id }).from(tags).where(and(
      eq(tags.workspaceId, workspaceId),
      inArray(tags.id, filters.tag_ids)
    ))
    if (rows.length !== filters.tag_ids.length) {
      throw createError({ statusCode: 400, statusMessage: 'Saved view contains an invalid tag' })
    }
  }
}
