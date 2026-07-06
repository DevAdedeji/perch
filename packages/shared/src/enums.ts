/**
 * Shared enums — the single source of truth for the string unions that appear
 * in both the database (§4) and the real-time contract (§6). The DB package
 * mirrors these as pgEnums; keep the two in sync.
 */

/** A member's role within a workspace. `admin` is a superset of `agent`. */
export const ROLES = ['admin', 'agent'] as const
export type Role = (typeof ROLES)[number]

/** Live presence, tracked over the socket (§6.5). */
export const PRESENCES = ['online', 'offline', 'away'] as const
export type Presence = (typeof PRESENCES)[number]

/** Presence a client is allowed to set for itself (never `offline` — that's connection-driven). */
export const SETTABLE_PRESENCES = ['online', 'away'] as const
export type SettablePresence = (typeof SETTABLE_PRESENCES)[number]

/** Lifecycle of a conversation. New conversations start `unassigned`. */
export const CONVERSATION_STATUSES = ['unassigned', 'open', 'resolved'] as const
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number]

/** Who authored a message. */
export const SENDER_TYPES = ['visitor', 'agent', 'system'] as const
export type SenderType = (typeof SENDER_TYPES)[number]

/** Invite lifecycle. */
export const INVITE_STATUSES = ['pending', 'accepted', 'revoked'] as const
export type InviteStatus = (typeof INVITE_STATUSES)[number]
