<script setup lang="ts">
import type { PublicHelpGroup } from '~/utils/help-center'
import { helpArticleExcerpt } from '~/utils/help-center'

definePageMeta({ layout: 'help-center' })

const route = useRoute()
const router = useRouter()
const siteId = computed(() => String(route.params.siteId ?? ''))
const submittedSearch = computed(() => typeof route.query.q === 'string' ? route.query.q.trim().slice(0, 80) : '')
const search = ref(submittedSearch.value)
const { url: siteUrl, indexable } = useSiteUrl()

const { data: groups, error, status, refresh } = await useFetch<PublicHelpGroup[]>('/api/widget/articles', {
  query: computed(() => ({
    site_id: siteId.value,
    ...(submittedSearch.value ? { q: submittedSearch.value } : {})
  }))
})

if (import.meta.server && error.value) {
  setResponseStatus(useRequestEvent()!, error.value.statusCode === 404 ? 404 : (error.value.statusCode === 429 ? 429 : 503))
}

const articleCount = computed(() => (groups.value ?? []).reduce((total, group) => total + group.articles.length, 0))
const pageTitle = computed(() => submittedSearch.value ? `Search help articles · Perch` : 'Help Center · Perch')
const pageDescription = computed(() => articleCount.value
  ? `Browse ${articleCount.value} support ${articleCount.value === 1 ? 'article' : 'articles'} and find answers quickly.`
  : 'Browse support articles and find answers quickly.')

useSeoMeta({
  title: pageTitle,
  description: pageDescription,
  robots: () => indexable.value && articleCount.value > 0 && !submittedSearch.value
    ? 'index, follow'
    : 'noindex, follow',
  ogTitle: pageTitle,
  ogDescription: pageDescription,
  ogType: 'website',
  ogUrl: () => `${siteUrl.value}/help/${siteId.value}`
})

function updateSearchUrl() {
  const q = search.value.trim()
  void router.replace({ query: q ? { q } : {} })
}

function retryLoad() {
  void refresh()
}

watch(() => route.query.q, (value) => {
  search.value = typeof value === 'string' ? value.slice(0, 80) : ''
})
</script>

<template>
  <UContainer class="py-10 sm:py-16">
    <div class="mx-auto max-w-3xl">
      <div class="text-center">
        <span class="mx-auto grid size-12 place-items-center rounded-2xl avatar-amber">
          <UIcon
            name="i-lucide-life-buoy"
            class="size-6"
          />
        </span>
        <h1 class="mt-5 font-display text-3xl font-bold tracking-tight text-highlighted sm:text-4xl">
          How can we help?
        </h1>
        <p class="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
          Search for an answer or browse the topics below.
        </p>

        <form
          class="mx-auto mt-7 max-w-xl"
          role="search"
          @submit.prevent="updateSearchUrl"
        >
          <UInput
            v-model="search"
            type="search"
            size="xl"
            icon="i-lucide-search"
            class="w-full"
            placeholder="Search help articles"
            aria-label="Search help articles"
            autocomplete="off"
            @blur="updateSearchUrl"
          />
        </form>
      </div>

      <div
        v-if="status === 'pending'"
        class="mt-10 grid gap-4 sm:grid-cols-2"
        aria-label="Loading help articles"
      >
        <USkeleton
          v-for="item in 4"
          :key="item"
          class="h-44 rounded-2xl"
        />
      </div>

      <div
        v-else-if="error"
        class="mt-10 rounded-2xl border-glow bg-elevated/30 px-6 py-12 text-center"
      >
        <UIcon
          :name="error.statusCode === 404 ? 'i-lucide-book-x' : 'i-lucide-cloud-off'"
          class="mx-auto size-8 text-dimmed"
        />
        <h2 class="mt-3 font-display text-lg font-semibold text-highlighted">
          {{ error.statusCode === 404 ? 'Help center not found' : 'Help center unavailable' }}
        </h2>
        <p class="mx-auto mt-1 max-w-sm text-sm text-muted">
          {{ error.statusCode === 404
            ? 'This link may be incorrect or the help center may no longer exist.'
            : 'We could not load the articles right now. Please try again.' }}
        </p>
        <UButton
          v-if="error.statusCode !== 404"
          class="mt-5"
          color="neutral"
          variant="soft"
          icon="i-lucide-refresh-cw"
          @click="retryLoad"
        >
          Try again
        </UButton>
      </div>

      <div
        v-else-if="submittedSearch && !articleCount"
        class="mt-10 rounded-2xl border-glow bg-elevated/30 px-6 py-12 text-center"
      >
        <UIcon
          name="i-lucide-search-x"
          class="mx-auto size-8 text-dimmed"
        />
        <h2 class="mt-3 font-display text-lg font-semibold text-highlighted">
          No matches for “{{ submittedSearch }}”
        </h2>
        <p class="mt-1 text-sm text-muted">
          Try a shorter phrase or browse all topics.
        </p>
        <UButton
          class="mt-5"
          color="neutral"
          variant="soft"
          @click="search = ''; updateSearchUrl()"
        >
          Clear search
        </UButton>
      </div>

      <div
        v-else-if="!articleCount"
        class="mt-10 rounded-2xl border-glow bg-elevated/30 px-6 py-12 text-center"
      >
        <UIcon
          name="i-lucide-book-open"
          class="mx-auto size-8 text-dimmed"
        />
        <h2 class="mt-3 font-display text-lg font-semibold text-highlighted">
          No articles published yet
        </h2>
        <p class="mx-auto mt-1 max-w-sm text-sm text-muted">
          This help center is being prepared. Please check back soon.
        </p>
      </div>

      <div
        v-else
        class="mt-10 space-y-8"
      >
        <p
          v-if="submittedSearch"
          class="text-sm text-muted"
          role="status"
        >
          {{ articleCount }} {{ articleCount === 1 ? 'result' : 'results' }}
        </p>

        <section
          v-for="group in groups"
          :key="group.id"
          :aria-labelledby="`group-${group.id}`"
        >
          <div class="mb-3">
            <h2
              :id="`group-${group.id}`"
              class="font-display text-lg font-semibold text-highlighted"
            >
              {{ group.name }}
            </h2>
            <p
              v-if="group.description"
              class="mt-0.5 text-sm text-muted"
            >
              {{ group.description }}
            </p>
          </div>

          <ul class="overflow-hidden rounded-2xl border-glow bg-default">
            <li
              v-for="article in group.articles"
              :key="article.id"
              class="border-b border-default last:border-b-0"
            >
              <NuxtLink
                :to="`/help/${siteId}/${article.id}`"
                class="group flex items-start gap-4 px-4 py-4 transition-colors hover:bg-elevated/50 sm:px-5"
              >
                <span class="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-elevated text-muted ring-1 ring-default transition-colors group-hover:text-highlighted">
                  <UIcon
                    :name="article.url ? 'i-lucide-external-link' : 'i-lucide-file-text'"
                    class="size-4"
                  />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-semibold text-highlighted">
                    {{ article.title }}
                  </span>
                  <span
                    v-if="article.excerpt"
                    class="mt-1 line-clamp-2 block text-sm leading-relaxed text-muted"
                  >
                    {{ helpArticleExcerpt(article.excerpt) }}
                  </span>
                  <span
                    v-else-if="article.url"
                    class="mt-1 block text-sm text-muted"
                  >
                    Continue to an external help page
                  </span>
                </span>
                <UIcon
                  name="i-lucide-chevron-right"
                  class="mt-2 size-4 shrink-0 text-dimmed transition-transform group-hover:translate-x-0.5"
                />
              </NuxtLink>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </UContainer>
</template>
