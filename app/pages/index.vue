<script setup lang="ts">
const pillars = [
  {
    icon: 'i-lucide-mouse-pointer-click',
    title: 'Embed in one script tag',
    desc: 'Paste a single line, and a sandboxed widget lands on any site. From “copy” to first message in under two minutes — no build step, no framework shipped to the host page.',
    tag: 'data-site-id="ws_abc123"'
  },
  {
    icon: 'i-lucide-layout-dashboard',
    title: 'The Control Room',
    desc: 'A multi-agent command center where your team lives. See every conversation, claim or get auto-assigned, transfer mid-thread, and reply — all updating live for the whole team.',
    tag: 'where support teams perch'
  },
  {
    icon: 'i-lucide-radio',
    title: 'Real-time, not polling',
    desc: 'Typing indicators, instant delivery, live presence — over real WebSockets. If it feels laggy, we failed. Perch is built so it never does.',
    tag: 'sub-50ms round trips'
  }
]

const features = [
  { icon: 'i-lucide-split', title: 'Atomic claim race', desc: 'Two agents, one chat — first claim wins with a conditional write. The loser gets a clean conflict, never a double-owned thread.' },
  { icon: 'i-lucide-users', title: 'Live presence', desc: 'Online, away, offline — tracked over the socket with heartbeats and broadcast to the whole workspace in seconds.' },
  { icon: 'i-lucide-shield-check', title: 'Scoped multi-tenancy', desc: 'Every workspace is isolated by site_id. Visitor tokens are scoped to a single conversation and nothing else.' },
  { icon: 'i-lucide-sticky-note', title: 'Internal notes', desc: 'Agent-only comments filtered server-side — the visitor pipeline can never receive them.' },
  { icon: 'i-lucide-zap', title: 'Canned responses', desc: 'Insert saved replies with a shortcut like /hello and keep the conversation moving.' },
  { icon: 'i-lucide-image', title: 'Signed uploads', desc: 'Direct-to-Cloudinary image attachments with server-signed params — the secret never touches the client.' }
]

const steps = [
  { n: '01', icon: 'i-lucide-user-plus', title: 'Create your workspace', desc: 'Sign up, name your business, and get a unique site_id that scopes everything.' },
  { n: '02', icon: 'i-lucide-code', title: 'Paste the snippet', desc: 'Drop one <script> tag on your site. The widget injects itself in an isolated iframe.' },
  { n: '03', icon: 'i-lucide-message-circle', title: 'Start talking', desc: 'A visitor says hi, your Control Room lights up, and an agent replies — instantly.' }
]

const stats = [
  { value: '<50ms', label: 'Message round-trip' },
  { value: '<2min', label: 'To first message' },
  { value: '100%', label: 'Real WebSockets' },
  { value: '0', label: 'Double-owned chats' }
]

const brands = [
  'i-simple-icons-vercel', 'i-simple-icons-linear', 'i-simple-icons-notion',
  'i-simple-icons-figma', 'i-simple-icons-slack', 'i-simple-icons-framer',
  'i-simple-icons-stripe', 'i-simple-icons-github'
]

const plans = [
  {
    name: 'Solo',
    price: '$0',
    period: '/mo',
    desc: 'For a single seat kicking the tires.',
    features: ['1 agent seat', '1 workspace', 'Real-time widget', 'Community support'],
    cta: 'Start free',
    featured: false
  },
  {
    name: 'Team',
    price: '$0',
    period: '/mo',
    desc: 'The full Control Room. Free while in portfolio mode.',
    features: ['Unlimited agents', 'Auto-assignment', 'Internal notes & canned replies', 'Presence & workload', 'Image attachments'],
    cta: 'Get started',
    featured: true
  },
  {
    name: 'Scale',
    price: 'Custom',
    period: '',
    desc: 'Redis pub/sub fan-out & horizontal scale.',
    features: ['Everything in Team', 'Multi-instance real-time', 'Priority routing', 'SSO & audit log'],
    cta: 'Talk to us',
    featured: false
  }
]
</script>

