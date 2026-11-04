# Release runbook

This runbook separates confirmed setup from remaining release checks. The owner authorized implementation and deployment; completion still requires the evidence below. Keep the current Microsoft MX, SPF, DKIM, DMARC and public MTA-STS service intact.

## Tracking activation correction — November 4, 2026

Implementation and release are in progress. The intended contract is active-only capture, one visible start-and-email action, stop without new capture, first new load per activation and no old-load replay. This supersedes earlier documentation that described capture before arming or while paused. Earlier saved activity is preserved and labeled historical.

The additive activation migration requires a private production export, disposable rehearsal and count/preference comparisons before application. Apply the migration and deploy the corrected image collector and dashboard/dispatcher promptly; the prior collector can still capture inactive loads in the migration-to-deployment interval. Existing sender/DNS, Access, free plan and 89-day report/retention safeguards stay in place. This is not a database rollback workflow: use corrected code retaining the new capture and queue guards, because older code can violate the inactive contract even if it can read the new schema. A database restore would replace newer records and needs separate approval.

Live acceptance checks must prove both GIF and logo requests do not record while inactive; one explicit start turns on capture and email readiness; concurrent first loads produce one notification; stop blocks new recording and unaccepted queued work; restart waits for a new load rather than replaying old history. A provider call already under way may complete after Stop and cannot be recalled. Use a clearly labeled controlled record, preserve real records, and distinguish provider acceptance from the owner’s inbox confirmation.

## Tracked-logo release checkpoint — November 4, 2026

