<script setup lang="ts">
import type { PublicHelpArticleDetail } from '~/utils/help-center'
import { helpArticleExcerpt } from '~/utils/help-center'

definePageMeta({ layout: 'help-center' })

const route = useRoute()
const siteId = computed(() => String(route.params.siteId ?? ''))
const articleId = computed(() => String(route.params.articleId ?? ''))
const { url: siteUrl, indexable } = useSiteUrl()

const { data: article, error, status, refresh } = await useFetch<PublicHelpArticleDetail>(() => `/api/widget/articles/${articleId.value}`, {
  query: computed(() => ({ site_id: siteId.value }))
})

if (import.meta.server && (error.value || !article.value)) {
  const statusCode = error.value?.statusCode
  setResponseStatus(useRequestEvent()!, statusCode === 404 || !error.value ? 404 : (statusCode === 429 ? 429 : 503))
}

const pageTitle = computed(() => article.value ? `${article.value.title} · Perch Help Center` : 'Article not found · Perch')
const description = computed(() => article.value?.body
  ? helpArticleExcerpt(article.value.body, 155)
  : 'Read this support article in the Perch Help Center.')

useSeoMeta({
  title: pageTitle,
  description,
  robots: () => indexable.value && !!article.value ? 'index, follow' : 'noindex, nofollow',
  ogTitle: pageTitle,
  ogDescription: description,
  ogType: 'article',
  ogUrl: () => `${siteUrl.value}/help/${siteId.value}/${articleId.value}`
})

function retryLoad() {
  void refresh()
}
</script>

<template>
  <UContainer class="py-8 sm:py-12">
    <div class="mx-auto max-w-3xl">
      <NuxtLink
        :to="`/help/${siteId}`"
        class="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-highlighted"
      >
        <UIcon
          name="i-lucide-arrow-left"
          class="size-4"
        />
        Back to all articles
      </NuxtLink>

      <div
        v-if="status === 'pending'"
        class="mt-8 space-y-4"
        aria-label="Loading article"
      >
        <USkeleton class="h-9 w-3/4 rounded-lg" />
        <USkeleton class="h-4 w-40 rounded" />
        <USkeleton class="mt-8 h-64 w-full rounded-2xl" />
      </div>

      <div
        v-else-if="error || !article"
        class="mt-8 rounded-2xl border-glow bg-elevated/30 px-6 py-12 text-center"
      >
        <UIcon
          :name="error && error.statusCode !== 404 ? 'i-lucide-cloud-off' : 'i-lucide-file-question'"
          class="mx-auto size-8 text-dimmed"
        />
        <h1 class="mt-3 font-display text-xl font-semibold text-highlighted">
          {{ error && error.statusCode !== 404 ? 'Article unavailable' : 'Article not found' }}
        </h1>
        <p class="mx-auto mt-1 max-w-sm text-sm text-muted">
          {{ error && error.statusCode !== 404
            ? 'We could not load this article right now. Please try again.'
            : 'It may have been unpublished, moved, or the link may be incorrect.' }}
        </p>
        <div class="mt-5 flex justify-center gap-2">
          <UButton
            v-if="error && error.statusCode !== 404"
            color="neutral"
            variant="soft"
            icon="i-lucide-refresh-cw"
            @click="retryLoad"
          >
            Try again
          </UButton>
          <UButton
            :to="`/help/${siteId}`"
            color="neutral"
          >
            Browse all articles
          </UButton>
        </div>
      </div>

      <article
        v-else
        class="mt-8"
      >
        <p class="text-sm font-medium text-primary-700 dark:text-primary-400">
          {{ article.group.name }}
        </p>
        <h1 class="mt-2 font-display text-3xl font-bold tracking-tight text-highlighted sm:text-4xl">
          {{ article.title }}
        </h1>

        <div class="mt-8 rounded-2xl border-glow bg-default p-5 sm:p-8">
          <div
            v-if="article.body"
            class="whitespace-pre-line text-[15px] leading-7 text-muted"
          >
            {{ article.body }}
          </div>

          <div
            v-if="article.url"
            :class="article.body ? 'mt-8 border-t border-default pt-6' : ''"
          >
            <p class="text-sm text-muted">
              This answer continues on an external help page.
            </p>
            <UButton
              :to="article.url"
              target="_blank"
              rel="noopener noreferrer nofollow"
              class="mt-3"
              color="neutral"
              trailing-icon="i-lucide-external-link"
            >
              Open help page
            </UButton>
          </div>
        </div>
      </article>
    </div>
  </UContainer>
</template>
