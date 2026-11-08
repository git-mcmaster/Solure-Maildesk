# Solure Maildesk

A private email image-load dashboard for Solure Digital Works. Prepare a tracking image, insert it into Outlook while tracking is off, then start or schedule tracking and review requests with owner-only email alerts.

An image request is not proof that a person read a message. Email privacy services may preload images, block them or serve cached copies. Shared and forwarded images cannot identify an individual reader.

## Project state

The November 8 connected-sending upgrade is implemented locally, pending release and owner consent. It adds batch preparation and exact-version approval, a secure single-owner Microsoft connection, automatic MIME submission, weekday schedule planning, cancellation, final do-not-contact checks, reply/failure holds and sending history. No live mailbox, credentials, database or deployment changed. Existing Outlook drafts and the deployed manual workflow remain untouched. See [the connected workflow](docs/AUTOMATION.md), [Microsoft permissions and setup](docs/MICROSOFT_CONNECTION.md) and [verification](docs/VERIFICATION.md).

The same local upgrade includes the RFC 8058 receiving endpoint and automatic native-unsubscribe header preparation. A controlled received message must still establish DKIM coverage of both unsubscribe fields; native Gmail eligibility remains unverified. See [one-click unsubscribe](docs/UNSUBSCRIBE.md). Local tests and HTTP acceptance do not establish delivery, Inbox placement or human reading.

The November 6 planned-time update is published and deployed, with 135 tests passing and controlled live timing checks complete. Import and review externally written drafts, prepare one tracking logo and recipient-bound opt-out link, then copy an approved message into Outlook. Schedule the actual email separately in Outlook and enter that same planned send time in Maildesk. Recording starts 45 seconds after that time, using a saved server timestamp. Maildesk does not connect to Microsoft, send emails or confirm delivery. Publication, deployment and live verification are recorded separately in [the release runbook](docs/RELEASE.md) and [verification record](docs/VERIFICATION.md). See [the complete workflow](docs/SCHEDULED_OUTREACH.md).

This is a standalone app prepared for GitHub and Cloudflare. Source implementation and local verification are tracked in [the implementation plan](docs/IMPLEMENTATION_PLAN.md) and [verification record](docs/VERIFICATION.md). No Cloudflare production resources, DNS, live sender or Access application are created by installing or building it. See [the release runbook](docs/RELEASE.md) before any deployment.

The November 4 update is published and deployed at https://maildesk.soluredigitalworks.com/. Every pixel gets a saved report after 89 elapsed days. A native email binding sends only to the verified Solure owner from `reports@notifications.soluredigitalworks.com`. A clearly labeled setup report passed the live scheduled dispatcher on its first attempt, and the owner confirmed Inbox arrival. Processing a real pixel at its elapsed 89-day boundary remains unobserved. See the dated verification record for evidence and limits.

The subsequent tracked-logo signature extension is published and deployed. All 79 tests and CI passed. The live preview, rich-text copying and one controlled logo-load event were verified. It adds no DNS change, database migration or service. Actual Outlook insertion, including Outlook on iPhone, still needs a received-message/source check.

The tracking/notification activation correction is published, migrated and deployed, with 91/91 tests and CI passing. Inactive requests save nothing; one Start action enables tracking and email readiness. The controlled live load alert was accepted by the email service on its first scheduled attempt; owner inbox confirmation remains pending.

## What is included

- Private dashboard, server-side search, pagination and message details.
- Draft import, recipient-specific preparation, exact-version approval and saved-time tracking schedules with a 45-second delay.
- Opaque per-message tracking images served by a separate public Worker.
- Inactive, active and archived tracking states; labels can be added anytime.
- No new capture while inactive; first-load notification per activation and optional hourly repeat alerts.
- Durable notification outbox, bounded retries and dry-run local transport.
- Permanent loaded history, never-loaded preservation controls, unread notifications, CSV export and deletion controls.
- One saved 89-day report per pixel, with an owner-only report history and email delivery queue.
- Optional private request details: connection IP, approximate location, network and reported client/device hints.
- Cloudflare Access JWT verification, exact owner identity and same-origin mutations.

The app does not read your Outlook mailbox. Recipients and message labels are entered manually or imported through the review queue. Actual Outlook image insertion still requires its user-controlled test. The controlled image-load alert passed production dispatch; its Inbox confirmation is pending. The separately tested scheduled report reached the owner’s Inbox.

