<script setup lang="ts">
useSeoMeta({
  title: 'Privacy Policy · Perch',
  description: 'How Perch collects, uses and protects account, workspace and live-chat data.'
})

const updated = 'September 2, 2026'
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
              class="text-primary-600 dark:text-primary-400 hover:underline"
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
            <li><strong class="text-highlighted">Visitor context</strong> — what the embedding website chooses to share: a name and email typed into the pre-chat form, or a user ID, name, and email passed via <code class="font-mono text-xs">Perch.identify()</code>. We also record the page URL the chat started on and coarse labels such as browser, operating system, and device type. We do not retain the browser's full user-agent string. Workspace teammates may add private support context such as company, role, notes, and tags; those details are not shown in the visitor widget.</li>
            <li><strong class="text-highlighted">Visitor email preferences</strong> — whether a visitor explicitly asked for reply notifications, when they consented, whether a public reply was already read, and a secret-keyed one-way hash used to remember unsubscribe, bounce, or complaint suppression without placing the address in the suppression list.</li>
            <li><strong class="text-highlighted">Technical basics</strong> — IP addresses used briefly in memory for rate limiting and abuse prevention, a sign-in IP kept temporarily so you can recognize account sessions, and privacy-filtered error reports (via Sentry) when something breaks.</li>
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
            <li><strong class="text-highlighted">Resend</strong> — transactional email (password resets and verification, plus visitor chat-reply notifications only after the visitor explicitly opts in)</li>
            <li><strong class="text-highlighted">Bachs</strong> — subscription checkout and payment processing</li>
            <li><strong class="text-highlighted">Sentry</strong> — error monitoring</li>
          </ul>
        </section>

        <section>
          <h2>Visitor reply emails</h2>
          <p class="mt-3">
            Entering an email for support does not by itself subscribe a visitor to reply emails.
            A visitor must explicitly opt in from the chat. Notifications are deliberately generic:
            they say that the workspace replied but do not include message text, page URLs, internal
            notes, or customer-profile details. The private return link is signed, expires, can be
            exchanged only once, and opens only the conversation that produced it.
          </p>
          <p>
            A visitor can turn reply emails off in the widget or use the unsubscribe link in an
            email. Perch keeps that suppression for the email and workspace so another pending
            notification is not sent. Delivery also stops after a provider bounce or complaint.
          </p>
        </section>

        <section>
          <h2>How long we keep it</h2>
          <p class="mt-3">
            Chat history is kept for as long as the workspace exists, so businesses can see past
            conversations. Deleting a workspace permanently removes its conversations, messages,
            visitors, and settings. Deleting your account removes your profile and any workspaces
            where you were the only member. Both options are available in the app, and deletion from
            the live service is immediate — there is no in-app soft-delete recovery window.
          </p>
          <p>
            Private disaster-recovery backups may retain a deleted record for up to 14 days before
            automatic rotation. Backups are access-restricted, are not used to keep serving deleted
            data, and are restored only when recovering the service from a serious data-loss event.
            If a backup is restored, separately retained deletion receipts are reconciled before
            normal access resumes so requests made after that archive remain effective.
          </p>
          <p>
            Account sessions expire after 90 days without activity. The IP captured at sign-in is
            removed after 30 days even when the session remains active. Browser information is
            reduced to coarse browser, operating-system, and device labels before it is stored.
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
