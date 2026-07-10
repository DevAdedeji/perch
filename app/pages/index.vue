<script setup lang="ts">
const config = useRuntimeConfig()
const toast = useToast()

// the landing page eats its own dog food — the real widget, live, bottom-right
useHead({
  script: [{
    'src': '/widget.js',
    'data-site-id': config.public.demoSiteId,
    'async': true,
    'tagPosition': 'bodyClose'
  }]
})

// closing tag split so it doesn't terminate this SFC <script> block
const closeScript = '</' + 'script>'
const snippetText = computed(() => `<script src="https://perch.adedeji.xyz/widget.js" data-site-id="ws_abc123" async>${closeScript}`)
async function copySnippet() {
  try {
    await navigator.clipboard.writeText(snippetText.value)
    toast.add({ title: 'Snippet copied', icon: 'i-lucide-check', color: 'success' })
  } catch {
    toast.add({ title: 'Copy failed', color: 'error' })
  }
}

// plain-language numbers under the demo
const stats = [
  { value: '<1s', label: 'Message delivery' },
  { value: '2 min', label: 'From signup to live' },
  { value: '1 line', label: 'Of code to install' },
  { value: '0', label: 'Double-answered chats' }
]

// what the team actually gets — written for humans, not engineers
const benefits = [
  {
    icon: 'i-lucide-inbox',
    title: 'One shared inbox',
    desc: 'Every chat from your website lands in one place for the whole team — and updates live, without anyone refreshing.'
  },
  {
    icon: 'i-lucide-hand',
    title: 'Claim chats, don’t collide',
    desc: 'One click makes a conversation yours. If two teammates reach for the same one, the first wins and the other is told instantly — visitors never get two competing replies.'
  },
  {
    icon: 'i-lucide-users',
    title: 'See who’s available',
    desc: 'Green dot means online. Your team sees who’s around, and visitors see whether anyone’s home before they write.'
  },
  {
    icon: 'i-lucide-sticky-note',
    title: 'Notes visitors never see',
    desc: 'Leave private notes on any conversation for your teammates — perfect for handovers and context.'
  },
  {
    icon: 'i-lucide-zap',
    title: 'Saved replies',
    desc: 'Answer the questions you hear every day in two keystrokes: type / and pick a template.'
  },
  {
    icon: 'i-lucide-arrow-left-right',
    title: 'Hand off mid-conversation',
    desc: 'Transfer a chat to the right teammate with the full history attached. The visitor just sees a new name say hello.'
  }
]

// honest marquee: the stack this thing is actually built with, end to end
const stack = [
  { icon: 'i-simple-icons-nuxtdotjs', label: 'Nuxt 4' },
  { icon: 'i-simple-icons-vuedotjs', label: 'Vue 3' },
  { icon: 'i-simple-icons-typescript', label: 'TypeScript' },
  { icon: 'i-simple-icons-postgresql', label: 'Postgres' },
  { icon: 'i-simple-icons-drizzle', label: 'Drizzle' },
  { icon: 'i-simple-icons-tailwindcss', label: 'Tailwind' },
  { icon: 'i-simple-icons-docker', label: 'Docker' },
  { icon: 'i-simple-icons-pnpm', label: 'pnpm' }
]

const claimSql = 'UPDATE conversations\nSET assigned_agent_id = $me, status = \'open\'\nWHERE id = $id AND status = \'unassigned\';\n-- 1 row → claim.ok · 0 rows → claim.conflict'
</script>