## Tracked-logo signature

Open a message and choose “Logo signature,” then “Copy for Outlook.” The rich-text clipboard contains the Solure logo, Elijah’s name, business, email and website; it also includes a clean four-line plain-text fallback. The existing approved logo displays at 48 × 50 pixels and is the signature’s **only** tracking image. “Invisible pixel” remains an alternative; use one format per message.

Create and copy a fresh signature for each email. Reusing one tracked signature as Outlook’s global signature combines those emails’ activity in one history. Prepare the email while tracking is off. Either start tracking manually when ready, or schedule tracking using the same planned send time you chose in Outlook; recording then begins 45 seconds later. Copying alone never starts it. Previews after activation and scanners can still cause the first request. “Copy HTML” provides source for an HTML-aware insertion method; pasting that source into ordinary email text does not insert the image. “Copy text only” has no image or tracking.

The dashboard’s preview uses a separate untracked logo, so viewing, hiding or copying it does not record a load. “Images hidden” previews the readable contact text without the logo. An email client may still block images, proxy or cache them, and a request does not prove a human read the email. The logo does not bypass those controls or establish a deliverability improvement. Outlook on iPhone’s handling of the copied signature and external image must be tested before treating that client as supported.

## Outreach opt-out

For a saved recipient, choose “Create opt-out footer” in the selected message. The optional signature footer provides a recipient-specific “Stop outreach emails” link and a reply-based opt-out instruction. Generating or copying the footer does not start tracking. Save a changed recipient before generating or copying another recipient’s footer.

The public footer link opens a confirmation page on the existing public image hostname. Ordinary GET/HEAD visits, scanner previews and image loads cannot add an address to the do-not-contact list. Its same-origin confirmation form saves the preference. The local November 8 extension additionally accepts a standards-compatible mailbox-service POST on a separate token-bound endpoint; it preserves the browser form’s origin checks. Neither route exposes a recipient address or private Maildesk information or collects request IP, location or User-Agent. A forwarded link remains bound to the original recipient; anyone holding it can submit that recipient’s preference. It is not proof of who clicked.

Confirmed preferences and recipient-bound links survive message edits, history clearing, manual pixel deletion and automatic cleanup. The November 6 extension additionally stops future capture and disables unaccepted load alerts for an opted-out recipient, preserving saved history. The private “Do not contact” view supports search and manual entry for reply-based requests. Matching messages show a prominent warning; Maildesk blocks new tracking starts, new opt-out links and its copy controls for that address. Maildesk does not read the inbox or send prospecting messages, so the owner must record reply-based requests and honor the list when composing directly in Outlook or another app. Existing copied text cannot be recalled. The opt-out footer does not supply the separate postal-address or advertising disclosures required for commercial email.

The dashboard remains restricted to the configured owner, with both Cloudflare Access and application-level exact-email checks. Only the public image and opt-out routes are accessible without dashboard sign-in. This extension uses existing services and adds no plan, sender destination, DNS or Access-policy change.

## Local development

Use Node 22.21 or a supported Node 24+ release and pnpm 10.26.1. Install the pinned dependency graph:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

The development launcher copies `.dev.vars.example` to an ignored `.dev.vars` if needed, applies migrations to a local database and starts three loopback-only services:

| Address | Service |
| --- | --- |
| `http://127.0.0.1:5173` | Dashboard, with API requests proxied to the local Worker |
| `http://127.0.0.1:8787` | Dashboard Worker API |
| `http://127.0.0.1:8788` | Public image Worker |

Both Workers share the local database under `.wrangler/state`. Development authentication requires `DEV_AUTH=true` and a loopback request hostname. The launcher forces dry-run owner alerts. Tracking eligibility is checked against its saved activation time on every image request; no browser countdown or mailbox simulation is used. No email is sent. Local image URLs work only on this computer; do not send them to real recipients.

```sh
pnpm check
pnpm bundle:check
```

`check` runs TypeScript, tests and the production client build. `bundle:check` packages both Workers without deploying. Tests use disposable local databases; they do not require a Cloudflare account or credentials.

## Source structure

