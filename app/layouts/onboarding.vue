<script setup lang="ts">
const { logout } = useAuth()
</script>

<template>
  <div class="relative isolate flex min-h-screen flex-col">
    <div class="bg-grid pointer-events-none absolute inset-0 z-0 opacity-60" />

    <header class="relative z-10 flex h-16 shrink-0 items-center px-5 sm:px-8">
      <NuxtLink
        to="/"
        aria-label="Perch home"
      >
        <PerchLogo />
      </NuxtLink>
      <div class="ml-auto flex items-center gap-1.5">
        <UColorModeButton />
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-log-out"
          @click="logout"
        >
          Sign out
        </UButton>
      </div>
    </header>

    <main class="relative z-10 flex flex-1 flex-col items-center justify-center px-5 py-10 sm:px-8">
      <slot />
    </main>
  </div>
</template>
