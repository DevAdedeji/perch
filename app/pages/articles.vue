<script setup lang="ts">
definePageMeta({ layout: 'dashboard' })
useHead({ title: 'Help Center · Perch' })

interface Article {
  id: string
  title: string
  body: string
  url: string | null
  status: 'draft' | 'published'
  updated_at: string
}

interface Group {
  id: string
  name: string
  description: string | null
  sort_order: number
  articles: Article[]
}

const { currentWorkspace } = useAuth()
const toast = useToast()

const wid = computed(() => currentWorkspace.value?.workspaceId ?? null)
const isAdmin = computed(() => currentWorkspace.value?.role === 'admin')
const groups = ref<Group[]>([])
const loading = ref(true)

async function load() {
  if (!wid.value) return
  loading.value = true
  try {
    groups.value = await $fetch<Group[]>(`/api/workspaces/${wid.value}/articles`)
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(wid, load)

/* ── group create / edit ── */
const groupModalOpen = ref(false)
const groupSaving = ref(false)
const editingGroup = ref<Group | null>(null)
const groupForm = reactive({ name: '', description: '' })

function openGroupModal(group: Group | null) {
  editingGroup.value = group
  groupForm.name = group?.name ?? ''
  groupForm.description = group?.description ?? ''
  groupModalOpen.value = true
}

async function saveGroup() {
  if (!groupForm.name.trim() || groupSaving.value) return
  groupSaving.value = true
  try {
    if (editingGroup.value) {
      const res = await $fetch<Group>(`/api/workspaces/${wid.value}/article-groups/${editingGroup.value.id}`, {
        method: 'PATCH',
        body: { name: groupForm.name, description: groupForm.description || null }
      })
      Object.assign(editingGroup.value, { name: res.name, description: res.description })
    } else {
      const res = await $fetch<Group>(`/api/workspaces/${wid.value}/article-groups`, {
        method: 'POST',
        body: { name: groupForm.name, description: groupForm.description || undefined }
      })
      groups.value.push(res)
    }
    groupModalOpen.value = false
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not save the group'), color: 'error' })
  } finally {
    groupSaving.value = false
  }
}

async function deleteGroup(group: Group) {
  try {
    await $fetch(`/api/workspaces/${wid.value}/article-groups/${group.id}`, { method: 'DELETE' })
    groups.value = groups.value.filter(g => g.id !== group.id)
    toast.add({ title: `“${group.name}” deleted`, color: 'neutral' })
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not delete the group'), color: 'error' })
  }
}

async function moveGroup(group: Group, dir: -1 | 1) {
  const idx = groups.value.indexOf(group)
  const swapWith = groups.value[idx + dir]
  if (!swapWith) return
  // optimistic swap, then persist both orders
  groups.value.splice(idx, 1)
  groups.value.splice(idx + dir, 0, group)
  try {
    await Promise.all(groups.value.map((g, i) =>
      g.sort_order === i
        ? Promise.resolve()
        : $fetch(`/api/workspaces/${wid.value}/article-groups/${g.id}`, {
            method: 'PATCH',
            body: { sort_order: i }
          }).then(() => { g.sort_order = i })
    ))
  } catch {
    toast.add({ title: 'Could not reorder — reloading', color: 'error' })
    load()
  }
}

/* ── article create / edit ── */
const articleModalOpen = ref(false)
const articleSaving = ref(false)
const editingArticle = ref<Article | null>(null)
const articleGroupRef = ref<Group | null>(null)
const articleForm = reactive({ title: '', body: '', url: '', published: false })

function openArticleModal(group: Group, article: Article | null) {
  articleGroupRef.value = group
  editingArticle.value = article
  articleForm.title = article?.title ?? ''
  articleForm.body = article?.body ?? ''
  articleForm.url = article?.url ?? ''
  articleForm.published = article?.status === 'published'
  articleModalOpen.value = true
}

async function saveArticle() {
  const group = articleGroupRef.value
  const hasContent = articleForm.body.trim() || articleForm.url.trim()
  if (!group || !articleForm.title.trim() || !hasContent || articleSaving.value) return
  articleSaving.value = true
  const status = articleForm.published ? 'published' : 'draft'
  try {
    if (editingArticle.value) {
      const res = await $fetch<Article>(`/api/workspaces/${wid.value}/articles/${editingArticle.value.id}`, {
        method: 'PATCH',
        body: { title: articleForm.title, body: articleForm.body, url: articleForm.url.trim() || null, status }
      })
      Object.assign(editingArticle.value, res)
    } else {
      const res = await $fetch<Article>(`/api/workspaces/${wid.value}/articles`, {
        method: 'POST',
        body: { group_id: group.id, title: articleForm.title, body: articleForm.body, url: articleForm.url.trim() || undefined, status }
      })
      group.articles.push(res)
    }
    articleModalOpen.value = false
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not save the article'), color: 'error' })
  } finally {
    articleSaving.value = false
  }
}

async function deleteArticle(group: Group, article: Article) {
  try {
    await $fetch(`/api/workspaces/${wid.value}/articles/${article.id}`, { method: 'DELETE' })
    group.articles = group.articles.filter(a => a.id !== article.id)
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not delete the article'), color: 'error' })
  }
}

async function togglePublish(article: Article) {
  const next = article.status === 'published' ? 'draft' : 'published'
  try {
    const res = await $fetch<Article>(`/api/workspaces/${wid.value}/articles/${article.id}`, {
      method: 'PATCH',
      body: { status: next }
    })
    Object.assign(article, res)
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not update the article'), color: 'error' })
  }
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-2xl mx-auto p-5 sm:p-8 space-y-8">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h1 class="font-display text-2xl font-bold text-highlighted">
            Help Center
          </h1>
          <p class="text-sm text-muted mt-0.5">
            Articles your visitors can read in the widget's Help tab — answer the
            common questions before they become conversations.
          </p>
        </div>
        <UButton
          v-if="isAdmin"
          color="primary"
          icon="i-lucide-plus"
          class="shrink-0"
          @click="openGroupModal(null)"
        >
          New group
        </UButton>
      </div>

      <div
        v-if="loading"
        class="space-y-4"
      >
        <USkeleton
          v-for="n in 2"
          :key="n"
          class="h-36 w-full rounded-2xl"
        />
      </div>

      <div
        v-else-if="!groups.length"
        class="rounded-2xl border-glow bg-elevated/30 p-10 text-center"
      >
        <UIcon
          name="i-lucide-book-open"
          class="mx-auto size-8 text-dimmed"
        />
        <p class="mt-3 text-sm font-medium text-highlighted">
          No articles yet
        </p>
        <p class="mt-1 text-sm text-muted max-w-sm mx-auto">
          Start with a group like “Getting started”, then write the answers you keep
          typing into chats. Published articles appear in the widget automatically.
        </p>
        <UButton
          v-if="isAdmin"
          color="primary"
          class="mt-5"
          icon="i-lucide-plus"
          @click="openGroupModal(null)"
        >
          Create the first group
        </UButton>
      </div>

      <section
        v-for="(group, gi) in groups"
        v-else
        :key="group.id"
        class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6"
      >
        <div class="flex items-start gap-2">
          <div class="min-w-0 flex-1">
            <h2 class="font-display font-semibold text-highlighted truncate">
              {{ group.name }}
            </h2>
            <p
              v-if="group.description"
              class="text-sm text-muted mt-0.5"
            >
              {{ group.description }}
            </p>
          </div>
          <template v-if="isAdmin">
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-chevron-up"
              :disabled="gi === 0"
              aria-label="Move group up"
              @click="moveGroup(group, -1)"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-chevron-down"
              :disabled="gi === groups.length - 1"
              aria-label="Move group down"
              @click="moveGroup(group, 1)"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-pencil"
              aria-label="Edit group"
              @click="openGroupModal(group)"
            />
            <UButton
              size="xs"
              color="error"
              variant="ghost"
              icon="i-lucide-trash-2"
              aria-label="Delete group"
              @click="deleteGroup(group)"
            />
          </template>
        </div>

        <ul
          v-if="group.articles.length"
          class="mt-4 divide-y divide-default/60 rounded-xl ring-1 ring-default overflow-hidden"
        >
          <li
            v-for="article in group.articles"
            :key="article.id"
            class="group/row flex items-center gap-3 px-3.5 py-2.5 bg-default"
          >
            <UIcon
              :name="article.url ? 'i-lucide-link' : 'i-lucide-file-text'"
              class="size-4 shrink-0 text-dimmed"
            />
            <button
              class="min-w-0 flex-1 text-left text-sm font-medium text-highlighted truncate hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
              @click="isAdmin ? openArticleModal(group, article) : undefined"
            >
              {{ article.title }}
            </button>
            <UBadge
              :color="article.status === 'published' ? 'success' : 'neutral'"
              variant="subtle"
              size="sm"
              class="shrink-0 cursor-pointer"
              @click="isAdmin && togglePublish(article)"
            >
              {{ article.status === 'published' ? 'Published' : 'Draft' }}
            </UBadge>
            <UButton
              v-if="isAdmin"
              class="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 transition-opacity"
              size="xs"
              color="error"
              variant="ghost"
              icon="i-lucide-trash-2"
              :aria-label="`Delete ${article.title}`"
              @click="deleteArticle(group, article)"
            />
          </li>
        </ul>
        <p
          v-else
          class="mt-4 rounded-xl ring-1 ring-default bg-default px-4 py-3 text-xs text-dimmed"
        >
          No articles in this group yet.
        </p>

        <UButton
          v-if="isAdmin"
          class="mt-3"
          size="sm"
          color="neutral"
          variant="subtle"
          icon="i-lucide-plus"
          @click="openArticleModal(group, null)"
        >
          New article
        </UButton>
      </section>
    </div>

    <!-- group editor -->
    <UModal
      v-model:open="groupModalOpen"
      :title="editingGroup ? 'Edit group' : 'New group'"
    >
      <template #body>
        <div class="space-y-4">
          <UFormField label="Name">
            <UInput
              v-model="groupForm.name"
              size="lg"
              class="w-full"
              placeholder="Getting started"
              @keyup.enter="saveGroup"
            />
          </UFormField>
          <UFormField
            label="Description"
            hint="Optional"
          >
            <UInput
              v-model="groupForm.description"
              size="lg"
              class="w-full"
              placeholder="Everything you need for your first week"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            color="neutral"
            variant="ghost"
            @click="groupModalOpen = false"
          >
            Cancel
          </UButton>
          <UButton
            color="primary"
            :loading="groupSaving"
            :disabled="!groupForm.name.trim()"
            @click="saveGroup"
          >
            {{ editingGroup ? 'Save' : 'Create group' }}
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- article editor -->
    <UModal
      v-model:open="articleModalOpen"
      :title="editingArticle ? 'Edit article' : 'New article'"
      :description="articleGroupRef ? `In “${articleGroupRef.name}”` : undefined"
      :ui="{ content: 'max-w-2xl' }"
    >
      <template #body>
        <div class="space-y-4">
          <UFormField label="Title">
            <UInput
              v-model="articleForm.title"
              size="lg"
              class="w-full"
              placeholder="How do I invite my team?"
            />
          </UFormField>
          <UFormField
            label="Link to an existing page"
            hint="Optional"
          >
            <UInput
              v-model="articleForm.url"
              type="url"
              size="lg"
              class="w-full"
              placeholder="https://yoursite.com/faq/invites"
            />
            <template #help>
              Already answered this on your site? Paste the link — visitors will open it
              directly, no need to rewrite it here.
            </template>
          </UFormField>
          <UFormField
            label="Body"
            :hint="articleForm.url.trim() ? 'Optional when a link is set' : 'Plain text — blank lines start new paragraphs'"
          >
            <UTextarea
              v-model="articleForm.body"
              :rows="articleForm.url.trim() ? 5 : 12"
              class="w-full"
              placeholder="Write the answer the way you'd type it in chat…"
            />
          </UFormField>
          <div class="flex items-center justify-between gap-4">
            <div>
              <p class="text-sm font-medium text-highlighted">
                Published
              </p>
              <p class="text-xs text-muted">
                Visible to visitors in the widget's Help tab.
              </p>
            </div>
            <USwitch v-model="articleForm.published" />
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            color="neutral"
            variant="ghost"
            @click="articleModalOpen = false"
          >
            Cancel
          </UButton>
          <UButton
            color="primary"
            :loading="articleSaving"
            :disabled="!articleForm.title.trim() || (!articleForm.body.trim() && !articleForm.url.trim())"
            @click="saveArticle"
          >
            {{ editingArticle ? 'Save' : 'Create article' }}
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