```text
src/client/          Dashboard interface and interaction states
src/server/          Private API, image endpoint, access checks, outbox dispatcher
migrations/          Versioned database schema
tests/               Functional and security regression tests
scripts/             Local development launcher
docs/                Implementation decisions, release steps and verification
wrangler.*.jsonc     Separate Worker configurations for the deployed Solure account
```

Keep `.dev.vars`, credentials, database files, dependency folders and build output out of Git. The one-day package maturity rule is retained in `pnpm-workspace.yaml`.

## Data and limits

Store private labels, optional recipient/notes, image-load timestamps, lifecycle state and notification state. Request-detail collection is off by default. When the owner enables it in preferences, new recorded loads can also save the fetching connection’s IP, approximate city/region/country, time zone, network number/organization and bounded User-Agent with reported client/platform/device hints. Image capture does not collect GPS coordinates, postal code, cookies or message bodies, or use an external geolocation lookup. The separate review queue stores the draft text you import and its prepared message privately. Pixel URLs contain random tokens, not recipient addresses.

These details describe an image request, not a verified reader. Email proxies, scanners, VPNs and forwarding can replace or obscure the person’s location and device. An explicit proxy User-Agent suppresses device/platform attribution; missing information stays unknown. Older loads cannot be backfilled. Turning collection off stops future capture; stored details remain permanently after a recorded load unless you clear activity or delete the pixel. Details appear only in the authenticated owner timeline, not in public images or summary CSV.

Select a pixel to see a single history, newest first. Every entry groups its timestamp with the approximate location, reported client/device or proxy and network captured for that particular load; expand the same entry for its IP, time zone, network number and raw reported User-Agent. “Load earlier requests” reaches the rest of the retained history in stable pages, including beyond 1,000 events. An expanded history stays still while you read; Refresh starts again with the latest page. The timeline states when details were not collected, rather than attaching another load’s data.

Loaded pixels and their activity, request details and notifications are kept permanently, including archived pixels, unless you explicitly clear activity or delete the pixel. A recorded request from a scanner or proxy counts as a load. A permanent ever-loaded marker survives manual activity clearing so clearing does not turn a previously loaded pixel into an expiring one. Older deleted activity cannot be recovered or backfilled. The legacy `retentionDays` API field remains accepted for older clients but no longer controls cleanup.

The report update queues one immutable summary 89 elapsed days after each pixel’s creation, including never-loaded, paused and archived pixels. It records the label, optional recipient, creation/status, current request counts, first/latest timestamps, unused-pixel age threshold and a private activity link. It omits notes, request IPs, User-Agents and public tracking tokens. Reports go only to `elijah@soluredigitalworks.com`, independently of the optional image-load email-alert switch. The private Reports history exposes pending, failed, simulated and provider-accepted states and a retry action for failed reports. A snapshot does not reconstruct cleared activity or establish that anyone read an email.

On the updated scheduler, unprotected never-loaded pixels are eligible for deletion only after 90 days **and** acceptance of their report by the configured email service. An unconfigured sender, failed send or local dry run holds the pixel beyond that age threshold. Protect one with “Keep this pixel even if it never loads,” or enable “Keep all never-loaded pixels” in preferences; turning protection off restores eligibility subject to both guards. Report snapshots survive automatic pixel deletion. Explicitly deleting a linked pixel also removes its snapshot; a retained snapshot whose pixel has expired can be deleted separately from private Reports history. Deletion cannot recall an email already accepted by a provider.

The minute scheduler generates at most 100 reports and dispatches at most five reports plus five optional image-load alerts per invocation. A regression measures 40 D1 calls on the fully busy combined path, below the Free plan’s 50-query limit. Delayed invocations or a backlog can delay processing beyond the exact 89-day instant. Permanent history and report snapshots accumulate against existing database quotas; this does not authorize a paid upgrade. Recorded activity remains capped at 200 requests per pixel per UTC day and 10,000 requests per account per UTC day, and image-load alerts at 200 per UTC day. Counts reflect recorded requests subject to these caps, not unique readers.

Email status “sent” means the configured provider accepted the message. The outbox reduces routine duplicates, but a crash after acceptance can cause a retry duplicate because the native email API has no documented idempotency key. See the plan for the reliability boundary.

## Ownership

The intended owner controls the GitHub repository, Cloudflare account, database and domain. A source repository, a successful local test, an approved release and verified production behavior are separate milestones.
