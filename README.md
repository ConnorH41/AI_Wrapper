# Character and motion studio

A session-only app for putting a chosen character into a moving scene. Upload a portrait or generate a fictional adult character, load a demo scene or upload a short MP4, review both, then generate and download a character-replacement clip.

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

## Credentials and free usage

Set these only in ignored `apps/web/.env.local` or Vercel's server environment:

| Variable | Purpose |
|---|---|
| APP_ACCESS_PASSWORD | Shared tester password, at least 16 characters |
| SESSION_SIGNING_SECRET | Cookie/cancellation signing secret, at least 32 characters |
| HF_TOKEN | Read token from a free Hugging Face account; required for video generation |
| CLOUDFLARE_ACCOUNT_ID | Optional, needed for prompted character portraits |
| CLOUDFLARE_API_TOKEN | Optional Workers AI token for prompted character portraits |

Create a free [Hugging Face account](https://huggingface.co/join), verify its email, then create a dedicated [Read token](https://huggingface.co/settings/tokens). Keep paid billing disabled and do not buy inference credits. The app checks whoami-v2 before each video submission and refuses accounts unless isPro=false. Prompted portraits use Cloudflare Workers AI `@cf/black-forest-labs/flux-1-schnell` with four steps; keep that account within its free allocation too. Uploaded portraits need no Cloudflare credentials. Gemini and Groq are no longer used. Existing ignored credentials are not deleted automatically.

The UI displays "$0 within available free quotas" before generation. Shared quotas can be exhausted or unavailable. There is no paid fallback or automatic generation retry. Cancellation is best-effort; a started remote job may still consume free GPU time. Waiting for a quota reset is not a guarantee of provider availability.

## Media and privacy

- Character portraits: JPEG, PNG, or WebP, up to 10 MB and 40 million pixels, decoded in the browser. Uploaded likenesses require consent.
- Motion reference: resized locally to JPEG up to 768 pixels and 1 MiB. Server signature/dimension validation caps dimensions at 1024.
- Uploaded scenes: MP4 up to 3 MiB, decoded in the browser, 2–15 seconds and at most 4K. Use one clearly visible person and a steady camera. Only the first two seconds are generated.
- The app stores drafts and output only in browser memory. No database, account system, browser storage, persistent queue, or object storage is used.
- After separate sharing consent, the public [Wan2.2-Animate Space](https://huggingface.co/spaces/alexnasa/Wan2.2-Animate-ZEROGPU) processes and temporarily hosts the character and scene. Use permitted, non-sensitive media. The app's session-only design does not control the provider's retention.

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

Motion uses the named Space in Character Swap / Low Res mode. Its raw REST request needs six inputs, including a hidden final State null omitted by its public API description. Vercel handles bounded submission. The browser keeps one continuous result stream open using an opaque job ID and downloads a bounded MP4 into memory. Reconnecting or refreshing can lose the result. HF_TOKEN stays server-only, including cancellation; cancellation tickets are signed and expire after 20 minutes. Media URLs are restricted to the fixed Space's cache paths.

Input changes clear dependent output and sharing consent. A failed request preserves completed inputs and an earlier successful video. Duplicate requests are blocked, generation is explicitly requested, and session reauthentication preserves the draft. Reset revokes Blob URLs and clears the session's media.

## Verification

```powershell
npm test
npm run typecheck
npm run build
npm run test:browser
```

Browser tests use installed Chrome and Edge, controlled provider responses, and real browser media decoding/playback/downloads. They cover both character sources, scene uploads, consent, invalidation, quota failure, cancellation, a second generation, authentication, reset, and removal of the product flow. Artifacts are saved under ignored test-results/.

For an explicit real free-GPU test, set MOTION_REFERENCE_PATH to an absolute path to a permitted, non-sensitive portrait, then run `npm run test:motion`. This sends that portrait to the provider and consumes free quota. The normal regression suite does not consume inference quota. `npm run test:live` is an alias for the same motion check.

On October 27, 2026, native free-account generation produced a fresh two-second H.264/AAC clip at 640 x 352 and 30 fps. The subsequent live browser attempt reached the provider but hit free GPU quota. A successful fresh complete browser generation remains unverified; controlled tests do not establish live-provider availability. The prompted-portrait live check also failed upstream that day despite active token verification. Existing .data files remain untouched; obsolete database-backed product source and dependencies were removed when the product-ad flow was retired.

## Vercel

Use Root Directory `apps/web` and include shared workspace sources outside it. Install using the repository's npm lockfile and run the web build script. Set the three required server variables in Preview and Production; add Cloudflare credentials only for prompted characters. No static WASM assets or runtime media storage are needed. Verify a preview, including authentication, provider CORS, cancellation and downloads, before promotion. Vercel Hobby requires personal non-commercial use. A preview deployment has not yet been verified.
