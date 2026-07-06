<script setup lang="ts">
const title = 'Perch — Live chat support that feels instant'
const description
  = 'Perch is a real-time live chat platform for support teams. Drop in one script tag and your team perches in the Control Room — watching the inbox, claiming chats, and replying the moment a visitor lands.'

useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    { name: 'theme-color', content: '#f59e0b' }
  ],
  link: [
    { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    { rel: 'apple-touch-icon', href: '/favicon.svg' }
  ],
  htmlAttrs: {
    lang: 'en'
  }
})

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
  twitterCard: 'summary_large_image'
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
