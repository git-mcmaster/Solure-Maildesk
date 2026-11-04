# Verification record

## Conditional retention — November 4, 2026

The owner requested and authorized publication of a replacement retention policy: keep any pixel with a recorded load and all its activity/request details permanently; remove only never-loaded pixels after 90 days, with preservation toggles. This supersedes the activity-age expiration documented in earlier releases below.

Implemented behavior:

- Loaded pixels, events, metadata and notifications are never removed automatically by age, including archived pixels. Manual clear/delete remains available and destructive.
- Never-loaded pixels are eligible for automatic deletion after 90 days from creation. Each pixel can be protected with “Keep this pixel even if it never loads.” Preferences also offers “Keep all never-loaded pixels.” Both preservation flags default off, matching the requested 90-day baseline.
- A durable `hasRecordedLoad` marker is backfilled from available historical load evidence and set atomically by a trigger on the first recorded event. Manual activity clearing does not reset it. Scanner/proxy loads count; missing historical evidence cannot be reconstructed.
- The legacy `retentionDays` field remains accepted for older clients but no longer expires loaded activity. Partial updates preserve unrelated capture/preservation preferences.
- Cleanup uses one atomic, bounded DELETE with a recheck of global/per-pixel protection and load evidence, plus indexed candidate and related-record lookups. No paid plan, dependencies, DNS or access changes are included.

Local checks before publication:

| Check | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | Passed on installed Node 24.22.1 |
| `node node_modules/vitest/vitest.mjs run tests/server/request-metadata.test.ts tests/server/maildesk.test.ts` | 50/50 passed in disposable Miniflare/D1, including migration backfill, 90-day boundary, both preservation toggles, historical loaded metadata/notifications, clear-history permanence, atomic first-load/protection races and bounded cleanup |
| `node node_modules/vite/bin/vite.js build` | Passed |
| `node node_modules/wrangler/bin/wrangler.js deploy --dry-run --config wrangler.dashboard.jsonc --outdir dist/dashboard-worker` and corresponding pixel config/output | Both bundles passed |
| `git diff --check` | Passed |
| Private backup upgrade rehearsal | Restored the current export into disposable SQLite and applied `0004`; preserved three pixels, seven events, two notifications, and existing capture settings. All existing pixels gained the recorded-load marker. No backup record/event/notification was older than 90 days |
| Isolated local migration | `0004_permanent_loaded_history.sql` applied successfully |
| Browser controls | Per-pixel preservation saved and survived reload. Global keep-all saved and survived reload, then was restored off. A controlled local GET changed an unloaded pixel to permanent retention. Loaded records displayed the permanence explanation |
| Responsive controls | Per-pixel keep controls and preferences inspected in exact 390/320-CSS-pixel frames; checked document widths matched their viewport widths. Browser-frame tests, not physical-device tests |

A separate read-only review and disposable SQLite query-plan inspection confirmed indexed cleanup without temporary sorting and no additional material defect in the inspected retention implementation. Existing inbox-alert and actual-Outlook limitations remain separate from retention behavior.

### Conditional retention production release

