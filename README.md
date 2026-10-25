# AI Wrapper

A UGC product-video app. A creator uploads a product photo, describes the video they want, and gets back a short vertical product video with a presenter, voiceover, and captions.

**Status:** planning only. Nothing is scaffolded yet — this repo currently contains documentation.

## What "wrapper" means here

We do not train a video model. The product is an orchestration layer: hosted generative APIs, stitched together by a job pipeline, wrapped in UX that makes the output repeatable.

Higgsfield-style precision does not come from one magic model. It comes from reference images, presets, short clips, an approve-then-animate flow, and compositing the real product photo into the frame. The quality is in the pipeline, not the checkpoint.

## Pipeline

```
Project
  → upload product packshot (+ optional person references) and/or prompt
  → LLM writes the script
  → TTS renders the voiceover
  → talking-head / image-to-video via hosted APIs
  → ffmpeg composites product, overlays, and captions
  → MP4
```

Stills are approved by the user **before** any video generation runs. Video calls are by far the most expensive step, so a bad prompt or a bad reference must be caught while it is still cheap to fix.

## Locked decisions

| Area | Decision |
| --- | --- |
| Talent | No stock avatars. Users prompt and/or upload their own references. |
| Models | Hosted APIs only for the MVP. No self-hosted GPUs on day one. |
| Assembly | ffmpeg for cut, stitch, overlay, and captions. |
| Product look | Composite the real packshot. AI-invented packaging is a later, optional path. |
| Surface | Web first. Mobile later, against the same API. |

## Tech stack

TypeScript end to end — Next.js for the web app, a plain Node worker process for jobs. We call hosted APIs over HTTP and have no model code of our own, so Python would add a second language and a second deploy target without buying anything.

- **Postgres** holds all state. Supabase or Neon; Supabase also covers auth.
- **S3-compatible object storage** holds all media. Cloudflare R2 is preferred over S3 because video means heavy egress and R2 does not bill for it. Store object keys in Postgres and serve through signed URLs; never store media bytes in the database.
- **Queue:** `pg-boss`, to stay on the database we already run. BullMQ with Redis is the alternative.
- **ffmpeg** runs in a container we control.

## Hosting

The web app deploys to **Vercel**. The worker runs on a **container host** (Fly.io, Railway, or Render).

Generation work and ffmpeg **cannot run on serverless**: execution timeouts are measured in seconds to minutes, there are no persistent worker processes, and an ffmpeg binary exceeds typical bundle limits. Our jobs take minutes by design, so they live in the worker.

The two halves never call each other. The web app writes a job row; the worker picks it up. `pg-boss` divides along the same line — `send()` is an INSERT and runs fine in a serverless function, while `work()` is the long-lived loop that needs the container.

Three rules follow from the Vercel half:

- **Uploads go directly to object storage.** Serverless request bodies cap around 4.5 MB, which product photos exceed. API routes issue presigned URLs and the browser uploads straight to R2. Finished MP4s are likewise served from the CDN, never proxied through a function.
- **Use the pooled Postgres connection string** in the web app. Ephemeral functions open a connection per cold start and will exhaust the database otherwise. The worker can use the direct connection.
- **Keep both halves in one monorepo** — `apps/web`, `apps/worker`, and a shared `packages/core` for the database schema, provider router, and types — so the two deploys cannot drift apart.

During early development the worker can simply run on the dev machine against a cloud database, letting a deployed Vercel frontend work end to end with local models and no API spend.

## Architecture sketch

- **Web app** is the only client for now, but the API is designed so a mobile client can reuse it unchanged.
- **Job pipeline** runs generation asynchronously. Individual steps take minutes, so nothing expensive happens in a request handler.
- **Model router** sits between the pipeline and providers (Kling, Hedra, ElevenLabs, and others), so a provider can be swapped per step without touching pipeline logic. Provider calls are submit-then-poll.
- **ffmpeg** does final assembly.

## MVP plan

### Validate before building

Two checks come before any code, because both can invalidate the plan:

1. **Judge the output quality by hand.** Spend a small amount directly in Kling's and Hedra's own web interfaces, using real product photos and a real script. If image-to-video over a packshot does not look good enough to post, orchestration cannot fix it. Learn this in an afternoon rather than after the pipeline exists.
2. **Read the provider terms for commercial resale and multi-tenant use.** We resell generated video and route many users through one API key. Some providers restrict redistribution, require attribution, or prohibit multiplexing accounts.

