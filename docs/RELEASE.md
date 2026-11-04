# Release runbook

This runbook separates confirmed setup from remaining release checks. The owner authorized implementation and deployment; completion still requires the evidence below. Keep the current Microsoft MX, SPF, DKIM, DMARC and public MTA-STS service intact.

## Confirmed setup — November 3, 2026

- Source is published in the owner’s public [git-mcmaster/Solure-Maildesk repository](https://github.com/git-mcmaster/Solure-Maildesk). The owner deferred a visibility change; public visibility is not a release blocker.
- Published source baseline `61e4b4a773de802c648aa80aafcaf624d7cacf7d` has tree `ca62a1476ee184aa819c4e16d7db86f94bad2d02`; production configuration and initial deployment evidence were published in `e62e20dfd6ad32ec10bc8388f013128b3b94a1d0`, tree `014a227335286fc927b5ae9646b6692bb12a9976`. Both publications’ 33 paths and blob hashes, sizes and modes matched their reviewed local snapshots. This revision adds owner workflow evidence only; application code and configuration are unchanged.
- [GitHub CI run 41767359458](https://github.com/git-mcmaster/Solure-Maildesk/actions/runs/41767359458) passed TypeScript, all 24 backend tests, the client build and both Worker dry-run bundles on clean Ubuntu 24.04.
- [Production configuration CI run 41772391137](https://github.com/git-mcmaster/Solure-Maildesk/actions/runs/41772391137) passed the same complete checks on commit `e62e20dfd6ad32ec10bc8388f013128b3b94a1d0`.
- The current local recheck passed TypeScript, client build and both bundles. Local Miniflare/D1 initialization timed out before tests ran; the local `pnpm check` did not pass. Preserve this distinction from the successful CI run.
- Zero Trust Free is active. An Access application for `maildesk.soluredigitalworks.com` allows exactly `elijah@soluredigitalworks.com`; email one-time PIN is enabled. The actual team hostname is `throbbing-morning-dbde.cloudflareaccess.com`.
- No paid upgrade was accepted. Native email alerts remain unconfigured: this account’s Email Sending UI required Workers Paid. Root Email Routing onboarding proposed replacing Microsoft MX records and was canceled without changing those mail DNS records.
- Account `2b6c3404db3df23a12558f1852bc221c` now has a dedicated D1 database, `solure-maildesk` / `1e984554-9e0c-455c-91be-aefaae407324`, created empty. Remote migrations `0001_initial.sql` and `0002_daily_counters.sql` both applied successfully.
- Both bundles passed with the actual production identifiers. The dashboard configuration has the actual Access team/audience and no `DEV_AUTH`, `EMAIL_MODE` or email binding.
- Dashboard version `47f1c3fa-b218-4a88-ba94-3340a3769fb9` is deployed at `maildesk.soluredigitalworks.com` with a once-per-minute scheduled trigger. Image Worker version `613db136-48a2-4c60-8d4a-bb744221cfbc` is deployed at `pixel.soluredigitalworks.com`.
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

Publication and actual production checks for this update are recorded in [VERIFICATION.md](VERIFICATION.md).

## Request-details release — November 4, 2026

Approved update deployed after matching source publication and passing [CI run 41791192985](https://github.com/git-mcmaster/Solure-Maildesk/actions/runs/41791192985). Source `61dbb608a14854ab0fdcf9b1434d541aa8187a0f`, tree `78047325c885abbce389043cedf03b8ffa2a5131`, matches the reviewed local source. The private backup/upgrade rehearsal preserved existing records; remote migration `0003` applied successfully. Dashboard version `784a15e9-61ac-4850-9314-7fd20578dcd0` and image version `1d8f83e4-740e-4935-bf7c-30a92e00d4e3` are live on the existing hostnames.

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

- Preserve the dedicated database ID `1e984554-9e0c-455c-91be-aefaae407324` in both production configurations. Its initial empty-state check and remote `0001`/`0002` migrations are complete; do not rerun setup against an unrelated database.
- For any fresh environment, first confirm the selected account/database and empty state, then apply the reviewed migrations to that database only. The November 3 local D1 startup blocker did not establish a local migration pass; the initial schema has passing clean-Linux CI and successful production migration results.
- For later migrations, export a backup, document compatibility and the actual restore procedure, and rehearse recovery in a disposable database. Do not assume reverting a Worker restores deleted rows.
- Use separate database IDs for preview and production. Never let an unreviewed preview access the production database or live sender.

## 3. Protect the private Worker

- Preserve hostname Access coverage for every dashboard path. Both alternate `workers.dev` and preview URLs are disabled. Before enabling any alternate URL, explicitly protect it as well; hostname coverage must not be treated as Worker-level all-traffic protection.
- Preserve the configured exact Emails selector for `elijah@soluredigitalworks.com` and the enabled email one-time PIN method. An “any valid one-time PIN” rule is too broad.
- Preserve `ACCESS_TEAM_DOMAIN=throbbing-morning-dbde.cloudflareaccess.com` and the actual returned application audience already in the production configuration. Neither is a guessed identifier.
- Set the dashboard origin to the actual HTTPS dashboard hostname. Production `DEV_AUTH` must be absent, and email mode must remain non-sending until the sender test.
- Both configs keep `workers.dev` and preview URLs disabled by default. Public image access and the existing MTA-STS Worker must remain outside the dashboard policy.
- Preserve the verified owner sign-in and unauthenticated redirects on the sampled HTML, bootstrap API, CSV and hashed script paths. Test another identity’s live denial; the path sample is not exhaustive. Continue verifying JWT issuer, signature, audience and expiry in application code, not merely a decoded email.

## 4. Attach the two hostnames

- Preserve the attached `maildesk.soluredigitalworks.com` dashboard domain and `pixel.soluredigitalworks.com` public image domain.
- Cloudflare-hosted HTTPS Worker custom domains use Cloudflare’s proxy. Mail-related Microsoft MX/DKIM/Autodiscover records retain their own existing DNS-only configuration.
- Serve pixel GET and HEAD requests without an Access login, JavaScript challenge or bot CAPTCHA. Protect the endpoint through opaque tokens, validation and recording caps instead.
- Cache-prevention headers passed the standard-user-agent public check. Confirm actual email clients and image proxies can retrieve a known image; the Python-default-user-agent edge denial is unresolved client-coverage evidence. Recipient proxies can still cache; these headers do not defeat privacy features.

## 5. Configure optional email alerts

- Initial release can use the implemented in-app notification history. Native email alerts are not configured, and no owner inbox delivery has been verified.
- This account’s current Email Sending onboarding UI requires Workers Paid. No upgrade was accepted; any paid service requires separate owner authorization. If sender setup is revisited, use a dedicated sending subdomain if supported by the actual onboarding flow and inspect every proposed DNS record before accepting it.
- **Do not enable root Email Routing.** It is a different service that replaces MX and conflicts with the Microsoft mailbox.
- Check that onboarding preserves existing root authentication policy and reporting endpoints. Add only the sender-authentication records that are actually required.
- Add an `EMAIL` binding restricted to the verified owner destination. Configure `EMAIL_FROM` with an actually authenticated sender and `EMAIL_MODE=live` only for an approved sending test.
- The code fixes the notification destination to `OWNER_EMAIL`; browser input cannot choose arbitrary recipients.
- Test one owner alert. Check the received authentication results and actual inbox arrival. An API success is provider acceptance, not inbox verification.

## 6. Validate Outlook insertion

- Create a disposable test pixel. Use the rich HTML copy tool in the actual Outlook client.
- Send a user-controlled test and inspect the received source: the image must retain the public HTTPS URL. A `cid:` image or embedded attachment is not the expected tracking mechanism.
- Confirm a request reaches the endpoint and the private timeline. Check sender preview behavior and loads before arming. Repeat with images blocked.
- Keep Outlook on iPhone marked unverified until its exact workflow passes. If it embeds the image, document a supported desktop/web workflow rather than claiming mobile compatibility.
- Compare a small tracked and untracked delivery sample. This is a practical observation, not a universal inbox-placement guarantee.

## 7. Release, observe and recover

- Keep the reviewed production configuration and dated verification evidence in source control. The deployed versions, two attached domains, synthetic capture and authenticated owner workflow are recorded above; Outlook sending and inbox delivery remain separate gates.
- Repeat owner sign-in, persistence, settings, notifications and actual-hostname pixel checks after future releases. Verify scheduled retention across its time boundary; the observed 90-day setting alone does not prove it ran.
- Add account usage alerts and review spending-control availability before assuming a fixed cost ceiling. Ordinary usage is expected to be small; public request abuse can consume quota.
- Monitor failed notification states and database usage. Avoid request-body logs and unnecessary retention of tracking URLs or private labels.
- To stop recording, archive pixels or remove the image Worker route. Pausing stops alerts while preserving image activity. To stop all alerts, disable them in settings and inspect in-flight sends. Keep the dashboard behind Access during any recovery.
- To restore the app, deploy a previously tested code version compatible with the current schema. Restore a database backup only when the recovery plan calls for it and with explicit approval of any data replacement.

## Reference documentation

- [Cloudflare Git builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Worker Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- [Access validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Email sending API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
- [Email domain setup](https://developers.cloudflare.com/email-service/configuration/domains/)
