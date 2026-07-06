<script setup lang="ts">
const { loggedIn, logout } = useAuth()
</script>

<template>
  <div class="relative min-h-screen flex flex-col">
    <!-- ambient backdrop -->
    <div class="pointer-events-none fixed inset-0 -z-10">
      <div class="absolute inset-0 bg-grid [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_30%,transparent_100%)]" />
      <div class="absolute top-[-15%] left-1/2 -translate-x-1/2 size-[520px] rounded-full bg-amber-400/15 blur-[130px]" />
    </div>

    <header class="flex items-center justify-between px-5 sm:px-8 h-16">
      <NuxtLink
        to="/"
        aria-label="Perch home"
      >
        <PerchLogo />
      </NuxtLink>
      <div class="flex items-center gap-1.5">
        <UColorModeButton />
        <UButton
          v-if="loggedIn"
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

    <main class="flex-1 flex items-center justify-center px-4 py-8 sm:py-12">
      <slot />
    </main>
  </div>
</template>
