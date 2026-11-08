# One-click unsubscribe — November 8, 2026

## Connected sending status — November 8, local only

The local [connected automation](AUTOMATION.md) now inserts these headers into the approved MIME message and checks suppression again immediately before its Microsoft submission. The older receiving-endpoint milestone below did not include that sender. Neither local milestone proves Microsoft’s DKIM coverage of both fields or guarantees a Gmail Unsubscribe button; received-source verification remains required.

## State and boundaries

Local implementation only. The receiving endpoint and header preparation do not establish deployment, received-header preservation, DKIM coverage, Gmail button display or suppression by an external sender. That receiving extension alone requires no new service, dependency, migration, DNS change or credential. The separate connected-sending upgrade adds Microsoft access and storage as described above. Neither workflow can cancel an independently saved Outlook schedule.

Existing footer URLs, recipient bindings, approved message content, signatures, pixels, timing and access policies are preserved. Legacy manual pixels can reuse their existing tokens without being imported into Review queue.

## How the protocol works

[RFC 8058](https://www.rfc-editor.org/rfc/rfc8058.html) describes how a receiving mail service requests an unsubscribe using information in an email. It is a protocol, not a subscription or hosted product. The service acts after its user consents; Maildesk cannot prove that an HTTP request came from Gmail or a human.

Outgoing promotional mail needs these headers, using the real recipient’s existing token instead of the example:

```text
List-Unsubscribe: <https://pixel.example.test/outreach/unsubscribe/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

Both fields must appear in the `h=` list of at least one valid DKIM signature. SPF, DMARC or a signature covering other fields does not replace that requirement. Pasting these lines into an Outlook message or signature does not create email headers.

When the user chooses its Unsubscribe control, the receiving service sends:

```http
POST /outreach/unsubscribe/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa HTTP/1.1
Host: pixel.example.test
Content-Type: application/x-www-form-urlencoded

List-Unsubscribe=One-Click
```

The server maps the opaque token to one saved recipient and writes an idempotent do-not-contact preference. It responds directly, without a redirect, sign-in, confirmation email or additional confirmation step. URL-encoded and multipart form bodies are supported. Every actual sending workflow must honor suppression before submitting another outreach message.

## Public request safety

- `/outreach/stop/<token>` remains the browser confirmation flow with same-origin form validation.
- `/outreach/unsubscribe/<token>` accepts the exact RFC form submission with a valid existing token. It needs no Origin header, cookies or dashboard login; receiving mail servers do not have the owner’s session.
- GET/HEAD are read-only on both routes. A browser opening the new route can use the existing confirmation flow. Query parameters, previews and image requests do not unsubscribe anyone.
- Malformed, duplicate, extra, file and oversized form fields are rejected. Unsupported methods and unknown tokens do not change storage. Storage failures report failure rather than claiming success.
- The 256-bit token is an authorization capability, not identity verification. A person holding a forwarded token can opt out its original recipient. Do not publish real tokens in logs, screenshots or public diagnostics.
- The existing durable table and suppression triggers are reused. Preferences survive pixel deletion and block Maildesk preparation, approval, recording and queued alerts. No new identifying request telemetry is collected.

## Private header preparation

The advanced “One-click unsubscribe setup” disclosure appears for manual messages with existing opt-out links and for approved review-queue versions. It reports that sending is unverified. Preparation is read-only and never generates a replacement token.

- Reviewed messages: `GET /api/outreach/:id/unsubscribe-headers?version=N`. Check the exact approved version, recipient, persisted pixel/token binding and current suppression state.
- Manual messages: `GET /api/pixels/:id/unsubscribe-headers?recipient=<saved-recipient>`. Review-queue managed pixels must use the approved-version route instead.
- Both routes retain exact-owner authorization and private no-cache responses. HTTPS origin and token-path validation prevent header injection or sending recipients to another site.
- Copying rechecks the server. Responses explicitly report `status: prepared-only`, `transportVerified: false` and `dkimSigningRequired: true`.
- HTTP development origins cannot generate production RFC headers. Tests may use an HTTPS example origin with a disposable database; never send development URLs to real recipients.

## Microsoft 365 transport gate

Graph’s [JSON message headers](https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0) require custom fields to start with `x-`. Its [MIME submission](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0) is a candidate for preserving Internet headers, but the final received message must be checked.

Microsoft’s [Exchange Online DKIM example](https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dkim-configure#verify-dkim-signing-of-outbound-mail-from-microsoft-365) omits the unsubscribe fields. [Set-DkimSigningConfig](https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/set-dkimsigningconfig?view=exchange-ps) documents no header-selection parameter. This does not prove every Microsoft-based transport fails; it means current documentation does not establish RFC 8058 signing for this workflow.

No Microsoft permission, mail transport, paid provider or signing key has been added. A future integration must check suppression immediately before actual submission, handle already-queued opt-outs and preserve exact-message approval. Current Outlook schedules must still be cancelled separately.

## Acceptance and release

1. Pass type checks, disposable-D1 request/suppression tests, header-binding tests, client build, Worker dry-run bundles and rendered desktop/mobile checks.
2. Obtain publication/deployment authorization. Deploy and check the public endpoint before the dashboard’s header controls; no migration is needed. Do not use the new URLs in outgoing mail before the public endpoint is verified with an authorized test record.
3. Obtain separate authorization for an exact controlled external test message and required sender permissions. Prospects are not test recipients.
4. Inspect received source: both headers intact and recipient-bound, receiver `dkim=pass`, and the passing signature’s `h=` covering both fields.
5. Verify receiver-style POST suppression, harmless GET/HEAD, repeat-request safety and honest storage-failure responses.
6. Verify the actual sender blocks newly opted-out recipients before submission and handles queued outreach. An approved draft, tracking timestamp or Graph `202 Accepted` does not prove sending or suppression.
7. Record results separately from [Gmail’s button eligibility](https://support.google.com/mail/answer/14229414?hl=en). Correct headers cannot force Gmail to display its Unsubscribe control.

Reverting the code does not erase saved preferences. Keep the same do-not-contact list across releases and providers.
