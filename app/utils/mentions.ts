export interface ActiveMention {
  start: number
  query: string
}

/** Find an unfinished @mention at the caret-at-end position. */
export function activeMention(value: string): ActiveMention | null {
  const at = value.lastIndexOf('@')
  if (at < 0 || (at > 0 && !/\s/.test(value[at - 1]!))) return null
  const query = value.slice(at + 1)
  if (query.includes('\n') || /[.,!?;:()[\]{}]/.test(query)) return null
  return { start: at, query: query.toLowerCase() }
}

export function insertMention(value: string, mention: ActiveMention, name: string): string {
  return `${value.slice(0, mention.start)}@${name} `
}

export function selectedMentionIds(content: string, picked: ReadonlyMap<string, string>): string[] {
  return [...new Set([...picked.entries()]
    .filter(([, token]) => content.includes(token))
    .map(([id]) => id))]
}

export interface MentionSegment {
  text: string
  mention: boolean
}

/** Split known, server-validated mention tokens for safe highlighted rendering. */
export function mentionSegments(
  content: string,
  mentionedMemberIds: readonly string[],
  memberName: (id: string) => string | null
): MentionSegment[] {
  const tokens = mentionedMemberIds
    .map(id => memberName(id))
    .filter((name): name is string => !!name)
    .map(name => `@${name}`)
    .sort((a, b) => b.length - a.length)
  if (!tokens.length) return [{ text: content, mention: false }]

  const escaped = tokens.map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`(${escaped.join('|')})`, 'g')
  return content.split(pattern).filter(Boolean).map(text => ({ text, mention: tokens.includes(text) }))
}
