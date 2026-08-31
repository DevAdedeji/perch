<script setup lang="ts">
const { loggedIn, logout } = useAuth()
</script>

<template>
  <div class="min-h-screen lg:grid lg:grid-cols-2">
    <AuthShowcase />

    <div class="relative isolate flex min-h-screen flex-col">
      <!-- ambient backdrop: the faint blueprint grid, nothing else -->
      <div class="bg-grid pointer-events-none absolute inset-0 z-0 opacity-60" />

      <header class="relative z-10 flex h-16 shrink-0 items-center px-5 sm:px-8">
        <!-- the panel carries the logo from lg up, so it never appears twice -->
        <NuxtLink
          to="/"
          class="lg:hidden"
          aria-label="Perch home"
        >
          <PerchLogo />
        </NuxtLink>
        <div class="ml-auto flex items-center gap-1.5">
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

      <main class="relative z-10 flex flex-1 items-center justify-center px-5 py-8 sm:px-8 sm:py-12">
        <slot />
      </main>
    </div>
  </div>
</template>
