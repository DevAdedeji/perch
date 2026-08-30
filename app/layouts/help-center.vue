<template>
  <div class="min-h-screen bg-default">
    <header class="border-b border-default bg-default/95">
      <UContainer class="flex h-16 items-center justify-between gap-4">
        <NuxtLink
          to="/"
          aria-label="Perch home"
        >
          <PerchLogo />
        </NuxtLink>
        <span class="text-xs font-medium text-muted">
          Help Center
        </span>
      </UContainer>
    </header>

    <main>
      <slot />
    </main>

    <footer class="border-t border-default">
      <UContainer class="flex flex-col items-center justify-between gap-3 py-7 text-center sm:flex-row sm:text-left">
        <p class="text-xs text-dimmed">
          Helpful answers, available whenever you need them.
        </p>
        <NuxtLink
          to="/"
          class="text-xs text-muted transition-colors hover:text-highlighted"
        >
          Powered by Perch
        </NuxtLink>
      </UContainer>
    </footer>
  </div>
</template>
