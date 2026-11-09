# Microsoft connection — November 8, 2026

The connection code and additive storage are deployed with prospect sending explicitly disabled. After the owner authorized continuation, the single-tenant Solure Maildesk Web app was registered and its six delegated permission requests saved. The exact callback and disabled implicit/public-client flows were verified. The owner created a replacement app password expiring May 7, 2027; its predecessor was deleted before use. All five dashboard-only connection settings are saved as Worker secrets and verified by name, and the authenticated live interface recognizes the configuration. After action-time owner approval, Microsoft’s consent was accepted with organization-wide consent unchecked. The authenticated live interface confirms connection to the exact Solure mailbox and sending disabled. The owner authorized end-to-end testing. One API test was accepted, its sent copy reconciled and its Message-ID preserved, but it received Microsoft NDR 550 5.7.708. A direct Outlook control reached Gmail Inbox with SPF, DKIM and DMARC passing. Automatic sending is disabled again; no prospect was sent. The messages used different body/header/signature treatments, so these tests do not isolate transport, client IP or content as the cause of the different outcomes. Connection readiness is separate from message approval, sending authorization and native Gmail unsubscribe verification.

## What the connection permits

One configured Microsoft 365 tenant and one configured owner object ID can connect through Microsoft’s authorization-code flow with PKCE. A second account, tenant, client registration or mailbox address is rejected. The existing Cloudflare owner authentication protects every connection route, including the callback.

The requested delegated permissions are:

| Permission | Purpose |
| --- | --- |
| `User.Read` | Confirm that Microsoft’s `/me` profile is the configured owner and mailbox. |
| `Mail.Read` | Inspect relevant mail metadata/content for sent-message reconciliation and outcome checks. Microsoft grants read access across this user’s mailbox, not only Maildesk messages. |
| `Mail.Send` | Submit an explicitly approved message through the connected owner’s mailbox. Connecting alone does not authorize a message. |
| `offline_access` | Refresh access on the server when the browser is closed. |
| `openid profile` | Verify the signed identity token, its owner, tenant and nonce. |