<template>
  <main class="relative">
    <!-- ═══════════════ HERO ═══════════════ -->
    <section class="relative pt-36 pb-20 sm:pt-44 sm:pb-28 overflow-hidden">
      <!-- backdrop -->
      <div class="pointer-events-none absolute inset-0 -z-10">
        <div class="absolute inset-0 bg-grid [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,#000_40%,transparent_100%)]" />
        <div class="absolute top-[-10%] left-1/2 -translate-x-1/2 size-[560px] rounded-full bg-amber-400/25 blur-[120px]" />
        <div class="absolute top-[10%] right-[8%] size-[380px] rounded-full bg-orange-500/12 blur-[120px]" />
        <div class="absolute top-[20%] left-[6%] size-[320px] rounded-full bg-amber-500/15 blur-[110px]" />
      </div>

      <UContainer>
        <div class="grid lg:grid-cols-[1.05fr_0.95fr] gap-14 lg:gap-10 items-center">
          <!-- copy -->
          <div>
            <div class="inline-flex items-center gap-2 rounded-full glass ring-1 ring-default pl-1.5 pr-3 py-1.5 text-xs">
              <span class="rounded-full bg-amber-400/15 px-2 py-0.5 font-medium text-amber-400">New</span>
              <span class="text-muted">Real-time support, owned end to end</span>
              <UIcon
                name="i-lucide-arrow-right"
                class="size-3.5 text-dimmed"
              />
            </div>

            <h1 class="mt-6 font-display text-5xl sm:text-6xl lg:text-[4.25rem] font-bold leading-[1.02] tracking-tight text-highlighted">
              Your team, perched on
              <span class="text-gradient">every conversation.</span>
            </h1>

            <p class="mt-6 max-w-xl text-lg text-muted leading-relaxed">
              Perch is a live-chat platform built on real WebSockets. Drop in one script tag,
              and agents watch the inbox, claim chats, and reply the instant a visitor lands —
              no refresh, no lag.
            </p>

            <div class="mt-8 flex flex-wrap items-center gap-3">
              <UButton
                to="/signup"
                size="xl"
                color="primary"
                trailing-icon="i-lucide-arrow-right"
                class="font-semibold shadow-lg shadow-amber-500/20"
              >
                Get started free
              </UButton>
              <UButton
                to="#control-room"
                size="xl"
                color="neutral"
                variant="subtle"
                icon="i-lucide-play"
              >
                See the Control Room
              </UButton>
            </div>

            <div class="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
              <span class="flex items-center gap-1.5"><UIcon
                name="i-lucide-check"
                class="size-4 text-amber-400"
              /> No credit card</span>
              <span class="flex items-center gap-1.5"><UIcon
                name="i-lucide-check"
                class="size-4 text-amber-400"
              /> One script tag</span>
              <span class="flex items-center gap-1.5"><UIcon
                name="i-lucide-check"
                class="size-4 text-amber-400"
              /> Under 2 minutes to live</span>
            </div>
          </div>

          <!-- visual -->
          <div
            class="relative"
          >
            <div class="absolute inset-0 -z-10 blur-2xl bg-amber-400/10 rounded-full" />
            <HeroChat />
          </div>
        </div>

        <!-- brand marquee -->
        <div class="mt-20">
          <p class="text-center text-xs uppercase tracking-[0.2em] text-dimmed">
            Built for teams who live in the inbox
          </p>
          <div class="relative mt-6 overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_12%,#000_88%,transparent)]">
            <div class="flex w-max gap-16 animate-marquee">
              <UIcon
                v-for="(b, i) in [...brands, ...brands]"
                :key="i"
                :name="b"
                class="size-8 text-dimmed/70 hover:text-muted transition-colors shrink-0"
              />
            </div>
          </div>
        </div>
      </UContainer>
    </section>

    <!-- ═══════════════ PILLARS ═══════════════ -->
    <section
      id="features"
      class="relative py-20 sm:py-28"
    >
      <UContainer>
        <div
          class="max-w-2xl"
        >
          <p class="flex items-center gap-2 text-sm font-medium text-amber-400">
            <span class="h-px w-8 bg-amber-400" /> Three pillars
          </p>
          <h2 class="mt-4 font-display text-4xl sm:text-5xl font-bold tracking-tight text-highlighted">
            Depth where it counts.
          </h2>
          <p class="mt-4 text-lg text-muted">
            Not another chat box. Perch goes deep on the parts support teams actually feel.
          </p>
        </div>

        <div class="mt-14 grid md:grid-cols-3 gap-5">
          <div
            v-for="p in pillars"
            :key="p.title"
            class="group relative rounded-2xl border-glow bg-elevated/30 glass p-7 transition-transform duration-300 hover:-translate-y-1"
          >
            <div class="grid place-items-center size-12 rounded-xl bg-amber-400/10 ring-1 ring-amber-400/20">
              <UIcon
                :name="p.icon"
                class="size-6 text-amber-400"
              />
            </div>
            <h3 class="mt-5 font-display text-xl font-semibold text-highlighted">
              {{ p.title }}
            </h3>
            <p class="mt-2.5 text-sm text-muted leading-relaxed">
              {{ p.desc }}
            </p>
            <p class="mt-5 inline-block rounded-lg bg-default/70 ring-1 ring-default px-2.5 py-1 font-mono text-xs text-amber-400">
              {{ p.tag }}
            </p>
          </div>
        </div>

        <!-- supporting feature bento -->
        <div class="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <div
            v-for="f in features"
            :key="f.title"
            class="group relative rounded-2xl bg-elevated/20 ring-1 ring-default p-6 hover:ring-amber-400/30 transition-colors"
          >
            <div class="flex items-center gap-3">
              <UIcon
                :name="f.icon"
                class="size-5 text-amber-400"
              />
              <h3 class="font-medium text-highlighted">
                {{ f.title }}
              </h3>
            </div>
            <p class="mt-3 text-sm text-muted leading-relaxed">
              {{ f.desc }}
            </p>
          </div>
        </div>
      </UContainer>
    </section>

    <!-- ═══════════════ CONTROL ROOM ═══════════════ -->
    <section
      id="control-room"
      class="relative py-20 sm:py-28 overflow-hidden"
    >
      <div class="pointer-events-none absolute inset-0 -z-10">
        <div class="absolute bottom-0 left-1/2 -translate-x-1/2 size-[600px] rounded-full bg-amber-400/10 blur-[130px]" />
      </div>
      <UContainer>
        <!-- header + feature bullets -->
        <div class="grid lg:grid-cols-[1fr_1.1fr] gap-10 lg:gap-16 items-end">
          <div>
            <p class="flex items-center gap-2 text-sm font-medium text-amber-400">
              <span class="h-px w-8 bg-amber-400" /> The Control Room
            </p>
            <h2 class="mt-4 font-display text-4xl sm:text-5xl font-bold tracking-tight text-highlighted">
              Where your team perches.
            </h2>
            <p class="mt-5 text-lg text-muted leading-relaxed">
              One live command center for the whole team. Conversations stream in, presence
              updates in real time, and assignment just works — manual claim or round-robin
              across whoever's online.
            </p>
          </div>

          <ul
            class="grid sm:grid-cols-3 gap-5"
          >
            <li
              v-for="item in [
                { icon: 'i-lucide-inbox', t: 'Unified inbox', d: 'Filter by unassigned, open, or resolved — with per-agent unread state.' },
                { icon: 'i-lucide-hand', t: 'Claim or auto-assign', d: 'First claim wins atomically; round-robin across online agents.' },
                { icon: 'i-lucide-arrow-left-right', t: 'Transfer mid-thread', d: 'Hand a conversation to the right teammate without losing context.' }
              ]"
              :key="item.t"
              class="rounded-xl bg-elevated/20 ring-1 ring-default p-4"
            >
              <span class="grid place-items-center size-9 rounded-lg bg-amber-400/10 ring-1 ring-amber-400/20">
                <UIcon
                  :name="item.icon"
                  class="size-5 text-amber-400"
                />
              </span>
              <p class="mt-3 font-medium text-sm text-highlighted">
                {{ item.t }}
              </p>
              <p class="mt-1 text-xs text-muted leading-relaxed">
                {{ item.d }}
              </p>
            </li>
          </ul>
        </div>

        <!-- full-width product shot -->
        <div
          class="mt-12"
        >
          <ControlRoomMock />
        </div>
      </UContainer>
    </section>

    <!-- ═══════════════ STATS ═══════════════ -->
    <section class="relative py-16">
      <UContainer>
        <div
          class="rounded-3xl border-glow bg-elevated/30 glass overflow-hidden"
        >
          <div class="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-default">
            <div
              v-for="s in stats"
              :key="s.label"
              class="p-8 text-center"
            >
              <p class="font-display text-4xl sm:text-5xl font-bold text-gradient">
                {{ s.value }}
              </p>
              <p class="mt-2 text-sm text-muted">
                {{ s.label }}
              </p>
            </div>
          </div>
        </div>
      </UContainer>
    </section>

    <!-- ═══════════════ HOW IT WORKS ═══════════════ -->
    <section
      id="how"
      class="relative py-20 sm:py-28"
    >
      <UContainer>
        <div
          class="text-center max-w-2xl mx-auto"
        >
          <p class="flex items-center justify-center gap-2 text-sm font-medium text-amber-400">
            <span class="h-px w-8 bg-amber-400" /> How it works <span class="h-px w-8 bg-amber-400" />
          </p>
          <h2 class="mt-4 font-display text-4xl sm:text-5xl font-bold tracking-tight text-highlighted">
            Live in three steps.
          </h2>
        </div>

        <div class="relative mt-16 grid md:grid-cols-3 gap-6">
          <!-- connecting line -->
          <div class="hidden md:block absolute top-9 left-[16%] right-[16%] h-px bg-linear-to-r from-transparent via-amber-400/40 to-transparent" />
          <div
            v-for="(s, i) in steps"
            :key="s.n"
            class="relative text-center"
          >
            <div class="relative mx-auto grid place-items-center size-18 rounded-2xl border-glow bg-elevated/50 glass">
              <UIcon
                :name="s.icon"
                class="size-7 text-amber-400"
              />
              <span class="absolute -top-2 -right-2 grid place-items-center size-6 rounded-full bg-amber-500 text-[11px] font-bold text-white font-mono">{{ i + 1 }}</span>
            </div>
            <h3 class="mt-5 font-display text-lg font-semibold text-highlighted">
              {{ s.title }}
            </h3>
            <p class="mt-2 text-sm text-muted max-w-xs mx-auto">
              {{ s.desc }}
            </p>
          </div>
        </div>

        <!-- code snippet -->
        <div
          class="mt-14 max-w-2xl mx-auto"
        >
          <div class="rounded-2xl border-glow bg-elevated/40 glass overflow-hidden">
            <div class="flex items-center gap-2 px-4 py-2.5 border-b border-default bg-elevated/50">
              <UIcon
                name="i-lucide-code"
                class="size-4 text-dimmed"
              />
              <span class="text-xs font-mono text-dimmed">index.html</span>
              <UButton
                class="ml-auto"
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-copy"
                label="Copy"
              />
            </div>
            <pre class="p-5 text-sm font-mono leading-relaxed overflow-x-auto"><code><span class="text-dimmed">&lt;</span><span class="text-amber-400">script</span> <span class="text-orange-300">src</span>=<span class="text-muted">"https://perch.app/widget.js"</span> <span class="text-orange-300">data-site-id</span>=<span class="text-muted">"ws_abc123"</span> <span class="text-orange-300">async</span><span class="text-dimmed">&gt;&lt;/</span><span class="text-amber-400">script</span><span class="text-dimmed">&gt;</span></code></pre>
          </div>
        </div>
      </UContainer>
    </section>

    <!-- ═══════════════ PRICING ═══════════════ -->
    <section
      id="pricing"
      class="relative py-20 sm:py-28 overflow-hidden"
    >
      <div class="pointer-events-none absolute inset-0 -z-10">
        <div class="absolute top-1/4 left-1/2 -translate-x-1/2 size-[500px] rounded-full bg-amber-400/12 blur-[130px]" />
      </div>
      <UContainer>
        <div
          class="text-center max-w-2xl mx-auto"
        >
          <h2 class="font-display text-4xl sm:text-5xl font-bold tracking-tight text-highlighted">
            Simple, honest pricing.
          </h2>
          <p class="mt-4 text-lg text-muted">
            A portfolio build — so everything's free. The plans show where it would go.
          </p>
        </div>

        <div class="mt-14 grid lg:grid-cols-3 gap-5 items-start">
          <div
            v-for="plan in plans"
            :key="plan.name"
            class="relative rounded-2xl p-7 transition-transform duration-300 hover:-translate-y-1"
            :class="plan.featured
              ? 'border-glow bg-elevated/50 glass shadow-2xl shadow-amber-500/10 lg:-mt-4 lg:mb-4'
              : 'ring-1 ring-default bg-elevated/20'"
          >
            <span
              v-if="plan.featured"
              class="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white shadow-lg shadow-amber-500/30"
            >Most popular</span>

            <p class="font-display text-lg font-semibold text-highlighted">
              {{ plan.name }}
            </p>
            <p class="mt-1 text-sm text-muted">
              {{ plan.desc }}
            </p>
            <p class="mt-5 flex items-end gap-1">
              <span class="font-display text-4xl font-bold text-highlighted">{{ plan.price }}</span>
              <span class="mb-1 text-sm text-dimmed">{{ plan.period }}</span>
            </p>

            <UButton
              :color="plan.featured ? 'primary' : 'neutral'"
              :variant="plan.featured ? 'solid' : 'subtle'"
              block
              size="lg"
              class="mt-6 font-medium"
              :trailing-icon="plan.featured ? 'i-lucide-arrow-right' : undefined"
            >
              {{ plan.cta }}
            </UButton>

            <ul class="mt-7 space-y-3">
              <li
                v-for="feat in plan.features"
                :key="feat"
                class="flex items-start gap-2.5 text-sm"
              >
                <UIcon
                  name="i-lucide-check"
                  class="mt-0.5 size-4 shrink-0 text-amber-400"
                />
                <span class="text-muted">{{ feat }}</span>
              </li>
            </ul>
          </div>
        </div>
      </UContainer>
    </section>

    <!-- ═══════════════ FINAL CTA ═══════════════ -->
    <section class="relative py-16">
      <UContainer>
        <div
          class="relative overflow-hidden rounded-3xl border-glow bg-elevated/40 glass px-8 py-16 sm:px-16 text-center"
        >
          <div class="pointer-events-none absolute inset-0 -z-10">
            <div class="absolute inset-0 bg-grid [mask-image:radial-gradient(ellipse_60%_80%_at_50%_50%,#000,transparent)]" />
            <div class="absolute top-0 left-1/2 -translate-x-1/2 size-[400px] rounded-full bg-amber-400/20 blur-[100px]" />
          </div>

          <div class="mx-auto mb-6 grid place-items-center size-16 rounded-2xl bg-amber-400/10 ring-1 ring-amber-400/20">
            <UIcon
              name="i-lucide-bird"
              class="size-8 text-amber-400"
            />
          </div>
          <h2 class="font-display text-4xl sm:text-5xl font-bold tracking-tight text-highlighted">
            Ready to let your team perch?
          </h2>
          <p class="mt-4 max-w-xl mx-auto text-lg text-muted">
            Spin up a workspace, grab your script tag, and watch the first conversation land in real time.
          </p>
          <div class="mt-8 flex flex-wrap justify-center gap-3">
            <UButton
              to="/signup"
              size="xl"
              color="primary"
              trailing-icon="i-lucide-arrow-right"
              class="font-semibold shadow-lg shadow-amber-500/20"
            >
              Get started free
            </UButton>
            <UButton
              to="#control-room"
              size="xl"
              color="neutral"
              variant="subtle"
              icon="i-lucide-book-open"
            >
              Read the docs
            </UButton>
          </div>
        </div>
      </UContainer>
    </section>
  </main>
</template>