The signature extension is published and deployed. Implementation commit `9625020be92a7964d15851e7518aedc597ec3e8a` passed CI; the production-only preview CSP correction is `bcb9362af63cf844014633152261243fd28c8ef1`, tree `fe41a0efc0e39240991831ebf9763fde6c6ca6d7`, with passing [CI run 41817500132](https://github.com/git-mcmaster/Solure-Maildesk/actions/runs/41817500132). The exact tree matches the local reviewed source. Controlled live preview, rich clipboard, HEAD and one recorded logo GET passed. It adds a per-message PNG logo using the existing image-capture behavior and a separate untracked preview asset. The signature contains readable contact text and one tracked logo; the invisible GIF remains an alternative. Existing report dispatch, permanent loaded history, preservation controls, request-detail collection and capture caps remain unchanged. No DNS, database migration, dependency, service or paid plan change is needed.

Before release, run the full checks and both Worker bundles on the exact reviewed source. Deploy the public image Worker before or together with the dashboard so freshly copied logo URLs are available. Verify PNG content/dimensions, cache-prevention headers, equivalent known/unknown responses, HEAD without activity, untracked preview requests and retained GIF behavior. Confirm owner-only dashboard access and that preview/copy operations leave the selected message’s load count unchanged. Record the exact publication, CI and deployed versions separately from these local results.

Actual Outlook insertion is a separate acceptance check. Test a fresh message in the browser and Outlook on iPhone; inspect the received source for the unique remote `/p/<token>/logo.png` address, readable fallback contact details and absence of a second hidden GIF or embedded image replacement. Confirm a controlled load reaches that message’s existing timeline. Do not claim Outlook compatibility, human-read detection or a deliverability improvement from a build or clipboard check alone.

If this extension needs recovery, deploy a corrected build retaining the new public logo URLs and existing report/retention guards; the dashboard signature option can be disabled separately. Returning the public Worker to an older release would break logo URLs already sent. Never restore code predating permanent-history and accepted-report cleanup guards. No database rollback is required or authorized for this extension.

## Current report release status — November 4, 2026

The 89-day report implementation is published as `e5f423a07a4719eb5334ad295d2dc6eec0cd1165`, tree `b9f65be35af341417d8a700685b148f611315a11`, with passing [CI run 41802564631](https://github.com/git-mcmaster/Solure-Maildesk/actions/runs/41802564631). A fresh private export and disposable `0005` rehearsal preserved four pixels, eight events and two notifications. Remote `0005` and dashboard version `[internal identifier recorded privately]` are deployed; the existing minute schedule, public image service and owner Access remain intact. Live Reports and an existing pixel’s calculated due date displayed correctly. Production counts/preferences were preserved.

**Report email sending is live.** The follow-up sender configuration is published as `51f893e5677a73202410bf2d9ad202c50c74d859`, tree `6fb90ccdc58836b1901a44be57b4eb9e6855a29a`, and deployed. [CI run 41808317650](https://github.com/git-mcmaster/Solure-Maildesk/actions/runs/41808317650) passed the complete checks. The native `EMAIL` binding is restricted to the verified owner address and uses `reports@notifications.soluredigitalworks.com`. A clearly labeled synthetic report was accepted on the first ordinary scheduled attempt at 4:34 AM EST on November 4; the owner confirmed it arrived in Inbox. No real pixel was aged or edited for this test. A real elapsed 89-day boundary remains unobserved.

The owner approved the temporary Zone Settings Edit / DNS Read key for setup. It was created, used only for the approved sender setup, then revoked; a subsequent API verification returned HTTP 401. The local secret copy was removed. No paid upgrade was accepted. Every pre-existing DNS record was unchanged. Cloudflare added three MX records and one SPF TXT at `notifications.soluredigitalworks.com`, plus its managed Routing DKIM selector at `cf2024-1._domainkey.soluredigitalworks.com`. This fifth authentication record was absent from the preview and is explicitly recorded here. Microsoft’s apex MX/SPF and selector1/selector2 remain intact. Cloudflare’s parent Routing status reports a Microsoft MX/SPF mismatch; do not replace those records to make that status green. The separately configured notifications subdomain is ready, and the bounded owner-only send worked.

Unsent reports hold unused pixels beyond 90 days. Do not roll back to older cleanup code; it does not enforce the report-before-delete condition. To pause sending without changing retention, remove `EMAIL_MODE=live` in a reviewed configuration release; pending reports then hold cleanup. See [VERIFICATION.md](VERIFICATION.md) for exact evidence and limitations.

## Historical pre-release checkpoint — November 4, 2026, local implementation

The owner requested one automatically generated report for every pixel at 89 days from creation, sent to `elijah@soluredigitalworks.com`. This update is implemented locally and passed 62 tests and TypeScript; it is **not yet published, migrated remotely or deployed**. Existing production release evidence below describes earlier code. Browser review and any sender provisioning are separate checks.

The new minute scheduler queues up to 100 due snapshots, dispatches up to five reports, runs guarded unused-pixel cleanup, then dispatches up to five optional image-load alerts. A fully busy regression measures 40 D1 calls. “89 days” means elapsed time from creation; minute scheduling, retries and backlogs can delay processing. Reports cover never-loaded, loaded, paused and archived pixels and are independent of the image-load email-alert preference. They have no per-pixel opt-out.

Snapshots include label/optional recipient, creation/status, current counts, first/latest recorded request, before-arming count, the 90-day unused-pixel threshold and the private history link. They exclude private notes, request IPs, User-Agents and public pixel tokens. The immutable snapshot survives automatic unused-pixel deletion. Explicit pixel deletion removes its linked snapshot; an authenticated orphan-report DELETE removes a snapshot after its pixel has expired. Deletion does not recall an in-flight or accepted email. Counts are saved image requests, not verified human reads; cleared history is not reconstructed.

Loaded pixels and history remain permanent unless explicitly cleared/deleted. The global and per-pixel never-loaded preservation controls remain available. Unprotected never-loaded pixels may be automatically deleted only when strictly older than 90 days **and** their report has status `sent`, with an independently checked delivery marker. Pending, failed, unconfigured and local dry-run reports defer deletion. `sent` means the configured provider accepted the message, not that it reached the inbox. Leases and one-snapshot uniqueness prevent routine concurrent duplicates; a crash after provider acceptance can still cause a retry duplicate. Five automatic attempts are bounded with backoff; the owner can retry a failed report from private history.

### Migration and recovery gate

- Review and publish the exact source only after local checks and full-suite CI; no commit or publication is implied by this entry. Recheck both bundles and the owner report interface before deployment.
- Export the confirmed Maildesk production database to a private file outside Git. Restore that export into disposable SQLite/D1 and rehearse `0005_pixel_reports.sql`, verifying original pixels, events, metadata, notifications and preservation settings remain unchanged. The local regression has exercised a populated `0004` fixture upgrade; a current production-export rehearsal remains required.
- `0005` adds nullable queue/accepted markers, the durable snapshot/outbox table and due, delivery, cleanup and foreign-key indexes. Existing pixels are not deleted by the migration. Older due pixels will be queued after the new scheduler starts; no sender means they remain pending and cannot pass new cleanup.
- Before migration, establish whether the currently deployed older scheduler could delete an already-overdue unused pixel during the rollout. If any such rows exist, suspend that old cron before applying the migration and deploying the new guarded scheduler. Do not assume additive schema compatibility preserves the new behavior.
- Apply only to the confirmed dedicated Maildesk database, then deploy the reviewed dashboard Worker promptly and verify the new scheduler order and report access controls. The public image code and Microsoft mail DNS do not require changes for report generation.
- **Do not roll back to code predating this report guard.** Earlier permanent-history code can delete unused pixels after 90 days without a sent report; still older code can age-delete loaded activity. Recover with a corrected build that retains both permanent-history and accepted-report cleanup rules. A database restore replaces newer data and requires explicit approval; it does not recall accepted emails. Additive schema changes alone are not a data-preserving reverse migration.

### Historical sender investigation before approval

The Cloudflare destination has now been verified by the owner. The production `EMAIL` binding and sender remain unconfigured, and the Email Sending UI remains gated by Workers Paid. Apex Email Routing onboarding was canceled because it proposed replacing Microsoft MX records; no production mail DNS changes or paid upgrade were made. An API/subdomain-only free route is being investigated, but no functioning sender or free sending entitlement is established. Do not describe queued reports as delivered. Keep Microsoft’s existing MX/SPF/DKIM/DMARC and the public MTA-STS service intact. Actual owner inbox delivery remains a release gate.

## Confirmed setup — November 3, 2026

- Source is published in the owner’s public [git-mcmaster/Solure-Maildesk repository](https://github.com/git-mcmaster/Solure-Maildesk). The owner deferred a visibility change; public visibility is not a release blocker.
- Published source baseline `61e4b4a773de802c648aa80aafcaf624d7cacf7d` has tree `ca62a1476ee184aa819c4e16d7db86f94bad2d02`; production configuration and initial deployment evidence were published in `e62e20dfd6ad32ec10bc8388f013128b3b94a1d0`, tree `014a227335286fc927b5ae9646b6692bb12a9976`. Both publications’ 33 paths and blob hashes, sizes and modes matched their reviewed local snapshots. This revision adds owner workflow evidence only; application code and configuration are unchanged.
- [GitHub CI run 41767359458](https://github.com/git-mcmaster/Solure-Maildesk/actions/runs/41767359458) passed TypeScript, all 24 backend tests, the client build and both Worker dry-run bundles on clean Ubuntu 24.04.
- [Production configuration CI run 41772391137](https://github.com/git-mcmaster/Solure-Maildesk/actions/runs/41772391137) passed the same complete checks on commit `e62e20dfd6ad32ec10bc8388f013128b3b94a1d0`.
- The current local recheck passed TypeScript, client build and both bundles. Local Miniflare/D1 initialization timed out before tests ran; the local `pnpm check` did not pass. Preserve this distinction from the successful CI run.
- Zero Trust Free is active. An Access application for `maildesk.soluredigitalworks.com` allows exactly `elijah@soluredigitalworks.com`; email one-time PIN is enabled. The actual team hostname is `[owner Access team hostname]`.
- No paid upgrade was accepted. Native email alerts remain unconfigured: this account’s Email Sending UI required Workers Paid. Root Email Routing onboarding proposed replacing Microsoft MX records and was canceled without changing those mail DNS records.
- Account `[internal identifier recorded privately]` now has a dedicated D1 database, `solure-maildesk` / `[internal identifier recorded privately]`, created empty. Remote migrations `0001_initial.sql` and `0002_daily_counters.sql` both applied successfully.
- Both bundles passed with the actual production identifiers. The dashboard configuration has the actual Access team/audience and no `DEV_AUTH`, `EMAIL_MODE` or email binding.
- Dashboard version `[internal identifier recorded privately]` is deployed at `maildesk.soluredigitalworks.com` with a once-per-minute scheduled trigger. Image Worker version `[internal identifier recorded privately]` is deployed at `pixel.soluredigitalworks.com`.
- Only those two new hostnames were added, both as proxied Worker custom domains. Independent public DNS-over-HTTPS confirmed the retained Microsoft MX at priority 0, SPF `~all`, both DKIM CNAMEs and DMARC quarantine with all three reporting destinations. `_mta-sts` ID is `20261103223633`; the existing HTTPS policy returned 200 with `mode: testing`, the Microsoft MX and `max_age: 86400`. No mail records or MTA-STS service were changed by this deployment.
- Standard-Mozilla-user-agent checks passed for the unknown-token public GIF (GET 200, 42 bytes, 1×1, cache-prevention headers; HEAD 200, empty) and invalid image path (404). Unauthenticated `/`, `/api/bootstrap`, `/api/export.csv` and `/assets/index-BFM4bS7d.js` each returned a 302 to the exact Access login. Both `solure-maildesk.soluredigital.workers.dev` and `solure-maildesk-pixel.soluredigital.workers.dev` returned 404. The actual browser displayed the owner email one-time PIN login page.
- A temporary “Deployment verification” record was inserted directly through the D1 CLI. HEAD recorded no event; two concurrent public GETs produced two events, `load_count=2` and one in-app notification with status `disabled` because email was off. No email was sent. This verifies a synthetic production capture through the public Worker and database, not private API creation or the owner interface.
- Owner completed a fresh email one-time PIN sign-in and exercised the live private interface/API: created and labeled “Owner workflow verification,” saved the owner recipient and notes, verified the remote HTTPS 1×1 GIF in the **Copy for Outlook** clipboard payload, recorded one pre-arm request without a notification, armed the record and issued two concurrent requests. Three timeline events, one early, produced exactly one new in-app notification; the earlier CLI test accounts for the second total notification.
- Marking the new notification read reduced unread from two to one. The owner-workflow record was paused through the interface; both controlled records showed “Paused,” including the earlier record paused through the D1 CLI. A reload preserved records, counts, paused states and read state. Settings showed email disabled/unconfigured, 90-day retention and repeat alerts off. Authenticated `/api/health` returned `{"data":{"ok":true,"notificationConfigured":false}}`.
- The owner workflow is verified with controlled test records, not real email delivery. Actual Outlook insertion/sending, owner inbox alerts, a second identity’s live denial and scheduled retention remain unverified. A Python default user agent received Cloudflare 403/error 1010; no edge policy was changed, and email-client/proxy compatibility still needs its actual test. The local verification screenshot and pixel tokens are not committed.

## Conditional retention update — November 4, 2026

The owner requested replacing activity-age cleanup with permanent loaded-pixel history, optional preservation of never-loaded pixels and publication. This supersedes earlier 30/90/180-day activity-retention guidance below. Loaded records, events, saved metadata and notifications must never be automatically deleted by age. Unprotected never-loaded pixels are eligible for deletion 90 days after creation; the per-pixel flag or global keep-all preference prevents that cleanup. Any recorded image request counts as a load, including proxy/scanner requests. Manual clear/delete remains explicit and destructive.

Migration `0004` adds off-by-default never-loaded preservation settings, a persistent ever-loaded marker, a capture trigger and cleanup index. Backfill preserves any existing evidence of a recorded load. Rehearse against a private production export before applying; confirm no existing expired never-loaded pixels before enabling the new cleanup. Apply only to the confirmed Maildesk database, then promptly deploy the updated dashboard scheduler and image collector. Preserve DNS, Access, free plan and notification configuration.

Older Worker versions can read the additive schema but **must not be used as a routine rollback**: their scheduled activity-age cleanup would violate permanent history. Use a corrected build that retains the new retention logic. A database restore replaces newer data and requires separate approval. A clear performed before this migration may have erased every indication of an earlier load; the backfill cannot reconstruct missing evidence. Permanent retention increases stored data over time and remains subject to existing free database limits; no paid service or plan upgrade is authorized.

Published source `fab3ee42d8a3cc27b6e50a70c59ba5808deebb0a` (tree `74356f28653fa12580acc170767ebbbf2db75b0c`) matches the reviewed local source. [CI run 41795515713](https://github.com/git-mcmaster/Solure-Maildesk/actions/runs/41795515713) passed. Remote `0004` applied successfully; dashboard version `[internal identifier recorded privately]` is live with the existing schedule. Public image Worker code/version was unchanged. The live per-pixel keep flag persisted before a controlled first load, then the record switched to permanent retention; it was archived after testing. All original history and notification counts were preserved. Capture remains on, global keep-all off, and email/repeat alerts off. No DNS, Access or paid-service change. Detailed scope and verification limits are recorded in [VERIFICATION.md](VERIFICATION.md).

## Request-details release — November 4, 2026

Approved update deployed after matching source publication and passing [CI run 41791192985](https://github.com/git-mcmaster/Solure-Maildesk/actions/runs/41791192985). Source `61dbb608a14854ab0fdcf9b1434d541aa8187a0f`, tree `78047325c885abbce389043cedf03b8ffa2a5131`, matches the reviewed local source. The private backup/upgrade rehearsal preserved existing records; remote migration `0003` applied successfully. Dashboard version `[internal identifier recorded privately]` and image version `[internal identifier recorded privately]` are live on the existing hostnames.

Collection was enabled through the authenticated owner interface as approved; retention remains 90 days, email and repeat alerts remain off. Two controlled GETs produced separate metadata-bearing timeline entries and the unchanged GIF response. Historical rows and notifications remained intact. The release test was archived after verification; it retains its history and stops recording. Existing private paths still redirect unauthenticated requests to Access. See [the detailed verification record](VERIFICATION.md) for exact scope and remaining Outlook, actual-client and email-delivery limitations. This release adds no paid service, DNS or Access policy change.

## 1. Review and source control

### Optional request details — November 4 local change

The owner requested request IP, location and client/device information, then explicitly approved publication, deployment and the additive migration on November 4, conditional on a cohesive per-pixel history. The timeline now groups each load’s timestamp, location and client/network summary with its expandable full details. Cursor pagination provides the full retained history rather than silently stopping at 1,000 entries. Local validation and the production release are recorded separately in the verification record. It adds no dependency, external lookup, paid service, DNS change or permission grant. Cloudflare supplies approximate connection metadata; User-Agent interpretation is a reported hint, not a verified identity.

- Apply additive migration `0003_request_details.sql` before releasing the new Workers. It adds an off-by-default settings flag, nullable event JSON and an index for seeking older history; existing rows retain null details. Rehearse against a disposable copy containing the earlier schema and events, then export a production backup before applying it to the confirmed Maildesk database.
- Old Worker versions remain compatible with the added columns because their inserts name columns. Rolling back code stops new capture, but does not erase previously saved details or reverse the migration. To remove captured details, use the approved event-retention/clear/delete workflow; a full backup restore would replace newer records and requires separate approval.
- Verify capture off/on/off, historical null metadata, public GIF equivalence, private API authorization and retention/clear/delete behavior. Verify desktop and narrow timeline/settings layouts with synthetic data before release.
- The schema defaults collection off. The November 4 approval covers enabling it after deployment and a controlled verification request. Confirm the saved setting and actual Cloudflare fields; local and synthetic fixtures do not prove real-client attribution. Existing Outlook and email-alert release limits still apply.

- Keep this standalone project in the owner’s confirmed `git-mcmaster/Solure-Maildesk` repository. Review each release diff and require passing full-suite CI, type checking, client build and both Worker bundles.
- Keep secrets, generated output and local activity out of Git. The repository is currently public with the owner’s knowledge; keep the existing website repository independent.
- Keep production deployment manual at first. Cloudflare’s Git integration can build versions without promoting them by using `wrangler versions upload`; previews and production must use separate resources. An application code rollback does not roll back database changes.

## 2. Create isolated resources

- Preserve the dedicated database ID `[internal identifier recorded privately]` in both production configurations. Its initial empty-state check and remote `0001`/`0002` migrations are complete; do not rerun setup against an unrelated database.
- For any fresh environment, first confirm the selected account/database and empty state, then apply the reviewed migrations to that database only. The November 3 local D1 startup blocker did not establish a local migration pass; the initial schema has passing clean-Linux CI and successful production migration results.
- For later migrations, export a backup, document compatibility and the actual restore procedure, and rehearse recovery in a disposable database. Do not assume reverting a Worker restores deleted rows.
- Use separate database IDs for preview and production. Never let an unreviewed preview access the production database or live sender.

## 3. Protect the private Worker

- Preserve hostname Access coverage for every dashboard path. Both alternate `workers.dev` and preview URLs are disabled. Before enabling any alternate URL, explicitly protect it as well; hostname coverage must not be treated as Worker-level all-traffic protection.
- Preserve the configured exact Emails selector for `elijah@soluredigitalworks.com` and the enabled email one-time PIN method. An “any valid one-time PIN” rule is too broad.
- Preserve `ACCESS_TEAM_DOMAIN=[owner Access team hostname]` and the actual returned application audience already in the production configuration. Neither is a guessed identifier.
- Set the dashboard origin to the actual HTTPS dashboard hostname. Production `DEV_AUTH` must be absent, and email mode must remain non-sending until the sender test.
- Both configs keep `workers.dev` and preview URLs disabled by default. Public image access and the existing MTA-STS Worker must remain outside the dashboard policy.
- Preserve the verified owner sign-in and unauthenticated redirects on the sampled HTML, bootstrap API, CSV and hashed script paths. Test another identity’s live denial; the path sample is not exhaustive. Continue verifying JWT issuer, signature, audience and expiry in application code, not merely a decoded email.

## 4. Attach the two hostnames

- Preserve the attached `maildesk.soluredigitalworks.com` dashboard domain and `pixel.soluredigitalworks.com` public image domain.
- Cloudflare-hosted HTTPS Worker custom domains use Cloudflare’s proxy. Mail-related Microsoft MX/DKIM/Autodiscover records retain their own existing DNS-only configuration.
- Serve pixel GET and HEAD requests without an Access login, JavaScript challenge or bot CAPTCHA. Protect the endpoint through opaque tokens, validation and recording caps instead.
- Cache-prevention headers passed the standard-user-agent public check. Confirm actual email clients and image proxies can retrieve a known image; the Python-default-user-agent edge denial is unresolved client-coverage evidence. Recipient proxies can still cache; these headers do not defeat privacy features.

## 5. Preserve the owner-only sender

- Native report sending is configured and the controlled setup report reached the owner’s Inbox. The same transport is available for optional image-load alerts; their existing preference remains off, and this report test did not exercise a real image-load alert.
- Keep the native binding restricted to `elijah@soluredigitalworks.com` and the configured From address `reports@notifications.soluredigitalworks.com`. Do not expand destinations into an arbitrary relay.
- The verified-destination path worked with existing free services. The general Email Sending UI remains a different, Workers Paid-gated path; no upgrade is authorized by this setup.
- Preserve the three notifications-subdomain MX records, its SPF TXT, and Cloudflare’s generated `cf2024-1` DKIM record. Keep Microsoft’s existing apex MX/SPF and DKIM selectors intact. Do not change them to resolve Cloudflare’s parent Routing mismatch notice.
- The temporary setup key has been revoked and its local copy removed; ordinary Worker sending uses the native binding, not that key.
- The controlled scheduled report was accepted once, and the owner confirmed Inbox arrival. Its received authentication headers were not inspected. Do not infer SPF/DKIM/DMARC results or universal inbox placement from that one receipt.

## 6. Validate Outlook insertion

- Create a disposable test pixel. Use the rich HTML copy tool in the actual Outlook client.
- Send a user-controlled test and inspect the received source: the image must retain the public HTTPS URL. A `cid:` image or embedded attachment is not the expected tracking mechanism.
- Confirm a request reaches the endpoint and the private timeline. Check sender preview behavior and loads before arming. Repeat with images blocked.
- Keep Outlook on iPhone marked unverified until its exact workflow passes. If it embeds the image, document a supported desktop/web workflow rather than claiming mobile compatibility.
- Compare a small tracked and untracked delivery sample. This is a practical observation, not a universal inbox-placement guarantee.

## 7. Release, observe and recover

- Keep the reviewed production configuration and dated verification evidence in source control. The deployed versions, two attached domains, synthetic capture and authenticated owner workflow are recorded above; Actual Outlook image insertion and optional image-load-alert Inbox receipt remain separate gates; scheduled report receipt is confirmed above.
- Repeat owner sign-in, persistence, settings, notifications and actual-hostname pixel checks after future releases. Verify scheduled retention across its time boundary; the observed 90-day setting alone does not prove it ran.
- Add account usage alerts and review spending-control availability before assuming a fixed cost ceiling. Ordinary usage is expected to be small; public request abuse can consume quota.
- Monitor failed notification states and database usage. Avoid request-body logs and unnecessary retention of tracking URLs or private labels.
- To stop recording, archive pixels or remove the image Worker route. Pausing stops image-load alerts while preserving image activity. The optional image-load alert preference does not disable mandatory 89-day reports; sender changes and in-flight sends require separate operational review. Keep the dashboard behind Access during any recovery.
- To restore the app, deploy a tested corrected version that preserves the current permanent-history and accepted-report cleanup rules, as well as schema compatibility. Restore a database backup only when the recovery plan calls for it and with explicit approval of any data replacement.

## Reference documentation

- [Cloudflare Git builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Worker Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- [Access validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Email sending API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
- [Email domain setup](https://developers.cloudflare.com/email-service/configuration/domains/)
