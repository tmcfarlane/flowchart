# Premium image studio and payments

Premium uses a recurring Stripe subscription and server-side OpenAI image generation. The website sends users to Stripe-hosted Checkout and Customer Portal. No card fields, Stripe secret keys, OpenAI keys, or paid flags are stored in the browser. Sign in with ChatGPT and ChatGPT plan usage remain a separate integration; this image provider uses the operator's configured OpenAI API billing.

## User experience and recovery

The website creates a browser session using a random 256-bit capability in an HttpOnly, SameSite=Lax cookie. HTTPS uses a `__Host-` cookie with Secure and Path=/, without a Domain attribute. The server persists only its SHA-256 hash, along with the account's Stripe customer/subscription mapping, and enforces the cookie's one-year expiry server-side. Recovery creates a new expiry period. A signed CSRF token obtained from the session endpoint protects mutations; an exact configured Origin and Fetch Metadata check also prevent cross-site actions.

Access initially belongs to this browser. Users can explicitly save a one-time recovery code and restore it on another browser. Recovery rotates the browser capability, invalidates the previous browser session, and consumes the recovery code. Save a new code after restoring. Generating a new recovery code invalidates the previous code. Recovery codes are secrets and are stored hashed. They are never placed in URLs or logs. There is no automatic email sign-in or email recovery in this release: if the cookie and recovery code are both lost, an operator must verify ownership against Stripe before assisting. A receipt alone is not an authentication credential. Users can still manage subscriptions through Stripe's own customer communications when those are configured.

Before a paid image request is sent, the studio saves one bounded record in local storage: its UUID, exact trimmed description, style, size, state, timestamps and an opaque account binding. It stores no authentication capability, CSRF token, image read URL or pixels. The description stays locally until another deliberate image request replaces it; the studio explains this before generation. A blocked or failed initial write stops the new request. Completed requests retain their metadata so a reload can recover the last result during its 24-hour server cache. Clearing local storage removes this browser's saved request lookup and cannot undo an already-authorized provider request.

Opening the studio never sends an image request. **Recover last image** explicitly checks the saved UUID without starting generation, even after cancellation, exhausted allowance or provider downtime. A check that finds no claim is repeatable: the original request may still be verifying payment and can finish later. Known pre-provider cooldown, quota or capacity failures offer an explicit retry using the same exact metadata and UUID. Pending or uncertain requests never silently receive a new UUID when details change; starting another paid request requires a separate confirmation and can spend another credit. Contact support before another request when the outcome is uncertain. Expired, deleted and lost-asset results cannot be recreated through recovery; diagrams, downloads and image links saved earlier are independent copies.

The server derives `accountBinding` from the account ID with a purpose-specific HMAC. It is stable across session/recovery rotation and grants no account or asset access. Each browser image request must include the binding from its verified billing session; a switched account is rejected before any claim or spend. Locally saved metadata for a different account remains visible but cannot be replayed against the new account. Session changes clear previous image and access-code displays, and delayed results are fenced against the active account.

The Checkout success query is a display hint. It never grants Premium. A session can remain pending while an asynchronous payment completes. Users can refresh status after returning. The status endpoint consults only the Checkout ID already stored for that account, and verifies its customer, completion, payment, subscription, and invoice against Stripe.

## Paid entitlement

The server requires all of the following before image generation:

- The cookie matches a stored account capability.
- The subscription belongs to that account's mapped Stripe customer.
- The subscription is active, contains the configured Premium Price, and has a paid period ending in the future.
- Its latest invoice is paid with a positive amount. Its InvoicePayments resolve to successful paid Charges through PaymentIntents or Charges. Refunded or disputed money does not count toward the paid total.
- No refund, dispute, or early fraud warning has put the subscription under payment review.

Trials, zero-value invoices, free promotions, client-side flags, URL parameters, and unrelated prices do not grant image generation. The server checks current Stripe state again before each image request. Provider failures and billing storage failures fail closed. Cancel-at-period-end retains access for the paid period; immediate cancellation, unpaid/past-due state, and expired payment periods revoke spend access.

