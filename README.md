# Character and motion studio

A session-only app for putting a complete chosen character into a moving scene. Upload a reference showing the character's face, hair and outfit, or generate a fictional adult reference, then review a short source scene before generation.

The default **Full character** workflow implements an experimental mask-guided VACE preview through fal. It accepts a 2–5-second uploaded MP4 and a user-selected whole-person region. It is **disabled by default**, pending paid credentials, provider-account spending controls and an explicit operator decision. Its live output quality and audio preservation have not been verified. The selection is a first-frame guide for provider tracking, not an automatically verified full-body mask across the entire clip.

The separately selected **Experimental free preview** uses the original Hugging Face Space. It can retain source clothing and is not a reliable full-character swap. Returned mask/background diagnostics are available for review. Neither path falls back to the other automatically.

Read [the full-character research and roadmap](docs/full-character-replacement.md) and [implemented behavior and paid setup](docs/replacement-setup.md). These files contain the project findings for later review; generated user media and credentials are not committed.

The current free prototype generates the first **two seconds at low resolution**, using the source scene's motion and audio. It does not add custom speech or lip-sync. Resolution and aspect ratio come from the motion provider; this is not a fixed 15-second ad exporter. Product uploads, product fields, ad scripts, narration, captions, and the old rendering pipeline have been removed.

## Run locally

Requires Node.js 20.19+ and npm, with desktop Chrome or Edge.

```powershell
npm install
Copy-Item apps/web/.env.local.example apps/web/.env.local
# Fill in the ignored .env.local privately, then:
npm run dev
```

