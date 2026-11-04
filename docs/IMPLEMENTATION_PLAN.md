# Solure Maildesk implementation plan

## Outreach opt-out — November 4, 2026

The owner approved a professional “Stop outreach emails” footer and explicitly required that random visitors cannot opt out by merely loading a page. Keep a public, script-free confirmation form on the existing image Worker, with separate 256-bit bearer tokens bound immutably to a normalized saved recipient. GET and HEAD are read-only; an explicit same-origin, bounded form POST records the preference. No public email input, sign-in requirement, recipient display, request-detail capture or automatic submission is provided. A forwarded bearer link can confirm the original recipient; do not present it as identity verification.

Add independent link and do-not-contact tables in migration `0007_outreach_opt_out.sql`, without a cascading pixel foreign key. Preserve every original table/row, the permanent-history and 89-day report guards, and existing image behavior. Retain links and suppression entries even after a pixel’s recipient changes or the pixel is cleared/deleted. The owner API creates a link only for a valid current recipient, refuses suppressed recipients, and checks concurrent edits. Expose matching suppression flags and a private, paged/searchable manual-entry list for reply-based requests. Block new tracking starts for suppressed addresses and prevent copying from a stale or blocked recipient in the interface.

The signature footer is optional, explicitly created for a saved recipient, readable without images, and present in rich HTML and plain-text fallback. Copying remains separate from tracking activation. Clearly state that manual messages in Outlook are outside Maildesk’s control and that reply-based opt-outs must be recorded by the owner. No arbitrary email sender, external list service, dependency upgrade, paid plan, DNS or access change is required.

Rehearse the additive migration against a private production export and compare original rows/columns before release. Check public GET/HEAD/preview no-write behavior, explicit POST, invalid tokens/methods/origins, repeated confirmation, edit/delete survival, duplicate/manual suppression, exact-owner private APIs, current tracking/retention/report regressions, and responsive rendered controls. The live policy and source check must support any owner-only claim. Recovery retains the new tables, old sent links and suppression checks; older code that ignores opt-outs is not a suitable routine rollback. A database restore replaces newer data and requires separate approval.

