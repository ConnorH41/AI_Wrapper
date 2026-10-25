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

## Architecture sketch

- **Web app** is the only client for now, but the API is designed so a mobile client can reuse it unchanged.
- **Job pipeline** runs generation asynchronously. Individual steps take minutes, so nothing expensive happens in a request handler.
- **Model router** sits between the pipeline and providers (Kling, Hedra, ElevenLabs, and others), so a provider can be swapped per step without touching pipeline logic.
- **ffmpeg** does final assembly.

## Design docs

Three documents cover this in more depth — a UGC video wrapper briefing, the backend architecture, and the MVP build plan. They currently live in the cloud Project Context and have not been committed here yet.

## Getting started

Not applicable yet. The next step is scaffolding the web app, the job pipeline, and the model router from the MVP build plan.