Open [the studio](http://localhost:3000/studio). Use the shared password, select your character, then choose a scene and approve external processing before generating. Refreshing or closing the tab discards the draft; download the finished clip before leaving. A warning appears when leaving unfinished work.

## Credentials and provider usage

Set these only in ignored `apps/web/.env.local` or Vercel's server environment:

| Variable | Purpose |
|---|---|
| APP_ACCESS_PASSWORD | Shared tester password, at least 16 characters |
| SESSION_SIGNING_SECRET | Cookie/cancellation signing secret, at least 32 characters |
| HF_TOKEN | Free Hugging Face read token; needed only for the experimental free video preview |
| CLOUDFLARE_ACCOUNT_ID | Optional, needed for prompted character portraits |
| CLOUDFLARE_API_TOKEN | Optional Workers AI token for prompted character portraits |
| FAL_KEY | Optional paid full-character provider credential; leave unset until paid setup is reviewed |
| ENABLE_PAID_MOTION | Defaults to false; explicit operator enablement for the paid integration |
| PAID_MOTION_BUDGET_REVIEWED | Defaults to false; acknowledges spending-control review, not an enforced/global dollar cap |

For the free preview, create a free [Hugging Face account](https://huggingface.co/join), verify its email, then create a dedicated [Read token](https://huggingface.co/settings/tokens). Keep that account's paid billing disabled and do not buy inference credits. The free adapter checks whoami-v2 before each submission and refuses accounts unless isPro=false. Prompted character references use Cloudflare Workers AI `@cf/black-forest-labs/flux-1-schnell` with four steps; keep that account within its free allocation too. Uploaded references need no Cloudflare credentials. Existing ignored credentials are not deleted automatically.

The free paths display "$0 within available free quotas" before provider requests. Shared quotas can be exhausted or unavailable. The paid path separately says charges apply and requires its own processing consent; read [setup and remaining production work](docs/replacement-setup.md) before enabling it. There is no automatic provider fallback or generation retry. Cancellation is best-effort; started processing may still consume quota or be billed.

## Media and privacy

- Character references: JPEG, PNG, or WebP, up to 10 MB and 40 million pixels, decoded in the browser. Show the intended hair/outfit/body and an unobstructed face. Uploaded likenesses require consent.
- Motion reference: resized locally to JPEG up to 768 pixels and 1 MiB. Server signature/dimension validation caps dimensions at 1024.
- Free-preview scenes: MP4 up to 3 MiB, 2–15 seconds, at most 4K. Only the first two seconds are generated.
- Full-character preview scenes: MP4 up to 3 MiB, trimmed to 2–5 seconds, at most 1080p/2048 pixels per dimension. A first-frame whole-person selection guides provider tracking; it does not prove an accurate body mask throughout the video. Use one clearly visible person and a steady camera.
- The app stores drafts and output only in browser memory. No database, account system, browser storage, persistent queue, or object storage is used.
- The free preview sends media to the public [Wan2.2-Animate Space](https://huggingface.co/spaces/alexnasa/Wan2.2-Animate-ZEROGPU). The separately consented paid path uploads character/scene/selection guide to fal and requests a one-hour media lifecycle preference. Neither that preference nor the memory-only draft guarantees provider deletion. Use permitted, non-sensitive media.

## Architecture

Next.js App Router, React, TypeScript, shadcn/ui, and Tailwind. Browser-safe types and validation live in packages/core; server-only provider requests live in apps/web/src/lib/server. No inference SDK, local weights, GPU process, native ffmpeg, or ffmpeg.wasm is required.

The server authenticates all generation requests with a signed 12-hour HttpOnly, SameSite=Strict cookie, Secure in production, and checks the Origin. Missing configuration fails closed. JSON bodies are limited to 16 KiB; multipart uploads stay below Vercel's payload limit. Requests have an 85-second abort deadline and a 90-second function maximum.

| Endpoint | Purpose |
|---|---|
| GET /api/session | Check authentication |
| POST /api/session | Sign in |
| DELETE /api/session | Sign out |
| POST /api/avatar | Generate one character portrait |
| POST /api/motion | Load the demo, submit a motion job, or cancel |
| GET /api/replacement | Check whether paid full-character setup is enabled |
| POST /api/replacement | Submit a separately consented mask-guided preview, check its existing job, or request cancellation |

The free adapter uses the named Space in Character Swap / Low Res mode. Its raw REST request needs six inputs, including a hidden final State null omitted by its public API description. The browser holds one continuous result stream and downloads a bounded MP4 into memory; reconnecting or refreshing can lose the result. HF_TOKEN stays server-only, cancellation tickets expire after 20 minutes, and media URLs stay on the Space. The fal adapter uses separate signed 30-minute jobs with server-side status/cancel calls and HTTPS fal.media results. It never forwards its key to browsers or signed storage PUTs.

Input changes clear dependent output and consent. Failures preserve completed inputs and earlier output. The client prevents duplicate operations. The paid server's same-key guard is process-local, not durable/global billing protection. Unknown jobs/submissions hold editing until resolved or explicitly left. Reauthentication preserves the in-memory draft; reset revokes Blob URLs and clears it.

## Verification

```powershell
npm test
npm run typecheck
npm run build
npm run test:browser
```

The repository browser configuration targets installed Chrome and Edge. The cloud's separate Chromium configuration has been verified; branded-browser release coverage remains outstanding. Regressions use controlled provider responses and real media decoding/playback/downloads, including full-character selection, paid consent, known/ambiguous job recovery, invalid output and earlier-result preservation. Artifacts stay under ignored test-results/; these tests do not demonstrate live generation quality.

For an explicit real free-GPU test, set MOTION_REFERENCE_PATH to an absolute path to a permitted, non-sensitive portrait, then run `npm run test:motion`. This sends that portrait to the provider and consumes free quota. The normal regression suite does not consume inference quota. `npm run test:live` is an alias for the same motion check.

Earlier native free-account generation produced a two-second H.264/AAC clip, followed by a browser attempt that hit free quota. A later supplied-media browser test completed a real 2-second 368 × 608 download and playback, but retained the source outfit/hair and failed full-character fidelity. Paid live quality/audio remain unverified. Existing .data files remain untouched; no user media is committed.

## Vercel

Use Root Directory `apps/web` and include shared workspace sources outside it. Install with the npm lockfile and run the web build script. Authentication requires APP_ACCESS_PASSWORD and SESSION_SIGNING_SECRET; add HF_TOKEN only for the free preview and Cloudflare bindings only for prompted references. Keep the paid flags false until its account/spending setup is deliberately reviewed. Public paid deployment additionally requires durable cross-instance job/idempotency/budget controls; the current process-local prototype is insufficient. Verify a deployment preview before promotion. Vercel Hobby requires personal non-commercial use; no preview deployment has been verified.
