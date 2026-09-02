<script setup lang="ts">
import type { CustomerProfileUpdate, VisitorContext, WorkspaceTag } from '~/composables/useControlRoom'

const props = defineProps<{
  context: VisitorContext | null
  fallbackName: string | null
  availableTags: WorkspaceTag[]
  saveProfile: (changes: CustomerProfileUpdate) => Promise<unknown>
}>()

const { copy } = useCopyToClipboard()
const toast = useToast()
const editing = ref(false)
const saving = ref(false)
const errorMessage = ref('')
const form = reactive({
  name: '',
  email: '',
  company: '',
  jobTitle: '',
  internalNote: '',
  tagIds: [] as string[]
})

const displayName = computed(() => props.context?.visitor.name ?? props.fallbackName ?? 'Visitor')
const hasProfileOverride = computed(() => Boolean(
  props.context?.visitor.profile_name || props.context?.visitor.profile_email
))
const reportedIdentity = computed(() => [
  props.context?.visitor.reported_name,
  props.context?.visitor.reported_email
].filter(Boolean).join(' · '))
const remainingNoteCharacters = computed(() => 2000 - form.internalNote.length)

watch(() => props.context?.visitor.profile_version, resetForm, { immediate: true })

function resetForm() {
  const visitor = props.context?.visitor
  form.name = visitor?.profile_name ?? ''
  form.email = visitor?.profile_email ?? ''
  form.company = visitor?.company ?? ''
  form.jobTitle = visitor?.job_title ?? ''
  form.internalNote = visitor?.internal_note ?? ''
  form.tagIds = visitor?.tags.map(tag => tag.id) ?? []
  errorMessage.value = ''
}

function initials(name: string) {
  return name.trim().split(/\s+/).map(word => word[0]).slice(0, 2).join('').toUpperCase() || 'V'
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function toggleTag(tagId: string) {
  if (form.tagIds.includes(tagId)) {
    form.tagIds = form.tagIds.filter(id => id !== tagId)
  } else if (form.tagIds.length < 20) {
    form.tagIds = [...form.tagIds, tagId]
  }
}

async function submit() {
  if (saving.value || !props.context) return
  saving.value = true
  errorMessage.value = ''
  try {
    await props.saveProfile({
      name: form.name,
      email: form.email,
      company: form.company,
      job_title: form.jobTitle,
      internal_note: form.internalNote,
      tag_ids: form.tagIds
    })
    editing.value = false
    toast.add({ title: 'Customer details saved', color: 'success', icon: 'i-lucide-check' })
  } catch (error) {
    resetForm()
    errorMessage.value = getErrorMessage(error, 'Could not save customer details')
  } finally {
    saving.value = false
  }
}

function cancelEdit() {
  resetForm()
  editing.value = false
}

const pageHost = computed(() => {
  const url = props.context?.visitor.page_url
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.host + (parsed.pathname === '/' ? '' : parsed.pathname)
  } catch {
    return url
  }
})
</script>

