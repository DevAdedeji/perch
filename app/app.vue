<script setup lang="ts">
import { isPerchIndexablePath } from '@perch/shared'

const route = useRoute()
const { url: siteUrl, indexable: productionSite } = useSiteUrl()
const title = 'Perch — Live chat support that feels instant'
const description
  = 'Perch is a real-time live chat platform for support teams. Drop in one script tag and your team perches in the Control Room — watching the inbox, claiming chats, and replying the moment a visitor lands.'
const canonical = computed(() => `${siteUrl.value}${route.path === '/' ? '' : route.path}`)
const indexable = computed(() => productionSite.value && isPerchIndexablePath(route.path))
const ogImage = computed(() => `${siteUrl.value}/og.png`)

useHead(() => ({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    { name: 'theme-color', content: '#0f172a' }
  ],
  link: [
    { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    { rel: 'apple-touch-icon', href: '/favicon.svg' },
    ...(indexable.value ? [{ key: 'canonical', rel: 'canonical', href: canonical.value }] : [])
  ],
  htmlAttrs: {
    lang: 'en'
  }
}))

useSeoMeta({
  robots: () => indexable.value ? 'index, follow' : 'noindex, nofollow',
  title,
  description,
  ogType: 'website',
  ogSiteName: 'Perch Live Chat',
  ogLocale: 'en',
  ogTitle: title,
  ogDescription: description,
  ogUrl: () => indexable.value ? canonical.value : undefined,
  ogImage: () => ogImage.value,
  ogImageWidth: 1200,
  ogImageHeight: 630,
  ogImageAlt: 'Perch live chat shared inbox for support teams',
  twitterCard: 'summary_large_image',
  twitterTitle: title,
  twitterDescription: description,
  twitterImage: () => ogImage.value
})
</script>

<template>
  <UApp>
    <div class="min-h-screen bg-default text-default antialiased">
      <NuxtLayout>
        <NuxtPage />
      </NuxtLayout>
    </div>
  </UApp>
</template>
