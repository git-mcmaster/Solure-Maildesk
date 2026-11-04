# Verification record

## Current status — November 3, 2026

The reviewed source baseline is published in the owner’s public [Solure-Maildesk repository](https://github.com/git-mcmaster/Solure-Maildesk). The owner deferred a repository-visibility change. Initial source commit `61e4b4a773de802c648aa80aafcaf624d7cacf7d` points to tree `ca62a1476ee184aa819c4e16d7db86f94bad2d02`, which exactly matches local source commit `a2a4bb47cb43ceba57b459746930881be5f44421`. Production configuration and initial deployment evidence were then published in commit `e62e20dfd6ad32ec10bc8388f013128b3b94a1d0`, tree `014a227335286fc927b5ae9646b6692bb12a9976`. For both publications, all 33 remote paths, blob hashes, byte sizes and file modes matched the reviewed local snapshots; no extra files, credentials, generated output or local activity records were uploaded. This revision documents the authenticated owner workflow only; application code and production configuration are unchanged.

| Check | Observed result |
| --- | --- |
| [GitHub Actions, run 41767359458](https://github.com/git-mcmaster/Solure-Maildesk/actions/runs/41767359458) | Clean Ubuntu 24.04 execution passed: TypeScript, all 24 backend tests, Vite client build and both Worker dry-run bundles |
| [Production configuration CI, run 41772391137](https://github.com/git-mcmaster/Solure-Maildesk/actions/runs/41772391137) | Commit `e62e20dfd6ad32ec10bc8388f013128b3b94a1d0` passed all 24 tests, TypeScript, client build and both Worker dry-run bundles |
| Current local recheck | TypeScript, client build and both Worker dry-run bundles passed |
| Current local backend tests | Unverified: Miniflare/D1 initialization timed out before the 24 tests executed; this local `pnpm check` did not pass |
| Cloudflare Access setup | Zero Trust Free active; dashboard application created for `maildesk.soluredigitalworks.com`, with an exact-email Allow rule for `elijah@soluredigitalworks.com` and email one-time PIN enabled |
| Access team | `throbbing-morning-dbde.cloudflareaccess.com`; production configuration uses the actual application audience, with no `DEV_AUTH`, `EMAIL_MODE` or email binding |
| Production configuration bundles | Both dry-run bundles passed with the actual account, D1 and Access identifiers |
| Optional native email alerts | Unconfigured. The account’s Email Sending onboarding UI required Workers Paid; no paid upgrade was accepted |

The local emulator startup problem is distinct from the passing clean-Linux CI run. Its HTTP runtime answered a diagnostic request, but the D1 binding/proxy initialization did not finish. The current local test result must not be described as a pass or an application assertion failure.

Root Email Routing onboarding proposed replacing the domain’s Microsoft MX records and was canceled. No Microsoft mail DNS records were changed through this setup. In-app notification history is implemented; native owner email alerts require a separately configured sender and actual delivery verification.

### Deployment and public endpoint evidence

| Resource | Observed result |
| --- | --- |
| Cloudflare account | `2b6c3404db3df23a12558f1852bc221c` |
| Dedicated D1 database | `solure-maildesk`, ID `1e984554-9e0c-455c-91be-aefaae407324`, created empty; remote migrations `0001_initial.sql` and `0002_daily_counters.sql` both applied successfully |
| Dashboard Worker | Deployed version `47f1c3fa-b218-4a88-ba94-3340a3769fb9`, custom domain `maildesk.soluredigitalworks.com`, with a once-per-minute scheduled trigger |
| Public image Worker | Deployed version `613db136-48a2-4c60-8d4a-bb744221cfbc`, custom domain `pixel.soluredigitalworks.com` |
| Unknown valid-format image URL | With a standard Mozilla user agent, GET returned HTTP 200 and a 42-byte, 1×1 transparent GIF with cache-prevention headers; HEAD returned HTTP 200 with an empty body |
| Invalid public image path | HTTP 404 with the same standard user agent |
| Unauthenticated private paths | `/`, `/api/bootstrap`, `/api/export.csv` and `/assets/index-BFM4bS7d.js` each returned HTTP 302 to the exact Cloudflare Access login with a standard Mozilla user agent |
| Alternate Worker hostnames | `solure-maildesk.soluredigital.workers.dev` and `solure-maildesk-pixel.soluredigital.workers.dev` both returned HTTP 404 |
| Browser login | Owner completed a fresh email one-time PIN sign-in; the authenticated private workspace loaded the two controlled verification records |
| Synthetic production capture | A temporary “Deployment verification” record inserted directly through the D1 CLI received HEAD 200 without recording an event, then two concurrent GETs returned 200 with the 42-byte GIF. A database read confirmed `load_count=2`, two events and exactly one in-app notification with status `disabled` because email was off; no email was sent |

Only the two new application hostnames were added, both as proxied Worker custom domains. An independent post-deployment public DNS-over-HTTPS snapshot confirmed the existing Microsoft MX at priority 0, SPF ending in `~all`, both DKIM CNAMEs and DMARC `p=quarantine` with all three reporting destinations retained. `_mta-sts` advertised policy ID `20261103223633`; the existing HTTPS MTA-STS policy returned HTTP 200 with `mode: testing`, the Microsoft MX and `max_age: 86400`. This deployment did not change those mail records or the MTA-STS service.

The first synthetic capture verified the public Worker and production database/notification behavior through direct D1 setup. The separate authenticated workflow below then exercised creation and control through the private interface/API. Neither test establishes Outlook insertion or a real recipient opening an email.

### Authenticated owner workflow

After owner sign-in, the live browser verified:

- Created “Owner workflow verification” through the interface/API and saved its label, owner recipient and notes.
- Used **Copy for Outlook** and inspected the HTML clipboard payload: it contained the remote HTTPS 1×1 GIF URL. This was clipboard verification, not insertion into Outlook or a sent message.
- Requested the new image once before arming. GET returned 200 with 42 bytes; the timeline marked it “While alerts off” and no additional notification was created.
- Armed the record through the interface, then issued two concurrent controlled GET requests. Both returned 200. The timeline showed three events, including one before arming, and exactly one new in-app notification. Total notifications were two, including the earlier CLI-created test.
- Marked the new notification read, reducing the unread count from two to one.
- Paused both controlled test records through the interface. Reloading preserved the records, counts, paused states and notification read state.
- Confirmed settings showed email notifications disabled and unconfigured, 90-day retention and repeat alerts off.
- Opened authenticated `/api/health`, which returned `{"data":{"ok":true,"notificationConfigured":false}}`.

These were controlled HTTP image requests and test records, not actual mailbox or recipient activity. The local verification screenshot remains outside Git; pixel tokens and clipboard contents were not added to the repository. Scheduled retention over its time boundary was not tested live.

Client coverage is limited: a Python default user agent received Cloudflare HTTP 403/error 1010, while the standard Mozilla user agent succeeded. No edge policy was changed to bypass this behavior. Actual email-client and image-proxy compatibility remains an Outlook release test, not a conclusion from the browser-shaped request.

The Workers are deployed, and the listed public access, DNS, synthetic capture and authenticated owner workflow checks passed. Actual Outlook insertion/sending, owner inbox alert delivery, a second identity’s live denial and scheduled retention remain unverified.

## Historical local verification — November 2, 2026

The following results describe the November 2 local implementation review, not the November 3 recheck or a production release.

### Automated checks

| Command | Observed result |
| --- | --- |
| `pnpm check` | TypeScript passed; 24 backend tests passed; Vite production client build passed |
| `pnpm bundle:check` | Both Cloudflare Worker bundles packaged successfully using `--dry-run`; nothing deployed |
| `pnpm audit --json` | Zero reported vulnerabilities across all severity levels |

Environment: Node 22.21.0, pnpm 10.26.1, TypeScript 7.0.2, Vite 8.3.5, Vitest 5.0.5 and Wrangler 4.156.1. Tests used real, disposable local D1-compatible databases through Miniflare and the committed migrations.

The backend cases cover signed, expired and tampered authentication tokens; incorrect identity, audience, issuer and hostname; fail-closed configuration and unauthenticated static assets; cross-origin mutations; input validation; label-after-send behavior; concurrent image capture and notification deduplication; HEAD and unknown images; storage failure; archive/deletion; daily caps and resets; server-side pagination/search; CSV formula escaping; dry-run sending; retries, concurrent outbox claims and queued cancellation; rolling repeat-alert cooldown; and retention without resetting lifetime first-alert suppression.

The audit initially identified vulnerabilities in the test emulator’s pinned transitive dependencies. Scoped overrides select patched `undici` and `sharp` versions; tests and bundles passed with those overrides. The lockfile and package release-age guard remain in place.

### Browser verification

Exercised the local interface through the in-app browser:

- Empty state, pixel creation, message labels, recipient and notes, saving and selection.
- Rich HTML clipboard output containing the remote image URL, with no self-load caused by rendering the dashboard.
- A simulated request before enabling alerts, then two concurrent requests after enabling them: three recorded loads, one marked early and one notification.
- Local scheduled outbox processing, producing a dry-run result without sending email.
- Unread/read notifications, opening the associated message and a direct message link.
- Pause, archive, archive navigation and restore as paused.
- Search with no results, clearing the search and CSV export.
- Settings, retention and clear development-mode wording.
- Desktop layout and exact 390- and 320-CSS-pixel frames, with no horizontal overflow in the checked states. This was responsive browser inspection, not a physical iPhone test.

The review image shows a locally created “Workflow verification” record and simulated requests. It is not real recipient activity. Local database contents are ignored by Git and excluded from the source archive. A text-contrast sample and keyboard/dialog checks were performed; this was not an exhaustive accessibility audit.

A separate read-only source review found no remaining material defects in the inspected authentication, public image isolation, capture, notification, retention, pagination/export and interface claims. That review does not establish deployed security.

## Remaining release gates

- Verify denial of a second identity in the live deployment. Owner sign-in and the private workflow passed; the sampled unauthenticated HTML, bootstrap API, CSV and hashed script paths redirect to Access. This is not an exhaustive path or identity test. `workers.dev` and preview URLs remain disabled in both production configurations.
- Verify scheduled retention across its actual time boundary; seeing the 90-day setting and a configured cron does not establish that live retention behavior.
- Native email service availability, authenticated sender setup and actual owner inbox delivery.
- Remote image preservation and insertion in Outlook on iPhone, web or desktop. Copying HTML locally does not prove an Outlook client preserves it.
- Real email-client/image-proxy availability and real-world delivery behavior; the user-agent-dependent edge result above remains a coverage limitation.

As of the November 2 review, no production resources, DNS records, Microsoft settings or mailbox contents had been changed. The November 3 source publication, Access setup, dedicated database, Worker deployments and two new application hostnames are recorded separately above. Follow [the release runbook](RELEASE.md) for the remaining release checks.
