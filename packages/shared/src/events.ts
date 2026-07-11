/**
 * The real-time event contract (PRD §6) — "the spine".
 *
 * Imported by the dashboard, the widget, and the Nitro WS server so that every
 * message crossing the socket is type-checked on both ends. Two channels exist
 * (§6.1); a visitor's connection may ONLY ever be subscribed to its own
 * `conversation:{id}` — never `workspace:*` or another conversation.
 */

import type { ConversationStatus, Presence, SettablePresence } from './enums'
import type { ConversationDTO, MessageDTO } from './models'

/* ── §6.1 Channels ──────────────────────────────────────────────── */

export const channels = {
  /** Inbox-level events for all online agents in a workspace. */
  workspace: (workspaceId: string) => `workspace:${workspaceId}` as const,
  /** Message stream + typing + read receipts for one conversation. */
  conversation: (conversationId: string) => `conversation:${conversationId}` as const
}

export type WorkspaceChannel = ReturnType<typeof channels.workspace>
export type ConversationChannel = ReturnType<typeof channels.conversation>
export type Channel = WorkspaceChannel | ConversationChannel

/* ── §6.2 Client → Server ───────────────────────────────────────── */

export interface VisitorHelloPayload {
  site_id: string
  visitor_id: string
  page_url: string
  ua: string
}

export interface MessageSendPayload {
  conversation_id: string
  content: string
  attachment_url?: string
  attachment_type?: string
  is_internal_note?: boolean
}

export interface ConversationRefPayload {
  conversation_id: string
}

export interface ConversationAssignPayload {
  conversation_id: string
  member_id: string
}

export interface PresenceUpdatePayload {
  presence: SettablePresence
}

/** Discriminated union of everything a client may send. */
export type ClientEvent = | { type: 'visitor.hello', payload: VisitorHelloPayload }
  | { type: 'message.send', payload: MessageSendPayload }
  | { type: 'typing.start', payload: ConversationRefPayload }
  | { type: 'typing.stop', payload: ConversationRefPayload }
  | { type: 'conversation.claim', payload: ConversationRefPayload }
  | { type: 'conversation.assign', payload: ConversationAssignPayload }
  | { type: 'conversation.resolve', payload: ConversationRefPayload }
  | { type: 'conversation.reopen', payload: ConversationRefPayload }
  | { type: 'conversation.read', payload: ConversationRefPayload }
  | { type: 'presence.update', payload: PresenceUpdatePayload }

export type ClientEventType = ClientEvent['type']

/* ── §6.3 Server → Client ───────────────────────────────────────── */

export interface ConversationUpdatedPayload {
  id: string
  status: ConversationStatus
  assigned_agent_id: string | null
  last_message_at: string
}

export interface ClaimOkPayload {
  conversation_id: string
}

export interface ClaimConflictPayload {
  conversation_id: string
  assigned_agent_id: string | null
}

export interface TypingPayload {
  conversation_id: string
  actor: 'visitor' | 'agent'
  is_typing: boolean
}

export interface PresencePayload {
  member_id: string
  presence: Presence
}

export interface BusinessPresencePayload {
  online: boolean
}

export interface ConversationReadReceiptPayload {
  conversation_id: string
  /** ISO timestamp of the agent's read — messages at or before this are "Seen". */
  last_read_at: string
}

/** Discriminated union of everything the server may broadcast. */
export type ServerEvent = | { type: 'message.new', payload: MessageDTO }
  | { type: 'conversation.new', payload: ConversationDTO }
  | { type: 'conversation.updated', payload: ConversationUpdatedPayload }
  | { type: 'conversation.claim.ok', payload: ClaimOkPayload }
  | { type: 'conversation.claim.conflict', payload: ClaimConflictPayload }
  | { type: 'typing', payload: TypingPayload }
  | { type: 'presence', payload: PresencePayload }
  | { type: 'business.presence', payload: BusinessPresencePayload }
  | { type: 'conversation.read', payload: ConversationReadReceiptPayload }

export type ServerEventType = ServerEvent['type']

/**
 * The signature the `publish()` abstraction (§5.4) fans out. Swapping the
 * in-process bus for Redis pub/sub must not change this type.
 */
export type WsEvent = ServerEvent

/* ── Narrowing helpers ──────────────────────────────────────────── */

/** Type guard so `if (isClientEvent(msg, 'message.send'))` narrows `payload`. */
export function isClientEvent<T extends ClientEventType>(
  event: ClientEvent,
  type: T
): event is Extract<ClientEvent, { type: T }> {
  return event.type === type
}
