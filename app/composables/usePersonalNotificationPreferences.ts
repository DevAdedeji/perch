import { defaultNotificationPreferences } from '@perch/shared'
import type { NotificationCategory, NotificationPreference } from '@perch/shared'

export type NotificationPreferenceChannel = Exclude<keyof NotificationPreference, 'category'>

export interface PersonalNotificationPreferenceEntry {
  preferences: NotificationPreference[]
  ready: boolean
  loading: boolean
  generation: number
}

const pendingPreferenceLoads = new Map<string, Promise<NotificationPreference[] | null>>()

export function notificationPreferenceScope(userId: string, workspaceId: string) {
  return `${userId}:${workspaceId}`
}

export function nextPreferenceGeneration(entry?: PersonalNotificationPreferenceEntry) {
  return (entry?.generation ?? 0) + 1
}

export function isCurrentPreferenceGeneration(entry: PersonalNotificationPreferenceEntry | undefined, generation: number) {
  return entry?.generation === generation
}

export function notificationAlertsReady(entry: PersonalNotificationPreferenceEntry | undefined) {
  return entry?.ready === true
}

export function queuePendingReminder(queue: Set<string>, conversationId: string) {
  queue.add(conversationId)
}

export function drainPendingReminders(queue: Set<string>) {
  const conversationIds = [...queue]
  queue.clear()
  return conversationIds
}

export function replacedPreferenceEntry(
  entry: PersonalNotificationPreferenceEntry | undefined,
  preferences: NotificationPreference[]
): PersonalNotificationPreferenceEntry {
  return {
    preferences,
    ready: true,
    loading: false,
    generation: nextPreferenceGeneration(entry)
  }
}

export function updatedNotificationPreferences(
  preferences: NotificationPreference[],
  category: NotificationCategory,
  channel: NotificationPreferenceChannel,
  enabled: boolean
): NotificationPreference[] {
  return preferences.map(preference => preference.category === category
    ? { ...preference, [channel]: enabled }
    : preference)
}

export function notificationPreferenceDraft(
  entry: PersonalNotificationPreferenceEntry | undefined,
  dirty: boolean
): NotificationPreference[] | null {
  if (!entry?.ready || dirty) return null
  return entry.preferences.map(preference => ({ ...preference }))
}

export function coalescedNotificationPreferenceLoad(
  scope: string,
  start: () => Promise<NotificationPreference[] | null>
) {
  const pending = pendingPreferenceLoads.get(scope)
  if (pending) return pending

  const request = start()
  pendingPreferenceLoads.set(scope, request)
  const clear = () => {
    if (pendingPreferenceLoads.get(scope) === request) pendingPreferenceLoads.delete(scope)
  }
  request.then(clear, clear)
  return request
}

export function usePersonalNotificationPreferences() {
  const entries = useState<Record<string, PersonalNotificationPreferenceEntry>>(
    'notifications:personal-preferences',
    () => ({})
  )

  function entry(scope: string | null) {
    return scope ? entries.value[scope] : undefined
  }

  async function load(scope: string, workspaceId: string) {
    const existing = entries.value[scope]
    if (existing?.ready) return existing.preferences

    return coalescedNotificationPreferenceLoad(scope, async () => {
      const current = entries.value[scope]
      if (current?.ready) return current.preferences
      const generation = nextPreferenceGeneration(current)
      entries.value[scope] = {
        preferences: current?.preferences ?? defaultNotificationPreferences(),
        ready: false,
        loading: true,
        generation
      }
      try {
        const result = await $fetch<{ preferences: NotificationPreference[] }>(
          `/api/workspaces/${workspaceId}/notification-preferences`
        )
        if (!isCurrentPreferenceGeneration(entries.value[scope], generation)) return null
        entries.value[scope] = {
          preferences: result.preferences,
          ready: true,
          loading: false,
          generation
        }
        return result.preferences
      } catch (error) {
        if (isCurrentPreferenceGeneration(entries.value[scope], generation)) {
          entries.value[scope] = {
            preferences: entries.value[scope]!.preferences,
            ready: false,
            loading: false,
            generation
          }
        }
        throw error
      }
    })
  }

  function replace(scope: string, preferences: NotificationPreference[]) {
    entries.value[scope] = replacedPreferenceEntry(entries.value[scope], preferences)
  }

  return { entries, entry, load, replace }
}
