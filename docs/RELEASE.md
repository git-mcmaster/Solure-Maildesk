# Release runbook

This file is a release plan, not evidence that any of these steps have happened. Production changes require the owner’s explicit approval. Keep the current Microsoft MX, SPF, DKIM, DMARC and public MTA-STS service intact.

## 1. Review and source control

- Put this standalone project in the owner’s private `solure-maildesk` repository. Review the diff and run `pnpm check` and `pnpm bundle:check`.
- Confirm the actual repository owner and visibility through GitHub. Keep the existing website repository independent.
- Keep production deployment manual at first. Cloudflare’s Git integration can build versions without promoting them by using `wrangler versions upload`; previews and production must use separate resources. An application code rollback does not roll back database changes.

## 2. Create isolated resources

- Create a dedicated Cloudflare D1 database and record its returned ID in both Wrangler configurations. The all-zero ID is deliberately a placeholder.
- Confirm the database is new/empty. Run the committed migrations locally first, then apply them to that database only after checking the selected account and database name.
- For later migrations, export a backup, document compatibility and the actual restore procedure, and rehearse recovery in a disposable database. Do not assume reverting a Worker restores deleted rows.
- Use separate database IDs for preview and production. Never let an unreviewed preview access the production database or live sender.

## 3. Protect the private Worker

- Configure Cloudflare Access for the dashboard Worker’s **all traffic** scope, including production and alternate Worker URLs.
- Allow only `elijah@soluredigitalworks.com`, using an exact Emails selector. An “any valid one-time PIN” rule is too broad.
- Configure `ACCESS_TEAM_DOMAIN` with the actual Cloudflare Access team hostname and `ACCESS_AUD` with the application’s actual audience. These are identifiers, not values to guess.
- Set the dashboard origin to the actual HTTPS dashboard hostname. Production `DEV_AUTH` must be absent, and email mode must remain non-sending until the sender test.
- Both configs keep `workers.dev` and preview URLs disabled by default. Public image access and the existing MTA-STS Worker must remain outside the dashboard policy.
- Prove unauthenticated requests cannot fetch private HTML, API data, CSV files or static assets. Prove another identity is denied. Verify the token’s issuer, signature, audience and expiry, not merely its decoded email.

## 4. Attach the two hostnames

- Attach `maildesk.soluredigitalworks.com` to the private dashboard Worker and `pixel.soluredigitalworks.com` to the public image Worker.
- Cloudflare-hosted HTTPS Worker custom domains use Cloudflare’s proxy. Mail-related Microsoft MX/DKIM/Autodiscover records retain their own existing DNS-only configuration.
- Serve pixel GET and HEAD requests without an Access login, JavaScript challenge or bot CAPTCHA. Protect the endpoint through opaque tokens, validation and recording caps instead.
- Confirm the image path bypasses cache rules and responds with the intended no-store headers. Recipient proxies can still cache; these headers do not defeat privacy features.

## 5. Configure optional email alerts

- Check whether the native Cloudflare Email Sending service is available in the owner’s account. Use a dedicated sending subdomain if supported by the actual onboarding flow, and inspect every proposed DNS record before accepting it.
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

- Approve the final version before deploying or attaching live domains.
- Recheck login denial, public image access, persistence, settings and notifications from the actual hostnames.
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