Scheduled cancellation uses the earlier of Stripe's `cancel_at` date and the paid item's period end. Flexible billing can set `cancel_at` while leaving `cancel_at_period_end` false; the website's `cancelAtPeriodEnd` display flag represents either schedule. A terminal canceled/expired subscription can start a fresh Checkout immediately. Previous subscription and Checkout ownership is retired durably so delayed events cannot restore the old subscription during the replacement payment.

Webhook signatures are verified by the Stripe SDK against exact raw request bytes with a five-minute tolerance. The Vercel webhook disables body parsing. The development adapter retains the original byte buffer; parsed JSON is never reserialized to verify a signature. Event processing is idempotent, retries failures, and rejects an older lifecycle event overriding a newer one. Ownership comes from persisted Stripe Customer IDs and the current Stripe object graph, never browser-provided metadata.

Foreground paid-spend proof uses a separate persisted billing revision rather than the webhook event watermark. If a billing update commits while Stripe is being queried, the proof is retried against the latest revision. Three consecutive collisions fail closed before reserving image allowance or calling OpenAI. A fresh cancellation cannot be discarded in favor of cached paid state merely because a newer webhook committed during the lookup; refund/fraud holds are preserved throughout.

Register these webhook events with API version `2026-09-30.endive` (the version pinned by Stripe Node SDK 23.0.0):

- `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`
- `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`
- `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`
- `charge.refunded`, `charge.dispute.created`, `radar.early_fraud_warning.created`

Refunds (including partial refunds), disputes, and early fraud warnings suspend image generation for the affected subscription pending operator review. The handler follows PaymentIntent → paginated InvoicePayments → Invoice parent → Subscription to resolve ownership. Risk holds are persisted independently of fulfillment order: an early warning arriving before the subscription is recorded cannot be lost. If the invoice link is not yet visible, the verified PaymentIntent Customer receives an account hold for review. A successful later invoice does not silently clear a risk hold. This release does not automatically send dispute evidence, issue refunds, or cancel a subscription on a fraud warning; operators should review the event in Stripe and resolve the account hold through their support procedure.

For a known account, revocation commits to the account record before its risk boundary is published. Revocations and paid allowance reservations serialize through the same atomic account update, including a billing revision change. A request already authorized before revocation can finish; later reservations are rejected. This is the application's authorization boundary, and it cannot retroactively cancel provider work already authorized. Persisted independent risk records retain warnings that precede subscription fulfillment.

Webhook proof also checks the billing revision captured before its Stripe lookup. If cancellation or subscription retirement commits during that lookup, the stale snapshot is rejected and Stripe's retry reads fresh ownership. Checkout polling, expiry, and creation commits check the stored Checkout ID and nonce, so an older request cannot erase or replace a newer Checkout. Expired predecessors retain an ownership tombstone for delayed event delivery. A completed asynchronous payment remains pending until its actual Stripe lifecycle changes; exceeding one day does not permit another subscription.

## Image generation and sharing

