import { and, asc, automationRules, eq, inArray, tags, workspaceMembers } from '@perch/db'
import type { AutomationRule, Visitor } from '@perch/db'
import type { AutomationRuleConfig, AutomationRuleType } from '@perch/shared'
import { z } from 'zod'

const uuid = z.string().uuid()

export const automationRuleSchemas = {
  round_robin: z.object({ member_ids: z.array(uuid).max(50).transform(ids => [...new Set(ids)]) }).strict(),
  page_assignment: z.object({
    url_contains: z.string().trim().min(1).max(300),
    member_id: uuid
  }).strict(),
  vip_tagging: z.discriminatedUnion('condition', [
    z.object({
      condition: z.literal('email_domain'),
      value: z.string().trim().toLowerCase().regex(/^@?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i).max(253),
      tag_id: uuid
    }).strict(),
    z.object({ condition: z.literal('email_equals'), value: z.string().trim().toLowerCase().email().max(200), tag_id: uuid }).strict(),
    z.object({
      condition: z.literal('metadata'),
      metadata_key: z.enum(['page_url', 'referrer', 'browser', 'device']),
      value: z.string().trim().min(1).max(300),
      tag_id: uuid
    }).strict()
  ]),
  inactivity_reminder: z.object({ minutes: z.number().int().min(5).max(1440) }).strict(),
  auto_close: z.object({ hours: z.number().int().min(24).max(720) }).strict()
} satisfies Record<AutomationRuleType, z.ZodType>

export function parseAutomationConfig(type: AutomationRuleType, config: unknown) {
  return automationRuleSchemas[type].safeParse(config)
}

export async function assertAutomationReferences(workspaceId: string, type: AutomationRuleType, config: AutomationRuleConfig) {
  const memberIds = type === 'round_robin'
    ? (config as { member_ids: string[] }).member_ids
    : type === 'page_assignment'
      ? [(config as { member_id: string }).member_id]
      : []
  if (memberIds.length) {
    const rows = await useDb().select({ id: workspaceMembers.id }).from(workspaceMembers).where(and(
      eq(workspaceMembers.workspaceId, workspaceId),
      inArray(workspaceMembers.id, memberIds)
    ))
    if (rows.length !== memberIds.length) {
      throw createError({ statusCode: 400, statusMessage: 'Automation contains an invalid team member' })
    }
  }

  if (type === 'vip_tagging') {
    const tagId = (config as { tag_id: string }).tag_id
    const tag = await useDb().query.tags.findFirst({ where: and(eq(tags.id, tagId), eq(tags.workspaceId, workspaceId)) })
    if (!tag) throw createError({ statusCode: 400, statusMessage: 'Automation contains an invalid tag' })
  }
}

export function matchesPageRule(config: { url_contains: string }, pageUrl: string | undefined) {
  return Boolean(pageUrl?.toLowerCase().includes(config.url_contains.toLowerCase()))
}

export function matchesVipRule(config: Extract<AutomationRuleConfig, { condition: unknown }>, visitor: Pick<Visitor, 'email' | 'identityVerified' | 'metadata'>) {
  if (config.condition === 'email_domain') {
    if (!visitor.identityVerified || !visitor.email) return false
    const domain = visitor.email.toLowerCase().split('@')[1]
    return domain === config.value.replace(/^@/, '').toLowerCase()
  }
  if (config.condition === 'email_equals') {
    return visitor.identityVerified && visitor.email?.toLowerCase() === config.value.toLowerCase()
  }
  const value = visitor.metadata[config.metadata_key]
  return typeof value === 'string' && value.toLowerCase().includes(config.value.toLowerCase())
}

interface AutomationCacheEntry { at: number, rules: AutomationRule[] }
const CACHE_TTL = 30_000
const globalCache = globalThis as unknown as { __perchAutomationRuleCache?: Map<string, AutomationCacheEntry> }
const cache = (globalCache.__perchAutomationRuleCache ??= new Map<string, AutomationCacheEntry>())

export async function getEnabledAutomationRules(workspaceId: string) {
  const hit = cache.get(workspaceId)
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.rules
  const rules = await useDb().query.automationRules.findMany({
    where: and(eq(automationRules.workspaceId, workspaceId), eq(automationRules.enabled, true)),
    orderBy: [asc(automationRules.sortOrder), asc(automationRules.createdAt), asc(automationRules.id)]
  })
  cache.set(workspaceId, { at: Date.now(), rules })
  return rules
}

export function invalidateAutomationRuleCache(workspaceId: string) {
  cache.delete(workspaceId)
}

export function serializeAutomationRule(rule: AutomationRule) {
  return {
    id: rule.id,
    name: rule.name,
    type: rule.type,
    config: rule.config,
    sort_order: rule.sortOrder,
    enabled: rule.enabled,
    created_at: rule.createdAt.toISOString(),
    updated_at: rule.updatedAt.toISOString()
  }
}