- Published source `fab3ee42d8a3cc27b6e50a70c59ba5808deebb0a`, tree `74356f28653fa12580acc170767ebbbf2db75b0c`, exactly matches local source `c2d3a7e3e4aa554aa73ecf53c18698a984335724` (37 tracked paths). No private backup, tracking token, activity fixture or request metadata was published.
- [GitHub Actions run 41795515713](https://github.com/git-mcmaster/Solure-Maildesk/actions/runs/41795515713) passed the clean-environment checks before production migration/deployment.
- A fresh read-only preflight confirmed three existing pixels, seven events, two notifications, no events/notifications older than 90 days, capture on and email/repeat alerts off. This verified that the old scheduler could not age-purge any existing activity during the brief migration-first deployment window. Older versions remain unsuitable for rollback because their cleanup behavior differs.
- Applied remote `0004_permanent_loaded_history.sql` successfully to the dedicated Maildesk database. Deployed dashboard version `bda63546-78f6-4bc1-a136-d5b7f49843d7` on the existing custom domain with the existing minute schedule. The public image Worker code/version was unchanged; the additive database trigger marks new recorded loads permanently.
- The authenticated live preferences showed capture still on, the new global keep-all preference off, and no activity-age dropdown. Created “Retention policy verification” in the owner interface, saved its per-pixel keep flag while still never-loaded, reloaded and confirmed protection persisted.
- One controlled public GET returned HTTP 200 and the unchanged 42-byte GIF. Reloading the private record showed “Kept permanently after its first recorded load” and one history entry. No email was sent. Archived the controlled record to stop further recording without deleting it.
- Read-only production checks confirmed all four current pixels marked as loaded/permanent, eight total events (all seven original events preserved), three metadata-bearing events, and two notifications unchanged. The controlled record was archived with both its recorded-load and preservation flags true. The new trigger and cleanup indexes existed.
- Capture remains enabled; global keep-all remains off, implementing the requested 90-day baseline for unprotected never-loaded pixels. Email and repeat alerts remain off. No paid plan, DNS or Access policy changed. Unauthenticated bootstrap and the new hashed client-script paths returned 302 to the correct Access login.

The 90-day boundary, race behavior and very old loaded-history preservation were tested using disposable clocks/data, not by aging or deleting live records. Actual scheduled deletion after 90 elapsed production days remains unobserved. The live screenshot is stored outside Git and shows the current retention controls.


## Optional request details — November 4, 2026

Implemented and verified locally. The owner approved publication, deployment, the additive migration and enabling collection, conditional on a cohesive per-pixel history. The new schema defaults collection off; enabling it records only future requests. Publication and production verification are recorded separately below when performed.

| Check | Observed result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | Passed using bundled Node 24.22.1 |
| `node node_modules/vitest/vitest.mjs run tests/server/request-metadata.test.ts tests/server/maildesk.test.ts` | 40/40 passed: 7 metadata cases and 33 D1/backend cases, including the existing authentication, caps and outbox regressions |
| `node node_modules/vite/bin/vite.js build` | Passed after the final client changes |
| `node node_modules/wrangler/bin/wrangler.js deploy --dry-run --config wrangler.dashboard.jsonc --outdir dist/dashboard-worker` and the corresponding `wrangler.pixel.jsonc` / `dist/pixel-worker` command | Both bundles passed; neither deployed |
| `git diff --check` | Passed after review; no dependency, lockfile, production configuration or unrelated source changes |
| Disposable SQLite upgrade rehearsal | Earlier schema and existing events survived `0003`; null historical details, off-by-default capture, boolean constraint, triggers and deletion cascade passed |
| Local Wrangler migration | `0001`, `0002` and `0003` applied successfully to an isolated temporary local database; no production database changed |
| Browser workflow | Created a disposable local pixel, recorded a load with capture off, enabled capture through preferences, recorded a synthetic proxy-shaped request, expanded its details and the older null-details explanation |
| Concurrent preferences | Opened a collection-enabled preferences window, disabled capture through a separate local API request, changed only retention in the older window and saved: capture stayed off and retention became 30 days |
| Responsive timeline | Expanded details at exact 390- and 320-CSS-pixel iframe widths; document scroll widths matched their viewport widths, and long reported client text wrapped. This was browser inspection, not a physical phone test |

Pure cases cover IP validation, fake IPv6-header precedence, Cloudflare’s Class E pseudo-IPv4 preservation, missing fields, explicit proxy precedence, unrecognized clients, hostile/oversized input and corrupted stored JSON. D1 cases cover off/on/off persistence, atomic disable, partial settings updates without restoring stale flags, owner-only access, unchanged public GIF/HEAD behavior, historical events, retention, clearing and deletion.

The local request used a deliberately supplied Google-image-proxy User-Agent, not an actual Gmail fetch. Local Wrangler supplied approximate development geodata alongside the loopback IP; that is emulator evidence, not production geolocation or reader attribution. No Outlook email was sent. Capture details do not appear in CSV exports or notification messages. No dependency, paid service, DNS record, access policy or live collection setting was changed.

The bundled pnpm wrapper attempted package-manager setup and stopped before running the requested check; no module purge/install was accepted. The commands above invoked the existing installed tools directly. Publication, remote migration and actual Cloudflare capture remain separate release steps described in [the runbook](RELEASE.md).

The owner approved publication, deployment, the additive migration and enabling collection on November 4, with the additional requirement that a single pixel group every recorded load with its time, approximate location and attached details. The interface now shows those summaries directly on each entry, with expandable full details. Cursor pagination exposes all retained events rather than stopping at 1,000. A 1,105-event backend regression checks ordering, timestamp ties, null metadata, deleted cursor anchors and cross-pixel/invalid cursors. A matching three-column index and tuple comparison let SQLite seek directly into older history without a temporary sort.

The browser showed 100 local fixture events, then 105 after “Load earlier requests,” with no duplicate entries. Expanded history remains stable during background refresh; manual refresh returns to the newest page. Expanded details at exact 390- and 320-CSS-pixel frames had matching document/viewport widths. The 105-event fixture and its location/network fields are synthetic and local only. A private export of the existing production database was restored into disposable SQLite and upgraded successfully, preserving its two pixels, five events and two notifications with collection off. The disposable local collection setting remains off. No live migration or capture enablement is implied by these local checks.

### Production release — November 4, 2026

The owner’s conditional approval was fulfilled and the request-details update is now deployed. Source commit `61dbb608a14854ab0fdcf9b1434d541aa8187a0f` points to tree `78047325c885abbce389043cedf03b8ffa2a5131`, exactly matching local source commit `7b6393b47c7d2263d9607459091f8ea5fac80132`: all 36 tracked paths, blob hashes and file modes matched. No tokens, local fixtures, private request data or backup were published. [GitHub Actions run 41791192985](https://github.com/git-mcmaster/Solure-Maildesk/actions/runs/41791192985) passed the clean Ubuntu checks before migration/deployment.

- Exported the existing dedicated production database to a private local file outside Git, restored it into disposable SQLite and applied the final `0003` migration. Original counts of two pixels, five events and two notifications were preserved; capture defaulted off and the pagination index existed.
- Applied remote `0003_request_details.sql` successfully to the confirmed Maildesk database only.
- Deployed dashboard version `784a15e9-61ac-4850-9314-7fd20578dcd0` and image Worker version `1d8f83e4-740e-4935-bf7c-30a92e00d4e3` from the reviewed source. Existing hostnames, cron, Access configuration, free plan and mail DNS were unchanged.
- The existing owner session opened the live workspace. Through Settings, enabled **Collect request details** and saved successfully. A read-only database check confirmed capture on, email off, repeat alerts off and retention still 90 days.
- Created and labeled “Request-details release verification” through the live private interface. Issued one HEAD and two controlled GET requests with deliberately supplied desktop-Chrome and iPhone-Safari User-Agents. HEAD returned 200 with zero bytes and no event. Both GETs returned 200 with the identical 42-byte GIF, SHA-256 `ef1955ae757c8b966c83248350331bd3a30f658ced11f387f8ebf05ab3368629`, and cache-prevention headers.
- The same pixel’s live timeline showed two separate entries with timestamps, approximate request location, network and the corresponding reported client/platform/device summary. Expanding an entry showed its request IP, time zone, ASN and raw reported User-Agent. Database checks confirmed two metadata-bearing events and all five historical null-metadata events retained, with total notifications unchanged at two. No email was sent; these UAs do not establish actual Chrome/iPhone or mailbox use.
- Archived the controlled release-verification pixel through the interface to stop recording without deleting its history. Collection remains enabled for future loads on other unarchived pixels.
- Unauthenticated standard-user-agent checks for `/`, `/api/bootstrap`, `/api/export.csv` and the new `/assets/index-BcIiXTe0.js` each returned 302 to the correct Cloudflare Access login. No private event metadata was returned by those checks.

Production capture and the cohesive individual-pixel view are verified with controlled requests. Full multi-page behavior was verified locally with 105 browser events and 1,105 backend events, not by filling the production database with test history. Exact 390/320-width layout checks remain browser-frame tests, not physical-phone tests. Actual Outlook insertion/sending, email-proxy behavior, scheduled retention across a live time boundary and owner inbox email alerts remain outside this release’s verified coverage.

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
- Paused the owner-workflow record through the interface. Both controlled records showed “Paused,” including the earlier record paused through the D1 CLI. Reloading preserved the records, counts, paused states and notification read state.
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