No application-wide mail permissions, shared-mailbox permissions, mailbox deletion permission or draft-write permission are requested. This version does not edit or synchronize Outlook drafts. The Graph wrapper permits only mailbox GET/HEAD reads and POST to the exact `/me/sendMail` endpoint. It rejects PATCH, DELETE, other POST operations, other Graph users, other hosts and redirects. See Microsoft’s [permission descriptions](https://learn.microsoft.com/en-us/graph/permissions-reference#mailread), [authorization-code protocol](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow) and [sendMail API](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0).

## Server configuration and setup

After approval, an administrator registers a **single-tenant Web application**, not an SPA. Set its exact Web redirect URI to:

```text
https://maildesk.soluredigitalworks.com/api/mailbox/callback
```

Do not enable public-client or implicit flows. Grant only the delegated scopes listed above, subject to the tenant’s consent rules. The approved owner completes Microsoft sign-in/MFA and the displayed consent step. The app rejects mismatched immutable identity claims and then checks Microsoft’s `/me` user ID and mailbox address before storing tokens.

Required dashboard-only settings:

| Setting | Treatment |
| --- | --- |
| `MICROSOFT_TENANT_ID` | Exact Solure tenant GUID, configured by the owner/admin. |
| `MICROSOFT_CLIENT_ID` | The single-tenant app’s public client GUID. |
| `MICROSOFT_OWNER_ID` | Exact owner’s Microsoft user object GUID; email matching alone is insufficient. |
| `MICROSOFT_CLIENT_SECRET` | Confidential Web-app credential, stored as a Worker secret. Never put it in browser code, Git, screenshots or ordinary variables. |
| `MAILBOX_TOKEN_KEY` | Independent 32-byte cryptographically random AES key, base64 encoded and stored as a Worker secret. Keep it separate from database exports. |
| `OUTREACH_SENDING_ENABLED` | Remains absent/`false` until a separately approved live acceptance test and release. Connecting does not turn it on. |

Microsoft recommends certificate credentials for the strongest confidential-client authentication; this implementation supports a server-held client secret with an administrator-managed expiration/rotation. Do not change the encryption key casually: existing ciphertext becomes unreadable and requires reconnection. Keep an approved secret-management/recovery path separate from any database backup. Worker secret management is documented [here](https://developers.cloudflare.com/workers/configuration/secrets/).

Loopback-only development authentication can use an HTTP localhost callback with synthetic provider responses. Production configuration requires HTTPS. An unconfigured deployment reports disconnected without querying the new tables or calling Microsoft.

## Private storage and lifecycle

Migration `0011_mailbox_connection.sql` adds one singleton connection row and short-lived OAuth-state records. It does not modify historic pixels, approved content, opt-out links or schedules. Access/refresh tokens and PKCE flow data are AES-GCM encrypted with contextual authenticated data. OAuth state and its browser binding are hashed; the browser cookie is HttpOnly, SameSite=Lax, host-bound and Secure in production. State expires after ten minutes and is atomically consumed once.

ID-token checks use the installed `jose` verifier with fixed Microsoft keys, RS256, exact issuer/audience, expiration, issue time, tenant, owner and nonce. Initial profile verification independently checks the token’s Microsoft user and mailbox address. Tokens, authorization codes and provider error bodies are not exposed in status or logs.

Refresh uses a 60-second database lease and version comparison. A concurrent refresh does not overwrite the newer credentials. Disconnect/new-connect generations prevent an in-flight callback or refresh from resurrecting a locally disconnected connection. Microsoft refresh tokens may expire or be revoked; Maildesk stops and requests reconnection. A Web registration avoids the SPA flow’s 24-hour refresh-token limit, but does not promise permanent authorization. [Microsoft refresh-token behavior](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens)

The private API is:

```text
GET  /api/mailbox/status
POST /api/mailbox/connect       {"acknowledgePermissions":true}
GET  /api/mailbox/callback      Microsoft authorization response
POST /api/mailbox/disconnect    {}
```

Disconnect removes stored local credentials and pending OAuth states. It makes no external mailbox deletion or consent-revocation call. The administrator can additionally revoke the app’s consent in Microsoft. Disconnect cannot recall an already in-flight/accepted mail submission. A disconnect or opt-out occurring after the final local check cannot atomically cancel an external request already beginning; the sending log must preserve its actual outcome and expose any uncertainty.

## Sending and outcome boundaries

The internal `mailboxGraphFetch` wrapper forces the fixed Microsoft Graph host and immutable IDs, refreshes credentials server-side, strips caller-supplied authentication/cookies and never automatically retries. Its optional final eligibility callback runs after credential work and directly before the external request, allowing sending code to recheck approved version, cancellation and do-not-contact.

HTTP 202 means Microsoft accepted the request; it does not prove completed sending, delivery, Inbox placement or human reading. A timeout has an unknown outcome and must not trigger a blind resend. Preserve attempts and reconcile against Sent Items, then ask for review when the outcome cannot be established. Existing Outlook schedules remain independent; do not silently adopt or duplicate them. [Microsoft’s send processing](https://learn.microsoft.com/en-us/graph/outlook-things-to-know-about-send-mail)

Microsoft can accept MIME and applicable Internet headers, but current documentation does not establish that its DKIM signature covers both RFC 8058 fields. `nativeUnsubscribeVerified` remains false. A controlled received message must demonstrate correct headers and a passing DKIM signature covering both before claiming native one-click support. Copying these headers into a body/signature does not enable the feature. [MIME support](https://learn.microsoft.com/en-us/graph/outlook-send-mime-message), [Microsoft’s DKIM verification example](https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dkim-configure#verify-dkim-signing-of-outbound-mail-from-microsoft-365)

## Cost, limits and activation checks

Ordinary Graph mail APIs are standard APIs included with the applicable Microsoft 365 user license within usage thresholds. This design does not attach an Azure billing subscription or invoke a listed metered API. Existing mailbox licensing and provider sending limits still apply. [Graph cost categories](https://learn.microsoft.com/en-us/graph/metered-api-overview), [current metered API list](https://learn.microsoft.com/en-us/graph/metered-api-list)

Current Graph Outlook limits include 10,000 requests per ten minutes per app/mailbox and four concurrent requests. The wrapper preserves a bounded numeric `Retry-After` from throttling responses and returns only safe provider errors. Scheduling code must back off and bound work rather than retry in a loop. [Graph limits](https://learn.microsoft.com/en-us/graph/throttling-limits#outlook-service-limits), [throttling guidance](https://learn.microsoft.com/en-us/graph/throttling)

Cloudflare Free currently provides 100,000 Worker requests/day, 10 ms CPU per cron invocation and 50 subrequests/invocation; D1 Free provides five million rows read/day and 100,000 rows written/day. Free exhaustion causes errors, while Paid has usage-based charges. Account plan, existing total usage and actual expanded-workflow CPU must be checked before any cost claim. No upgrade or paid service is authorized by this implementation. [Worker limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Worker pricing](https://developers.cloudflare.com/workers/platform/pricing/)

Before activation: rehearse the additive migration on a disposable backup, verify local owner/state/nonce/tenant/refresh/race tests, obtain explicit approval for live registration/permissions/secrets/migration/deployment, connect the correct account and authorize the exact controlled test message. Verify received source and outcomes separately from provider acceptance. Do not use real prospects as test recipients or enable unattended outreach from an existing content approval alone.