Status: implemented, published and deployed after the owner explicitly approved the live database update. The 114-test suite, TypeScript, client build, both bundles, populated-data rehearsal and rendered desktop/narrow-screen review passed. Implementation `5a301bffc6a37e3325c9eb5a4817a242091fec2a` passed [CI run 41881316392](https://github.com/git-mcmaster/Solure-Maildesk/actions/runs/41881316392). Remote migration `0007`, both deployments and live confirmation/no-write/immutable-binding checks passed; all original database rows were preserved. Actual Outlook/iPhone footer insertion remains unverified. See VERIFICATION.md for evidence and limits.

Status: approved scope for local implementation; production deployment, DNS, live email sending and tenant changes remain separate release steps. November 2, 2026.

## Tracking and notification activation correction — November 4, 2026

The owner reported that inactive pixels kept recording and that priming email alerts required too many steps. Confirmed causes were the public collector excluding only archived pixels, a separate global email preference left off by activation, and lifetime notification eligibility being consumed even when mail was disabled. This correction is published, migrated and deployed. The 91-test suite, TypeScript, build, Worker bundles, CI, private populated-data rehearsal and controlled live inactive/start/stop/notification checks passed. The live image-load email was accepted on its first scheduled attempt; owner Inbox confirmation remains pending.

Define inactive draft/paused/archived records as no new event capture, quota consumption or notification creation. Continue serving their harmless image so stopping tracking does not break an already-sent signature. Existing activity remains historical; earlier pre-activation events are explicitly labeled as the earlier behavior. Active capture, both PNG and GIF, uses the same atomic status gate and limits.

Provide a prominent “Start tracking & email me” action that saves current details, validates the sender, activates tracking and resumes the existing workspace email switch atomically. Disclose that resuming this master switch also resumes future alerts for other active messages. “Stop tracking” stops new recording and unaccepted queued alerts; it cannot recall a provider call already begun. A first new load after each explicit restart may notify again, with optional repeats no more than once per rolling hour. Do not replay old loads. Copying never activates tracking.

Use an additive migration for activation identity and durable notification eligibility. Preserve loaded history, saved reports, preferences and first-ever markers; clearing history must not re-enable the same activation’s first alert or reset its cooldown. Save-details requests must preserve lifecycle changes made concurrently. Rehearse migration on disposable data and take a private production export before rollout. Recovery uses corrected code retaining activation guards; restoring a database would replace newer data and requires separate approval. No DNS, access, paid-plan or sender changes are required.

## Tracked-logo signature extension — November 4, 2026

The owner approved improving and implementing the signature workflow. A message-specific Solure logo replaces the separate hidden pixel when “Logo signature” is selected, giving the image a useful visible purpose while keeping name and contact details readable as text. The original invisible pixel remains an alternative. This extension is published and deployed, with the 79-test suite, TypeScript, builds, CI and controlled live preview/clipboard/capture checks passing. Production preview integration exposed a CSP omission, corrected with an exact untracked-asset allowance and regression test. Actual Outlook on iPhone insertion and received MIME remain unverified.

Reuse the approved 192 × 200 PNG at a 48 × 50 display size. Serve it through `/p/<token>/logo.png` using the existing capture path, metadata preference, request caps and alert rules. Retain legacy `/p/<token>.gif` URLs. Serve dashboard previews from the separate untracked `/brand/solure-logo-v1.png` endpoint; previewing or copying must not create activity. HEAD requests do not record activity, and tracked-logo responses do not reveal whether the token exists or capture succeeded.

Offer rich `text/html` and clean `text/plain` clipboard content, plus explicit HTML-source and text-only options. Generated signature HTML contains exactly one tracked image, escaped contact text and direct contact links. Explain that each email needs a fresh signature, a global reusable Outlook signature combines history, text-only copying does not track and raw HTML requires an HTML-aware insertion method. Do not claim the logo bypasses image blocking, identifies a reader or improves deliverability.

No dependency, database schema, retention/report behavior, DNS, access policy, sender setup or paid service changes are required. Deploy the public image endpoint before or together with the dashboard, then verify the new public routes and retained GIF route. A user-controlled Outlook/browser and iPhone test must inspect the received message’s external image URL and resulting request before either insertion method is marked supported.

## 89-day report extension — November 4, 2026

The owner requested a report for every pixel at 89 elapsed days from creation, sent to `elijah@soluredigitalworks.com`. The extension is published, migrated and deployed. All 62 backend/metadata tests, TypeScript, the build and bundles passed. The sender configuration subsequently passed complete CI and a controlled scheduled report reached the owner’s Inbox. A real elapsed 89-day boundary remains unobserved. The dated original plan below remains context; this extension adds a mandatory report independent of the optional image-load email-alert preference.

Use a dedicated D1 snapshot/outbox table with one unique source-pixel key, immutable text, leased claims and bounded retries. Migration `0005` adds nullable per-pixel queue/acceptance markers and indexes so already-queued pixels and overdue-but-undelivered cleanup candidates do not cause repeated full scans. The minute scheduler queues at most 100 due reports, dispatches at most five, performs accepted-report-gated cleanup, then dispatches at most five ordinary load alerts. The measured busy path uses 40 D1 calls. Scheduling/backlogs can delay processing beyond the exact due instant.

Include every lifecycle state and both loaded/never-loaded pixels. Snapshot only the label, optional recipient, creation/status, current counts, first/latest timestamps, early-load count, unused-pixel threshold and private activity link. Omit notes, raw IPs, User-Agents and public tracking tokens. Clearly distinguish recorded image requests from human reads and current saved history from previously cleared activity. Owner-only report history provides pagination, per-pixel report lookup, delivery state and failed-report retry.

Preserve permanent loaded history and both never-loaded keep controls. Automatic deletion of an unprotected never-loaded pixel now additionally requires provider acceptance of its report; absent configuration, failures and dry runs hold the pixel past 90 days. Automatic cleanup retains the report snapshot with a nullable pixel link. Explicit pixel deletion atomically removes the linked snapshot; a separate authenticated orphan-report DELETE allows removal after automatic cleanup. Deletion cannot recall accepted or in-flight email.

Provider acceptance is not inbox proof. Unique snapshots and leases prevent normal concurrent duplication, but a crash after acceptance can cause a retry duplicate; no undocumented sending parameter is assumed. Five failed attempts require an owner retry after correcting configuration. Sending stays fixed to the owner and does not expose an arbitrary relay.

Before release, export the production database privately and rehearse the additive `0005` migration on a disposable copy, then verify counts/settings. Suspend an older cron first if overdue unused pixels could be deleted during rollout. Deploy corrected code retaining permanent history **and** report-before-delete guards; older cleanup code is not an acceptable rollback. Restoring a database replaces newer data and needs separate approval. Snapshots accumulate against existing free quotas; no paid upgrade is authorized.

The production `EMAIL` binding is restricted to the verified owner address and uses `reports@notifications.soluredigitalworks.com`. The approved Routing subdomain setup worked with existing free services; no paid upgrade was accepted. It added four notifications-subdomain records plus Cloudflare’s managed root-level Routing DKIM selector, while preserving every pre-existing DNS record. The temporary setup key was revoked and its local copy removed. A single clearly labeled synthetic report exercised the ordinary scheduled dispatcher and the owner confirmed Inbox arrival; its authentication headers were not inspected. Keep publication, CI, production dispatch and that specific inbox receipt distinct in [VERIFICATION.md](VERIFICATION.md).

## Original November 2 plan — historical context

The following original plan preserves the proposed architecture and pre-release status at that date. Current source, hosting and sender outcomes are recorded in the November 4 extension above and the release record.

### Outcome and boundaries

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
2. **Capture.** Serve a transparent GIF from `/p/<token>.gif`. A GET for a known active record may log activity; HEAD must not log an open. Use no-store response headers and no edge caching for this path. Return the image even when capture fails. This does not override recipient-side proxy caching. Cap event amplification per token per day. Store timestamps by default. The November 4 owner-requested extension adds optional connection metadata behind an off-by-default setting; it does not identify a reader or collect GPS coordinates or message bodies.
3. **Manual send workflow.** New pixel → copy remote-image HTML/image → insert into Outlook → send normally → label and arm alerts. Copying a file or a bare URL is not equivalent to inserting an externally loaded image. Provide an insertion test and an explicit compatibility status; do not label a client supported without checking the received message source and the actual request.
4. **Events and alerts.** Preserve pre-arm loads with an honest label; do not assume they were the sender. Atomically create the first post-arm notification. Default to one alert per message; repeat alerts have a cooldown. A notification receipt means provider acceptance, not confirmed inbox delivery. A send followed by a process failure can produce a duplicate when the provider has no idempotency API; document that boundary.
5. **Management.** Search and filter messages; inspect a chronological activity timeline; rename, pause, archive and delete; show unread notifications and mark them read; export CSV safely against spreadsheet formulas. Keep loaded pixel records, detailed events, request metadata and notifications permanently until explicit clear/delete. Clean up only never-loaded pixels 90 days after creation, with a per-pixel preservation flag and a global keep-all toggle. Persist an ever-loaded marker across manual history clearing; include archived records in the same rule. Preserve the email-alert switch.
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

- [Cloudflare request metadata](https://developers.cloudflare.com/workers/runtime-apis/request/#incomingrequestcfproperties)
- [Cloudflare connecting IP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-connecting-ip)
- [IP geolocation limitations](https://developers.cloudflare.com/network/ip-geolocation/)
- [Apple Mail Privacy Protection](https://www.apple.com/legal/privacy/data/en/mail-privacy-protection/)

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
