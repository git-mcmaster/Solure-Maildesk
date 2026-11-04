# Solure Maildesk implementation plan

Status: approved scope for local implementation; production deployment, DNS, live email sending and tenant changes remain separate release steps. November 2, 2026.

## Outcome and boundaries

Build a private, responsive dashboard for Elijah to create one remotely hosted image per email, send through Outlook, label the image afterward, and review image-load activity. An image request is evidence of a request, not proof that a person read a message. Shared or forwarded messages cannot identify which person loaded their shared image. Image proxies, preloads, blocks and caches limit observations.

Deliver functioning code and local validation before polishing the interface. Keep source in a standalone private GitHub repository when repository access permits. The owner created `git-mcmaster/Solure-Maildesk`; the connector reported it public during this session. The owner deferred making it private, so the source remains local and upload is pending. Do not put this app’s implementation into the existing public website or public repository without explicit direction.

## Architecture and why

| Component | Approach | Reason |
| --- | --- | --- |
| Private dashboard | React and TypeScript, Vite build, Cloudflare Worker with static assets | A small browser interface, explicit types and a straightforward deployment |
| Public image service | Separate Worker at `pixel.soluredigitalworks.com` | Email clients need public image access; public routes must never expose labels or administration |
| Owner access | Cloudflare Access on the whole dashboard Worker, plus verified issuer/audience and exact owner email in the API | Protect API calls and alternate Worker URLs, fail closed on missing configuration |
| Data | Cloudflare D1, versioned SQL migrations and prepared statements | Durable records and transactional changes without managing a database server |
| Alerts | D1 notification outbox and a scheduled dispatcher | Store intent with the event; retry sending failures without relying on a browser being open |
| Email | Native Cloudflare sending binding, exact verified owner destination | Owner-only alerts with no mailbox read permission; sender provisioning is a release prerequisite |
| Source and releases | Private GitHub repository; automated checks; explicit production release | Reviewable changes and no accidental live rollout on every edit |

Production hostnames are proposals, not configured resources. Use a separate development database and local-only login bypass restricted to loopback hosts. Development notifications use a dry-run transport. Keep credentials, local databases and environment files out of Git.

## Functional work

1. **Data and lifecycle.** Create opaque random identifiers with at least 128 bits of entropy. Store optional label, recipient and notes privately. Support draft, armed, paused and archived states. Renaming must preserve earlier events. Deleting a pixel removes its private records; the image endpoint still returns a harmless image for unknown identifiers.
2. **Capture.** Serve a transparent GIF from `/p/<token>.gif`. A GET for a known active record may log activity; HEAD must not log an open. Use no-store response headers and no edge caching for this path. Return the image even when capture fails. This does not override recipient-side proxy caching. Cap event amplification per token per day. Store minimal event metadata rather than message bodies or recipient IP addresses.
3. **Manual send workflow.** New pixel → copy remote-image HTML/image → insert into Outlook → send normally → label and arm alerts. Copying a file or a bare URL is not equivalent to inserting an externally loaded image. Provide an insertion test and an explicit compatibility status; do not label a client supported without checking the received message source and the actual request.
4. **Events and alerts.** Preserve pre-arm loads with an honest label; do not assume they were the sender. Atomically create the first post-arm notification. Default to one alert per message; repeat alerts have a cooldown. A notification receipt means provider acceptance, not confirmed inbox delivery. A send followed by a process failure can produce a duplicate when the provider has no idempotency API; document that boundary.
5. **Management.** Search and filter messages; inspect a chronological activity timeline; rename, pause, archive and delete; show unread notifications and mark them read; export CSV safely against spreadsheet formulas. Add retention settings (30, 90 or 180 days) and an email-alert switch. Retention applies to detailed event history; explain what summary fields remain.
6. **Operational visibility.** Show local-development mode, unavailable email configuration, failures and manual-insertion uncertainty in the relevant workflow. Distinguish no recorded loads, no actual reading, queued alerts and sent alerts. Do not fabricate activity or seed production records.

## Security and reliability requirements

- Validate Access signatures against a configured trusted issuer and audience, then compare the exact owner identity. Never trust an unsigned email header.
- Require same-origin mutation requests; validate inputs and lengths, use prepared statements, escape user content and avoid rendering arbitrary HTML.
- Keep public image handling in a separate entry point with no management routes, labels or export responses.
- Keep owner notification destination fixed in server configuration. Do not let a request turn this into an arbitrary email relay.
- Store notification intent transactionally with capture; claim work safely under concurrent cron runs, retry with bounded backoff and expose failure states.
- Use a restrictive content security policy and no third-party analytics. Keep private API responses out of caches.
- Test absence of auth, incorrect identity, wrong issuer/audience, cross-origin changes, alternate hosts, malformed tokens and event caps.
- Audit dependencies and commit the lockfile. Preserve the existing project’s preference for at least a one-day package release age.

## UX pass after functionality

Use Solure’s established ink, warm ivory and ember palette. Prioritize a clear “New pixel” action and the create → insert → send → label workflow. Provide useful empty, loading, error and offline states; visible focus; labeled controls; keyboard-operable dialogs; mobile layouts; readable dates with exact timestamps available. Never show a misleading “read” count. Keep explanatory detail beside insertion and activity, rather than making the main screen a technical checklist.

## Validation and release gates

1. Type checks, production build and meaningful backend tests using a real local SQLite/D1-compatible database.
2. Verify creation, editing, pre-arm history, concurrent first-load alert deduplication, pause/archive/delete, CSV escaping, input validation and bounded retries.
3. Exercise the actual interface through the browser: empty state, creation, selection, labeling, arming, simulated local request, timeline, notifications and settings. Inspect desktop and narrow layouts.
4. Verify Worker bundles without deploying. Scan tracked files for secrets and unrelated changes.
5. Before production, create owner-controlled Cloudflare resources, protect the private Worker, confirm exact Access issuer/audience, configure hostnames and notification sender, and apply migrations to the intended database with backup/recovery preparation.
6. With user-controlled test mail, prove remote-image preservation in the actual Outlook client and verify end-to-end notification delivery. Outlook on iPhone remains unverified until this passes.
7. Release only after explicit approval. Recheck unauthenticated denial, public GIF access, database persistence and live delivery. No authentication or email-delivery claim is established by a local build alone.

## Primary references

- [Cloudflare React and Vite](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/)
- [Worker-level Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [D1 prepared statements and atomic batches](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Email sending binding](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
- [Sender and recipient restrictions](https://developers.cloudflare.com/email-service/configuration/send-bindings/)
- [Email domain setup and records](https://developers.cloudflare.com/email-service/configuration/domains/)
- [GitHub builds and release behavior](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Outlook picture insertion](https://support.microsoft.com/en-us/accessibility/outlook/use-a-screen-reader-to-insert-a-picture-or-image-in-an-email-in-outlook)
- [Image proxy limitations](https://postmarkapp.com/support/article/1257-open-tracking-and-apple-mail)
