<script setup lang="ts">
import type { AutomationRuleConfig, AutomationRuleType } from '@perch/shared'

const props = defineProps<{ workspaceId: string }>()
const toast = useToast()

interface AutomationRule {
  id: string
  name: string
  type: AutomationRuleType
  config: AutomationRuleConfig
  sort_order: number
  enabled: boolean
}

interface Member { id: string, name: string }
interface Tag { id: string, name: string }

const templates: Array<{ type: AutomationRuleType, title: string, description: string, icon: string }> = [
  { type: 'round_robin', title: 'Share new chats', description: 'Take turns assigning new conversations.', icon: 'i-lucide-refresh-cw' },
  { type: 'page_assignment', title: 'Route by page', description: 'Send visitors from one page to the right teammate.', icon: 'i-lucide-route' },
  { type: 'vip_tagging', title: 'Tag VIPs', description: 'Recognize trusted customers or visitor context.', icon: 'i-lucide-sparkles' },
  { type: 'inactivity_reminder', title: 'Remind teammates', description: 'Nudge the owner when a chat goes quiet.', icon: 'i-lucide-clock-alert' },
  { type: 'auto_close', title: 'Close inactive chats', description: 'Resolve old assigned chats after a safe delay.', icon: 'i-lucide-circle-check-big' }
]

const rules = ref<AutomationRule[]>([])
const members = ref<Member[]>([])
const tags = ref<Tag[]>([])
const loading = ref(true)
const saving = ref(false)
const editingId = ref<string | null>(null)
const createRequestKey = ref<string | null>(null)
const selectedType = ref<AutomationRuleType | null>(null)
const ruleName = ref('')
const memberIds = ref<string[]>([])
const targetMemberId = ref('')
const urlContains = ref('')
const vipCondition = ref<'email_domain' | 'email_equals' | 'metadata'>('email_domain')
const vipValue = ref('')
const metadataKey = ref<'page_url'>('page_url')
const tagId = ref('')
const reminderMinutes = ref(30)
const closeHours = ref(72)

