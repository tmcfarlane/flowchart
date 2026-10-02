# ChatGPT plan usage for diagram AI

The intended integration lets a user authorize their ChatGPT plan to pay for eligible diagram generation and editing requests. Identity and AI usage are separate permissions. Signing in alone does not enable inference. This feature is not enabled in the current website.

The current `POST /api/chat` route sends requests only to the operator's configured Azure deployment using its server-side `AZURE_*` settings. An OpenAI API key, consumer bearer token or browser-supplied plan flag does not activate ChatGPT plan usage. Missing Azure configuration returns an unavailable response without an upstream call. The current UI exposes no ChatGPT sign-in, connected-plan badge or subscriber usage controls. MCP chart tools operate independently of this text generation route.

OpenAI's [current integration overview](https://developers.openai.com/siwc/token-sharing-open-source) makes the direct flow available for open-source and locally hosted apps. Paid or remotely hosted apps must use the interest/approval route described there. The hosted Flowchart website includes Premium subscriptions, so its production integration needs that approval and issued application configuration. Do not enable the open-source dynamic-registration flow on the commercial hosted service as a substitute.

## User experience

Offer **Continue with ChatGPT** when an approved integration is configured. Ask for plan-usage permission explicitly and confirm it after the first successful connection. Show **Using ChatGPT plan** beside diagram chat while that billing path is selected, with a **Manage usage** link to ChatGPT settings. Display the user's current account-specific model choices. Keep website Premium billing separate from ChatGPT plan usage.

If the user declines plan usage, retain a valid sign-in and explain that AI usage remains disconnected. If usage is exhausted, preserve their prompt and canvas, offer **Manage usage**, and wait for their choice. Never silently charge the website's API account or buy additional credits as a fallback. Connection does not provide access to ChatGPT conversations or memories. Follow the [official UI guidelines](https://developers.openai.com/siwc/ui-ux-guidelines).

## Implementation contract after approval

1. Use the approved client registration and callback configuration. Start OAuth with PKCE, random state and nonce, and the permitted identity/Responses scopes. Validate the returned ID token's signature, issuer, audience, expiry and nonce. Require the granted `chatgpt.tokens.use.direct` permission before using a ChatGPT plan.
2. Keep tokens in a protected server-side account store with an HttpOnly browser session; never expose access or refresh tokens to React, local storage, URLs, analytics or logs. Keep registrations and refresh-token rotations bound to their verified account and workspace configuration. Follow [accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).
3. Discover the selected account's models using its inference access token. Submit the diagram context to `POST https://api.openai.com/v1/responses` with `store: false`, `stream: true`, and the required history as an input array. Keep the existing graph validation and preview/apply baseline checks. Successful inference requires `response.completed`; partial text, interrupted streams or `response.failed` cannot become an applicable diagram. Follow [models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).
4. Handle refresh, declined permission, revoked connections, unsupported capabilities and app/plan limits with the exact returned error code. Preserve prompts and diagrams. Follow [errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery).
5. Verify sign-in, consent decline, token validation/rotation, complete inference, app usage limits, disconnect and account switching before displaying this option in production.

## Premium images

The documented ChatGPT plan-usage preview excludes image generation and hosted MCP tools. Diagram text requests can use the plan route when approved; Premium image generation currently uses the operator's separate OpenAI image API configuration. Image requests remain gated by a verified paid subscription and quota. Do not send image requests to an unsupported subscription endpoint. See [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) and [Premium implementation](premium.md).

Verified against official OpenAI documentation on 2026-10-02. The approval and a completed real subscriber-funded inference request remain unverified.
