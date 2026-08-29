<script setup lang="ts">
import type { CannedResponse, TeamMember } from '~/composables/useControlRoom'

const props = defineProps<{
  members: TeamMember[]
  cannedResponses: CannedResponse[]
  sendReply: (
    content: string,
    isInternalNote?: boolean,
    attachment?: { url: string, type: string },
    mentionedMemberIds?: string[]
  ) => Promise<void>
  sendAttachment: (
    file: File,
    upload: () => Promise<{ url: string, type: string }>,
    isInternalNote?: boolean
  ) => Promise<void>
}>()

const toast = useToast()
const reply = ref('')
const internalNote = ref(false)
const composerElement = ref<{ textareaRef?: HTMLTextAreaElement } | null>(null)

const mentionIndex = ref(0)
const pickedMentions = new Map<string, string>()
const mentionQuery = computed<string | null>(() => {
  if (!internalNote.value) return null
  const match = reply.value.match(/@([\w-]*)$/)
  return match ? match[1]!.toLowerCase() : null
})
const mentionMatches = computed(() =>
  mentionQuery.value === null
    ? []
    : props.members.filter(member => member.name.toLowerCase().includes(mentionQuery.value!)).slice(0, 6)
)
const mentionOpen = computed(() => mentionMatches.value.length > 0)

watch(mentionQuery, () => {
  mentionIndex.value = 0
})

function focusComposer() {
  nextTick(() => composerElement.value?.textareaRef?.focus())
}

function applyMention(member: Pick<TeamMember, 'id' | 'name'>) {
  const token = `@${member.name.split(' ')[0]}`
  reply.value = reply.value.replace(/@[\w-]*$/, `${token} `)
  pickedMentions.set(token, member.id)
  focusComposer()
}

const cannedDismissed = ref(false)
const cannedIndex = ref(0)
const cannedQuery = computed<string | null>(() => {
  const match = reply.value.match(/^\/([a-z0-9-]*)$/i)
  return match ? match[1]!.toLowerCase() : null
})
const cannedMatches = computed<CannedResponse[]>(() =>
  cannedQuery.value === null
    ? []
    : props.cannedResponses.filter(response => response.shortcut.startsWith(cannedQuery.value!)).slice(0, 6)
)
const cannedOpen = computed(() => cannedMatches.value.length > 0 && !cannedDismissed.value && !internalNote.value)

watch(cannedQuery, () => {
  cannedIndex.value = 0
  cannedDismissed.value = false
})

function applyCanned(response: CannedResponse) {
  reply.value = response.content
  focusComposer()
}

function onComposerKeydown(event: KeyboardEvent) {
  if (mentionOpen.value) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      mentionIndex.value = (mentionIndex.value + 1) % mentionMatches.value.length
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      mentionIndex.value = (mentionIndex.value - 1 + mentionMatches.value.length) % mentionMatches.value.length
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      applyMention(mentionMatches.value[mentionIndex.value]!)
      return
    }
  }

  if (cannedOpen.value) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      cannedIndex.value = (cannedIndex.value + 1) % cannedMatches.value.length
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      cannedIndex.value = (cannedIndex.value - 1 + cannedMatches.value.length) % cannedMatches.value.length
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      applyCanned(cannedMatches.value[cannedIndex.value]!)
      return
    }
    if (event.key === 'Escape') {
      cannedDismissed.value = true
      return
    }
  }

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    send()
  }
}

async function send() {
  const text = reply.value.trim()
  if (!text) return
  const note = internalNote.value
  const mentionIds = note
    ? [...new Set([...pickedMentions.entries()]
        .filter(([token]) => text.includes(token))
        .map(([, id]) => id))]
    : []

  pickedMentions.clear()
  reply.value = ''
  internalNote.value = false
  await props.sendReply(text, note, undefined, mentionIds)
}

const { uploading, uploadImage } = useImageUpload()
const attachmentElement = ref<HTMLInputElement | null>(null)

async function onAttachmentPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    toast.add({ title: 'Only images can be attached', color: 'error' })
    return
  }
  if (file.size > 1024 * 1024) {
    toast.add({ title: 'Images must be smaller than 1 MB', color: 'error' })
    return
  }
  await props.sendAttachment(file, () => uploadImage(file), internalNote.value)
}

