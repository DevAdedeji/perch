<script setup lang="ts">
import type { MessageDTO } from '@perch/shared'
import { mentionSegments } from '~/utils/mentions'

type ThreadMessage = MessageDTO & { pending?: boolean, failed?: boolean }
interface MessageRow { kind: 'message', message: ThreadMessage, first: boolean, last: boolean }
interface NoteRow { kind: 'note', message: ThreadMessage }
interface SystemRow { kind: 'system', message: ThreadMessage }
interface DayRow { kind: 'day', id: string, label: string }

const props = defineProps<{
  messages: ThreadMessage[]
  loading: boolean
  hasMore: boolean
  loadingOlder: boolean
  visitorTyping: boolean
  visitorDraft: string
  memberName: (id: string | null) => string | null
  loadOlderMessages: () => Promise<void>
  retrySend: (messageId: string) => Promise<void>
}>()

function initials(name: string | null, fallback = 'A') {
  return (name ?? fallback).trim().split(/\s+/).map(word => word[0]).slice(0, 2).join('').toUpperCase() || fallback
}

function dayLabel(iso: string) {
  const date = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function noteSegments(message: ThreadMessage) {
  return mentionSegments(message.content, message.mentioned_member_ids, id => props.memberName(id))
}

function isBubble(message: ThreadMessage) {
  return message.sender_type !== 'system' && !message.is_internal_note
}

function sameGroup(first: ThreadMessage, second: ThreadMessage) {
  return isBubble(first) && isBubble(second)
    && first.sender_type === second.sender_type
    && first.sender_id === second.sender_id
    && Math.abs(+new Date(second.created_at) - +new Date(first.created_at)) < 5 * 60_000
}

const rows = computed<(MessageRow | NoteRow | SystemRow | DayRow)[]>(() => {
  const result: (MessageRow | NoteRow | SystemRow | DayRow)[] = []
  for (let index = 0; index < props.messages.length; index++) {
    const message = props.messages[index]!
    const previous = props.messages[index - 1]
    const next = props.messages[index + 1]
    const day = dayLabel(message.created_at)
    const newDay = !previous || dayLabel(previous.created_at) !== day

    if (newDay) result.push({ kind: 'day', id: `day-${message.id}`, label: day })
    if (message.sender_type === 'system') {
      result.push({ kind: 'system', message })
    } else if (message.is_internal_note) {
      result.push({ kind: 'note', message })
    } else {
      result.push({
        kind: 'message',
        message,
        first: newDay || !previous || !sameGroup(previous, message),
        last: !next || !sameGroup(message, next) || dayLabel(next.created_at) !== day
      })
    }
  }
  return result
})

function bubbleShape(row: MessageRow) {
  return row.message.sender_type === 'agent'
    ? ['rounded-2xl rounded-br-md', !row.first && 'rounded-tr-md']
    : ['rounded-2xl rounded-bl-md', !row.first && 'rounded-tl-md']
}

const threadElement = ref<HTMLElement | null>(null)
let lastMessageId: string | null = null

watch(() => props.messages[props.messages.length - 1]?.id ?? null, (id) => {
  if (id && id !== lastMessageId) {
    nextTick(() => {
      threadElement.value?.scrollTo({ top: threadElement.value.scrollHeight, behavior: 'smooth' })
    })
  }
  lastMessageId = id
})

watch(() => props.visitorDraft, () => {
  const element = threadElement.value
  if (!element) return
  const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 160
  if (nearBottom) nextTick(() => element.scrollTo({ top: element.scrollHeight }))
})

watch(() => props.loading, (loading) => {
  if (!loading) {
    nextTick(() => {
      threadElement.value?.scrollTo({ top: threadElement.value.scrollHeight })
    })
  }
})

async function loadOlder() {
  const element = threadElement.value
  const previousHeight = element?.scrollHeight ?? 0
  await props.loadOlderMessages()
  await nextTick()
  if (element) element.scrollTop += element.scrollHeight - previousHeight
}
</script>

<template>
  <div
    v-if="loading"
    class="flex-1 px-5 py-5 space-y-3 bg-grid"
  >
    <USkeleton class="h-9 w-44 rounded-2xl rounded-bl-md" />
    <USkeleton class="h-9 w-56 rounded-2xl rounded-br-md ml-auto" />
    <USkeleton class="h-9 w-40 rounded-2xl rounded-bl-md" />
    <USkeleton class="h-16 w-52 rounded-2xl rounded-br-md ml-auto" />
  </div>

  <div
    v-else
    ref="threadElement"
    class="flex-1 overflow-y-auto px-5 py-5 bg-grid"
  >
    <div
      v-if="hasMore"
      class="flex justify-center pb-3"
    >
      <UButton
        size="xs"
        color="neutral"
        variant="subtle"
        icon="i-lucide-history"
        :loading="loadingOlder"
        @click="loadOlder"
      >
        Load earlier messages
      </UButton>
    </div>

    <template
      v-for="row in rows"
      :key="row.kind === 'day' ? row.id : row.message.id"
    >
      <p
        v-if="row.kind === 'day'"
        class="text-center text-[10px] font-semibold uppercase tracking-wider text-dimmed mt-5 mb-3 first:mt-0"
      >
        {{ row.label }}
      </p>

      <div
        v-else-if="row.kind === 'system'"
        class="flex justify-center my-2"
      >
        <span class="rounded-full bg-elevated ring-1 ring-default px-3 py-1 text-[11px] text-muted">{{ row.message.content }}</span>
      </div>

      <div
        v-else-if="row.kind === 'note'"
        class="flex justify-end my-2"
      >
        <div class="max-w-[72%] rounded-xl rounded-br-md bg-primary-500/10 ring-1 ring-primary-500/30 px-3.5 py-2 text-sm text-highlighted whitespace-pre-wrap wrap-break-word">
          <p class="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-primary-700 dark:text-primary-400 mb-1">
            <UIcon
              name="i-lucide-lock"
              class="size-3"
            />
            Internal note · {{ memberName(row.message.sender_id) }} · {{ formatTime(row.message.created_at) }}
          </p>
          <a
            v-if="row.message.attachment_url"
            :href="row.message.attachment_url"
            target="_blank"
            rel="noopener"
            class="block my-1"
          >
            <img
              :src="cldThumb(row.message.attachment_url)"
              class="rounded-lg max-h-56 w-auto"
              loading="lazy"
              alt="Image attachment"
            >
          </a>
          <template
            v-for="(segment, index) in noteSegments(row.message)"
            :key="index"
          >
            <span :class="segment.mention ? 'rounded bg-primary-500/20 px-0.5 font-semibold text-primary-800 dark:text-primary-300' : ''">{{ segment.text }}</span>
          </template>
        </div>
      </div>

      <div
        v-else
        :class="row.first ? 'mt-2.5' : 'mt-0.5'"
      >
        <div
          class="flex items-end gap-2"
          :class="row.message.sender_type === 'agent' ? 'flex-row-reverse' : ''"
        >
          <template v-if="row.message.sender_type === 'agent'">
            <span
              v-if="row.last"
              class="grid place-items-center size-6 shrink-0 rounded-lg avatar-primary text-[10px] font-semibold"
            >{{ initials(memberName(row.message.sender_id)) }}</span>
            <span
              v-else
              class="w-6 shrink-0"
            />
          </template>
          <div
            class="max-w-[72%] px-3.5 py-2 text-sm leading-snug whitespace-pre-wrap wrap-break-word transition-opacity"
            :class="[
              ...bubbleShape(row),
              row.message.sender_type === 'agent'
                ? 'bg-primary-500 text-slate-950 shadow-sm'
                : 'bg-default ring-1 ring-default text-highlighted',
              { 'opacity-60': row.message.pending, 'ring-2 ring-red-500/60': row.message.failed }
            ]"
          >
            <a
              v-if="row.message.attachment_url"
              :href="row.message.attachment_url"
              target="_blank"
              rel="noopener"
              class="block -mx-2 my-0.5 first:mt-0"
            >
              <img
                :src="cldThumb(row.message.attachment_url)"
                class="rounded-lg max-h-56 w-auto"
                loading="lazy"
                alt="Image attachment"
              >
            </a>
            <MessageContent
              v-if="row.message.content"
              :content="row.message.content"
            />
          </div>
        </div>
        <p
          v-if="row.last || row.message.failed"
          class="mt-1 text-[10px]"
          :class="row.message.sender_type === 'agent' ? 'text-right pr-9' : 'pl-1'"
        >
          <button
            v-if="row.message.failed"
            class="font-medium text-red-500 hover:underline"
            @click="retrySend(row.message.id)"
          >
            Not sent — retry
          </button>
          <span
            v-else
            class="text-dimmed"
          >{{ row.message.pending ? 'Sending…' : formatTime(row.message.created_at) }}</span>
        </p>
      </div>
    </template>

    <div
      v-if="visitorTyping"
      class="flex items-end gap-2 mt-2.5"
    >
      <div
        v-if="visitorDraft"
        class="max-w-[70%] rounded-2xl rounded-bl-md bg-default ring-1 ring-dashed ring-accented px-3.5 py-2"
      >
        <p class="text-sm leading-snug text-muted italic whitespace-pre-wrap wrap-break-word">
          {{ visitorDraft }}<span class="sneak-caret" />
        </p>
        <p class="mt-0.5 text-[10px] text-dimmed">
          typing…
        </p>
      </div>
      <div
        v-else
        class="flex items-center gap-1 rounded-2xl rounded-bl-md bg-default ring-1 ring-default px-3.5 py-3"
      >
        <span class="size-1.5 rounded-full bg-dimmed animate-bounce [animation-delay:-0.3s]" />
        <span class="size-1.5 rounded-full bg-dimmed animate-bounce [animation-delay:-0.15s]" />
        <span class="size-1.5 rounded-full bg-dimmed animate-bounce" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.sneak-caret {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 1px;
  vertical-align: text-bottom;
  background: currentcolor;
  animation: sneak-blink 1s step-end infinite;
}

@keyframes sneak-blink {
  50% {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sneak-caret {
    animation: none;
  }
}
</style>
