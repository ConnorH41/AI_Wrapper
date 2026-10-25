# AI Wrapper — agent guide

A UGC product-video app: product photo in, short presenter-style product video out. We orchestrate hosted generative APIs; we do not train models. See `README.md` for the full picture.

The repo is not scaffolded yet, so there are no build, test, or lint commands to run. When you add the first ones, document them here.

## Constraints

These are settled. Raise it with the user before working around any of them.

- **Hosted APIs only.** No self-hosted model weights, no GPU inference in our own infrastructure.
- **No stock avatars.** Talent comes from user prompts and user-uploaded references. Do not add an avatar library.
- **Composite the real packshot.** The user's actual product photo goes into the frame. Do not generate invented packaging as the default path.
- **ffmpeg for assembly.** Cut, stitch, overlay, and captions all go through ffmpeg rather than a hosted editing service.
- **API before client.** Mobile ships later against the same API, so keep product logic in the API and out of the web app.

## The approval gate

The single biggest risk is burning API spend on a generation the user never wanted.

Every expensive step must be gated behind cheap, user-approved output. Stills are approved before video generation runs. When you add a pipeline step, place it on the correct side of that gate and make the cost visible before the call, not after.

## Pipeline shape

`script (LLM) → voiceover (TTS) → video (talking-head / image-to-video) → assembly (ffmpeg) → MP4`

Generation steps take minutes. They belong in the async job pipeline, never inline in a request handler. Provider calls go through the model router so a step's provider can change without touching pipeline logic.