### The approval gate is two job chains, not one

The pipeline has to stop in the middle and wait for a person, possibly for hours. Rather than build a workflow engine, model it as two independent chains with the project's state in Postgres:

1. **Chain A (cheap):** write the script, render the stills, set the project to `awaiting_approval`. Ends there.
2. **The user approves** — an API call whose only job is to enqueue Chain B.
3. **Chain B (expensive):** generate video, assemble with ffmpeg, publish the MP4.

Neither chain ever blocks on a human, so no worker sits sleeping on an approval.

### Build order

Each stage produces something you can watch end to end, and the expensive dependency arrives last.

1. **Pipeline with stub providers and ffmpeg-only video.** Every capability in the model router gets a `mock` implementation that sleeps and returns a canned asset. Real video comes from ffmpeg applying a slow pan and zoom to the packshot — no model involved. This proves projects, uploads, both job chains, the approval gate, storage, and assembly, at zero cost. Keep the stubs permanently; they make tests fast and free.
2. **Real script generation,** pointed at local Ollama. Costs nothing and needs no key.
3. **Real voiceover,** via local Piper. Clearly synthetic, but enough to validate timing and captions.
4. **One paid hosted video call,** deliberately budgeted, once everything around it already works.

### Build early, not later

These are painful to retrofit, so they belong in stage 1:

- A **cost ledger** — one row per provider call recording provider, model, step, duration, status, and estimated cost. Without it you cannot say what a finished video costs, and pricing depends on that number.
- **Idempotency keys** on every provider call, so a worker retry after a timeout does not pay twice.
- **Hard per-project and per-user caps**, even as a bare integer with no UI.
- A **consent attestation** at reference upload. Users can upload a photo of anyone, which is a likeness problem as much as a feature, and most providers require the attestation in their terms.
- **Word-level timings from the TTS step.** Captions drift unless they are aligned to the voiceover's actual timing, so the TTS adapter returns timings alongside audio rather than just a WAV. Retrofitting this means reworking assembly.
- **A deadline and a terminal failure state on every job.** Provider polling can hang indefinitely, and without a timeout projects sit in `processing` forever. Define what the user sees on failure, and whether a retry re-charges them — a retried video generation costs money twice.
- **Attempt history in the schema.** Users will re-roll stills they dislike. Model generations as many-per-project with one marked current; a one-set-of-assets-per-project schema makes "try again" a migration.
- **Object storage lifecycle rules.** Intermediate stills, audio, and failed renders accumulate quickly and video grows without bound. A rule expiring intermediates after about a week costs nothing now.
- **A clean path for provider content refusals.** Moderation rejections on prompts and uploaded photos will happen and must reach the user as something better than a generic failure.

### UI scope

Deliberately minimal. The product is the pipeline, not the interface.

Three screens: a project list, a new-project form (packshot upload, optional reference images, prompt), and a project detail page showing status, the stills with approve/reject, and a video player on completion. Merging the list into the detail page to ship two is acceptable.

- **shadcn/ui on its default theme.** No custom theming, no design system work.
- **Poll for status.** A refetch every few seconds on the detail page. Streaming job progress buys nothing when jobs take minutes.
- **Supabase Auth's prebuilt UI.** Do not hand-build login forms.

The **approval gate is the one screen worth care** — it is the real product interaction and the main defense against wasted spend. Large stills, unambiguous approve and reject, and the cost of the next step shown before it is taken. Everything else can be plain.

Skip entirely: landing page, onboarding, settings, dashboards, dark mode, animations, and anything responsive beyond not breaking on a phone.

### Deliberately cut from v1

One provider per step with no router flexibility, one aspect ratio, no credits UI, no editor, no mobile client. The talking-head path can also wait — image-to-video over the packshot alone exercises the full pipeline with the fewest moving parts.

Pin the **output format** before writing provider code: aspect ratio, target duration, resolution, and caption style get hardcoded into every provider call and every ffmpeg command, and changing them later means touching every step.

## Design docs

Three documents cover this in more depth — a UGC video wrapper briefing, the backend architecture, and the MVP build plan. They currently live in the cloud Project Context and have not been committed here yet.

## Getting started

Not applicable yet. The next step is stage 1 of the MVP plan above: scaffold the monorepo, the job chains, and the model router with mock providers.

The local toolchain for development — Ollama, Piper, and ffmpeg, all keyless and free — is documented in `AGENTS.md`.
