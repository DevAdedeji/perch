<script setup lang="ts">
useHead({ title: 'Terms of Service · Perch' })

const updated = 'July 11, 2026'
const contact = 'adedejitewogbade2@gmail.com'
</script>

<template>
  <UContainer class="py-16 sm:py-20">
    <div class="max-w-2xl mx-auto">
      <h1 class="font-display text-3xl font-bold text-highlighted">
        Terms of Service
      </h1>
      <p class="mt-2 text-sm text-dimmed">
        Last updated {{ updated }}
      </p>

      <div class="mt-10 space-y-10 text-sm leading-relaxed text-muted [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-highlighted [&_p+p]:mt-3 [&_ul]:mt-3 [&_ul]:space-y-1.5 [&_ul]:list-disc [&_ul]:pl-5">
        <section>
          <h2>The service</h2>
          <p class="mt-3">
            Perch provides live-chat software: a dashboard for support teams and an embeddable
            widget for their websites. By creating an account you agree to these terms. If you're
            accepting on behalf of a company, you confirm you have the authority to do so.
          </p>
        </section>

        <section>
          <h2>Your account</h2>
          <p class="mt-3">
            You're responsible for what happens under your account — keep your password private and
            your email address current. You must be at least 16 to use Perch. One person per
            account; teammates get their own via workspace invites.
          </p>
        </section>

        <section>
          <h2>Your content</h2>
          <p class="mt-3">
            Conversations, attachments, and workspace settings belong to you (or to the visitors who
            wrote them). We claim no ownership — you grant us only the license needed to store,
            transmit, and display that content so the service works. You're responsible for having
            the right to share whatever you or your visitors upload.
          </p>
        </section>

        <section>
          <h2>Acceptable use</h2>
          <p class="mt-3">
            Don't use Perch to:
          </p>
          <ul>
            <li>send spam or unsolicited messages,</li>
            <li>harass, defraud, or impersonate anyone,</li>
            <li>distribute malware or illegal content,</li>
            <li>probe, overload, or disrupt the service or other workspaces,</li>
            <li>collect visitor data in ways your own privacy policy doesn't allow.</li>
          </ul>
          <p>
            If you embed the widget on your site, it's your job to tell your visitors that chats are
            handled by Perch, consistent with the laws that apply to you.
          </p>
        </section>

        <section>
          <h2>Availability & support</h2>
          <p class="mt-3">
            Perch is an early-stage product offered as-is. We work hard to keep it fast and
            available, but we don't yet offer an SLA — outages, maintenance windows, and breaking
            changes can happen. Support is by email at
            <a
              :href="`mailto:${contact}`"
              class="text-amber-600 dark:text-amber-400 hover:underline"
            >{{ contact }}</a>.
          </p>
        </section>

        <section>
          <h2>Termination</h2>
          <p class="mt-3">
            You can delete your workspace or account at any time from the app — deletion is
            immediate and permanent. We may suspend or terminate accounts that violate these terms,
            with notice where practical.
          </p>
        </section>

        <section>
          <h2>Liability</h2>
          <p class="mt-3">
            To the maximum extent the law allows, Perch is provided without warranties of any kind,
            and our total liability for any claim is limited to the amount you paid us in the twelve
            months before the claim (currently: nothing, as the service is free). We're not liable
            for indirect damages, lost profits, or lost data beyond what's in our control.
          </p>
        </section>

        <section>
          <h2>Changes</h2>
          <p class="mt-3">
            We may update these terms as the product evolves. Significant changes will be announced
            by email or in the app; the date above always reflects the current version. Using Perch
            after a change means you accept it.
          </p>
        </section>
      </div>
    </div>
  </UContainer>
</template>
