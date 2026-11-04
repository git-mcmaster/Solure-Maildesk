# Solure Maildesk

A private email image-load dashboard for Solure Digital Works. Create a tracking image, insert it into Outlook, send normally, label it afterward and review requests with optional owner-only email alerts.

An image request is not proof that a person read a message. Email privacy services may preload images, block them or serve cached copies. Shared and forwarded images cannot identify an individual reader.

## Project state

This is a standalone app prepared for GitHub and Cloudflare. Source implementation and local verification are tracked in [the implementation plan](docs/IMPLEMENTATION_PLAN.md) and [verification record](docs/VERIFICATION.md). No Cloudflare production resources, DNS, live sender or Access application are created by installing or building it. See [the release runbook](docs/RELEASE.md) before any deployment.

The November 4 update adding 89-day reports is implemented and tested locally, but is not yet published or deployed. The production email binding remains unconfigured; a verified destination alone does not establish a working sender or inbox delivery.

## What is included

- Private dashboard, server-side search, pagination and message details.
- Opaque per-message tracking images served by a separate public Worker.
- Draft, armed, paused and archived states; labels can be added after sending.
- Pre-arm event history and first post-arm notification; optional repeat alerts.
- Durable notification outbox, bounded retries and dry-run local transport.
- Permanent loaded history, never-loaded preservation controls, unread notifications, CSV export and deletion controls.
- One saved 89-day report per pixel, with an owner-only report history and email delivery queue.
- Optional private request details: connection IP, approximate location, network and reported client/device hints.
- Cloudflare Access JWT verification, exact owner identity and same-origin mutations.

The app does not read your Outlook mailbox. Recipient and message labels are manually entered. Real Outlook insertion and inbox notification delivery require a user-controlled test after a test endpoint is hosted.

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

Both Workers share the local database under `.wrangler/state`. Development authentication requires `DEV_AUTH=true` and a loopback request hostname. Dry-run alerts never send email. Local image URLs work only on this computer; do not send them to real recipients.

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
wrangler.*.jsonc     Separate Worker configurations; production IDs are placeholders
```

Keep `.dev.vars`, credentials, database files, dependency folders and build output out of Git. The one-day package maturity rule is retained in `pnpm-workspace.yaml`.

## Data and limits

Store private labels, optional recipient/notes, image-load timestamps, lifecycle state and notification state. Request-detail collection is off by default. When the owner enables it in preferences, new recorded loads can also save the fetching connection’s IP, approximate city/region/country, time zone, network number/organization and bounded User-Agent with reported client/platform/device hints. No GPS coordinates, postal code, cookies, message bodies or external geolocation lookup are used. Pixel URLs contain random tokens, not recipient addresses.

These details describe an image request, not a verified reader. Email proxies, scanners, VPNs and forwarding can replace or obscure the person’s location and device. An explicit proxy User-Agent suppresses device/platform attribution; missing information stays unknown. Older loads cannot be backfilled. Turning collection off stops future capture; stored details remain permanently after a recorded load unless you clear activity or delete the pixel. Details appear only in the authenticated owner timeline, not in the public GIF or summary CSV.

Select a pixel to see a single history, newest first. Every entry groups its timestamp with the approximate location, reported client/device or proxy and network captured for that particular load; expand the same entry for its IP, time zone, network number and raw reported User-Agent. “Load earlier requests” reaches the rest of the retained history in stable pages, including beyond 1,000 events. An expanded history stays still while you read; Refresh starts again with the latest page. The timeline states when details were not collected, rather than attaching another load’s data.

Loaded pixels and their activity, request details and notifications are kept permanently, including archived pixels, unless you explicitly clear activity or delete the pixel. A recorded request from a scanner or proxy counts as a load. A permanent ever-loaded marker survives manual activity clearing so clearing does not turn a previously loaded pixel into an expiring one. Older deleted activity cannot be recovered or backfilled. The legacy `retentionDays` API field remains accepted for older clients but no longer controls cleanup.

The report update queues one immutable summary 89 elapsed days after each pixel’s creation, including never-loaded, paused and archived pixels. It records the label, optional recipient, creation/status, current request counts, first/latest timestamps, unused-pixel age threshold and a private activity link. It omits notes, request IPs, User-Agents and public tracking tokens. Reports go only to `elijah@soluredigitalworks.com`, independently of the optional image-load email-alert switch. The private Reports history exposes pending, failed, simulated and provider-accepted states and a retry action for failed reports. A snapshot does not reconstruct cleared activity or establish that anyone read an email.

On the updated scheduler, unprotected never-loaded pixels are eligible for deletion only after 90 days **and** acceptance of their report by the configured email service. An unconfigured sender, failed send or local dry run holds the pixel beyond that age threshold. Protect one with “Keep this pixel even if it never loads,” or enable “Keep all never-loaded pixels” in preferences; turning protection off restores eligibility subject to both guards. Report snapshots survive automatic pixel deletion. Explicitly deleting a linked pixel also removes its snapshot; a retained snapshot whose pixel has expired can be deleted separately from private Reports history. Deletion cannot recall an email already accepted by a provider.

The minute scheduler generates at most 100 reports and dispatches at most five reports plus five optional image-load alerts per invocation. A regression measures 40 D1 calls on the fully busy combined path, below the Free plan’s 50-query limit. Delayed invocations or a backlog can delay processing beyond the exact 89-day instant. Permanent history and report snapshots accumulate against existing database quotas; this does not authorize a paid upgrade. Recorded activity remains capped at 200 requests per pixel per UTC day and 10,000 requests per account per UTC day, and image-load alerts at 200 per UTC day. Counts reflect recorded requests subject to these caps, not unique readers.

Email status “sent” means the configured provider accepted the message. The outbox reduces routine duplicates, but a crash after acceptance can cause a retry duplicate because the native email API has no documented idempotency key. See the plan for the reliability boundary.

## Ownership

The intended owner controls the GitHub repository, Cloudflare account, database and domain. A source repository, a successful local test, an approved release and verified production behavior are separate milestones.
