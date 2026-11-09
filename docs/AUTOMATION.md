# Connected sending — November 8, 2026

Maildesk includes preparation, review, scheduling and submission of approved messages through one owner’s Microsoft mailbox. The upgrade is published and deployed with its additive live migrations, but prospect sending is explicitly disabled. Microsoft registration, private server settings and owner-only consent are complete; the live interface confirms the connected Solure owner account. The authorized owner-only API test was accepted and its sent copy reconciled, but Microsoft returned NDR 550 5.7.708. A separate Outlook control reached Gmail Inbox. Sending remains disabled pending resolution of the connected-message failure and remaining acceptance gates. Existing manual Outlook work remains separate. See [verification](VERIFICATION.md) for evidence and [Microsoft connection](MICROSOFT_CONNECTION.md) for permissions, secrets and activation.

## Everyday workflow

1. Import the individualized drafts into Review queue. Existing Outlook drafts and their message-specific pairings are not automatically adopted, rewritten or scheduled.
2. Prepare the batch. Each message receives its own tracking logo, recipient-bound browser opt-out footer and native-unsubscribe header values. An existing do-not-contact match blocks preparation/sending.
3. Review the complete saved messages: recipient, subject, body, signature, logo and footer. Approve their exact versions together. Approval of wording does not authorize sending; changing a version invalidates its prior approval.
4. Select approved messages, choose a starting time and review the exact dates. The default planner uses weekdays, 9 a.m.–5 p.m. in the browser’s IANA time zone, five-minute spacing and spreading across additional days. It does not infer local holidays or the recipient’s time zone. The final confirmation explicitly authorizes those messages and dates.
5. Maildesk stores the plan and submits each due message server-side. There is no second Outlook schedule to copy for this connected workflow. Closing the browser does not stop it. Pause, cancellation and rescheduling are available in saved plans; in-flight or accepted submissions cannot be recalled.

Preparing a batch, connecting the mailbox, approving wording and authorizing sending are distinct actions. No automatic follow-up copy or automatic replies are generated. Existing manual Outlook schedules must still be changed in Outlook and Maildesk separately; do not schedule the same email through both workflows. Existing recipient/pixel/opt-out pairings and recording history are preserved.

## Limits and timing

The planner accepts at most 100 messages per batch and reserves capacity against saved automatic plans. It enforces 20 submissions per UTC day, at least two minutes between emails, a 30-day planning horizon and one selected message per recipient per batch. Existing conflicting automatic/manual plans are rejected rather than silently duplicated. The server recalculates the reviewed times and rejects a stale plan if reservations changed.

The existing minute trigger alternates work when connected sending is enabled: odd UTC minutes check incoming mail and process at most one due send; even minutes process existing reports, retention and image-load alerts. Each workload therefore runs every two minutes. When connected sending is disabled, legacy work keeps its original every-minute cadence. This avoids combining both busy paths in a single Free-plan database allowance, without adding a paid service. Exact-second dispatch is not promised. A plan more than 15 minutes late is held for explicit review rather than sent unexpectedly. A queue paused by the owner can still be planned and rescheduled; resuming can submit previously authorized messages that are already due within that 15-minute window. The confirmation explains this before resuming.

Image recording begins no earlier than the saved send time plus 45 seconds, and only after Microsoft accepts the submission. A late acceptance cannot cause recording before acceptance. This delay reduces some sender-side fetches; it can miss fast or cached activity and does not eliminate later security scans. Image requests are not read receipts.

## Submission and outcomes

Maildesk composes the approved MIME message, including its paired logo, footer and both unsubscribe headers. It claims the send once and rechecks the current approval, exact saved content, recipient, do-not-contact, reply holds, cancellation, pause, limits and test-recipient restriction immediately before the Microsoft request.

| Status | Evidence and consequence |
| --- | --- |
| Scheduled to send | Saved and authorized, but not submitted. |
| Submission in progress | A send attempt was claimed. Do not duplicate it in Outlook. |
| Microsoft accepted | Microsoft returned HTTP 202. This does not establish completed sending or delivery. |
| Sent copy confirmed | A bounded Sent Items check matched the generated Message-ID, recipient and subject. It does not establish delivery or Inbox placement. |
| Needs review | A rejection, timeout, unknown outcome, overdue plan or unresolved reconciliation requires attention. An attempted uncertain send is not automatically resubmitted. |
| Sending held | An opt-out, matched reply/failure or other eligibility check blocks sending. The reason is retained. |

