<script setup lang="ts">
useHead({ title: 'Privacy Policy · Perch' })

const updated = 'July 11, 2026'
const contact = 'adedejitewogbade2@gmail.com'
</script>

<template>
  <UContainer class="py-16 sm:py-20">
    <div class="max-w-2xl mx-auto">
      <h1 class="font-display text-3xl font-bold text-highlighted">
        Privacy Policy
      </h1>
      <p class="mt-2 text-sm text-dimmed">
        Last updated {{ updated }}
      </p>

      <div class="mt-10 space-y-10 text-sm leading-relaxed text-muted [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-highlighted [&_p+p]:mt-3 [&_ul]:mt-3 [&_ul]:space-y-1.5 [&_ul]:list-disc [&_ul]:pl-5">
        <section>
          <h2>Who we are</h2>
          <p class="mt-3">
            Perch is a live-chat platform that lets businesses ("workspaces") talk to visitors on
            their own websites. This policy explains what we collect, why, and what happens to it.
            Questions go to <a
              :href="`mailto:${contact}`"
              class="text-amber-600 dark:text-amber-400 hover:underline"
            >{{ contact }}</a>.
          </p>
        </section>

        <section>
          <h2>Two kinds of people use Perch</h2>
          <p class="mt-3">
            <strong class="text-highlighted">Account holders</strong> — agents and admins who sign up
            and run a workspace. For you, we are the data controller.
          </p>
          <p>
            <strong class="text-highlighted">Visitors</strong> — people chatting through a widget on a
            business's website. We process visitor data on that business's behalf; the business
            controls it. If you're a visitor with questions about your data, contact the website you
            were chatting on.
          </p>
        </section>

        <section>
          <h2>What we collect</h2>
          <ul>
            <li><strong class="text-highlighted">Account data</strong> — your name, email address, and a hashed password. Never the password itself.</li>
            <li><strong class="text-highlighted">Chat data</strong> — messages, image attachments, and conversation state, stored so both sides can read the history.</li>
            <li><strong class="text-highlighted">Visitor context</strong> — what the embedding website chooses to share: a name and email typed into the pre-chat form, or a user ID, name, and email passed via <code class="font-mono text-xs">Perch.identify()</code>. We also record the page URL the chat started on.</li>
            <li><strong class="text-highlighted">Technical basics</strong> — IP addresses for rate limiting and abuse prevention, and error reports (via Sentry) when something breaks.</li>
          </ul>
          <p>
            We don't run ads, we don't sell data, and we don't use tracking pixels or analytics
            cookies. The only cookies Perch sets are a session cookie to keep you signed in and a
            preference cookie for your active workspace.
          </p>
        </section>

        <section>
          <h2>Where it lives</h2>
          <p class="mt-3">
            Perch runs on a small set of infrastructure providers, each processing data only to
            provide the service:
          </p>
          <ul>
            <li><strong class="text-highlighted">Neon</strong> — Postgres database (US East)</li>
            <li><strong class="text-highlighted">Railway</strong> — application hosting</li>
            <li><strong class="text-highlighted">Cloudinary</strong> — image attachment storage</li>
            <li><strong class="text-highlighted">Resend</strong> — transactional email (password resets, verification)</li>
            <li><strong class="text-highlighted">Sentry</strong> — error monitoring</li>
          </ul>
        </section>

        <section>
          <h2>How long we keep it</h2>
          <p class="mt-3">
            Chat history is kept for as long as the workspace exists, so businesses can see past
            conversations. Deleting a workspace permanently removes its conversations, messages,
            visitors, and settings. Deleting your account removes your profile and any workspaces
            where you were the only member. Both options are available in the app, and deletion is
            immediate — there is no soft-delete recovery window.
          </p>
        </section>

        <section>
          <h2>Your rights</h2>
          <p class="mt-3">
            You can view and edit your account data in the app, export your conversations by
            request, and delete your workspace or account at any time. If you're in a jurisdiction
            with data-protection laws (GDPR, CCPA, NDPR), the rights those laws give you — access,
            correction, deletion, portability — apply, and the fastest way to exercise them is to
            email us.
          </p>
        </section>

        <section>
          <h2>Changes</h2>
          <p class="mt-3">
            If this policy changes in a way that matters, we'll note the new date at the top and,
            for significant changes, email account holders. Continued use after a change means you
            accept the updated policy.
          </p>
        </section>
      </div>
    </div>
  </UContainer>
</template>
