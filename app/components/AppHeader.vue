<script setup lang="ts">
const links = [
  { label: 'Features', to: '#features' },
  { label: 'Control Room', to: '#control-room' },
  { label: 'How it works', to: '#how' },
  { label: 'Pricing', to: '#pricing' }
]

const scrolled = ref(false)
const mobileOpen = ref(false)

function onScroll() {
  scrolled.value = window.scrollY > 12
}

onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))
</script>

<template>
  <header
    class="fixed inset-x-0 top-0 z-50 transition-all duration-300"
    :class="scrolled ? 'py-2' : 'py-3.5'"
  >
    <UContainer>
      <div
        class="flex items-center justify-between gap-4 rounded-2xl px-3 sm:px-4 h-14 transition-all duration-300"
        :class="scrolled
          ? 'glass ring-1 ring-default shadow-lg shadow-black/5'
          : 'ring-1 ring-transparent'"
      >
        <NuxtLink
          to="/"
          aria-label="Perch home"
        >
          <PerchLogo />
        </NuxtLink>

        <nav class="hidden md:flex items-center gap-1">
          <UButton
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            variant="ghost"
            color="neutral"
            size="md"
            class="text-muted hover:text-highlighted"
          >
            {{ link.label }}
          </UButton>
        </nav>

        <div class="flex items-center gap-1.5">
          <UColorModeButton />
          <UButton
            to="#"
            variant="ghost"
            color="neutral"
            size="md"
            class="hidden sm:inline-flex"
          >
            Sign in
          </UButton>
          <UButton
            to="#pricing"
            color="primary"
            size="md"
            trailing-icon="i-lucide-arrow-right"
            class="hidden sm:inline-flex font-medium"
          >
            Get started
          </UButton>
          <UButton
            class="md:hidden"
            color="neutral"
            variant="ghost"
            :icon="mobileOpen ? 'i-lucide-x' : 'i-lucide-menu'"
            aria-label="Menu"
            @click="mobileOpen = !mobileOpen"
          />
        </div>
      </div>

      <!-- mobile drawer -->
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0 -translate-y-2"
        leave-active-class="transition duration-150 ease-in"
        leave-to-class="opacity-0 -translate-y-2"
      >
        <div
          v-if="mobileOpen"
          class="md:hidden mt-2 glass ring-1 ring-default rounded-2xl p-2"
        >
          <UButton
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            variant="ghost"
            color="neutral"
            block
            class="justify-start"
            @click="mobileOpen = false"
          >
            {{ link.label }}
          </UButton>
          <div class="grid grid-cols-2 gap-2 p-1 pt-2">
            <UButton
              to="#"
              variant="soft"
              color="neutral"
              block
            >
              Sign in
            </UButton>
            <UButton
              to="#pricing"
              color="primary"
              block
            >
              Get started
            </UButton>
          </div>
        </div>
      </Transition>
    </UContainer>
  </header>
</template>
