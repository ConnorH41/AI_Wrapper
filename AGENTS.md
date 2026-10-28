# AI Wrapper — agent guide

## Current product

The approved MVP is a session-only UGC product-ad studio. The user supplies the real product photo and either uploads a presenter portrait or prompts a fictional adult presenter. They review the script, audio, caption transcript, and three scene previews, then approve and download a 15-second MP4.

The 15-second product ad keeps presenter portraits still. The optional character-replacement test below generates a separate moving clip. Neither flow adds new-script lip-sync, simulated product handling, a stock avatar library, or invented packaging.

## Stack and commands

TypeScript throughout. Next.js App Router, React, existing shadcn/ui and Tailwind. Browser-safe types and pure media helpers live in packages/core/src/session.ts and motion.ts, imported through @aiw/core/session and @aiw/core/motion. Server provider adapters live under apps/web/src/lib/server. The browser renderer uses single-thread ffmpeg.wasm in a Web Worker.

```powershell
npm install
npm run dev          # web only; no database or local models
npm test             # focused Node tests
npm run typecheck
npm run build
npm run test:browser # installed desktop Chrome and Edge
npm run test:motion  # explicit real free-GPU test; requires HF_TOKEN and MOTION_REFERENCE_PATH
npm run dev:legacy   # original local stack, retained temporarily
```

See apps/web/.env.local.example and README.md for credential setup. Do not print secrets or read .env.local into tool output. Check only variable names and presence. Never commit credentials or put them in NEXT_PUBLIC_ variables.

## Approved architecture

- Vercel hosts the app and bounded provider HTTP requests. This replaces the original blanket prohibition on generation requests in serverless; ffmpeg assembly still never runs in a function.
- Images, previews, audio, timings, and final video live only in browser memory. No database, persistent job queue, browser storage, object storage, or account system is needed for the session flow.
- The shared tester password lives in APP_ACCESS_PASSWORD. SESSION_SIGNING_SECRET signs 12-hour HttpOnly, SameSite=Strict cookies, Secure in production. Every provider endpoint checks authentication and Origin. Missing configuration fails closed.
- Keep product logic and provider credentials behind API boundaries. Canvas preparation and ffmpeg encoding execute in the browser.
- Uploads are JPEG, PNG, or WebP, at most 10 MB and 40 million pixels. Validate decoding and MIME contents. Require likeness consent for uploaded presenter photos. Photos stay in the browser for the product ad. Only an explicitly approved motion test sends a resized presenter JPEG and scene video to the external provider.
- Script/avatar JSON input is limited to 16 KiB; timing WAV input to 1 MiB. Provider responses stay below Vercel's payload limit. Requests have an 85-second cancellation signal and a 90-second function deadline.

## Providers and cost

Use hosted APIs directly through the existing narrow adapters. No inference weights, GPUs, Python services, AI Gateway, paid fallback, or automatic generation retries.

- Script: Gemini gemini-3.1-flash-lite.
- Voice: Gemini gemini-3.8-flash-tts, fixed English Kore voice, raw mono PCM at 24 kHz converted to WAV.
- Portrait: Cloudflare Workers AI @cf/black-forest-labs/flux-1-schnell, four steps.
- Timings: Groq whisper-large-v3-turbo, word timestamps.

These IDs are documentation-verified defaults. Verify access through the intended free accounts before calling them release-verified. Accounts must remain free-tier with paid billing disabled. Show "$0 within available free quotas" before generation. Quota exhaustion and provider content refusals must be shown as themselves. The shared password does not provide durable per-user quota enforcement.

## Output and approval

Output is fixed at 720 x 1280, 30 fps, 15 seconds, H.264/AAC MP4. No configurable formats in v1.

Scene sequence: presenter/product from 0–3 seconds, product/benefit from 3–11 seconds, presenter/product with Learn more from 11–15 seconds. Fit the actual packshot proportionally; keep the product and portrait as separate composition inputs.

Script editing invalidates voice, timings, approval, and output. Product-fact changes also invalidate script. Visual-only changes preserve narration but invalidate approval and output. Freeze approved media during rendering and block duplicate submissions.

