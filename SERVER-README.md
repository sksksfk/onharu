# Onharu private-minimum web push backend

Files: worker.js (module Worker), schema.sql (D1), tests.mjs (offline Node 22.13+/26 tests), run-tests.ps1 (sandbox-compatible runner).
No packages, no deployment performed, no browser/account changes.

## Setup (deployment owner)
1. Create a Cloudflare D1 database. Execute schema.sql against that database, e.g. with an already-installed authorized Wrangler: wrangler d1 execute onharu-push --remote --file=schema.sql . Alternatively use D1 console SQL.
2. Create a module Worker using worker.js, bind that D1 database as DB, and set Cron expression * * * * * (every minute, UTC).
3. Example wrangler.toml fragment:

    name = "onharu-push"
    main = "worker.js"
    compatibility_date = "2026-11-01"
    [triggers]
    crons = ["* * * * *"]
    [[d1_databases]]
    binding = "DB"
    database_name = "onharu-push"
    database_id = "REPLACE_WITH_D1_ID"
    [observability]
    enabled = false

4. Leave Workers invocation/request logging and log drains disabled. Code logs nothing, but Cloudflare infrastructure has its own operational processing/retention; do not promise zero provider metadata. Do not log request/response bodies, Authorization headers, subscription endpoints, D1 contents, or exports. D1 stores the VAPID private JWK; restrict database/dashboard access and backups. Public GitHub must contain only these source files, never a D1 dump.
5. GET /v1/config initializes VAPID server-side if needed. Concurrent first calls atomically elect one persistent key with INSERT OR IGNORE; all callers reread the winner. No private/admin endpoint. Preserve the database and VAPID row across deploys; deletion/rotation requires every browser to resubscribe.
6. Set frontend backend URL to the Worker HTTPS origin. Verify config, register, immediate test, delayed closed-app test, and a real scheduled minute on each supported phone. Cloudflare account/deployment and live browser-push verification remain outstanding.

## API
All mutation requests MUST have Origin: https://sksksfk.github.io (including manual test clients), JSON when a body is present, and HTTPS at the deployed Worker. Unknown origins get 403; no wildcard CORS or credentials cookies. OPTIONS permits only Authorization/Content-Type headers. GET config may be requested without Origin. Query parameters are rejected.

- GET /v1/config -> 200 {publicKey}. publicKey is unpadded base64url raw P-256 public key (65 bytes).
- POST /v1/devices -> 200 {id,token}. Body: {id,token,subscription:{endpoint,keys:{p256dh,auth}},times:["08:00"],timeZone:"Asia/Seoul"}. Browser subscription expirationTime is allowed but discarded.
  IMPORTANT contract extension: generate id from 16 cryptographically random bytes (22 unpadded base64url characters), token from 32 random bytes (43 characters), and persist BOTH locally BEFORE the first registration request. Retries MUST use the same id/token/subscription. The server only stores SHA-256(token). A lost response can then be safely retried. Do not create a new id after a network error. An existing endpoint cannot transfer to another identity; conflict/capacity returns 409. An identical retry never overwrites later schedule changes; use PUT for those. If credentials are lost, unsubscribe/resubscribe rather than attempting ownership recovery. For a subscription replacement, authenticate DELETE for the old identity before registering the new subscription.
- PUT /v1/devices/{id}, Authorization: Bearer <token>, body {times,timeZone} -> 200 {ok:true}. Empty times pauses future reminders. At most 32 unique strict HH:mm values; timezone is exactly Asia/Seoul. Schedules activate only for slots starting after registration/update, not retroactive current-minute catchup.
- DELETE /v1/devices/{id}, same bearer -> 200 {ok:true}. Existing identity with incorrect bearer gets generic 401. For DELETE only, an absent id with syntactically valid credentials returns ok for lost-response-safe idempotency. In-flight sends cannot be recalled.
- POST /v1/devices/{id}/test, same bearer, optional JSON {delaySeconds:0} (or no body) -> 202 {accepted:true,transportStatus:201,expired:false,delivered:false} if the push service accepted transport. Any 2xx transport is accepted. A nonaccepted transport returns 502 with accepted:false, actual transportStatus (null for network failure), expired boolean, delivered:false. This is NOT a browser delivery/display receipt. 404/410 deletes the expired subscription.
- Same test route with {delaySeconds:60} -> 202 {accepted:true,scheduledAt:ISO8601,transportStatus:null,delivered:false}. Here accepted means queued locally, NOT push transport acceptance. Close the app after this response. Cron sends once around 1-2 minutes after the request, not exactly 60 seconds. The only extra persisted datum is test_due_at, cleared by atomic claim. Failed/late tests do not retry. Tests are limited to once per device per 60 seconds; a pending test can be replaced by a later allowed test.
- Errors are JSON {error:code}: 400 validation, 401 authorization, 403 Origin, 409 registration conflict/capacity, 413 body >8192 bytes, 415 wrong media/encoding, 429 rate limit, 500 internal. No sensitive values are echoed in errors.

