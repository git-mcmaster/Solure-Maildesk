# Planned send time and delayed tracking

## What the owner approved

Maildesk stores the time the owner plans to send an email through Outlook and starts recording image requests 45 seconds later. The timestamp is saved in Cloudflare’s database. Every incoming image request checks it, so closing Maildesk, closing the browser or turning off the phone does not stop activation. There is no persistent connection, Microsoft access grant, mailbox polling, Sent Items check or email-sending service.

This is a planned-time contract. Maildesk cannot know whether Outlook actually sent the email. If the owner delays, cancels or reschedules the email in Outlook, the matching Maildesk schedule must also be changed or cancelled. A 45-second delay reduces early preview noise but cannot identify a human reader or eliminate scanners, privacy preloads, caching and forwarded-image ambiguity.

## Review queue

1. Import drafts from the other writing workflow. Imported text is private application data and is not emailed.
2. Prepare each message with one unique tracking logo and an opt-out link bound to its saved recipient. Do-not-contact matches cannot be prepared or scheduled.
3. Review the complete recipient, subject, body, signature and footer. Approval belongs to that exact saved version. Editing invalidates it; unsaved edits cannot be silently replaced.
4. Copy the approved complete message into Outlook. The rich clipboard includes HTML and a plain-text fallback. The dashboard preview uses only the untracked logo. Copying does not record a load, schedule Outlook or start tracking.
5. Schedule the actual email in Outlook, then enter that same future time in Maildesk. It displays the planned send time and recording-start time 45 seconds later.
6. Change the planned time before activation when needed, or cancel/stop tracking. Update Outlook separately. Stopping preserves saved history and cannot recall a notification already accepted by the email provider.

Existing pixels also have planned-time controls in their detail view; importing a draft is not required. Manual immediate Start and Stop remain available. Use a fresh pixel/signature for each email; reusing a tracked image combines activity in one history.

Scheduled image-load emails use the workspace’s Settings. If alerts are already on, the form explains that they apply; it does not offer an individual-message email-off switch. If alerts are paused, resuming them is an explicit unchecked option and affects all active pixels. While a manual pixel is already recording, stop it before creating a new schedule; future schedules can still be changed before recording begins.

## Timing and safety

Scheduling immediately installs a future activation timestamp and a fresh activation identity. Before that boundary, GIF and logo requests are served normally but save no event, counters or notification. At or after the boundary, an eligible request records activity without waiting for a scheduled task. Rescheduling before activation replaces the old boundary. Cancelling pauses capture and invalidates unaccepted alerts. The workspace email switch does not move a future schedule earlier.

Batch scheduling requires current version-specific approvals and checks saved recipients, duplicates and the do-not-contact list atomically. Suppression also blocks later capture, while preserving already saved history, immutable sent opt-out links and preferences. Maildesk cannot prevent the owner from sending independently through Outlook. Reply-based opt-outs still need to be entered in the private do-not-contact list.

The API stores UTC instants. The interface accepts and displays the owner’s browser-local time. The 45 seconds are elapsed time after the saved instant; they are not an exact email delivery or read time. Existing bounded owner-only alert/report dispatch still uses its ordinary minute schedule; notification arrival can lag the recorded image request.

## Implementation and release

The implementation uses the existing Cloudflare Workers, D1 database, owner-only Access and public image host. No DNS, paid plan, Microsoft tenant, sender destination or Access change is required. The source does not contain a mailbox simulator or prospect-email transport.

Migration `0008` adds the review/preparation queue. The planned-time migration adds the optional pixel planned-send timestamp and conservatively disables obsolete local simulation-owned jobs. The unused local-only simulated-mailbox migration is not included in this release. Existing manual pixels, saved request history, reports, settings and opt-out records must survive the populated-data rehearsal and production migration.

Before publication: review the exact diff, run type checks and timing/security regressions, inspect desktop/narrow layouts and require complete CI plus both Worker bundles. Before applying live migrations: export production privately, rehearse on a disposable copy and compare every original row/column. Deploy the public collector before the dashboard, then verify a synthetic scheduled record before and after its boundary, cancellation and unchanged private-access boundaries. Do not send to prospects or alter drafts/pixels belonging to the other chat.

Recovery uses a corrected build retaining suppression, future-time capture and retention/report guards. The additive schema can remain; dropping tables or restoring the database would replace newer data and is not a routine rollback. See RELEASE.md and VERIFICATION.md for actual publication, deployment and validation status. Email-client insertion/received-source preservation remains a separate acceptance check.
