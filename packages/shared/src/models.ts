/**
 * Wire DTOs — the serialized shapes that travel over the WebSocket and REST
 * boundary (§4 entities as JSON). Field names use the PRD's snake_case so the
 * contract reads 1:1 against the doc; timestamps are ISO-8601 strings (UTC).
 *
 * The server maps Drizzle rows (camelCase) → these DTOs at the boundary, and
 * filters anything the recipient must not see (e.g. internal notes for visitors).
 */

import type {
  ConversationPriority,
  ConversationStatus,
  Presence,
  Role,
  SenderType
} from './enums'

export interface WorkspaceDTO {
  id: string
  name: string
  site_id: string
  auto_assign_enabled: boolean
  prechat_form_enabled: boolean
  created_at: string
}

export interface MemberDTO {
  id: string
  workspace_id: string
  user_id: string
  name: string
  role: Role
  presence: Presence
  last_seen_at: string | null
}

export interface VisitorDTO {
  id: string
  workspace_id: string
  visitor_id: string
  name: string | null
  email: string | null
  first_seen_at: string
  last_seen_at: string
  metadata: VisitorMetadata
}

export interface VisitorMetadata {
  page_url?: string
  installation_preview?: boolean
  ua?: string
  browser?: string
  device?: string
  referrer?: string
}

export interface ConversationDTO {
  id: string
  workspace_id: string
  visitor_ref: string
  assigned_agent_id: string | null
  collaborator_member_ids: string[]
  status: ConversationStatus
  priority: ConversationPriority
  snoozed_until: string | null
  last_message_at: string
  created_at: string
  updated_at: string
  resolved_at: string | null
}

export type InboxSnoozedFilter = 'exclude' | 'include' | 'only'

export interface SavedInboxFilters {
  status: ConversationStatus | 'all'
  assignee: 'any' | 'me' | 'unassigned' | string
  priorities: ConversationPriority[]
  tag_ids: string[]
  snoozed: InboxSnoozedFilter
}

export type AutomationRuleConfig
  = { member_ids: string[] }
    | { url_contains: string, member_id: string }
    | { condition: 'email_domain', value: string, tag_id: string }
    | { condition: 'email_equals', value: string, tag_id: string }
    | { condition: 'metadata', metadata_key: 'page_url', value: string, tag_id: string }
    | { minutes: number }
    | { hours: number }

export interface MessageDTO {
  id: string
  conversation_id: string
  sender_type: SenderType
  sender_id: string | null
  content: string
  attachment_url: string | null
  attachment_type: string | null
  is_internal_note: boolean
  mentioned_member_ids: string[]
  created_at: string
}

export interface VisitorMessageDTO {
  id: string
  conversation_id: string
  sender_type: SenderType
  content: string
  attachment_url: string | null
  attachment_type: string | null
  created_at: string
}

export interface VisitorConversationDTO {
  id: string
  status: ConversationStatus
}

/**
 * A visitor currently connected via the widget — served from the in-memory
 * visitor-presence registry (never the DB), so timestamps are epoch millis.
 */
export interface LiveVisitorDTO {
  /** visitors.id (the DB row uuid — what conversations reference) */
  visitor_ref: string
  name: string | null
  email: string | null
  identity_verified: boolean
  /** the host page they're on right now; null until the first page report */
  page_url: string | null
  /** epoch ms they landed on the current page (dwell = now - page_since) */
  page_since: number
  /** epoch ms their first live socket connected */
  connected_at: number
}

/** "HH:MM" 24h strings; a day maps to one open range, or null when closed. */
export interface DayHours {
  open: string
  close: string
}

export type BusinessDay = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'

/**
 * Weekly business-hours schedule. `null`/absent workspace value = always
 * available (presence alone decides, today's behavior).
 */
export type BusinessHours = Partial<Record<BusinessDay, DayHours | null>>
