# Website identity with ChatGPT

The account control implements the [official hosted website identity flow](https://developers.openai.com/siwc/website): Authorization Code with PKCE and OpenID Connect. It creates a Flowchart session after validating the provider's identity token. It requests only `openid profile email`.

Live OpenAI sign-in remains unavailable until OpenAI issues an approved hosted client and registers this website's callback. No client has been issued or configured during this work. Local tests use signed synthetic identities; they do not establish that a real OpenAI authorization has completed.

Signing in does not enable [ChatGPT plan usage](chatgpt-plan-usage.md), change the diagram chat provider, grant Premium images, or connect existing billing accounts by email. Shared charts retain their existing capability-based permissions.

## Configuration

All settings are server-side. Never use a `VITE_` prefix or put an issued client secret in a URL, browser storage, or source control.

| Setting | Required value |
| --- | --- |
| `OPENAI_SIGN_IN_ENABLED` | `true` only after the hosted client has been approved and provisioned. Default is disabled. |
| `OPENAI_SIGN_IN_CLIENT_ID` | The application's issued `oaiapp_` client ID. |
| `OPENAI_SIGN_IN_REDIRECT_URI` | The exact registered callback, ending in `/api/auth/openai/callback`. |
| `OPENAI_SIGN_IN_TOKEN_AUTH_METHOD` | The provisioned `none` or `client_secret_basic` method; no inferred fallback. |
| `OPENAI_CLIENT_SECRET` | Required only for a confidential client using `client_secret_basic`. |
| `PUBLIC_BASE_URL` | Fixed website origin matching the registered callback. Production requires HTTPS. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Shared Redis, or the equivalent `UPSTASH_REDIS_REST_*` pair. Required for the default authentication store. |

Missing or invalid configuration leaves sign-in unavailable. Discovery is fixed to `https://auth.openai.com/.well-known/openid-configuration`; provider endpoints and issuer are validated before use. Development browser tests inject a memory store and a provider transport into a test-only server. The deployed API has no fixture selector or arbitrary issuer setting.

## Application endpoints

| Endpoint | Behavior |
| --- | --- |
| `GET /api/auth/openai/session` | Reports availability and verified first-party identity. Authenticated replies provide the CSRF value needed for sign-out. Plan usage always remains unavailable. |
| `GET /api/auth/openai/start` | Creates a short-lived browser-bound transaction and redirects to the discovered authorization endpoint. Unavailable configuration returns 503 without authorization or token requests. |
| `GET /api/auth/openai/callback` | Consumes the original transaction once, verifies state and exchanges the code with its original verifier and redirect URI. Creates a session only after signature and claim validation. Redirects to the website with a fixed success/error/cancelled status. |
| `POST /api/auth/openai/signout` | Requires the configured same-origin website and `X-OpenAI-Auth-CSRF`. Revokes the first-party session and clears its cookie. It does not sign out the user's ChatGPT account or remove billing state. |

Temporary sign-in and session cookies are host-only, `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/`. Transactions expire after ten minutes and are atomically consumed across instances. Sessions expire after eight hours. Session secrets are opaque; storage keys use their hashes. Provider tokens, authorization codes and PKCE verifiers are never returned by the session API or retained after authentication. Stable account identity uses the verified issuer, client ID and subject, rather than matching an email address.

## Verification

Run `npx vitest run src/test/server/openaiAuth.test.ts src/test/ChatGPTAccount.test.tsx` for authentication and account-control checks. These exercise signed JWTs, callback validation, replay and expiry, confidential-client errors, session revocation and origin/CSRF protection using fixtures.

Run `npm run test:browser:install` once, then `npm run test:auth:browser`. The browser suite serves a separate compiled application on an owned loopback port and invokes the real authentication handlers. It fetches the local authorization redirect with redirects disabled, checks the provider URL, and substitutes a clearly labeled test provider. An owned proxy on the next port refuses non-loopback browser traffic, including missed redirect interception. The suite verifies the default unavailable state and signed mock sign-in/sign-out. Its provider validates the original PKCE challenge before issuing a genuinely signed synthetic token. No OpenAI, Azure, Stripe or Redis credentials are used. `FLOWCHART_AUTH_BROWSER_PORT` selects a different pair of free loopback ports if needed.

Before enabling live sign-in, complete an actual authorization with the issued client in the intended environment, verify the exact registered callback and provisioned token authentication method, and confirm cookie/session behavior over HTTPS. That external dependency remains outstanding.