A controlled received-message test must verify that Microsoft preserves the generated Message-ID; Sent Items reconciliation and precise reply matching depend on it. Reconciliation is bounded to five checks. Unknown outcomes remain for review instead of risking a duplicate. Rate-limit responses impose a shared backoff, while the uncertain attempt itself remains held.

Before dispatch, a bounded incoming-mail check scans across mailbox folders, including mail moved by rules. It checks up to two messages per invocation and saves its cursor; a large mailbox backlog can delay sending until the check catches up. Precisely matched replies, structured permanent failure reports and ambiguous references to known outreach create recipient holds. Related holds are saved in one database operation rather than one call per recipient. Holds are distinct from an explicit do-not-contact preference and are not automatically cleared. Subject text or quoted prose alone does not prove a bounce. Unsupported or unmatched reports create an advisory to inspect the original in Outlook; only a bounded MIME prefix is inspected and raw incoming bodies are not stored. The latest 20 advisories and 100 holds are available in status; the interface shows smaller expandable lists.

When an incoming check fails or has an unfinished page, dispatch is held. Checks retry on a later invocation without silently overriding an owner pause. Recovery does not authorize old, overdue emails. This is polling, not an instant reply webhook: an incoming reply or opt-out can still race an already beginning external submission. Cancellation and disconnect cannot unsend it; the ledger preserves the actual outcome.

## Opt-outs and native mailbox buttons

The browser footer uses the existing confirmation route, so scanners and random GET/HEAD visits do not unsubscribe a recipient. The separate RFC 8058 endpoint handles a provider’s correctly formed one-click POST and updates the same durable suppression list. The final send gate checks that list again. See [unsubscribe](UNSUBSCRIBE.md).

Native Gmail Unsubscribe eligibility remains unverified. A controlled received source must show passing DKIM that covers both `List-Unsubscribe` and `List-Unsubscribe-Post`. Microsoft’s MIME submission support alone does not prove that signing requirement, and satisfying it does not guarantee Gmail displays a button. The UI and API explicitly retain `nativeUnsubscribeVerified: false`.

## Connection, cost and release

The connection is restricted to the configured owner account in one Microsoft tenant. Delegated permissions include mailbox-wide read access, send-as-self, account identity and background refresh. It does not request permission to edit/delete Outlook messages or access all organization mailboxes. Tokens are encrypted in D1 with a separate Worker-held key; no credentials belong in Git. See the [connection setup and security boundaries](MICROSOFT_CONNECTION.md).

Ordinary Graph mail APIs use the applicable existing Microsoft 365 license. No paid service, billing subscription, plan upgrade or DNS/mail-routing change was added. Cloudflare’s actual plan, remaining capacity and edge CPU must be checked before activation; local performance cannot establish production headroom. Permanent tracking and new attempt history continue to consume storage. No promise of zero overage exposure is made for an existing paid usage-based account.

The controlled activation sequence is:

1. Review and authorize source publication, the additive live migrations and deployment. Back up production first and verify migration preservation against that backup. The completed synthetic rehearsal is not a current production backup.
2. Authorize the single-tenant Microsoft registration and delegated permissions. Configure the exact owner, callback and separately stored secrets; keep sending disabled initially. Consent is completed by the owner.
3. Check current account limits and deploy with a test-recipient restriction. Connect the owner and authorize one exact reviewed test message to an owner-controlled inbox. Verify the received source, Message-ID preservation, signed unsubscribe fields, opt-out behavior and outcome checks separately from HTTP acceptance.
4. Enable prospect sending only after those results and the intended sending scope are explicitly approved. Do not import or schedule another chat’s approved drafts implicitly.

Stop/recovery starts by pausing and disabling new submissions. Preserve attempts and provider outcomes. Rolling back code or restoring a database cannot recall an accepted email; restoring a pre-send database can erase duplicate-prevention evidence and must not be followed by blind resending. Keep the ledger and matching encryption key recoverable, or reconnect if credentials cannot be decrypted. Remove new triggers before dropping their dependent tables during any reviewed schema rollback. Prefer an additive forward fix with sending held over destructive rollback.
