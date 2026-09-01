<script setup lang="ts">
import { validateImageAttachment } from '@perch/shared'
import type { CannedResponse, TeamMember } from '~/composables/useControlRoom'
import { activeMention, insertMention, selectedMentionIds } from '~/utils/mentions'

const props = defineProps<{
  workspaceId: string | null
  members: TeamMember[]
  currentMemberId: string | null
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

interface HelpSuggestion {
  id: string
  title: string
  excerpt: string
  group: string
  url: string
  external: boolean
}

const articlePickerOpen = ref(false)
const articleSearch = ref('')
const articleSuggestions = ref<HelpSuggestion[]>([])
const articleSearchStatus = ref<'idle' | 'loading' | 'error'>('idle')
const articleSearchElement = ref<{ inputRef?: HTMLInputElement } | null>(null)
let articleSearchTimer: ReturnType<typeof setTimeout> | undefined
let articleSearchController: AbortController | undefined

async function searchArticles() {
  clearTimeout(articleSearchTimer)
  articleSearchController?.abort()
  if (!articlePickerOpen.value || !props.workspaceId) return

  const controller = new AbortController()
  articleSearchController = controller
  articleSearchStatus.value = 'loading'
  try {
    const query = articleSearch.value.trim().slice(0, 80)
    const suggestions = await $fetch<HelpSuggestion[]>(`/api/workspaces/${props.workspaceId}/articles/search`, {
      query: query ? { q: query } : undefined,
      signal: controller.signal
    })
    if (controller !== articleSearchController) return
    articleSuggestions.value = suggestions
    articleSearchStatus.value = 'idle'
  } catch {
    if (controller.signal.aborted) return
    articleSearchStatus.value = 'error'
  }
}

function scheduleArticleSearch() {
  clearTimeout(articleSearchTimer)
  articleSearchTimer = setTimeout(searchArticles, 250)
}

function toggleArticlePicker() {
  articlePickerOpen.value = !articlePickerOpen.value
  if (!articlePickerOpen.value) {
    articleSearchController?.abort()
    return
  }
  void searchArticles()
  nextTick(() => articleSearchElement.value?.inputRef?.focus())
}

function suggestArticle(article: HelpSuggestion) {
  const suggestion = `${article.title}\n${article.url}`
  reply.value = reply.value.trim() ? `${reply.value.trimEnd()}\n\n${suggestion}` : suggestion
  articlePickerOpen.value = false
  focusComposer()
}

watch(internalNote, (enabled) => {
  if (enabled) articlePickerOpen.value = false
})

const mentionIndex = ref(0)
const pickedMentions = new Map<string, string>()
const currentMention = computed(() => internalNote.value ? activeMention(reply.value) : null)
const mentionMatches = computed(() =>
  currentMention.value === null
    ? []
    : props.members
        .filter(member => member.id !== props.currentMemberId && member.name.toLowerCase().includes(currentMention.value!.query))
        .slice(0, 6)
)
const mentionOpen = computed(() => mentionMatches.value.length > 0)

watch(currentMention, () => {
  mentionIndex.value = 0
})

function focusComposer() {
  nextTick(() => composerElement.value?.textareaRef?.focus())
}

function applyMention(member: Pick<TeamMember, 'id' | 'name'>) {
  if (!currentMention.value) return
  const token = `@${member.name}`
  reply.value = insertMention(reply.value, currentMention.value, member.name)
  pickedMentions.set(member.id, token)
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
  if (articlePickerOpen.value && event.key === 'Escape') {
    articlePickerOpen.value = false
    return
  }
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
  const mentionIds = note ? selectedMentionIds(text, pickedMentions) : []

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
  const validationError = validateImageAttachment(file)
  if (validationError) {
    toast.add({ title: validationError, color: 'error' })
    return
  }
  await props.sendAttachment(file, () => uploadImage(file), internalNote.value)
}

function presenceDot(status: TeamMember['presence']) {
  return status === 'online' ? 'bg-green-500' : status === 'away' ? 'bg-amber-400' : 'bg-zinc-500'
}

onBeforeUnmount(() => {
  clearTimeout(articleSearchTimer)
  articleSearchController?.abort()
})
</script>

<template>
  <div class="shrink-0 border-t border-default bg-default p-3">
    <div class="relative">
      <div
        v-if="articlePickerOpen"
        class="absolute bottom-full left-0 right-0 mb-2 rounded-xl bg-default ring-1 ring-default shadow-xl shadow-black/10 overflow-hidden z-10"
      >
        <div class="flex items-center justify-between gap-3 px-3 pt-3">
          <div class="min-w-0">
            <p class="text-xs font-semibold text-highlighted">
              Suggest a help article
            </p>
            <p class="text-[11px] text-dimmed">
              The link is added to your reply for review.
            </p>
          </div>
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            square
            icon="i-lucide-x"
            aria-label="Close article suggestions"
            @click="articlePickerOpen = false"
          />
        </div>
        <div class="p-3 pb-2">
          <UInput
            ref="articleSearchElement"
            v-model="articleSearch"
            type="search"
            size="sm"
            icon="i-lucide-search"
            placeholder="Search published articles…"
            aria-label="Search published help articles"
            autocomplete="off"
            class="w-full"
            @input="scheduleArticleSearch"
            @keydown.esc="articlePickerOpen = false"
          />
        </div>
        <div
          v-if="articleSearchStatus === 'loading' && !articleSuggestions.length"
          class="space-y-2 px-3 pb-3"
          aria-label="Searching published articles"
        >
          <USkeleton class="h-12 w-full rounded-lg" />
          <USkeleton class="h-12 w-full rounded-lg" />
        </div>
        <div
          v-else-if="articleSearchStatus === 'error'"
          class="px-3 pb-4 text-center"
        >
          <p class="text-xs text-muted">
            Couldn’t load articles.
          </p>
          <UButton
            class="mt-2"
            size="xs"
            color="neutral"
            variant="soft"
            icon="i-lucide-refresh-cw"
            @click="searchArticles"
          >
            Try again
          </UButton>
        </div>
        <p
          v-else-if="!articleSuggestions.length"
          class="px-3 pb-4 text-center text-xs text-dimmed"
          role="status"
        >
          {{ articleSearch.trim() ? 'No published articles match your search.' : 'Publish an article to suggest it here.' }}
        </p>
        <ul
          v-else
          class="max-h-64 overflow-y-auto px-1 pb-1"
          :aria-busy="articleSearchStatus === 'loading'"
        >
          <li
            v-for="article in articleSuggestions"
            :key="article.id"
          >
            <button
              class="w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-none"
              @click="suggestArticle(article)"
            >
              <span class="flex items-center gap-2">
                <span class="min-w-0 flex-1 truncate text-sm font-medium text-highlighted">{{ article.title }}</span>
                <UIcon
                  :name="article.external ? 'i-lucide-external-link' : 'i-lucide-book-open'"
                  class="size-3.5 shrink-0 text-dimmed"
                />
              </span>
              <span class="mt-0.5 block truncate text-[11px] text-dimmed">{{ article.group }}<template v-if="article.excerpt"> · {{ article.excerpt }}</template></span>
            </button>
          </li>
        </ul>
      </div>

      <div
        v-else-if="mentionOpen"
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
              :class="index === mentionIndex ? 'bg-primary-500/10 text-highlighted' : 'text-muted hover:bg-elevated'"
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
              :class="index === cannedIndex ? 'bg-primary-500/10' : 'hover:bg-elevated/60'"
              @mouseenter="cannedIndex = index"
              @click="applyCanned(response)"
            >
              <span class="shrink-0 font-mono text-xs font-semibold text-primary-700 dark:text-primary-400">/{{ response.shortcut }}</span>
              <span class="truncate text-xs text-muted">{{ response.content }}</span>
            </button>
          </li>
        </ul>
      </div>

      <div
        class="rounded-xl ring-1 transition-colors focus-within:ring-2"
        :class="internalNote
          ? 'ring-primary-500/40 bg-primary-500/5 focus-within:ring-primary-500/60'
          : 'ring-default bg-elevated/40 focus-within:ring-primary-500/60'"
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
            v-if="!internalNote"
            size="sm"
            color="neutral"
            variant="ghost"
            square
            icon="i-lucide-image-plus"
            :loading="uploading"
            aria-label="Attach an image (max 1 MB)"
            @click="attachmentElement?.click()"
          />
          <UButton
            size="sm"
            color="neutral"
            :variant="articlePickerOpen ? 'soft' : 'ghost'"
            square
            icon="i-lucide-book-open"
            :disabled="!workspaceId"
            :aria-expanded="articlePickerOpen"
            aria-label="Suggest a help article"
            @click="toggleArticlePicker"
          />
          <USwitch
            v-model="internalNote"
            size="sm"
          />
          <span
            class="text-xs"
            :class="internalNote ? 'text-primary-700 dark:text-primary-400 font-medium' : 'text-muted'"
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