<template>
  <main class="relative">
    <!-- ═══════════════ HERO — LIVE THEATER ═══════════════ -->
    <section class="relative pt-32 pb-20 sm:pt-40 sm:pb-24 overflow-hidden">
      <!-- backdrop: faint grid + a warm amber bloom -->
      <div class="pointer-events-none absolute inset-0 -z-10">
        <div class="absolute inset-0 bg-grid mask-[radial-gradient(ellipse_70%_55%_at_50%_0%,#000_30%,transparent_85%)]" />
        <div
          class="absolute -top-40 left-1/2 -translate-x-1/2 h-130 w-208 max-w-full rounded-full opacity-25 dark:opacity-20 blur-3xl"
          style="background: radial-gradient(closest-side, var(--color-amber-500), transparent 70%)"
        />
      </div>

      <UContainer>
        <div class="text-center max-w-3xl mx-auto">
          <div class="inline-flex items-center gap-2 rounded-full glass ring-1 ring-amber-500/30 px-3 py-1.5 text-xs">
            <span class="relative flex size-2">
              <span class="absolute inline-flex size-full rounded-full bg-amber-500 opacity-60 animate-ping" />
              <span class="relative inline-flex size-2 rounded-full bg-amber-500" />
            </span>
            <span class="text-muted">Live demo — this page runs Perch. <span class="text-highlighted font-medium">Say hi</span></span>
            <UIcon
              name="i-lucide-arrow-down-right"
              class="size-3.5 text-amber-600 dark:text-amber-400"
            />
          </div>

          <h1 class="mt-6 font-display text-5xl sm:text-6xl lg:text-7xl font-bold leading-[1.02] tracking-tight text-highlighted">
            Your team, perched on
            <span class="text-accent">every conversation.</span>
          </h1>

          <p class="mt-6 max-w-2xl mx-auto text-lg text-muted leading-relaxed">
            Perch puts a chat bubble on your website and gives your team one shared inbox
            to answer from — live, together, without stepping on each other.
          </p>

          <div class="mt-8 flex flex-wrap justify-center items-center gap-3">
            <UButton
              to="/signup"
              size="xl"
              color="primary"
              trailing-icon="i-lucide-arrow-right"
              class="font-semibold shadow-lg shadow-amber-500/25"
            >
              Get started free
            </UButton>
            <UButton
              to="#how"
              size="xl"
              color="neutral"
              variant="subtle"
              icon="i-lucide-code"
            >
              Set up in 2 minutes
            </UButton>
          </div>
        </div>

        <!-- the show: a visitor and the Control Room, live -->
        <div
          id="control-room"
          class="mt-14 sm:mt-16 scroll-mt-28"
        >
          <LiveTheater />
        </div>

        <!-- numbers, anchored to the demo they describe -->
        <div
          class="mt-12 max-w-3xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-px rounded-2xl overflow-hidden ring-1 ring-default"
          style="background: var(--ui-border)"
        >
          <div
            v-for="s in stats"
            :key="s.label"
            class="bg-default px-4 py-5 text-center"
          >
            <p class="font-display text-2xl sm:text-3xl font-bold text-accent">
              {{ s.value }}
            </p>
            <p class="mt-1 text-xs sm:text-sm text-muted">
              {{ s.label }}
            </p>
          </div>
        </div>
      </UContainer>
    </section>

    <!-- ═══════════════ WHAT YOUR TEAM GETS ═══════════════ -->
    <section
      id="features"
      class="relative py-20 sm:py-28 scroll-mt-16"
    >
      <UContainer>
        <div class="text-center max-w-2xl mx-auto">
          <h2 class="font-display text-4xl sm:text-5xl font-bold tracking-tight text-highlighted">
            Everything your support team needs.
          </h2>
          <p class="mt-4 text-lg text-muted">
            Nothing you have to configure. Sign up, add the bubble to your site, and this
            is what your team works with.
          </p>
        </div>

        <div class="mt-16 max-w-4xl mx-auto grid sm:grid-cols-2 gap-x-12 gap-y-12">
          <div
            v-for="b in benefits"
            :key="b.title"
            class="flex gap-4"
          >
            <span class="grid place-items-center size-11 shrink-0 rounded-xl bg-amber-500/10 ring-1 ring-amber-500/25">
              <UIcon
                :name="b.icon"
                class="size-5 text-amber-600 dark:text-amber-400"
              />
            </span>
            <div>
              <h3 class="font-display text-lg font-semibold text-highlighted">
                {{ b.title }}
              </h3>
              <p class="mt-1.5 text-sm text-muted leading-relaxed">
                {{ b.desc }}
              </p>
            </div>
          </div>
        </div>
      </UContainer>
    </section>

    <!-- ═══════════════ INSTALL ═══════════════ -->
    <section
      id="how"
      class="relative py-20 sm:py-28 scroll-mt-16"
    >
      <UContainer>
        <div class="max-w-2xl mx-auto text-center">
          <h2 class="font-display text-4xl sm:text-5xl font-bold tracking-tight text-highlighted">
            Live on your site in one copy-paste.
          </h2>
          <p class="mt-4 text-lg text-muted">
            If you can edit your website, you can add Perch. Paste this one line and the
            chat bubble appears — no developer required.
          </p>
        </div>

        <div class="mt-12 max-w-2xl mx-auto">
          <div class="rounded-2xl border-glow bg-elevated/40 glass overflow-hidden">
            <div class="flex items-center gap-2 px-4 py-2.5 border-b border-default bg-elevated/50">
              <span class="size-2.5 rounded-full bg-red-400/80" />
              <span class="size-2.5 rounded-full bg-amber-400/80" />
              <span class="size-2.5 rounded-full bg-green-400/80" />
              <span class="ml-2 text-xs font-mono text-dimmed">your-website.html</span>
              <UButton
                class="ml-auto"
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-copy"
                label="Copy"
                @click="copySnippet"
              />
            </div>
            <pre class="p-5 text-sm font-mono leading-relaxed overflow-x-auto"><code><span class="text-dimmed">&lt;</span><span class="text-highlighted">script</span> <span class="text-highlighted">src</span>=<span class="text-muted">"https://perch.app/widget.js"</span> <span class="text-highlighted">data-site-id</span>=<span class="text-amber-600 dark:text-amber-400">"ws_abc123"</span> <span class="text-highlighted">async</span><span class="text-dimmed">&gt;&lt;/</span><span class="text-highlighted">script</span><span class="text-dimmed">&gt;</span></code></pre>
          </div>
          <p class="mt-5 text-center text-sm text-muted">
            Works on any website — Shopify, WordPress, Webflow, plain HTML.
            Your visitors chat right away; they never need an account.
          </p>
        </div>
      </UContainer>
    </section>

    <!-- ═══════════════ UNDER THE HOOD — the engineering story, contained ═══════════════ -->
    <section class="relative py-16">
      <UContainer>
        <div class="rounded-3xl border-glow bg-elevated/30 glass overflow-hidden">
          <div class="grid lg:grid-cols-2 gap-10 items-center px-8 py-12 sm:px-14">
            <div>
              <p class="font-mono text-sm text-amber-600 dark:text-amber-400">
                under the hood
              </p>
              <h2 class="mt-3 font-display text-3xl sm:text-4xl font-bold tracking-tight text-highlighted">
                Also an open-source engineering build.
              </h2>
              <p class="mt-4 text-muted leading-relaxed">
                For the technically curious: Perch runs on real WebSockets end to end, with
                one typed event contract shared by the widget, the server, and the dashboard.
                Even the “two agents grab the same chat” race is settled by the database
                itself — first one wins, guaranteed, no matter the timing.
              </p>
              <UButton
                to="https://github.com/DevAdedeji/perch"
                target="_blank"
                class="mt-6"
                color="neutral"
                variant="subtle"
                icon="i-simple-icons-github"
              >
                Read the source
              </UButton>
            </div>
            <pre class="rounded-xl bg-default ring-1 ring-default p-5 font-mono text-xs sm:text-[13px] leading-relaxed text-highlighted overflow-x-auto">{{ claimSql }}</pre>
          </div>

          <!-- the stack, tucked where it belongs -->
          <div class="border-t border-default px-8 py-5">
            <div class="relative overflow-hidden mask-[linear-gradient(to_right,transparent,#000_12%,#000_88%,transparent)]">
              <div class="flex w-max gap-14 animate-marquee">
                <span
                  v-for="(s, i) in [...stack, ...stack]"
                  :key="i"
                  class="flex items-center gap-2.5 shrink-0 text-dimmed/80"
                >
                  <UIcon
                    :name="s.icon"
                    class="size-5"
                  />
                  <span class="text-sm font-medium">{{ s.label }}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </UContainer>
    </section>

    <!-- ═══════════════ PRICING — one honest strip ═══════════════ -->
    <section
      id="pricing"
      class="relative py-16 scroll-mt-16"
    >
      <UContainer>
        <div class="rounded-3xl border-glow bg-elevated/30 glass px-8 py-12 sm:px-14 grid lg:grid-cols-[1fr_auto] gap-8 items-center">
          <div>
            <h2 class="font-display text-3xl sm:text-4xl font-bold tracking-tight text-highlighted">
              Free. <span class="text-accent">All of it.</span>
            </h2>
            <p class="mt-3 max-w-xl text-muted leading-relaxed">
              Every feature, unlimited teammates, unlimited conversations. No credit card,
              no trial clock. If that ever changes, this is where the plans would live.
            </p>
          </div>
          <UButton
            to="/signup"
            size="lg"
            color="primary"
            trailing-icon="i-lucide-arrow-right"
            class="font-semibold justify-self-start lg:justify-self-end"
          >
            Create a workspace
          </UButton>
        </div>
      </UContainer>
    </section>

    <!-- ═══════════════ FINAL CTA ═══════════════ -->
    <section class="relative py-16">
      <UContainer>
        <div class="relative overflow-hidden rounded-3xl border-glow bg-elevated/40 glass px-8 py-16 sm:px-16 text-center">
          <div class="pointer-events-none absolute inset-0 -z-10 bg-grid mask-[radial-gradient(ellipse_60%_80%_at_50%_50%,#000,transparent)]" />

          <div class="mx-auto mb-6 grid place-items-center size-16 rounded-2xl bg-amber-500/10 ring-1 ring-amber-500/25">
            <UIcon
              name="i-lucide-bird"
              class="size-8 text-amber-600 dark:text-amber-400"
            />
          </div>
          <h2 class="font-display text-4xl sm:text-5xl font-bold tracking-tight text-highlighted">
            Ready to let your team perch?
          </h2>
          <p class="mt-4 max-w-xl mx-auto text-lg text-muted">
            Create your workspace, paste one line on your site, and watch the first
            conversation land while you’re still on this page.
          </p>
          <div class="mt-8 flex flex-wrap justify-center gap-3">
            <UButton
              to="/signup"
              size="xl"
              color="primary"
              trailing-icon="i-lucide-arrow-right"
              class="font-semibold shadow-lg shadow-amber-500/25"
            >
              Get started free
            </UButton>
            <UButton
              to="https://github.com/DevAdedeji/perch"
              target="_blank"
              size="xl"
              color="neutral"
              variant="subtle"
              icon="i-simple-icons-github"
            >
              Star on GitHub
            </UButton>
          </div>
        </div>
      </UContainer>
    </section>
  </main>
</template>