Voice synthesis and timing requests are separate so failed transcription can reuse generated audio. A completed narration includes audio, measured duration, and actual word timings. Never invent evenly distributed timestamps. Reject audio longer than 15 seconds without cutting speech or automatically regenerating. Pad shorter audio with silence.

Render lazily in one worker, support cancellation, release the engine's virtual filesystem by terminating the worker, and revoke replaced Blob URLs. Warn before leaving an unfinished session. Session reauthentication must preserve the draft.

## UI and verification

One plain creation screen plus a shared-password gate. Reuse existing components. No landing page, theming, animation, account management, dashboards, or mobile-browser support. Review large scene previews, script, narration, and caption transcript before export.

Test the real browser encoder in desktop Chrome and Edge and inspect exported MP4 metadata with ffprobe during development. Controlled API fixtures are appropriate for deterministic browser tests but never count as a live-provider smoke test. Test authentication, expiry/tampering/origin, invalid media and limits, refusals, quota errors, cancellation, retries, dependency invalidation, and a second render in the same tab.

## Transition gate

Do not remove the old worker, embedded database, project schema/routes, or pg-boss infrastructure until a live free-account portrait/script/voice/timing flow has produced a browser MP4. The source is retained for this gate only; it is not part of the new runtime. The old UI is available under /legacy and /new in development. Legacy boundaries return 404 in production. Preserve existing .data files.

After the gate passes, delete unused legacy source/dependencies and this transition section. Do not silently change providers, introduce billing, or change output requirements to bypass a failed feasibility check.

## Character-replacement experiment

The user approved selecting a character and replacing an actor in a scene video. Two fresh public-sample clips have been generated through the free account, including a native HTTP request. A separate motion-test card now uses the selected presenter, an uploaded scene or published demo, and explicit external-processing consent. It generates the first two seconds at the provider's low resolution and retains source audio. This does not replace the current 15-second ad, add lip-sync, or authorize paid inference or local model installation. Preserve the original exporter and legacy transition gate.

The provider is `alexnasa/Wan2.2-Animate-ZEROGPU`, Character Swap mode. Its raw REST contract needs six inputs, including a final hidden-State null that the public API description omits. HTTP submission is bounded on Vercel; the browser keeps one continuous provider result stream open using the opaque job ID. Reconnecting that stream is unreliable and can cancel the job. HF_TOKEN stays server-only, including on cancel. Browser media URLs are restricted to the fixed Space's cache paths; no provider credentials are returned. Cancellation tickets are signed and expire after 20 minutes; remote cancellation is best-effort.

On October 27, 2026, the live browser attempt through the app reached the provider and hit exhausted free GPU quota. Native generation succeeded earlier; a successful fresh complete browser flow is still unverified. Do not repeatedly consume GPU quota to replace deterministic regression tests or report controlled browser success as live-provider success.

HF_TOKEN is an optional Read token from a free account. Before every motion generation, reject accounts unless whoami-v2 explicitly reports isPro=false. Keep the example field blank. Portraits are decoded in the browser and resized to JPEG up to 768 pixels and 1 MiB; server-side JPEG signature/dimension checks cap dimensions at 1024. Uploaded MP4 scenes are capped at 3 MiB; browser decoding requires 2–15 seconds and at most 4K. The server bounds bytes and checks the MP4 container signature, not full codec decoding. Total multipart uploads stay below Vercel's payload limit. The public Space processes and temporarily hosts inputs/outputs; only non-sensitive, permitted test media should be used. No durable app storage, paid fallback, automatic generation retry, inference weights, or local GPU process is introduced. A new free account can use existing Spaces without qualifying to host its own.

## Deployment

Vercel Root Directory is apps/web with shared workspace sources included. Build copies the pinned ffmpeg JS/WASM to same-origin static files; a licensed local caption font is bundled. No runtime media storage or native ffmpeg installation is required. Verify a preview before production promotion. Vercel Hobby requires personal non-commercial use.
