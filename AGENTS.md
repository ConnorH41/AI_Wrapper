# AI Wrapper — agent guide

A UGC product-video app: product photo in, short presenter-style product video out. We orchestrate hosted generative APIs; we do not train models. See `README.md` for the full picture.

The repo is not scaffolded yet, so there are no build, test, or lint commands to run. When you add the first ones, document them here.

## Stack

TypeScript end to end: Next.js for the web app, a plain Node worker process for jobs. Postgres for state, S3-compatible object storage (Cloudflare R2) for media, `pg-boss` for the queue, ffmpeg in a container.

Do not introduce a second language. We call hosted APIs over HTTP and have no model code, so a Python service would add a deploy target without buying anything.

Store object keys in Postgres and serve media through signed URLs. Media bytes never go in the database.

## Hosting

The web app deploys to Vercel; the worker runs on a container host (Fly.io, Railway, or Render). Monorepo layout is `apps/web`, `apps/worker`, and a shared `packages/core` for schema, router, and types.

**Generation steps and ffmpeg must never run on serverless.** Serverless execution timeouts, the absence of persistent workers, and bundle size limits all rule it out, and our jobs take minutes by design. Anything slow belongs in the worker, which the web app reaches only by writing a job row — the two halves never call each other directly.

When adding code to `apps/web`, respect these:

- Uploads use presigned URLs straight to object storage. Never route file bytes through an API route; serverless bodies cap near 4.5 MB. Serve output media from the CDN, not through a function.
- Use the pooled Postgres connection string. The worker uses the direct one.
- `pg-boss` `send()` is safe in a route; `work()` only ever runs in the worker.

## Local toolchain

Development runs with no API keys and no rate limits. All three pieces are installed and verified on the dev machine.

- **Script generation:** Ollama serving `llama3.2:3b` at `http://localhost:11434`. The endpoint at `/v1` is OpenAI-compatible, so write the script adapter against the OpenAI SDK with an overridden base URL — switching to a hosted provider then costs a base URL and a key, not a rewrite.
- **Voiceover:** Piper at `C:\Users\hardi\tools\piper\piper.exe` with the `en_US-lessac-medium` voice. Reads text on stdin, writes a WAV via `--output_file`. Runs roughly 5x faster than real time on CPU.
- **Assembly:** ffmpeg 9.0.2 on `PATH`.

Local inference is CPU-only — the dev machine has no CUDA GPU. That is acceptable because generation happens in background jobs where tens of seconds go unnoticed. Do not move these calls into a request handler where the latency would show.

Piper sounds recognizably synthetic. It exists to prove the pipeline, not to ship; swap in a hosted TTS before output reaches users.

**There is no local video generation.** The integrated GPU cannot run a video model, which is why the first video path is a ffmpeg pan-and-zoom over the packshot rather than a model call.

## Constraints

These are settled. Raise it with the user before working around any of them.

- **Hosted APIs only.** No self-hosted model weights, no GPU inference in our own infrastructure.
- **No stock avatars.** Talent comes from user prompts and user-uploaded references. Do not add an avatar library.
- **Composite the real packshot.** The user's actual product photo goes into the frame. Do not generate invented packaging as the default path.
- **ffmpeg for assembly.** Cut, stitch, overlay, and captions all go through ffmpeg rather than a hosted editing service.
- **API before client.** Mobile ships later against the same API, so keep product logic in the API and out of the web app.

## UI scope

Keep it minimal — the product is the pipeline. Three screens: project list, new-project form, project detail with status, stills approval, and a video player.

Use shadcn/ui on its default theme. Do not add custom theming, animations, dark mode, a landing page, onboarding, or settings. Poll for job status rather than streaming. Use Supabase Auth's prebuilt UI instead of hand-built login forms.

The approval gate screen is the exception and deserves real care: large stills, unambiguous approve and reject, and the next step's cost shown before it is incurred.

## The approval gate

The single biggest risk is burning API spend on a generation the user never wanted.

Every expensive step must be gated behind cheap, user-approved output. Stills are approved before video generation runs. When you add a pipeline step, place it on the correct side of that gate and make the cost visible before the call, not after.

## Pipeline shape

`script (LLM) → voiceover (TTS) → video (talking-head / image-to-video) → assembly (ffmpeg) → MP4`

Generation steps take minutes. They belong in the async job pipeline, never inline in a request handler. Provider calls go through the model router so a step's provider can change without touching pipeline logic.
