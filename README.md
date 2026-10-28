# AI Wrapper

A session-only product-video studio. Upload a real product photo, upload or describe a presenter portrait, review a script and narration, then download a 15-second vertical MP4. Presenter images remain still; v1 does not generate lip-sync or body motion.

## Run locally

Requires Node.js 22 and npm. The session studio does not require Postgres, Ollama, Piper, or native ffmpeg.

```powershell
npm install
if (-not (Test-Path apps/web/.env.local)) { Copy-Item apps/web/.env.local.example apps/web/.env.local }
# Fill in apps/web/.env.local, then:
npm run dev
```

Open http://localhost:3000. /studio is an alias for the same screen. Keep the tab open and download the result before refreshing; there is no project history, database, localStorage, or object storage in this flow.

If apps/web/.env.local already exists, preserve it and fill its empty provider fields. The local setup may already contain generated app authentication secrets.

## Credentials and free-tier setup

All credentials stay on the server. Never prefix them with NEXT_PUBLIC_ or commit .env.local.

| Variable | Setup |
| --- | --- |
| GEMINI_API_KEY | Create a key in [Google AI Studio](https://aistudio.google.com/api-keys) in a project without paid billing. |
| CLOUDFLARE_ACCOUNT_ID | In [Cloudflare Workers AI](https://dash.cloudflare.com/), choose Use REST API and copy Account ID. |
| CLOUDFLARE_API_TOKEN | On that page, choose Create a Workers AI API Token and use the supplied permission template. Stay on Workers Free. |
| GROQ_API_KEY | Create a key at [Groq](https://console.groq.com/keys); keep the account on the free plan. |
| APP_ACCESS_PASSWORD | Shared tester password, at least 16 characters. |
| SESSION_SIGNING_SECRET | Random secret, at least 32 characters. Generate locally using the command below. |

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Do not paste secrets into chat or commit them. Keep the tracked example file blank; edit only `apps/web/.env.local`. Git ignores environment variants, Vercel metadata, and private key files, but cannot protect secrets already committed. If a key enters a commit, revoke and replace it, then clean that commit from history before pushing. Restart the dev server after editing environment variables.

The selected REST models are gemini-3.1-flash-lite for copy, gemini-3.8-flash-tts with voice Kore for speech, @cf/black-forest-labs/flux-1-schnell with 4 steps for portraits, and whisper-large-v3-turbo for word timestamps. These IDs are pinned in apps/web/src/lib/server/providers.ts against current documentation. Live model access and free-account quota must still be verified with your credentials before release. No automatic retries or paid provider fallback are implemented.

[Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Cloudflare pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Groq limits](https://console.groq.com/docs/rate-limits).

## Creation flow

1. Enter the shared password. The server issues an HttpOnly, SameSite=Strict cookie valid for 12 hours, Secure in production.
2. Select a product photo, name, factual benefit, and optional direction. Select one presenter image with likeness consent, or generate a fictional adult portrait. Uploads stay in browser memory.
3. Generate or edit roughly 30 words of copy. Generate narration, then request caption timings separately. A timing failure can be retried without generating speech again.
4. Review all three scene previews, the spoken audio, and the transcript. Approve the current inputs and create the MP4.
5. Play and download the MP4. Start over clears all session media. Closing or refreshing the tab discards the draft.

The output is 720 x 1280, 30 fps, 15 seconds, H.264/AAC. Scenes cover presenter/product (0–3s), product/benefit (3–11s), and presenter/product with Learn more (11–15s). Real product images are proportionally fitted into the frame. Long narration is rejected without truncation. Short audio is padded with silence. Captions use returned word timings, never invented uniform timing.

The single-thread ffmpeg.wasm engine runs in a browser worker. Its assets are copied from locked npm packages by the predev/prebuild script; the caption font and OFL license are bundled. No WASM or font CDN requests are needed. The font stack for the app is the system default. Desktop Chrome and Edge are supported; phone browsers are outside v1.

## API

All responses are uncached. Generation routes require the signed cookie and a matching Origin header. JSON requests are limited to 16 KiB, WAV timing requests to 1 MiB. Provider requests time out within the 90-second function deadline. Provider responses are bounded below Vercel's payload limit.

| Route | Request | Result |
| --- | --- | --- |
| GET /api/session | Cookie | authenticated boolean |
| POST /api/session | JSON password | Signed session cookie |
| DELETE /api/session | Matching Origin | Expire cookie |
| POST /api/script | JSON name, benefit, direction | JSON script |
| POST /api/avatar | JSON prompt | JPEG or PNG bytes |
| POST /api/voice | JSON script | PCM WAV bytes, X-Audio-Duration header |
| POST /api/timings | audio/wav body | JSON timings: word, start, end |

Errors use { error: { code, message } }, with invalid_input, unauthorized, forbidden, missing_configuration, quota_exhausted, provider_refusal, timeout, or upstream_failure. Never log provider credentials, uploaded media, or script contents. The shared password is a tester gate, not per-user quota accounting. Everyone with access shares the free provider allowance. Logout clears the browser cookie; rotating the signing secret invalidates all existing cookies.

## Verification

```powershell
npm test
npm run typecheck
npm run build
npm run test:browser
# After configuring free-tier credentials, make real provider calls:
npm run test:live
```

The browser tests use installed Chrome and Edge, controlled API responses, and actual ffmpeg.wasm encoding. Test audio is a fixture tone, not a real-provider narration claim. Exports and screenshots are written under ignored test-results/. Unit tests cover authentication, origins, body limits, WAV parsing, caption timing, render plans, and documented provider shapes. A separate real-provider smoke check and Vercel preview check are required before promotion.

To test the production bundle locally, first build, then run `$env:AIW_TEST_PRODUCTION = '1'; npm run test:browser` in PowerShell. Run builds and browser tests sequentially because both use the same Next.js output directory. The tests check cookie authentication, production-only legacy route blocking, actual encoding/playback/download, cancellation and rerendering, session recovery, image validation, and API request-size limits.

The dependency audit currently reports existing Next.js/PostCSS advisories in Next's bundled PostCSS 8.4.31. The studio does not accept or process user CSS. A framework/dependency upgrade is separate from this MVP change; do not run npm audit fix --force to silently introduce a major Next.js upgrade.

## Vercel

Use Next.js with Root Directory apps/web, enable source files outside the root directory, install with the repository's npm lockfile, and run the app's build script. Configure the six variables above separately for Preview and Production. Never deploy real credentials as public variables. Verify preview generation, same-origin cookie access, static WASM/font loading, and downloaded MP4 playback before promotion.

Vercel Hobby is restricted to personal, non-commercial use. Free access does not automatically make a business deployment non-commercial. [Fair-use rules](https://vercel.com/docs/limits/fair-use-guidelines).

## Transition status

The previous database-backed source and dependencies are intentionally retained until a real narration plus real word-timing export succeeds using the intended free accounts. The legacy UI is available in development at /legacy and /new, and npm run dev:legacy starts the original local stack. Legacy pages, media, and server actions return 404 in production. Existing .data files are preserved. Remove this section and the legacy infrastructure only after the approved feasibility gate passes.