function presenceDot(status: TeamMember['presence']) {
  return status === 'online' ? 'bg-green-500' : status === 'away' ? 'bg-amber-400' : 'bg-zinc-500'
}
</script>

<template>
  <div class="shrink-0 border-t border-default bg-default p-3">
    <div class="relative">
      <div
        v-if="mentionOpen"
        class="absolute bottom-full left-0 right-0 mb-2 rounded-xl bg-default ring-1 ring-default shadow-xl shadow-black/10 overflow-hidden z-10"
      >
        <p class="px-3 pt-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-dimmed">
          Mention a teammate
        </p>
        <ul class="max-h-56 overflow-y-auto pb-1">
          <li
            v-for="(member, index) in mentionMatches"
            :key="member.id"
          >
            <button
              class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors"
              :class="index === mentionIndex ? 'bg-amber-500/10 text-highlighted' : 'text-muted hover:bg-elevated'"
              @click="applyMention(member)"
            >
              <span
                class="size-1.5 rounded-full"
                :class="presenceDot(member.presence)"
              />
              {{ member.name }}
            </button>
          </li>
        </ul>
      </div>

      <div
        v-else-if="cannedOpen"
        class="absolute bottom-full left-0 right-0 mb-2 rounded-xl bg-default ring-1 ring-default shadow-xl shadow-black/10 overflow-hidden z-10"
      >
        <p class="px-3 pt-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-dimmed">
          Canned replies
        </p>
        <ul class="max-h-56 overflow-y-auto pb-1">
          <li
            v-for="(response, index) in cannedMatches"
            :key="response.id"
          >
            <button
              class="w-full flex items-baseline gap-2.5 px-3 py-2 text-left transition-colors"
              :class="index === cannedIndex ? 'bg-amber-500/10' : 'hover:bg-elevated/60'"
              @mouseenter="cannedIndex = index"
              @click="applyCanned(response)"
            >
              <span class="shrink-0 font-mono text-xs font-semibold text-amber-700 dark:text-amber-400">/{{ response.shortcut }}</span>
              <span class="truncate text-xs text-muted">{{ response.content }}</span>
            </button>
          </li>
        </ul>
      </div>

      <div
        class="rounded-xl ring-1 transition-colors focus-within:ring-2"
        :class="internalNote
          ? 'ring-amber-500/40 bg-amber-500/5 focus-within:ring-amber-500/60'
          : 'ring-default bg-elevated/40 focus-within:ring-amber-500/60'"
      >
        <UTextarea
          ref="composerElement"
          v-model="reply"
          :rows="2"
          autoresize
          variant="none"
          :placeholder="internalNote ? 'Write an internal note (agents only)…' : 'Reply to the visitor…'"
          class="w-full"
          @keydown="onComposerKeydown"
        />
        <div class="flex items-center gap-2 px-2.5 pb-2">
          <input
            ref="attachmentElement"
            type="file"
            accept="image/*"
            class="hidden"
            @change="onAttachmentPicked"
          >
          <UButton
            size="sm"
            color="neutral"
            variant="ghost"
            square
            icon="i-lucide-image-plus"
            :loading="uploading"
            aria-label="Attach an image (max 1 MB)"
            @click="attachmentElement?.click()"
          />
          <USwitch
            v-model="internalNote"
            size="sm"
          />
          <span
            class="text-xs"
            :class="internalNote ? 'text-amber-700 dark:text-amber-400 font-medium' : 'text-muted'"
          >Internal note</span>
          <span class="hidden sm:block ml-3 text-[11px] text-dimmed">
            <span class="font-mono">↵</span> send · <span class="font-mono">⇧↵</span> newline · <span class="font-mono">/</span> canned reply
          </span>
          <UButton
            class="ml-auto"
            size="sm"
            color="primary"
            icon="i-lucide-send-horizontal"
            square
            :aria-label="internalNote ? 'Add note' : 'Send'"
            :disabled="!reply.trim()"
            @click="send"
          />
        </div>
      </div>
    </div>
  </div>
</template>