<template>
  <div class="flex h-full flex-col overflow-y-auto">
    <div class="border-b border-default p-4 text-center sm:p-5">
      <span class="mx-auto grid size-14 place-items-center rounded-2xl avatar-primary text-lg font-bold">
        {{ initials(displayName) }}
      </span>
      <p class="mt-3 truncate text-sm font-semibold text-highlighted">
        {{ displayName }}
      </p>
      <button
        v-if="context?.visitor.email"
        class="mt-0.5 max-w-full truncate text-xs text-muted transition-colors hover:text-highlighted"
        :title="`Copy ${context.visitor.email}`"
        @click="copy(context.visitor.email!)"
      >
        {{ context.visitor.email }}
      </button>
      <p
        v-else
        class="mt-0.5 text-xs text-dimmed"
      >
        No email shared
      </p>
      <div class="mt-2 flex flex-wrap items-center justify-center gap-1.5">
        <span
          v-if="hasProfileOverride"
          class="inline-flex items-center gap-1 rounded-full bg-primary-500/10 px-1.5 py-0.5 text-[10px] font-medium text-primary-700 ring-1 ring-primary-500/25 dark:text-primary-400"
          title="A teammate added a private display name or email."
        >
          <UIcon
            name="i-lucide-users"
            class="size-3"
          />
          Team profile
        </span>
        <span
          v-if="context?.visitor.identity_verified"
          class="inline-flex shrink-0 items-center gap-1 rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-700 ring-1 ring-green-500/25 dark:text-green-400"
          title="The original identity supplied by the website was signed. Team profile edits are not verified."
        >
          <UIcon
            name="i-lucide-badge-check"
            class="size-3"
          />
          Verified site identity
        </span>
        <span
          v-if="context?.visitor.messaging_blocked"
          class="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-700 ring-1 ring-red-500/25 dark:text-red-400"
          title="This visitor cannot send new messages to this workspace."
        >
          <UIcon
            name="i-lucide-shield-ban"
            class="size-3"
          />
          Messaging blocked
        </span>
        <span
          v-if="context?.visitor.reply_email.eligible"
          class="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 ring-1 ring-sky-500/25 dark:text-sky-400"
          :title="context.visitor.reply_email.status === 'sent' ? 'A private return link was sent for the latest visitor turn.' : 'Perch can email a private return link when this visitor leaves.'"
        >
          <UIcon
            name="i-lucide-mail-check"
            class="size-3"
          />
          {{ context.visitor.reply_email.status === 'sent' ? 'Reply email sent' : 'Offline email ready' }}
        </span>
      </div>
    </div>

    <div
      v-if="!context"
      class="space-y-3 p-5"
      aria-label="Loading customer details"
    >
      <USkeleton
        v-for="n in 5"
        :key="n"
        class="h-9 w-full"
      />
    </div>

    <template v-else>
      <section class="border-b border-default p-4 sm:p-5">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-[10px] font-semibold uppercase tracking-wider text-dimmed">
              Customer details
            </p>
            <p class="mt-0.5 text-[11px] text-muted">
              Private to your team
            </p>
          </div>
          <UButton
            v-if="!editing"
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-pencil"
            @click="editing = true"
          >
            Edit
          </UButton>
        </div>

        <form
          v-if="editing"
          class="mt-4 space-y-3"
          @submit.prevent="submit"
        >
          <UFormField
            label="Name"
            help="Leave blank to use the visitor-provided name."
          >
            <UInput
              v-model="form.name"
              :placeholder="context.visitor.reported_name ?? 'Add a name'"
              maxlength="100"
              autocomplete="off"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Email">
            <UInput
              v-model="form.email"
              :placeholder="context.visitor.reported_email ?? 'Add an email'"
              type="email"
              maxlength="200"
              autocomplete="off"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Company">
            <UInput
              v-model="form.company"
              maxlength="120"
              autocomplete="organization"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Job title">
            <UInput
              v-model="form.jobTitle"
              maxlength="120"
              autocomplete="organization-title"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Internal note"
            help="Never shown to the customer."
          >
            <UTextarea
              v-model="form.internalNote"
              :rows="3"
              :maxlength="2000"
              autoresize
              class="w-full"
            />
            <p class="mt-1 text-right text-[10px] text-dimmed">
              {{ remainingNoteCharacters }} left
            </p>
          </UFormField>

          <details
            v-if="availableTags.length"
            class="rounded-lg ring-1 ring-default"
          >
            <summary class="cursor-pointer list-none px-3 py-2 text-xs font-medium text-highlighted">
              Customer tags <span class="font-normal text-muted">({{ form.tagIds.length }} selected)</span>
            </summary>
            <div class="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto border-t border-default p-2.5">
              <button
                v-for="tag in availableTags"
                :key="tag.id"
                type="button"
                class="rounded-md px-2 py-1 font-mono text-[11px] ring-1 transition-colors"
                :class="form.tagIds.includes(tag.id)
                  ? 'bg-primary-500/10 text-primary-700 ring-primary-500/30 dark:text-primary-400'
                  : 'text-muted ring-default hover:bg-elevated hover:text-highlighted'"
                :aria-pressed="form.tagIds.includes(tag.id)"
                @click="toggleTag(tag.id)"
              >
                #{{ tag.name }}
              </button>
            </div>
          </details>

          <p
            v-if="errorMessage"
            role="alert"
            class="text-xs text-error"
          >
            {{ errorMessage }}
          </p>
          <div class="flex justify-end gap-2 pt-1">
            <UButton
              type="button"
              size="sm"
              color="neutral"
              variant="ghost"
              :disabled="saving"
              @click="cancelEdit"
            >
              Cancel
            </UButton>
            <UButton
              type="submit"
              size="sm"
              :loading="saving"
            >
              Save
            </UButton>
          </div>
        </form>

        <div
          v-else
          class="mt-3 space-y-3 text-xs"
        >
          <div
            v-if="hasProfileOverride && reportedIdentity"
            class="rounded-lg bg-elevated/60 p-2.5 ring-1 ring-default"
          >
            <p class="text-[10px] font-semibold uppercase tracking-wider text-dimmed">
              Visitor reported
            </p>
            <p class="mt-1 break-words text-muted">
              {{ reportedIdentity }}
            </p>
          </div>
          <dl
            v-if="context.visitor.company || context.visitor.job_title"
            class="space-y-2"
          >
            <div
              v-if="context.visitor.company"
              class="flex items-start justify-between gap-3"
            >
              <dt class="shrink-0 text-muted">
                Company
              </dt>
              <dd class="break-words text-right text-highlighted">
                {{ context.visitor.company }}
              </dd>
            </div>
            <div
              v-if="context.visitor.job_title"
              class="flex items-start justify-between gap-3"
            >
              <dt class="shrink-0 text-muted">
                Job title
              </dt>
              <dd class="break-words text-right text-highlighted">
                {{ context.visitor.job_title }}
              </dd>
            </div>
          </dl>
          <p
            v-if="context.visitor.internal_note"
            class="whitespace-pre-wrap break-words rounded-lg bg-elevated/60 p-2.5 text-muted ring-1 ring-default"
          >
            {{ context.visitor.internal_note }}
          </p>
          <div
            v-if="context.visitor.tags.length"
            class="flex flex-wrap gap-1.5"
          >
            <span
              v-for="tag in context.visitor.tags"
              :key="tag.id"
              class="rounded-md bg-primary-500/10 px-1.5 py-0.5 font-mono text-[11px] text-primary-700 ring-1 ring-primary-500/25 dark:text-primary-400"
            >
              #{{ tag.name }}
            </span>
          </div>
          <p
            v-if="!context.visitor.company && !context.visitor.job_title && !context.visitor.internal_note && !context.visitor.tags.length"
            class="text-muted"
          >
            Add company, role, notes, or tags so the next teammate has context.
          </p>
        </div>
      </section>

      <section class="border-b border-default p-4 sm:p-5">
        <p class="text-[10px] font-semibold uppercase tracking-wider text-dimmed">
          Activity
        </p>
        <dl class="mt-3 space-y-2.5 text-xs">
          <div class="flex items-center justify-between gap-3">
            <dt class="shrink-0 text-muted">
              First seen
            </dt>
            <dd class="text-right text-highlighted">
              {{ shortDate(context.visitor.first_seen_at) }}
            </dd>
          </div>
          <div class="flex items-center justify-between gap-3">
            <dt class="shrink-0 text-muted">
              Last seen
            </dt>
            <dd class="text-right text-highlighted">
              {{ timeAgo(context.visitor.last_seen_at) }}
            </dd>
          </div>
          <div
            v-if="context.visitor.browser || context.visitor.os"
            class="flex items-center justify-between gap-3"
          >
            <dt class="shrink-0 text-muted">
              Device
            </dt>
            <dd class="text-right text-highlighted">
              {{ [context.visitor.browser, context.visitor.os].filter(Boolean).join(' · ') }}
            </dd>
          </div>
          <div
            v-if="pageHost"
            class="flex items-start justify-between gap-3"
          >
            <dt class="shrink-0 pt-px text-muted">
              Viewing
            </dt>
            <dd class="min-w-0 text-right">
              <a
                :href="context.visitor.page_url!"
                target="_blank"
                rel="noopener"
                class="inline-flex max-w-full items-center gap-1 text-highlighted transition-colors hover:text-primary-600 dark:hover:text-primary-400"
              >
                <span class="truncate">{{ pageHost }}</span>
                <UIcon
                  name="i-lucide-external-link"
                  class="size-3 shrink-0"
                />
              </a>
            </dd>
          </div>
        </dl>
      </section>

      <section class="border-b border-default p-4 sm:p-5">
        <div class="flex items-center justify-between gap-3">
          <p class="text-[10px] font-semibold uppercase tracking-wider text-dimmed">
            Conversation history
          </p>
          <span class="text-xs font-semibold tabular-nums text-highlighted">{{ context.past_conversations }}</span>
        </div>
        <div
          v-if="context.recent_conversations.length"
          class="mt-2 space-y-1"
        >
          <div
            v-for="conversation in context.recent_conversations"
            :key="conversation.id"
            class="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left"
          >
            <span
              class="size-1.5 shrink-0 rounded-full"
              :class="conversation.status === 'resolved' ? 'bg-green-500' : 'bg-amber-500'"
            />
            <span class="min-w-0 flex-1 truncate text-xs capitalize text-highlighted">{{ conversation.status }}</span>
            <span class="shrink-0 text-[11px] text-muted">{{ timeAgo(conversation.last_message_at) }}</span>
          </div>
        </div>
        <p
          v-else
          class="mt-2 text-xs text-muted"
        >
          This is the first conversation you can access.
        </p>
      </section>

      <section class="space-y-4 p-4 sm:p-5">
        <div v-if="context.visitor.external_id">
          <p class="text-[10px] font-semibold uppercase tracking-wider text-dimmed">
            User ID <span class="normal-case font-normal">· from their platform</span>
          </p>
          <button
            class="mt-2 w-full truncate rounded-lg bg-elevated/60 px-2.5 py-1.5 text-left font-mono text-[11px] text-muted ring-1 ring-default transition-colors hover:text-highlighted"
            title="Copy user id"
            @click="copy(context.visitor.external_id!)"
          >
            {{ context.visitor.external_id }}
          </button>
        </div>
        <div>
          <p class="text-[10px] font-semibold uppercase tracking-wider text-dimmed">
            Visitor ID
          </p>
          <button
            class="mt-2 w-full truncate rounded-lg bg-elevated/60 px-2.5 py-1.5 text-left font-mono text-[11px] text-muted ring-1 ring-default transition-colors hover:text-highlighted"
            title="Copy visitor id"
            @click="copy(context.visitor.visitor_id)"
          >
            {{ context.visitor.visitor_id }}
          </button>
        </div>
      </section>
    </template>
  </div>
</template>
