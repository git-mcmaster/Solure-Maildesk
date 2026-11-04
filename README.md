# Solure Maildesk

A private email image-load dashboard for Solure Digital Works. Create a tracking image, insert it into Outlook, send normally, label it afterward and review requests with optional owner-only email alerts.

An image request is not proof that a person read a message. Email privacy services may preload images, block them or serve cached copies. Shared and forwarded images cannot identify an individual reader.

## Project state

This is a standalone app prepared for GitHub and Cloudflare. Source implementation and local verification are tracked in [the implementation plan](docs/IMPLEMENTATION_PLAN.md) and [verification record](docs/VERIFICATION.md). No Cloudflare production resources, DNS, live sender or Access application are created by installing or building it. See [the release runbook](docs/RELEASE.md) before any deployment.

## What is included

- Private dashboard, server-side search, pagination and message details.
- Opaque per-message tracking images served by a separate public Worker.
- Draft, armed, paused and archived states; labels can be added after sending.
- Pre-arm event history and first post-arm notification; optional repeat alerts.
- Durable notification outbox, bounded retries and dry-run local transport.
- Retention settings, unread notifications, CSV export and deletion controls.
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

Store only private labels, optional recipient/notes, image-load timestamps, lifecycle state and notification state. Recipient IP addresses and message bodies are not application records. Pixel URLs contain random tokens, not recipient addresses.

Detailed history retention is selectable at 30, 90 or 180 days. Pixel-level first/latest timestamps and aggregate counts remain until cleared or the pixel is deleted. The first version caps recorded activity at 200 requests per pixel per UTC day and 10,000 requests per account per UTC day, and alerts at 200 per UTC day. Counts reflect recorded requests subject to these caps, not unique readers.

Email status “sent” means the configured provider accepted the message. The outbox reduces routine duplicates, but a crash after acceptance can cause a retry duplicate because the native email API has no documented idempotency key. See the plan for the reliability boundary.

## Ownership

The intended owner controls the GitHub repository, Cloudflare account, database and domain. A source repository, a successful local test, an approved release and verified production behavior are separate milestones.