async function load() {
  loading.value = true
  try {
    const [ruleRows, memberRows, tagRows] = await Promise.all([
      $fetch<AutomationRule[]>(`/api/workspaces/${props.workspaceId}/automation-rules`),
      $fetch<Member[]>(`/api/workspaces/${props.workspaceId}/members`),
      $fetch<Tag[]>(`/api/workspaces/${props.workspaceId}/tags`)
    ])
    rules.value = ruleRows
    members.value = memberRows
    tags.value = tagRows
  } catch (error) {
    toast.add({ title: getErrorMessage(error, 'Could not load automations'), color: 'error' })
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => props.workspaceId, () => {
  resetEditor()
  load()
})

function chooseTemplate(type: AutomationRuleType) {
  resetEditor()
  createRequestKey.value = crypto.randomUUID()
  selectedType.value = type
  ruleName.value = templates.find(template => template.type === type)?.title ?? 'Automation'
}

function resetEditor() {
  editingId.value = null
  createRequestKey.value = null
  selectedType.value = null
  ruleName.value = ''
  memberIds.value = []
  targetMemberId.value = ''
  urlContains.value = ''
  vipCondition.value = 'email_domain'
  vipValue.value = ''
  metadataKey.value = 'page_url'
  tagId.value = ''
  reminderMinutes.value = 30
  closeHours.value = 72
}

function editRule(rule: AutomationRule) {
  resetEditor()
  editingId.value = rule.id
  selectedType.value = rule.type
  ruleName.value = rule.name
  if (rule.type === 'round_robin') memberIds.value = [...(rule.config as { member_ids: string[] }).member_ids]
  if (rule.type === 'page_assignment') {
    const config = rule.config as { url_contains: string, member_id: string }
    urlContains.value = config.url_contains
    targetMemberId.value = config.member_id
  }
  if (rule.type === 'vip_tagging') {
    const config = rule.config as Extract<AutomationRuleConfig, { condition: unknown }>
    vipCondition.value = config.condition
    vipValue.value = config.value
    tagId.value = config.tag_id
    if (config.condition === 'metadata') metadataKey.value = config.metadata_key
  }
  if (rule.type === 'inactivity_reminder') reminderMinutes.value = (rule.config as { minutes: number }).minutes
  if (rule.type === 'auto_close') closeHours.value = (rule.config as { hours: number }).hours
}

function buildConfig(): AutomationRuleConfig | null {
  if (selectedType.value === 'round_robin') return { member_ids: [...memberIds.value] }
  if (selectedType.value === 'page_assignment') {
    if (!urlContains.value.trim() || !targetMemberId.value) return null
    return { url_contains: urlContains.value.trim(), member_id: targetMemberId.value }
  }
  if (selectedType.value === 'vip_tagging') {
    if (!vipValue.value.trim() || !tagId.value) return null
    if (vipCondition.value === 'metadata') {
      return { condition: 'metadata', metadata_key: metadataKey.value, value: vipValue.value.trim(), tag_id: tagId.value }
    }
    return { condition: vipCondition.value, value: vipValue.value.trim(), tag_id: tagId.value }
  }
  if (selectedType.value === 'inactivity_reminder') return { minutes: Math.round(reminderMinutes.value) }
  if (selectedType.value === 'auto_close') return { hours: Math.round(closeHours.value) }
  return null
}

const canSave = computed(() => Boolean(ruleName.value.trim() && buildConfig()))

async function saveRule() {
  const config = buildConfig()
  if (!selectedType.value || !ruleName.value.trim() || !config || saving.value) return
  saving.value = true
  try {
    if (editingId.value) {
      const updated = await $fetch<AutomationRule>(`/api/workspaces/${props.workspaceId}/automation-rules/${editingId.value}`, {
        method: 'PATCH',
        body: { name: ruleName.value.trim(), config }
      })
      rules.value = rules.value.map(rule => rule.id === updated.id ? updated : rule)
      toast.add({ title: 'Automation updated', color: 'success', icon: 'i-lucide-check' })
    } else {
      createRequestKey.value ||= crypto.randomUUID()
      const created = await $fetch<AutomationRule>(`/api/workspaces/${props.workspaceId}/automation-rules`, {
        method: 'POST',
        body: { name: ruleName.value.trim(), type: selectedType.value, config, idempotency_key: createRequestKey.value }
      })
      rules.value = [...rules.value, created]
      toast.add({ title: 'Automation is active', color: 'success', icon: 'i-lucide-zap' })
    }
    resetEditor()
  } catch (error) {
    toast.add({ title: getErrorMessage(error, 'Could not save automation'), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function toggleRule(rule: AutomationRule, enabled: boolean) {
  const previous = rule.enabled
  rule.enabled = enabled
  try {
    await $fetch(`/api/workspaces/${props.workspaceId}/automation-rules/${rule.id}`, { method: 'PATCH', body: { enabled } })
  } catch (error) {
    rule.enabled = previous
    toast.add({ title: getErrorMessage(error, 'Could not update automation'), color: 'error' })
  }
}

async function deleteRule(rule: AutomationRule) {
  if (!window.confirm(`Delete “${rule.name}”? This cannot be undone.`)) return
  try {
    await $fetch(`/api/workspaces/${props.workspaceId}/automation-rules/${rule.id}`, { method: 'DELETE' })
    rules.value = rules.value.filter(item => item.id !== rule.id)
    if (editingId.value === rule.id) resetEditor()
  } catch (error) {
    toast.add({ title: getErrorMessage(error, 'Could not delete automation'), color: 'error' })
  }
}

async function moveRule(rule: AutomationRule, direction: 'up' | 'down') {
  try {
    rules.value = await $fetch<AutomationRule[]>(`/api/workspaces/${props.workspaceId}/automation-rules/${rule.id}/move`, {
      method: 'POST',
      body: { direction }
    })
  } catch (error) {
    toast.add({ title: getErrorMessage(error, 'Could not reorder automations'), color: 'error' })
  }
}

function ruleSummary(rule: AutomationRule) {
  if (rule.type === 'round_robin') {
    const ids = (rule.config as { member_ids: string[] }).member_ids
    return ids.length ? `Rotate between ${ids.length} selected teammates` : 'Rotate between everyone on the team'
  }
  if (rule.type === 'page_assignment') {
    const config = rule.config as { url_contains: string, member_id: string }
    return `URL contains “${config.url_contains}” → ${members.value.find(member => member.id === config.member_id)?.name ?? 'teammate'}`
  }
  if (rule.type === 'vip_tagging') {
    const config = rule.config as Extract<AutomationRuleConfig, { condition: unknown }>
    const label = config.condition === 'email_domain' ? 'verified email domain' : config.condition === 'email_equals' ? 'verified email' : config.metadata_key
    return `${label} matches “${config.value}” → #${tags.value.find(tag => tag.id === config.tag_id)?.name ?? 'tag'}`
  }
  if (rule.type === 'inactivity_reminder') return `Remind the owner after ${(rule.config as { minutes: number }).minutes} minutes`
  return `Resolve assigned chats after ${(rule.config as { hours: number }).hours} hours`
}
</script>

<template>
  <section class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6">
    <div class="flex items-start gap-3">
      <div class="min-w-0 flex-1">
        <h2 class="font-display font-semibold text-highlighted">
          Simple automations
        </h2>
        <p class="mt-0.5 text-sm text-muted">
          Choose a starting point, fill in one or two details, and Perch handles the rest in the order shown.
        </p>
      </div>
      <UBadge
        color="warning"
        variant="subtle"
      >
        Admin
      </UBadge>
    </div>

    <div
      v-if="loading"
      class="mt-4 space-y-2"
    >
      <USkeleton
        v-for="index in 3"
        :key="index"
        class="h-16 w-full rounded-xl"
      />
    </div>

    <template v-else>
      <ul
        v-if="rules.length"
        class="mt-4 divide-y divide-default/60 overflow-hidden rounded-xl ring-1 ring-default"
      >
        <li
          v-for="(rule, index) in rules"
          :key="rule.id"
          class="flex items-start gap-2 bg-default px-3 py-3"
          :class="{ 'opacity-60': !rule.enabled }"
        >
          <span class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary-500/10 text-primary-700 dark:text-primary-400">
            <UIcon
              :name="templates.find(template => template.type === rule.type)?.icon"
              class="size-4"
            />
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-highlighted">
              {{ rule.name }}
            </p>
            <p class="mt-0.5 text-xs text-muted">
              {{ ruleSummary(rule) }}
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-0.5">
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-arrow-up"
              :disabled="index === 0"
              aria-label="Move automation up"
              @click="moveRule(rule, 'up')"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-arrow-down"
              :disabled="index === rules.length - 1"
              aria-label="Move automation down"
              @click="moveRule(rule, 'down')"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-pencil"
              :aria-label="`Edit ${rule.name}`"
              @click="editRule(rule)"
            />
            <USwitch
              :model-value="rule.enabled"
              :aria-label="rule.enabled ? `Disable ${rule.name}` : `Enable ${rule.name}`"
              @update:model-value="(value: boolean) => toggleRule(rule, value)"
            />
            <UButton
              size="xs"
              color="error"
              variant="ghost"
              icon="i-lucide-trash-2"
              :aria-label="`Delete ${rule.name}`"
              @click="deleteRule(rule)"
            />
          </div>
        </li>
      </ul>

      <p
        v-else
        class="mt-4 rounded-xl bg-default px-4 py-3 text-xs text-dimmed ring-1 ring-default"
      >
        No automations yet. Pick a template below to get started.
      </p>

      <div
        v-if="!selectedType"
        class="mt-5"
      >
        <p class="text-xs font-semibold uppercase tracking-wide text-dimmed">
          Add from a template
        </p>
        <div class="mt-2 grid gap-2 sm:grid-cols-2">
          <button
            v-for="template in templates"
            :key="template.type"
            type="button"
            class="flex items-start gap-3 rounded-xl bg-default p-3 text-left ring-1 ring-default transition hover:ring-primary-500/50"
            @click="chooseTemplate(template.type)"
          >
            <UIcon
              :name="template.icon"
              class="mt-0.5 size-4 shrink-0 text-primary-600 dark:text-primary-400"
            />
            <span class="min-w-0">
              <span class="block text-sm font-medium text-highlighted">{{ template.title }}</span>
              <span class="mt-0.5 block text-xs text-muted">{{ template.description }}</span>
            </span>
          </button>
        </div>
      </div>

      <form
        v-else
        class="mt-5 rounded-xl bg-default p-4 ring-1 ring-default"
        @submit.prevent="saveRule"
      >
        <div class="flex items-center gap-3">
          <UIcon
            :name="templates.find(template => template.type === selectedType)?.icon"
            class="size-5 text-primary-600 dark:text-primary-400"
          />
          <p class="font-medium text-highlighted">
            {{ editingId ? 'Edit automation' : templates.find(template => template.type === selectedType)?.title }}
          </p>
          <UButton
            class="ml-auto"
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            aria-label="Close editor"
            @click="resetEditor"
          />
        </div>

        <label class="mt-4 block">
          <span class="mb-1.5 block text-xs font-medium text-muted">Name</span>
          <UInput
            v-model="ruleName"
            maxlength="80"
            placeholder="A name your team will recognize"
          />
        </label>

        <fieldset
          v-if="selectedType === 'round_robin'"
          class="mt-4"
        >
          <legend class="text-xs font-medium text-muted">
            Who should take turns?
          </legend>
          <p class="mt-1 text-xs text-dimmed">
            Leave everyone unchecked to include the whole team.
          </p>
          <div class="mt-2 grid gap-2 sm:grid-cols-2">
            <label
              v-for="member in members"
              :key="member.id"
              class="flex items-center gap-2 rounded-lg bg-elevated/50 px-3 py-2 text-sm text-highlighted"
            >
              <input
                v-model="memberIds"
                type="checkbox"
                :value="member.id"
                class="accent-primary-500"
              >{{ member.name }}
            </label>
          </div>
        </fieldset>

        <div
          v-else-if="selectedType === 'page_assignment'"
          class="mt-4 grid gap-3 sm:grid-cols-2"
        >
          <label>
            <span class="mb-1.5 block text-xs font-medium text-muted">URL contains</span>
            <UInput
              v-model="urlContains"
              class="font-mono"
              maxlength="300"
              placeholder="/pricing"
            />
          </label>
          <label>
            <span class="mb-1.5 block text-xs font-medium text-muted">Assign to</span>
            <select
              v-model="targetMemberId"
              class="h-10 w-full rounded-lg border border-default bg-default px-3 text-sm text-highlighted"
            >
              <option
                value=""
                disabled
              >Choose teammate</option>
              <option
                v-for="member in members"
                :key="member.id"
                :value="member.id"
              >{{ member.name }}</option>
            </select>
          </label>
        </div>

        <div
          v-else-if="selectedType === 'vip_tagging'"
          class="mt-4 grid gap-3 sm:grid-cols-2"
        >
          <label>
            <span class="mb-1.5 block text-xs font-medium text-muted">Recognize by</span>
            <select
              v-model="vipCondition"
              class="h-10 w-full rounded-lg border border-default bg-default px-3 text-sm text-highlighted"
            >
              <option value="email_domain">Verified email domain</option>
              <option value="email_equals">Verified email address</option>
              <option value="metadata">Visitor context</option>
            </select>
          </label>
          <label v-if="vipCondition === 'metadata'">
            <span class="mb-1.5 block text-xs font-medium text-muted">Context field</span>
            <select
              v-model="metadataKey"
              class="h-10 w-full rounded-lg border border-default bg-default px-3 text-sm text-highlighted"
            >
              <option value="page_url">Page URL</option>
            </select>
          </label>
          <label>
            <span class="mb-1.5 block text-xs font-medium text-muted">Matches</span>
            <UInput
              v-model="vipValue"
              maxlength="300"
              :placeholder="vipCondition === 'email_domain' ? 'example.com' : vipCondition === 'email_equals' ? 'vip@example.com' : '/enterprise'"
            />
          </label>
          <label>
            <span class="mb-1.5 block text-xs font-medium text-muted">Apply tag</span>
            <select
              v-model="tagId"
              class="h-10 w-full rounded-lg border border-default bg-default px-3 text-sm text-highlighted"
            >
              <option
                value=""
                disabled
              >Choose tag</option>
              <option
                v-for="tag in tags"
                :key="tag.id"
                :value="tag.id"
              >#{{ tag.name }}</option>
            </select>
          </label>
          <p
            v-if="!tags.length"
            class="text-xs text-primary-700 dark:text-primary-400 sm:col-span-2"
          >
            Create a conversation tag first, then return here.
          </p>
        </div>

        <label
          v-else-if="selectedType === 'inactivity_reminder'"
          class="mt-4 block max-w-xs"
        >
          <span class="mb-1.5 block text-xs font-medium text-muted">Remind the assigned teammate after</span>
          <UInput
            v-model.number="reminderMinutes"
            type="number"
            :min="5"
            :max="1440"
          >
            <template #trailing><span class="text-xs text-dimmed">minutes</span></template>
          </UInput>
        </label>

        <label
          v-else
          class="mt-4 block max-w-xs"
        >
          <span class="mb-1.5 block text-xs font-medium text-muted">Resolve an assigned chat after</span>
          <UInput
            v-model.number="closeHours"
            type="number"
            :min="24"
            :max="720"
          >
            <template #trailing><span class="text-xs text-dimmed">hours</span></template>
          </UInput>
          <span class="mt-1.5 block text-xs text-dimmed">For safety, unanswered unassigned chats are never auto-closed.</span>
        </label>

        <div class="mt-5 flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="resetEditor"
          >
            Cancel
          </UButton>
          <UButton
            type="submit"
            icon="i-lucide-zap"
            :loading="saving"
            :disabled="!canSave"
          >
            {{ editingId ? 'Save changes' : 'Turn on automation' }}
          </UButton>
        </div>
      </form>
    </template>
  </section>
</template>