## Limits / privacy / scheduling semantics
- Small family limit: 12 registered devices; API aggregate 120 requests/minute via a singleton D1 minute counter, no IP storage. Origin is not authentication and can be forged by nonbrowser clients. This public registration API is NOT abuse-proof; an attacker can exhaust registration capacity/rate limits. Stronger anti-abuse would need a separate access-control decision, not hidden admin endpoints.
- Store only subscription (endpoint, p256dh/auth), endpoint uniqueness index, device identity/token hash, daily times/fixed timezone, last slot claim/attempt counters, operational timestamps/status, VAPID key singleton, and rate counter. No medicine names/doses/adherence/contacts/photos or application IP logs.
- Cron scans <=12 rows/minute. Asia/Seoul is fixed UTC+09:00 (no DST). Finds latest scheduled minute within a three-minute grace, never replays an outage backlog. Very close times in a missed-cron window can coalesce to the latest slot. Per-device atomic conditional UPDATE claims slots; parallel invocations do not normally send duplicate claims. No durable queue/health guarantee; quota/CPU exhaustion may drop reminders.
- HTTP TTL is <=120 seconds and also bounded by slot+3 minutes. Payload includes expiresAt; frontend service worker should discard expired messages. title: 온하루; body: 예정된 약 확인 시간입니다. 처방과 이미 복용했는지 확인해 주세요. No instruction to take medication. Test text is also generic Korean. Stable scheduled tag onharu-<UTC-minute>; payload data {url:"https://sksksfk.github.io/onharu/",slot,expiresAt,test}. Parents SW should show this content, use tag, and focus/open data.url. Do not display medication detail on lockscreen.
- Only explicit 429/5xx retry, max two transport attempts per slot, at least 60 seconds apart, respecting bounded Retry-After and grace deadline. 404/410 removes subscription; other 4xx and network/timeout/unknown outcomes are not retried. Atomic claims are deliberately not replayed after crashes; this prefers avoiding duplicate medication reminders over guaranteed delivery. A push service that accepts then returns 5xx could still produce duplicate transport; the stable tag mitigates duplicate notifications. A new later schedule slot supersedes an older pending retry. No exactly-once, exact-time, guaranteed-delivery, or medical-alarm claim.
- Endpoint SSRF boundary: exact HTTPS hosts fcm.googleapis.com, updates.push.services.mozilla.com, web.push.apple.com only. No ports (even explicit 443), userinfo, query/fragment, host suffix wildcards, raw whitespace/backslashes, noncanonical URLs. P-256 points are validated by WebCrypto import. Host paths are opaque subscriptions. Redirects are errors. Push response bodies are cancelled without reading/buffering; 8-second abort timeout. No other target is fetched.
- Cloudflare Workers Free + D1 intended; no paid binding. Maximum 12 sends per tick keeps ordinary subrequests below 50, including D1 calls. Actual CPU/quota suitability must be checked after deployment; no paid-plan promise and no automatic plan change. Cron and phone OS may be delayed; offline/disabled permissions/battery management can prevent notification. Not a medication safety system.

## Verification
Offline tests use real SQLite via Node's built-in node:sqlite shim for D1's prepare/bind/first/all/run interfaces, not a real Cloudflare runtime. Run node tests.mjs from this directory normally, or .\run-tests.ps1 in the restricted Windows sandbox. Tests make zero external network calls and never print generated secrets/tokens. Published RFC vector fixture keys are test-only, never production VAPID material.
Tests cover RFC8291 full ciphertext and CEK/nonce vector, independent WebCrypto HKDF receiver decryption, VAPID raw JOSE signature, concurrent VAPID initialization, endpoint/curve/time/body validation, idempotent registration/ownership/newer PUT preservation, Origin and bearer checks, atomic parallel cron, retry bound, expired subscriptions, delayed test atomic claim/cooldown.
Not verified: deployed D1/Workers runtime, Free CPU quotas, live push service acceptance, actual service-worker notification, phone closed-app display. No deployment was attempted.

Standards inspected before implementation:
- https://www.rfc-editor.org/rfc/rfc8291.txt sections 3.3/3.4/4/5 and Appendix A
- https://www.rfc-editor.org/rfc/rfc8188.txt sections 2/2.1/2.2/2.3
- https://www.rfc-editor.org/rfc/rfc8292.txt sections 2/3 (ES256, origin audience, <=24h expiration, vapid t=JWT,k=public-key)

