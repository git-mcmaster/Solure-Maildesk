# Verification record

## Planned-time revision — November 6, 2026

This release supersedes the unpublished simulated-mailbox design below. It saves the owner’s planned Outlook send time and starts capture 45 seconds later, checked by the server on each image request. No Microsoft connection, send confirmation, mailbox polling or prospect-email transport is present.

Source implementation `d1ff6f228b1e773c28f45d697085d8e54a232a27`, tree `cd16d410c3056f08c4f8e0a95094d5b09bca321f`, exactly matched the reviewed local temporary-index tree. [PR #2](https://github.com/git-mcmaster/Solure-Maildesk/pull/2) merged as `265288237661b067621eac00e6a5e441c986971f`. [CI run 42263085407](https://github.com/git-mcmaster/Solure-Maildesk/actions/runs/42263085407) passed `pnpm check` and `pnpm bundle:check`: TypeScript, all 135 tests in five files, the client build and both Worker bundles. The server scheduling file passed 17/17 cases and client outreach checks passed 4/4. Coverage includes exact time boundaries, version approval, atomic batch scheduling, rescheduling, cancellation, suppression and relevant state races. Independent read-only review identified no further blocking finding in the examined implementation.

A follow-up in [PR #3](https://github.com/git-mcmaster/Solure-Maildesk/pull/3), implementation `7ab8c54c062df4a41925163342ab8d0449b021d7`, clarifies the manual schedule’s global email setting. Existing enabled alerts are shown as a notice; paused alerts have an unchecked, explicit option to resume alerts for all active pixels. Selection/global-setting changes clear stale opt-in state. [CI run 42269806081](https://github.com/git-mcmaster/Solure-Maildesk/actions/runs/42269806081) passed the complete checks before merge as `401af46f96298342ebf42e4a93e027ef5c551331`.

The final narrow-layout/control follow-up in [PR #4](https://github.com/git-mcmaster/Solure-Maildesk/pull/4), implementation `8b40610112744d30ef7def9de5ed132054334e29`, also passed [complete CI run 42272192123](https://github.com/git-mcmaster/Solure-Maildesk/actions/runs/42272192123) before merge as `d38bd547df45db6872bc5620ab740d82e783d6be`: all 135 tests, TypeScript, client build and both bundles. It removes a measured five-pixel overflow in the manual detail card at 320 CSS pixels and hides schedule actions while recording is already active, retaining Stop-first guidance. The final local `pnpm build` passed with `index-YdARzTrA.js` (320.89 kB) and `index-3EmislW0.css` (56.69 kB). The final dashboard deployed successfully. The live page loaded `index-YdARzTrA.js`; the manual schedule panel was inspected at effective 320 and 390 CSS pixels, with client/scroll widths matching at both sizes. Its enabled-alert notice was visible with no misleading per-pixel checkbox. The synthetic manual pixel was returned to Archive with its one event intact. The live review queue was left open; its proof image is an ignored local artifact in `test-results/planned-time-live-final.png`.

Local checks completed:

- `/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node --max-old-space-size=384 node_modules/typescript/bin/tsc --noEmit`: passed for the main implementation. A later combined local recheck was terminated during TypeScript; it is not claimed as a pass. The clean CI run above passed the final source.
- `pnpm build`: passed, including the final clarification, producing `index-Brwbg6ut.js` (320.68 kB) and `index-Bu8FfPbW.css` (56.64 kB).
- Direct installed Wrangler dashboard dry run passed at 116.03 KiB; CI bundled the public collector at 16.65 KiB. `git diff --check` passed.
- The built local owner interface exercised preparation, exact-version approval, schedule review/save and cancellation using synthetic `example.com` recipients. Desktop and effective 391-/320-CSS-pixel frames were inspected; document client and scroll widths matched in both narrow checks. These are browser viewport checks, not a physical-iPhone acceptance test.

Before production migration, a private export was restored to disposable SQLite. Applying `0008_outreach_schedule.sql` and `0010_planned_tracking.sql` preserved every original row/column: 206 pixels, 44 events, eight notifications, one report, 200 opt-out links, one do-not-contact entry, settings and seven migration records. The new queue was empty; integrity and foreign-key checks passed. The unused local simulator migration `0009` is intentionally excluded. Remote migrations `0008` and `0010` then applied successfully. The public image Worker deployed before the dashboard, retaining the existing hostnames and configuration. Internal deployment IDs and private database exports are kept outside Git.

Live verification used two clearly labeled synthetic records only:

- The review queue imported/prepared/approved one `example.com` message. Its plan was saved for 13:03 EST and rescheduled to 13:05, with capture shown at 13:05:45 after reload. One deliberate logo GET after that boundary returned HTTP 200 / 3,201-byte PNG and recorded exactly one event. Cancelling preserved that event; another logo GET recorded nothing further. No actual email was scheduled in Outlook or sent to that synthetic recipient.
- A separate manual pixel was saved for 13:10 EST with capture at 13:10:45. A deliberate GET at 13:09:54 returned the PNG; the owner interface still showed zero activity. The dashboard tab was closed. A GET at 13:10:59 then recorded exactly one event, proving the gate did not depend on an open dashboard or browser timer. Stop preserved that event; a later GET recorded nothing further. The synthetic manual record was archived without deleting history.
- Existing global email alerts were on. The queue test’s pending notification was disabled before delivery; the manual test’s first-load notification was accepted by the email service on one attempt. This is provider acceptance, not a newly confirmed Inbox receipt. No message was sent to a prospect. The potentially misleading checkbox observed during this check prompted PR #3’s clarification.
- Unauthenticated dashboard root and `/api/bootstrap` each returned 302 to the existing Access gateway. Public `/api/outreach` returned 404. The synthetic public logo GETs returned 200. No Access, DNS, mail routing, sender destination or paid-plan setting changed. A second identity’s sign-in was not tested.
- The post-release private export retained every original row and all original events, notifications, reports, opt-out links and suppression entries. Two synthetic events account for the daily event-counter increase. One existing pixel changed from draft to armed at 17:40:20 UTC, before deployment; that concurrent activation was preserved, with no attribution inferred. No other original field changed. Both synthetic pixels had exactly one event after the stopped/cancelled GETs; integrity and foreign-key checks passed.

The final control and layout revision is deployed and rendered at the existing dashboard hostname. None of these checks establishes actual Outlook scheduled sending, received HTML preservation, physical-iPhone insertion, human reading or improved inbox placement. Outlook’s send time and Maildesk’s saved time must be updated separately. A 45-second delay can miss fast/cached opens, and later scanners can still record. Stop cannot recall an alert already accepted by the email provider.

## Scheduled review queue — November 6, 2026, local only

Implemented draft import, batch preparation, exact-version review/approval, batch scheduling, cancellation, recipient-bound opt-outs and a confirmed-send-plus-45-second capture gate. The mailbox adapter is deliberately a loopback-only simulation; no Microsoft transport, consent grant or real send is included. Live Maildesk and the owner’s Outlook session were inspected read-only. Browser sign-in is not a persistent server-side mailbox connection. No other chat’s drafts were edited, and no source publication, remote migration or deployment was performed.

Checks completed on the local tree:

- `/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node --max-old-space-size=512 node_modules/typescript/bin/tsc --noEmit`: passed.
- `pnpm build`: passed; final client output includes a 314.81 kB JavaScript asset and 55.72 kB CSS asset before gzip.
- The installed Node 24 executable running `node_modules/wrangler/bin/wrangler.js deploy --dry-run --config wrangler.dashboard.jsonc --outdir dist/dashboard-worker` and the equivalent pixel configuration: passed, 119.57 KiB dashboard and 16.65 KiB public Worker. Neither command deployed anything.
- `pnpm exec vitest run tests/server/mailbox.test.ts`: 3/3 passed with loopback permission. `pnpm exec vitest run tests/client/outreach.test.ts`: 4/4 passed. These cover the simulator/disconnected boundary and import/schedule parsing; they do not establish the complete queue integration.
- Disposable SQLite upgrade rehearsal: migrations `0001`–`0007`, a synthetic existing armed do-not-contact match, then `0008`–`0009`. Original fields were preserved except the intended opt-out pause. New tables were empty and the foreign-key check was clean. Only disposable/local databases were used.
- `git diff --check` and `node --check scripts/dev.mjs`: passed. Independent read-only source review found no additional actionable issue in the examined approval, suppression, timestamp gate or simulator boundaries.

Runtime verification encountered host file-read/startup stalls. The focused 16-case scheduling suite timed out in its `beforeAll` database startup, with all 16 cases skipped rather than passed. An isolated probe located a multi-minute synchronous dependency-file read before Miniflare construction; a subsequent disposable CommonJS probe passed a D1 query in 3.2 seconds. A Node 24 Vite/Vitest attempt failed native-library Team-ID validation; dependencies, system security settings and assertions were not changed to bypass it. A longer-startup regression run and rendered-interface review are tracked below when completed. The local launcher explicitly selects loopback development authentication, simulated mailbox mode and dry-run alerts. It also sets Wrangler’s forwarded host to loopback: otherwise its custom production route makes the app correctly reject the development-authentication bypass.

The real Microsoft connector, real scheduled sending, Outlook’s preservation of the prepared message and a Solure-to-owner-Gmail acceptance test remain release gates. The current production cron does not process this new queue. See [the workflow and release boundaries](SCHEDULED_OUTREACH.md).

### Rendered local rehearsal and regression limits

The corrected launcher reached all three local services. The actual built dashboard at `http://127.0.0.1:8787/` was exercised through the browser, using two clearly labeled synthetic `example.com` recipients. Import, batch preparation, exact-version approval, schedule confirmation and automatic simulated dispatch worked. The review preview requested only the untracked logo and kept recorded loads at zero. Unsaved wording blocked opening a different draft; switching to Messages and back retained it, and explicit discard restored the saved wording. No live Outlook drafts were read into or changed by this rehearsal.

A separate controlled HTTP rehearsal against those same local services scheduled the second synthetic item five seconds ahead, waited for automatic simulated Sent Items confirmation and checked that `trackingStartsAt − sentAt` was exactly 45 seconds. A PNG request during the delay returned HTTP 200 with zero recorded loads. The first request after the boundary recorded exactly one event. Adding that synthetic address to the local do-not-contact list immediately blocked the item; another PNG GET still returned the image but left the one saved event unchanged. The script’s three assertions groups passed, and the script exited 0. This is local integration evidence, not a real Microsoft send or human open.

Desktop and 391-/320-CSS-pixel browser frames were inspected. The two phone frames had matching document client and scroll widths, with no horizontal overflow in the checked queue/editor state. The browser’s existing zoom meant a nominal 390-unit viewport was actually 520 CSS pixels; the effective widths were measured rather than assumed. Screenshots are local, ignored artifacts in `test-results/scheduled-review-desktop.png` and `test-results/scheduled-review-mobile.png`. These checks do not establish physical-iPhone behavior or a complete accessibility audit.

The longer full regression command, `pnpm exec vitest run --pool=forks --maxWorkers=1 --hookTimeout=180000 --testTimeout=60000`, exited 1: 46 assertions passed, 87 legacy cases were skipped after database setup timed out, one new case failed and one mailbox-test fork failed to start. The new failure was an invalid fixture-order assumption: same-timestamp imports sort by random ID, so it inspected another recipient’s ordinary body. The test now selects the intended recipient, and its shared import helper identifies newly created IDs. A focused rerun (`NODE_OPTIONS=--max-old-space-size=512 pnpm exec vitest run tests/server/outreach.test.ts --pool=forks --maxWorkers=1 -t 'imports copy without sending'`) then passed, with the other 15 cases intentionally excluded by the name filter. Assertions were retained. The full suite is therefore not claimed green, despite the successful targeted and local integration checks.

The final whole scheduling-file retry, `node --max-old-space-size=512 node_modules/vitest/vitest.mjs run tests/server/outreach.test.ts --pool=forks --maxWorkers=1 --hookTimeout=180000`, again timed out in database setup and skipped all 16 cases. Increasing startup allowance did not resolve that environment issue. Final typechecking passed after stopping the preview, using `/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node --max-old-space-size=384 node_modules/typescript/bin/tsc --noEmit`; a preceding concurrent 512 MiB attempt had been killed with exit 137. Final `git diff --check` and launcher syntax checks passed. The preview was stopped after review, and can be restarted with `pnpm dev` from this repository. No failed or skipped runtime case is represented as a passing test.

## Outreach opt-out — November 4, 2026

The owner approved implementation of a recipient-specific opt-out footer and confirmation page, including protection against accidental page visits. Live Access inspection confirmed hostname-wide dashboard coverage and one Allow rule containing exactly `elijah@soluredigitalworks.com`. The source independently checks the signed Access token’s issuer, audience, expiry and exact owner email, with development bypass restricted to loopback. No access settings were changed. A live second identity’s sign-in was not exercised.

Local validation passed: `node node_modules/vitest/vitest.mjs run` (114 tests in three files, including 14 opt-out server regressions and 20 signature tests), `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/vite/bin/vite.js build`, both Wrangler deployment dry runs and `git diff --check`. The installed versions were Node 24.22.1, TypeScript 7.0.2, Vite 8.3.5, Vitest 5.0.5 and Wrangler 4.156.1. No dependency versions changed. Final bundles measured 84.56 KiB dashboard and 16.55 KiB public Worker. The busy combined scheduler regression remains below the existing 50-query budget.

A private production export was restored to disposable SQLite and migration `0007` applied. Every original row and column matched afterward: seven pixels, 23 events, five notifications, one report and existing settings. Both new tables were empty; foreign-key checks found no violation. Migration SHA-256: `9fa001d994d1ef49e251a4c19f114bb5fca1e3a7c02375bba9a2f17c49262c3d`. A fresh pre-release export/rehearsal repeated those results before remote application.

Actual local browser testing created a synthetic recipient, generated the link and copied both rich HTML and plain text. A GET visit left the do-not-contact list empty and recorded zero image requests. The first real form POST exposed a browser-policy conflict: `Referrer-Policy: no-referrer` made the form origin null. Only the opt-out page was changed to `same-origin`, retaining no cross-origin referrer and strict Origin validation; null/foreign origins remain denied. Reloading the actual page and submitting the button then succeeded and displayed exactly one confirmed preference in the private list. The matching message showed disabled copy/new-start controls. Responsive review found navigation overflow after adding the new item; the final two-row narrow header measured 390/390 and 320/320 client/scroll widths with 44-pixel targets preserved. These are browser CSS-width checks, not a physical-iPhone test.

Published implementation `5a301bffc6a37e3325c9eb5a4817a242091fec2a`, tree `07bad248bffcf97473184d32cca4a4bd13281288`, exactly matches the reviewed local source. [CI run 41881316392](https://github.com/git-mcmaster/Solure-Maildesk/actions/runs/41881316392) passed the complete check/build and both Worker bundles. The owner explicitly approved the live database update and deployment. Remote `0007` applied successfully; the public Worker was deployed before the dashboard on the existing hostnames. Internal deployment identifiers and private exports remain outside Git.

Observed live results:

- Unauthenticated dashboard root, bootstrap and export paths each returned 302 to Access. Public root/API and both alternate workers.dev hostnames returned 404. An unknown opt-out token returned 404. No Access, DNS or sender setting changed.
- Created one synthetic release-test record through the owner interface. Generated footer HTML and plain text contained its production HTTPS opt-out link, with no localhost URL. The public confirmation page did not display the address or private message context.
- Browser GET, HEAD and scanner-query GET left the do-not-contact table empty and retained 23 events/five notifications. HEAD returned 200 with an empty body; all confirmation responses used no-store. A foreign-origin form POST returned 403 and changed nothing.
- Pressing the actual browser confirmation button saved one recipient-source preference and displayed the success page. No confirmation email was sent and no image request was recorded. The private list displayed the new entry; the matching message showed disabled Start and copy controls with a do-not-contact explanation.
- Changed only that synthetic message’s recipient, revisited and reconfirmed the original link, then restored the original address. The stored link remained bound to the original address, suppression still had exactly one entry, and the edited address had none. The test message was archived without deleting its evidence.
- A post-release private export compared every original table’s columns and original row values with the fresh pre-release export: all were preserved, with no foreign-key violations. Final totals were eight pixels (seven original plus one archived synthetic), 23 events, five notifications, one report, one opt-out link and one synthetic do-not-contact entry. Settings and pre-existing data remained unchanged.

No prospective recipient has been contacted or opted out by these checks. A forwarded link can confirm the original address, and a scanner that deliberately submits forms cannot be distinguished from a button press; this is protection against passive visits, not human identity verification. Actual Outlook/iPhone pasted footer preservation and received-message source remain unverified; browser clipboard output does not establish email-client behavior. Maildesk cannot prevent an independent manual Outlook send, and reply-based requests must be entered by the owner. Existing active image capture/history is not automatically erased or stopped by a sales opt-out.

## Tracking activation correction — November 4, 2026

Published source `083c0c7c06070bda0bdaccf09969619e08e1a0e1`, tree `db7d8651478a9f7c9e79976d7389b856687a116b`, matches the reviewed local source. [CI run 41822743342](https://github.com/git-mcmaster/Solure-Maildesk/actions/runs/41822743342) passed. Remote `0006` and both Workers are deployed; internal version identifiers are recorded privately. Immediately afterward, the six pixels, 20 events, three notifications, saved report and email-off/repeat-off preferences remained unchanged.

Live owner-interface test created a clearly labeled synthetic record. Preview/copy plus inactive GIF/PNG requests left it at zero. One Start enabled tracking and the shared email master; two controlled simultaneous loads produced two events and one pending notification. The normal background scheduler recorded service acceptance at **11:45:16 UTC** on its first attempt, with no error. Owner Inbox/Junk confirmation is pending; this is not a claimed inbox receipt. Stop left the record inactive; further GIF/PNG GETs returned 200 but left its two events and one notification unchanged. It was archived without deletion. Final totals were seven pixels, 22 events, four notifications and one report; all pre-existing records remain. Email alerts are now on, repeat alerts remain off, and the other previously active message remains active with a fresh future-only notification window as disclosed in the Start control. No old disabled notification was replayed.

The deployed owner interface shows distinct tracking state, one prominent Start/Stop action, current-start delivery state and readable contact preview. Source-level tests cover restart, cleared history and cancellation races; no provider call already begun can be recalled. Phone-sized local UI checks are recorded below. Microsoft mail routing, DNS, Access, sender binding and paid-plan settings were unchanged.

### Pre-release local checkpoint

Local implementation is verified; source publication, remote migration, deployment and live acceptance remain pending at this checkpoint. The previous inactive-capture and separate email-priming behavior is superseded by the new contract in the implementation plan.

- `node node_modules/vitest/vitest.mjs run`: **91/91** passed across three files, including inactive GIF/PNG capture, explicit atomic activation, concurrent first loads, restart/canceled queues, clear-history eligibility/cooldown, stale save/state races, sender failures, populated migration and retained report/retention coverage.
- `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/vite/bin/vite.js build` and `git diff --check`: passed using the installed Node 24.22.1 toolchain.
- `node node_modules/wrangler/bin/wrangler.js deploy --dry-run --config wrangler.dashboard.jsonc --outdir dist/dashboard-worker`: passed, 78.13 KiB / 20.32 KiB gzip. Equivalent pixel-config dry run passed, 11.41 KiB / 6.13 KiB gzip. These checks did not deploy.
- Busy scheduled report-plus-load-alert processing measured **45 D1 calls**, below the existing 50-call budget assertion. No paid-service or limit change.
- A private production export was restored to a disposable SQLite copy and `0006_tracking_activation.sql` applied. All original columns/rows remained unchanged: six pixels, 20 events, three disabled notifications, one report and existing settings. The current active pixel received an activation identity; the email master stayed off. Foreign-key check found no violations. The same migration was applied only to the local browser-test database at this checkpoint.
- Browser workflow: inactive copy plus GIF/PNG GETs kept the new test record at zero. One Start action enabled tracking and email readiness; two concurrent format requests made two events and one pending notification. Stop preserved those events, disabled the queued notification and blocked subsequent GIF/PNG recording. Restart showed no notification until one new GET created the next activation’s pending notification; old disabled rows stayed disabled.
- Actual interface inspected at 320/390 CSS-pixel widths without horizontal overflow. The large start control fits both. This is responsive browser inspection, not a physical iPhone email-insertion test.
- Independent source review found no material issue in the inspected migration, atomic capture/save/activation logic, notification scoping or queue-cancellation guards. It does not establish an exhaustive security audit or inbox receipt.

The public collector still returns a harmless image when inactive. Historical early loads remain saved and explicitly labeled. Stop can cancel unaccepted queued work, but an email-provider call already begun may finish. Reports after 89 days remain independent of tracking and load-email switches. Actual Outlook insertion and recipient proxy behavior remain separately unverified.

## Tracked-logo production verification — November 4, 2026

Published implementation `9625020be92a7964d15851e7518aedc597ec3e8a` passed [CI run 41816250074](https://github.com/git-mcmaster/Solure-Maildesk/actions/runs/41816250074). The public image Worker was deployed before the dashboard. Live integration then found that the production dashboard CSP blocked its new remote preview, a condition absent from Vite development. Correction `bcb9362af63cf844014633152261243fd28c8ef1`, tree `fe41a0efc0e39240991831ebf9763fde6c6ca6d7`, adds only the exact untracked PNG URL to `img-src`; scripts, connections, framing and tracked-image routes retain their previous restrictions. Its new production-authenticated HTML regression passed in the full **79/79** suite, TypeScript, dashboard dry-run bundle (75.02 KiB / 19.83 KiB gzip), independent review and [CI run 41817500132](https://github.com/git-mcmaster/Solure-Maildesk/actions/runs/41817500132). The corrected dashboard is deployed; internal deployment identifiers are retained privately.

Observed live outcomes:

- Owner session renders the actual approved 192 × 200 PNG preview. Browser clipboard contains one unique remote logo image in `text/html` and clean four-line `text/plain`, with no extra GIF.
- The clearly labeled release-test record stayed at zero through preview/copy checks. HEAD returned 200 with no-store headers and no activity; one deliberate GET returned the exact 3,201-byte approved PNG and recorded one event in that same record’s timeline.
- Normal browser and GoogleImageProxy-shaped request headers returned 200 PNG; the latter was a simulated request, not an actual Gmail open. The original GIF route still returns 200 / 42 bytes. Python-urllib identification returned Cloudflare error 1010 / 403 while the other sampled identifiers passed; no Cloudflare filtering setting was changed. Actual recipient/proxy behavior is therefore still a separate acceptance check.
- Unauthenticated `/` and `/api/bootstrap` still redirect to Access. This is sampled route protection, not an exhaustive identity/security audit.
- All five pre-existing pixel records remained. No migration, DNS, mail routing, sender, retention/report preference or paid service change was made. The new controlled record is labeled as synthetic release verification and archived without deleting its history; its deliberate request must not be counted as recipient engagement.

Actual Outlook browser/iPhone insertion and received source preservation remain unverified. A logo does not bypass blocked images, establish a human read or demonstrate an inbox-placement improvement.

## Tracked-logo local verification — November 4, 2026

This checkpoint covers the implemented signature extension before publication or deployment. The root implementation agent ran the checks and local browser review below; the separate integration/security review found no material defect in the inspected changes. Existing production report/sender evidence follows in its own dated section and does not verify this extension live.

| Check | Observed result |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run` | 78/78 tests passed in three files, including the new signature helper and retained backend/metadata coverage; direct installed Node 24.22.1 |
| `node node_modules/typescript/bin/tsc --noEmit` | Passed |
| `node node_modules/vite/bin/vite.js build` | Passed |
| `node node_modules/wrangler/bin/wrangler.js deploy --dry-run --config wrangler.dashboard.jsonc --outdir dist/dashboard-worker` | Passed: 74.88 KiB / 19.74 KiB gzip; no deployment |
| `node node_modules/wrangler/bin/wrangler.js deploy --dry-run --config wrangler.pixel.jsonc --outdir dist/pixel-worker` | Passed: 11.43 KiB / 6.14 KiB gzip; no deployment |
| `git diff --check` | Passed |
| Logo asset and local preview | The approved static preview returned a 192 × 200 PNG; the signature displays it at 48 × 50 with readable contact text |
| Rich clipboard | “Copy for Outlook” supplied `text/html` and `text/plain`; signature HTML contained exactly one unique `/p/<token>/logo.png`, no hidden GIF, and the text fallback contained four clean contact lines |
| Self-load protection and capture | Viewing the preview, hiding its image, copying the signature and HEAD left the selected local message at zero recorded loads. A controlled GET returned the exact approved 3,201-byte PNG and changed its count from zero to one. The preview uses `/brand/solure-logo-v1.png` |
| Narrow layouts | Actual local interface checked at 320/390 CSS-pixel widths without horizontal overflow; these are browser viewport checks, not physical-phone tests |
| Capture/security review | Logo and GIF share capture rules, metadata controls and caps; HEAD and the static preview do not capture. Known, unknown, archived and storage-failure logo responses use the same PNG/headers. Contact text is escaped and the email link encoded |
| Scope | No database migration, DNS, sender, access policy, dependency or service change; report/retention behavior is preserved |

Publication, CI, deployment and production endpoint verification are pending at this checkpoint. Actual Outlook browser/iPhone insertion, received MIME/source preservation and the resulting email-client request remain unverified. Clipboard support alone does not establish those outcomes. Image blocks, proxies, scanners and caches still limit interpretation; no deliverability improvement or verified human read is claimed.

## Report sender activation — November 4, 2026

The owner explicitly approved the temporary Solure-only setup key after its broader Zone Settings Edit permission was explained. Source configuration `51f893e5677a73202410bf2d9ad202c50c74d859`, tree `6fb90ccdc58836b1901a44be57b4eb9e6855a29a`, matches the local configuration tree. [CI run 41808317650](https://github.com/git-mcmaster/Solure-Maildesk/actions/runs/41808317650) completed successfully, including `pnpm check` (TypeScript, 62 tests, client build) and `pnpm bundle:check`. No application logic, dependencies or migration changed in this activation.

| Check | Observed result |
| --- | --- |
| DNS preview and baseline | Saved a private baseline outside Git. Preview returned three MX and one SPF TXT, all at `notifications.soluredigitalworks.com`. |
| Approved Routing setup | API accepted only the named notifications subdomain and reported it ready. Afterwards every pre-existing record’s type, name, content, priority, TTL and proxy setting matched the baseline. |
| Additional provider-generated DNS | Cloudflare also added `cf2024-1._domainkey.soluredigitalworks.com`, its documented managed Routing DKIM selector; it was not in the preview. This is a fifth, root-level authentication addition, not a fully subdomain-only DNS change. Microsoft’s existing DKIM selectors were untouched. |
| Parent Routing warning | The parent service reports a Microsoft apex MX/SPF mismatch while the notifications subdomain is ready. Microsoft’s records were intentionally retained; actual mail routing still uses its priority-zero MX. No attempt was made to make the parent warning green by replacing them. |
| Temporary setup key | Revoked through the dashboard after setup; a direct verification request then returned HTTP 401 / Invalid API Token. Its owner-readable temporary local file was removed. No setup credential was committed. |
| `node node_modules/wrangler/bin/wrangler.js deploy --dry-run --config wrangler.dashboard.jsonc --outdir dist/dashboard-worker` | Passed with the fixed-destination `EMAIL` binding and live From address. The first invocation also emitted a log-path permission warning; rerunning with temporary log/config paths passed without it. |
| `node node_modules/wrangler/bin/wrangler.js deploy --config wrangler.dashboard.jsonc` | Deployed to the existing dashboard hostname and minute cron. Public pixel code, database schema and Access controls were unchanged. Native sending no longer depends on the revoked setup key. |
| Controlled production report | Queued one clearly labeled synthetic orphan report through `wrangler d1 execute ... --remote --file /tmp/maildesk-report-sender-smoke.sql --json`. No real pixel timestamps or history were changed. The ordinary minute cron marked it `sent` at 09:34:16 UTC / 4:34 AM EST on its first attempt with no error. |
| Owner outcome | The owner confirmed the exact subject and test code `SOLURE-REPORT-20261104-A` arrived in **Inbox**. This establishes that specific receipt, not all future placement. |
| Data preservation | Remote read-only count checks before and after kept four pixels, eight events and two existing notifications. Only the clearly labeled setup report was added. Existing optional image-load email alerts remain off. |
| Live interface | The private Reports view displayed the accepted report and its expanded synthetic snapshot; the sender-unconfigured warning was gone. The owner Access gateway remained in place. |

Cloudflare’s documented verified-destination path is free on all plans, including Routing-only configurations: [pricing](https://developers.cloudflare.com/email-service/platform/pricing/) and [send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/). Its Routing DKIM selector is described in [email authentication](https://developers.cloudflare.com/email-service/concepts/email-authentication/). No paid plan was purchased. These references support the design; the actual bounded sender/queue/Inbox test above is the production evidence.

Limitations: the controlled setup report did not age for 89 days, and its received authentication headers were not inspected. The real boundary logic is covered by local tests; a future real elapsed production boundary remains unobserved. Report `sent` always means provider acceptance; the owner’s Inbox confirmation applies specifically to this test. This activation does not establish Outlook image insertion, arbitrary recipient delivery, unique-human opens or future Inbox guarantees.

## Historical report implementation and first deployment — November 4, 2026

This checkpoint precedes sender activation. Its unconfigured-sender and unverified-Inbox statements describe that earlier point and are superseded by the activation evidence above.

Implemented following the owner’s request for a report for every pixel at 89 days from creation, emailed to the fixed Solure owner address. The following table records local validation; publication and production evidence appear in the separate subsection below. Neither establishes actual processing after 89 elapsed days or inbox delivery. Earlier dated production evidence remains historical.

| Check | Observed result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | Passed using installed Node 24.22.1 |
| `node node_modules/vitest/vitest.mjs run tests/server/maildesk.test.ts tests/server/request-metadata.test.ts` | 62/62 passed in two files using disposable Miniflare/D1; no live provider or production storage accessed |
| `git diff --check` | Passed after backend/report changes |
| `node node_modules/vite/bin/vite.js build` | Passed after the final compact-navigation CSS fix |
| Worker dry-run bundles | Both dashboard and public pixel bundles passed; no deployment performed by these commands |
| Browser report workflow | Synthetic local reports displayed pending, failed and accepted states; expanded snapshots were readable, a private-history button selected the correct pixel, and retry reset a failed report to queued with zero attempts |
| Narrow layouts | Expanded report dialogs inspected in 390/320-CSS-pixel frames. A 6-pixel navigation overflow at 320 was fixed; final document widths matched both viewports. These were browser-frame checks, not physical-phone tests |
| Populated schema upgrade regression | Applied `0005` to a disposable populated `0004` fixture, preserved existing pixel/event records and preservation settings, then queued its due snapshot successfully |
| Query-plan inspection | Disposable SQLite used `pixels_report_due` for due-date seeking, `pixels_reported_cleanup` for accepted-report cleanup candidates and indexed report/event/notification lookups, including the report foreign-key lookup; no temporary sort or full-report scan on these paths |
| Combined scheduled-call budget | Busy-path regression generated reports and dispatched five reports plus five image-load alerts in 40 D1 calls, below the Free plan’s 50-query invocation limit |
| Separate source review | Read-only review found and then confirmed resolution of the combined invocation-budget issue and missing orphan-snapshot deletion path; no additional material findings in the inspected changes |

The cases exercise the exact 89-day boundary, all pixel lifecycle states, never-loaded reports, bounded generation, concurrent unique queueing and claims, immutable text, owner-only recipients, note/IP/User-Agent/token exclusion, optional-alert independence, local-only dry runs, missing sender, backoff/five-attempt limit/manual retry, lease recovery, send-before-cleanup ordering, retained snapshots after automatic deletion, explicit linked/orphan deletion and generation/deletion races. Owner authentication, same-origin retry requests, pagination and input validation are included. Earlier permanent-history, request-detail, capture and outbox tests remain in the same passing suite.

Reports use the minute schedule, so they become due 89 elapsed days after creation and may be processed later because of cron timing, backlogs or retries. The new cleanup requires both age greater than 90 days and provider-accepted report state, independently rechecked alongside preservation and load evidence. Loaded history remains permanent. Unconfigured, failed or dry-run sends hold unused pixels; report delivery is independent of the optional image-load alert switch. Plain-text snapshots omit notes/raw request details and contain a private history link. Automatic deletion leaves the snapshot; explicit pixel deletion removes its linked snapshot, and a separate private DELETE handles orphaned snapshots.

`sent` records provider acceptance, not inbox delivery. A provider can accept immediately before a process crash, so a later retry can duplicate an email; no undocumented provider idempotency feature was assumed. Email delivery already in flight cannot be recalled by deletion. No live email was sent by these checks.

Sender setup was investigated alongside local validation. The production native sending binding/sender remained unconfigured; the Email Sending UI required Workers Paid. Apex Email Routing onboarding was canceled without changing Microsoft mail DNS. An API/subdomain-only free path was investigated but not activated. The following subsection records the subsequent source and production checks; actual owner inbox delivery remains a separate gate. Follow the migration/rollback warning in [RELEASE.md](RELEASE.md): older cleanup code does not preserve the new report-before-delete requirement.

### Report source publication and production release

- Published source `e5f423a07a4719eb5334ad295d2dc6eec0cd1165`, tree `b9f65be35af341417d8a700685b148f611315a11`, matches local source `ff5a594a264630f5cf3db62d103b88932282d799`. [CI run 41802564631](https://github.com/git-mcmaster/Solure-Maildesk/actions/runs/41802564631) passed before the production migration/deployment.
- Refreshed the existing Wrangler deployment authorization with the same seven permissions and SolureDigital-only scope; no new email or zone-settings permission was included. The first export attempt failed authentication; the refreshed retry succeeded. The private SQL backup was stored outside Git with owner-only file access. Applying `0005` to a disposable copy preserved four pixels, eight events and two notifications. No existing record was eligible for the older scheduler’s 90-day cleanup during the migration-first window.
- Remote `0005_pixel_reports.sql` applied successfully to the dedicated Maildesk database. Dashboard version `[internal identifier recorded privately]` deployed to the existing custom domain with the existing minute schedule. Public pixel Worker code/version remained unchanged.
- Authenticated production Reports opened successfully with zero saved reports, as expected because all current pixels are younger than 89 days. The existing owner-workflow pixel showed its calculated January 31, 2027 report date, permanent loaded-history policy and sender-unconfigured notice. No production records were aged artificially or seeded with report fixtures.
- Read-only production checks preserved all four loaded/permanent pixels, eight events and two notifications; the report table was empty, and all three new query/foreign-key indexes existed. Capture remains on, global unused preservation off, and optional image-load email/repeat alerts off.
- Unauthenticated requests to the new report-list API and deployed hashed JavaScript returned 302 to the exact owner Access login; public pixel code and its deployment were unchanged.
- The Cloudflare destination page independently showed the exact owner email as **Verified**. The temporary Zone Settings Edit / DNS Read credential was only prepared for review, not created: the owner requested an explanation rather than approving it. Email sending therefore remains unconfigured. No report email or paid upgrade occurred, and no Microsoft mail/DNS record was changed. Independent public DNS still showed Microsoft’s priority-zero MX.

The deployed schedule and due-date interface are verified; processing at a real elapsed 89-day boundary and actual report inbox delivery remain unverified. Local clocks/provider stubs establish logic, not those outcomes. Never-loaded pixels remain protected from cleanup until an email service accepts their report. Source/CI/deployment completion must not be described as email delivery completion.

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
- Applied remote `0004_permanent_loaded_history.sql` successfully to the dedicated Maildesk database. Deployed dashboard version `[internal identifier recorded privately]` on the existing custom domain with the existing minute schedule. The public image Worker code/version was unchanged; the additive database trigger marks new recorded loads permanently.
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
- Deployed dashboard version `[internal identifier recorded privately]` and image Worker version `[internal identifier recorded privately]` from the reviewed source. Existing hostnames, cron, Access configuration, free plan and mail DNS were unchanged.
- The existing owner session opened the live workspace. Through Settings, enabled **Collect request details** and saved successfully. A read-only database check confirmed capture on, email off, repeat alerts off and retention still 90 days.
- Created and labeled “Request-details release verification” through the live private interface. Issued one HEAD and two controlled GET requests with deliberately supplied desktop-Chrome and iPhone-Safari User-Agents. HEAD returned 200 with zero bytes and no event. Both GETs returned 200 with the identical 42-byte GIF, SHA-256 `[private verification value]`, and cache-prevention headers.
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
| Access team | `[owner Access team hostname]`; production configuration uses the actual application audience, with no `DEV_AUTH`, `EMAIL_MODE` or email binding |
| Production configuration bundles | Both dry-run bundles passed with the actual account, D1 and Access identifiers |
| Optional native email alerts | Unconfigured. The account’s Email Sending onboarding UI required Workers Paid; no paid upgrade was accepted |

The local emulator startup problem is distinct from the passing clean-Linux CI run. Its HTTP runtime answered a diagnostic request, but the D1 binding/proxy initialization did not finish. The current local test result must not be described as a pass or an application assertion failure.

Root Email Routing onboarding proposed replacing the domain’s Microsoft MX records and was canceled. No Microsoft mail DNS records were changed through this setup. In-app notification history is implemented; native owner email alerts require a separately configured sender and actual delivery verification.

### Deployment and public endpoint evidence

| Resource | Observed result |
| --- | --- |
| Cloudflare account | `[internal identifier recorded privately]` |
| Dedicated D1 database | `solure-maildesk`, ID `[internal identifier recorded privately]`, created empty; remote migrations `0001_initial.sql` and `0002_daily_counters.sql` both applied successfully |
| Dashboard Worker | Deployed version `[internal identifier recorded privately]`, custom domain `maildesk.soluredigitalworks.com`, with a once-per-minute scheduled trigger |
| Public image Worker | Deployed version `[internal identifier recorded privately]`, custom domain `pixel.soluredigitalworks.com` |
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