Prompts accept 3–2,000 characters, a supported style (`surreal`, `editorial`, `blueprint`, `minimal`), and size (`square`, `landscape`, `portrait`). The server sends a fixed single-image request to OpenAI with automatic moderation, medium quality, WebP output and bounded response size. Returned data must contain one image with canonical base64, complete RIFF chunks, a still-image bitstream header, and bounded dimensions. These checks follow the [WebP container specification](https://developers.google.com/speed/webp/docs/riff_container); they validate structure rather than decoding the compressed pixels. The current official OpenAI guide recommends `gpt-image-2.5-flare` for fast generation; the default can be changed using a server environment variable.

Each request needs a UUID. A compact durable claim retains the account/request identity, description hash, creation time, outcome and asset reference or sanitized failure. It contains no prompt, read capability or image pixels and has no expiry. Keep these claims in durable backups; removing them would remove same-ID spend protection. Full completed response metadata, including its read URL, is cached separately for 24 hours. An authenticated owner can recover that result after cancellation or provider downtime, without new paid proof or spend. Responses report current quota rather than an old saved count. After the recovery cache expires, the same UUID returns HTTP 410 without generating again; the image link saved earlier remains usable. Deleted or missing assets also return HTTP 410. Changing the description requires a new UUID. Known requests still in the previous 24-hour cache are promoted when read; history that expired before this change cannot be reconstructed.

An explicit retry can re-run a cooldown, quota, or shared-capacity preflight failure once that condition clears; its atomic claim still permits only one worker, even after a day or process reload. Requests that reached the provider are never re-sent under the same UUID. Explicit provider rejection or rate limiting refunds the member's image allowance but keeps the request non-replayable. A timeout, uncertain provider outcome, or result-storage failure retains the reservation. A pending request older than two minutes reports HTTP 504 uncertainty rather than claiming it is still running indefinitely; a late original completion can still save its result. Contact support before creating another request when spend is uncertain. Global attempt capacity remains charged to bound operator costs.

If a browser disconnects after generation has been authorized, the server saves the result when the provider finishes, provided the hosting process remains alive. A retry with the same UUID recovers that result. The browser disconnect does not automatically resend or refund an uncertain provider request.

Default limits are 30 images per calendar month (UTC), 5 per day (UTC), one request every 20 seconds, and 100 global attempts per day. All paid spend counters use atomic durable store writes. There is no overage billing: exhausting an allowance disables more generation until reset. These are configurable product limits, not provider guarantees.

Generated images are persisted as separate assets. The API returns a short absolute HTTPS URL in deployment, or a same-origin `/api/images/` path during localhost HTTP development, so diagrams can save, share, and export them within the existing chart JSON size limit. The URL contains a random read-only capability. Anyone with the URL or a shared diagram containing it can read the image; it grants no Premium, billing, or edit access. Store only the capability hash in the asset record. Image reads allow cross-origin canvas export without sending cookies. Do not collect full asset URLs in access logs, analytics, or error reports, because their query includes that read capability.

Images have indefinite retention, matching the default shared-chart policy, and survive cancellation. An authenticated owner can delete an asset; deletion removes the image data and token from its tombstone, and generation retries cannot recreate it. New image reads use `no-store` and reject deleted assets. Deletion cannot revoke pixels already read, downloaded or embedded in an earlier export. Deleting a chart does not automatically delete an image that may also be used in other charts. Generated images must be deleted separately through the image owner endpoint. Cancellation stops new spend and does not erase already-created work.

PNG, SVG and GIF export check generated image capabilities with bounded, deduplicated `no-store` HEAD requests before measuring or capturing the detached snapshot. Only same-origin `/api/images/:uuid` routes with exactly one decoded `key` parameter containing 43 base64url characters are checked. Valid percent-encoded query characters are normalized and fragments removed before deduplication; remote hosts, extra parameters and malformed keys do not expand the preflight fetch scope. This adds no requests to remote imported images. A deleted or unavailable generated image rejects the new export rather than reusing the renderer's cached pixels. The live canvas is preserved. An image deleted after a successful check may already have been read, so this is an availability check, not revocation of existing copies.

## Configuration

All secrets belong in server-side sensitive environment variables or the hosting platform's secrets vault. Never use a `VITE_` prefix. Prefer a restricted Stripe key and grant only the reads/writes needed for Customers, Prices, Checkout Sessions, Billing Portal Sessions, Subscriptions, Invoices, InvoicePayments, PaymentIntents and Charges. Use separate isolated Stripe sandboxes for development and CI.

| Variable | Purpose |
| --- | --- |
| `STRIPE_RESTRICTED_KEY` | Preferred restricted server API key. Current CLI temporary `rkcs_test_` sandbox keys are supported. |
| `STRIPE_SECRET_KEY` | Optional server-key fallback when a restricted key is not available. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of the matching sandbox/live webhook listener. |
| `STRIPE_PREMIUM_PRICE_ID` | Active, positive, recurring Stripe Price for this Premium product. The server reads amount/currency/interval for the UI. |
| `BILLING_SESSION_SECRET` | At least 32 random characters for CSRF signing and purpose-specific opaque account bindings. Rotating it changes saved-request account bindings. |
| `PUBLIC_BASE_URL` | Fixed website origin for same-origin actions, success/cancel links and generated image URLs. HTTPS required except localhost. |
| `BILLING_MODE` | Must explicitly be `live` to enable live Stripe keys. Omit during development. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Durable production Upstash Redis, shared with chart storage. `UPSTASH_REDIS_REST_*` also work. |
| `BILLING_STORE_FILE` | Local single-process file store for development. Required without Redis; file writes are atomic and use mode 0600. Never a production substitute for Redis. |
| `OPENAI_IMAGE_API_KEY` | Server OpenAI Images API key. `OPENAI_API_KEY` is an optional fallback. |
| `OPENAI_IMAGE_MODEL` | Optional model, default `gpt-image-2.5-flare`. Model access must be verified for the operator's account. |
| `PREMIUM_IMAGE_MONTHLY_LIMIT` | Default 30 (maximum 500). |
| `PREMIUM_IMAGE_DAILY_LIMIT` | Default 5 (maximum 100). |
| `IMAGE_GLOBAL_DAILY_LIMIT` | Default 100 (maximum 10,000). |
| `IMAGE_COOLDOWN_SECONDS` | Default 20 (maximum 3,600). |

Missing configuration reports that Premium/images are unavailable and never substitutes a fake paid state. Production requires durable Redis even when anonymous chart storage is configured as memory. Keep billing persistence backed up; recovery, subscription ownership, risk holds and usage counters live there. File storage is for one development process and does not coordinate separate processes.

Live Checkout is disabled while the image provider is missing; sandbox Checkout remains available for payment validation. The session endpoint's `checkoutAvailable` flag also accounts for unavailable/retired Prices. Existing members keep verified status and `canManageBilling` access when upgrades are unavailable. `hasSubscription` and `canManageBilling` indicate ownership/management, and never grant paid image generation. HTTP limits allow 120 status requests per IP per minute, 30 mutations per action per IP per hour (10 restores), and 10 new browser accounts per IP per hour in production; local development permits 100 accounts for independent test browsers.

Configure Stripe Customer Portal to allow cancellation and payment method management. Check that the hosting plan permits a 120-second image function duration before enabling generation; the application sets `maxDuration=120` and stops the provider request at 110 seconds. Confirm Images API access and expected costs in the OpenAI project, including provider-side spend caps. Set the Premium price and image allowances deliberately before selling the feature.

Stripe Tax is not enabled automatically. Before public sales, assess the operator's tax obligations and configure active tax registrations and Stripe Tax where applicable. A flag without registrations does not establish correct collection. Operator policies, support contact, refund terms, account recovery handling, and risk-review procedures require approval before launch.

## HTTP endpoints

| Endpoint | Request | Result |
| --- | --- | --- |
| `GET /api/billing/session` | Cookie, when present | Verified Premium state, price, quota, recovery, CSRF token, opaque `accountBinding`, `hasSubscription`, `canManageBilling`, `checkoutAvailable`; creates a secure free session when configured. |
| `POST /api/billing/checkout` | Cookie + Origin + `X-CSRF-Token`, `{}` | Stripe hosted Checkout URL; uses server Price and Customer mapping. |
| `POST /api/billing/portal` | Cookie + Origin + CSRF, `{}` | Stripe hosted Customer Portal URL for this account. |
| `POST /api/billing/recovery` | Cookie + Origin + CSRF, `{}` | New one-time recovery code; invalidate any previous code. |
| `POST /api/billing/restore` | Cookie + Origin + CSRF, `{recoveryCode}` | Rotated cookie and CSRF token; recovery code consumed. Start with session GET in a new browser. |
| `POST /api/billing/webhook` | Stripe signature, exact raw body | Verified fulfillment/lifecycle/risk processing. |
| `POST /api/images` | Cookie + Origin + CSRF, `{prompt,style,size,requestId,accountBinding,recoverOnly?}` | `{image:{id,url,prompt,createdAt},usage:{limit,used,remaining,resetAt}}`. `recoverOnly:true` never starts a request, reserves allowance or calls the provider. |
| `GET/HEAD /api/images/:id?key=...` | Read capability URL | Stored WebP image; no membership cookie required. |
| `DELETE /api/images/:id` | Owner cookie + Origin + CSRF | Asset deletion; subsequent reads are 404. |

An unmatched or missing account binding returns HTTP 409 `image_account_changed`. A recovery-only check without a known request returns HTTP 404 `image_request_missing`, which may be checked again; it does not create a claim. Reading a known legacy request may promote its existing claim for durable retention. Expired result caches or deleted/missing assets return HTTP 410; a pending request past its two-minute horizon returns HTTP 504 `image_uncertain`. These responses do not authorize a fresh paid request under another UUID.

## Validation and official references

`src/test/server/billing.test.ts` covers real HTTP handling, actual Stripe SDK signature verification and tampering rejection, unpaid/paid/asynchronous fulfillment, customer/price/environment ownership, webhook ordering and replay, cancellation/renewal, risk mapping, recovery rotation, durable file reload, fail-closed Redis, quotas/concurrent request deduplication, bounded provider requests, shareable asset reads and owner deletion. Its provider calls are fixtures. A separate real sandbox run is required to prove hosted Checkout, the Stripe account's portal configuration and actual webhook delivery together; successful unit tests do not prove those external settings.

Recovery tests also cover persistence before the first POST, remount without automatic generation, simultaneous activations, blocked/silent storage failures, exact same-ID retry, canceled/provider-unavailable/zero-credit recovery, account switching and delayed account responses. A held paid-proof fixture verifies that a recovery check arriving before the original claim creates no claim or reservation and can recover its later completion. The provider deadline test advances the actual timeout against an abortable fixture; it verifies support guidance and one outbound attempt, without a real provider charge.

On October 1, 2026 (Pacific time), a separate temporary Stripe sandbox verified the backend against the real Stripe API and genuine delivered webhooks: paid Visa subscription fulfillment; current InvoicePayments/Charge proof; browser-capability recovery; full refund; cancellation; an incomplete subscription from a declined attached card; a disputed test charge; and an early fraud warning. A genuine paid-event replay and a locally signed older-order fixture could not restore revoked access. The early warning test found and corrected a fulfillment-order race, then passed with a newly created warning. All subscriptions created by this backend validation were canceled and their remaining open Checkout Sessions expired. The sanitized evidence is saved outside the repository in `work/payment-validation/lifecycle-evidence.json`; it contains no keys, cookies or recovery codes. This validates the payment backend in that sandbox. It does not by itself prove hosted Checkout browser completion, portal setup, real OpenAI image generation, or production configuration.

A separate browser then completed genuine hosted Checkout with Stripe's 4242 test Visa and verified the website's paid state. Manage subscription opened the real hosted Portal with the paid USD 12 invoice, and Portal cancellation scheduled service to end on November 2. A read-only API check confirmed the successful, unrefunded, undisputed payment and found the flexible-billing cancellation field difference corrected above. Hosted billing is therefore verified in this sandbox. A real OpenAI image request remains unverified because no Images API credential is configured; the studio displays this unavailability and does not fabricate generated output.

After saving hosted proof, that test subscription was canceled immediately and a genuine webhook revoked its entitlement. An independent real sandbox account then paid, canceled, and started a new Checkout immediately; expiry of its old Checkout did not clear the replacement. Both open Sessions were expired afterward, and the sandbox had zero active subscriptions. Sanitized follow-up evidence is `work/payment-validation/hosted-subscription-evidence.json`. Separately, immutable held-provider fixtures reproduced the foreground/webhook race before the revision fix, then verified rejection without image-provider calls and bounded fail-closed retries. This concurrency regression uses fixtures, not a real OpenAI charge.

Primary sources consulted: [Stripe hosted subscriptions](https://docs.stripe.com/payments/checkout/build-subscriptions), [webhook signature verification](https://docs.stripe.com/webhooks), [subscription and refund event handling](https://docs.stripe.com/billing/subscriptions/webhooks), [Checkout Sessions creation](https://docs.stripe.com/api/checkout/sessions/create), [OpenAI image generation](https://developers.openai.com/api/docs/guides/image-generation).
