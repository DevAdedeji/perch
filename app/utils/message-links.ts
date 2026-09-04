export interface MessageTextSegment {
  text: string
  href?: string
}

const HTTP_URL = /https?:\/\/[^\s<]+/gi
const TRAILING_PUNCTUATION = /[,.!?;:]+$/

function splitTrailingPunctuation(candidate: string): { text: string, trailing: string } {
  let end = candidate.length
  const punctuation = candidate.match(TRAILING_PUNCTUATION)?.[0] ?? ''
  end -= punctuation.length

  while (candidate[end - 1] === ')') {
    const value = candidate.slice(0, end)
    const openCount = (value.match(/\(/g) ?? []).length
    const closeCount = (value.match(/\)/g) ?? []).length
    if (closeCount <= openCount) break
    end--
  }

  return { text: candidate.slice(0, end), trailing: candidate.slice(end) }
}

export function messageTextSegments(content: string): MessageTextSegment[] {
  const segments: MessageTextSegment[] = []
  let cursor = 0

  for (const match of content.matchAll(HTTP_URL)) {
    const start = match.index
    const candidate = match[0]
    const { text, trailing } = splitTrailingPunctuation(candidate)

    if (start > cursor) segments.push({ text: content.slice(cursor, start) })

    try {
      const url = new URL(text)
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) {
        segments.push({ text, href: url.toString() })
      } else {
        segments.push({ text })
      }
    } catch {
      segments.push({ text })
    }

    if (trailing) segments.push({ text: trailing })
    cursor = start + candidate.length
  }

  if (cursor < content.length) segments.push({ text: content.slice(cursor) })
  return segments.length ? segments : [{ text: content }]
}
