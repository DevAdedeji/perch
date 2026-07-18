/**
 * Wire DTOs — the serialized shapes that travel over the WebSocket and REST
 * boundary (§4 entities as JSON). Field names use the PRD's snake_case so the
 * contract reads 1:1 against the doc; timestamps are ISO-8601 strings (UTC).
 *
 * The server maps Drizzle rows (camelCase) → these DTOs at the boundary, and
 * filters anything the recipient must not see (e.g. internal notes for visitors).
 */

import type {
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
  status: ConversationStatus
  last_message_at: string
  created_at: string
  updated_at: string
  resolved_at: string | null
}

export interface MessageDTO {
  id: string
  conversation_id: string
  sender_type: SenderType
  sender_id: string | null
  content: string
  attachment_url: string | null
  attachment_type: string | null
  is_internal_note: boolean
  created_at: string
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
