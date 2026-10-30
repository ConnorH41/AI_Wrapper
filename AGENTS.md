# AI Wrapper — agent guide

## Current product

The user retired the product-ad flow on October 29, 2026. The app now focuses exclusively on a character and a scene/motion source. The tester enters a shared password, uploads a portrait or prompts a fictional adult character, selects a demo or uploads a short scene, reviews both, approves external processing, then generates and downloads a moving clip.

The latest requirement is **full-character replacement**: reference face, hair, clothing and complete visible body appearance should replace the source person while source motion/scene are preserved. A result keeping the source outfit fails this requirement. Read docs/full-character-replacement.md for research and docs/replacement-setup.md for implemented behavior and limits.

The default studio method is an experimental mask-guided VACE preview through fal, **disabled by default**. It uses a user-marked first-frame whole-person region and provider tracking, not a locally verified per-frame body mask. It requires a 2–5-second MP4, separate paid-processing consent and explicit operator enablement. Its live quality/audio behavior is unverified. The free Space is an explicitly selected diagnostic preview and may preserve the original clothing. Do not silently fall back between methods.

Do not restore product uploads, product facts, ad scripts, narration/captions, fixed 15-second compositions, or the obsolete product-pipeline feasibility gate. Existing .data files must remain untouched. The retired worker, embedded database, project routes/schema and queue dependencies have been removed as part of this scope change.

## Stack and commands

TypeScript, Next.js App Router, React, existing shadcn/ui and Tailwind. Browser-safe types and validation live in packages/core/src/session.ts and motion.ts, imported through @aiw/core/session and @aiw/core/motion. Server-only provider adapters live under apps/web/src/lib/server. Media stays in browser memory. No database, account system, persistent queue, browser storage, object storage, workflow framework, local models, GPU, Python service, or ffmpeg assembly is required.

```powershell
npm install
npm run dev
npm test
npm run typecheck
npm run build
npm run test:browser
npm run test:motion # explicit live free-GPU test; HF_TOKEN and MOTION_REFERENCE_PATH
```

Read README.md and apps/web/.env.local.example for setup. Never print secrets or read .env.local into tool output. Check only variable names and presence. Never commit credentials or put them in NEXT_PUBLIC_ variables. Do not modify ignored credential files when removing obsolete provider integrations.

## Security and providers

APP_ACCESS_PASSWORD is at least 16 characters. SESSION_SIGNING_SECRET is at least 32 characters and signs 12-hour HttpOnly, SameSite=Strict cookies, Secure in production. Every provider endpoint checks authentication and exact request Origin. Missing auth configuration fails closed. JSON input is limited to 16 KiB; combined motion uploads remain below Vercel's payload limit. Requests abort after 85 seconds with a 90-second function deadline.

- Motion: alexnasa/Wan2.2-Animate-ZEROGPU, Character Swap / Low Res mode. Requires server-only HF_TOKEN from a free account. Before every submission, whoami-v2 must explicitly report isPro=false.
- Optional full-character preview: fal-ai/wan-vace-14b/inpainting, 720p, 30 steps, reference image plus mask guide. FAL_KEY, ENABLE_PAID_MOTION=true and PAID_MOTION_BUDGET_REVIEWED=true are all required. The flags acknowledge setup, not a global/durable cost cap. Before public paid use, implement durable budget/idempotency controls and verify provider-account limits. Do not enable billing or run live paid tests as part of an ordinary code/test task.
- Optional prompted character portraits: Cloudflare Workers AI @cf/black-forest-labs/flux-1-schnell, four steps, server-only CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN. Uploaded portraits need no Cloudflare credentials.

Use native HTTP through narrow adapters. Keep paid billing disabled unless separately authorized and configured. No paid fallback, AI Gateway, inference weights, automatic generation retries, or unapproved provider changes. Display "$0 within available free quotas" before free provider requests; paid work must clearly say charges apply and require its own consent. Show quota exhaustion and refusals as themselves; the shared password does not provide durable per-user quota accounting.

## Character and scene flow

Accept JPEG, PNG and WebP portraits up to 10 MB and 40 million pixels; validate MIME contents and browser decoding. Require likeness consent for uploaded people. Resize motion references locally to JPEG up to 768 pixels and 1 MiB; server JPEG signature/dimension guards cap dimensions at 1024. Uploaded scenes are MP4 up to 3 MiB, browser-decoded at 2–15 seconds and at most 4K. Server checks bytes and MP4 signature rather than full codec decoding.

The free output is the first two seconds at provider low resolution, using the scene's motion and audio. The experimental paid appearance preview takes a trimmed 2–5-second source; audio preservation and full-character fidelity remain unverified. Do not promise fixed dimensions, a 15-second video, custom speech, new-script lip-sync, or a stock character library.

Keep the selected character and source scene visible before generation. Separate consent explicitly authorizes sending them to the public Space, which processes and temporarily hosts inputs and outputs. Only permitted, non-sensitive media should be used. The app's memory-only draft does not guarantee provider deletion.

Changing a character or scene invalidates the result and external sharing consent. Failed requests retain completed inputs and an earlier result. Prevent duplicate submissions and freeze media during requests. Cancellation is best-effort; started remote work may still consume free quota. Support playback, download, explicit retries, reset, and reauthentication without losing the draft. Revoke replaced Blob URLs and warn before leaving unfinished work.

## Motion protocol

The raw REST request needs six inputs including a hidden final State null. Its published API description omits that input. Vercel only handles bounded submission. The browser holds one continuous result stream using an opaque job ID; reconnecting can cancel or lose the result. HF_TOKEN stays server-only, including cancellation. Signed cancellation tickets expire after 20 minutes. Validate provider job IDs, cache paths, stream sizes and MP4 download sizes; browser URLs must stay on the fixed Space host.

Those stream rules apply to the free adapter. The fal adapter uses signed 30-minute job tickets and server-side status/cancel requests. Keys never reach browsers or signed storage PUTs. CDN URLs are restricted to HTTPS fal.media hosts. The in-process submission map prevents duplicate keys only within one process and its retention window; it is not production billing protection. An unknown job must be resumed/cancelled or explicitly left, never automatically resubmitted. Browser decoding/duration checks precede replacing earlier output. Keep real secrets out of browser traces and run regressions with mocked providers.

Two fresh public-sample generations succeeded on October 27, 2026, including native HTTP. The later live browser attempt through the app hit exhausted free GPU quota. Fresh complete browser success is still unverified. Prompted-portrait live generation also failed upstream that day despite active token verification. Do not repeatedly consume quota for regression testing or call fixtures live-provider verification.

A subsequent supplied-media browser test completed a real 2-second download, but retained the source outfit/hair and failed full-character fidelity. The free Space source seeds automatic segmentation from face boxes and uses five steps versus the official twenty; actual diagnostic masks from that job were not retained, so this is a strong lead, not proven causality. No live fal validation has been performed. New tests must not consume GPU quota automatically.

## Verification and deployment

Test uploaded and prompted characters, source preview/upload, consent gates, invalid media/limits, quota/refusal/timeout errors, cancellation, second generation, input invalidation, expired/tampered sessions, exact Origin checks, draft preservation, reset, playback and downloads in desktop Chrome and Edge. Product controls and retired product endpoints must remain absent. No new UI themes, landing pages, dashboards or mobile-browser support are in scope.

Vercel Root Directory is apps/web with shared workspace sources included. Set auth secrets and HF_TOKEN; Cloudflare variables are optional for prompted portraits. No static WASM or native rendering process is needed. Verify a preview before production promotion; Vercel Hobby is personal non-commercial only. Preview deployment remains unverified.
