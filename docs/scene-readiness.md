# Scene readiness and quality review

## What the studio now does

The full-character path is now a preparation and review flow:

1. Choose a character and a 2–5-second source. Mark the complete visible person on the first frame.
2. Run **Analyze scene locally**. The browser decodes the video track, measures consecutive-frame pixel changes and uses bounded translation-only block matching to suggest moving regions. No media is uploaded and no inference API is called for this analysis.
3. Review nine frames spanning the video, correcting each rectangle and confirming it. The source video remains playable so movement between samples can be inspected. Low-texture, poor-match and large-translation cases are flagged as uncertain. A large frame change is a warning, not a proven cut or action classification.
4. Confirm person count, continuity, source framing, face visibility, occlusion and reference clarity. Multiple people, cuts, missing observations or an unclear reference block this single-person pilot. Describe the appearance to retain and movement actually observed. The browser shows the exact instructions used by the server; it warns when requested clothes/shoes may be outside a cropped source.
5. Acknowledge identified risks and approve preparation. The browser creates an H.264 MP4 guide using white editable rectangles on black. Region boundaries interpolate between corrected checkpoints. The guide follows decoded source frame timestamps and durations, including variable frame timing. Inspect this playable guide and separately approve it before paid processing consent.
6. Generate one deliberately consented short test, only if the operator has enabled paid processing. The fal VACE request now uses **mask_video_url**, replacing the earlier first-frame PNG guide. The prompt is built from the reviewed appearance, motion and framing, using the same shared function as its preview.
7. Compare the result with the reference and source at nine corresponding timestamps and watch the complete clip. Confirm face, outfit/hair, movement, scene and artifacts before accepting. Rejection records a reason in memory and never automatically starts another paid request. Approved and unapproved downloads have different labels and filenames.

Changes to the source, character, observations, corrected regions or instructions invalidate preparation/approval and dependent output/consent. Each completed or cancelled paid attempt clears spending consent. Existing unknown-job protections and earlier-output preservation remain in place.

## What this check means

**Ready for a short test** means the review requirements are complete. It does not mean a model has proved that the character can be replaced accurately, and it is not a success probability.

The measured analysis is real local image processing. Semantic observations and action descriptions come from the user. There is no vision-language model, pose skeleton, identity classifier, automatic outfit recognition or automatic person segmentation in this implementation. A rectangle can include foreground objects and background; it is not a person-shaped alpha matte. Nine corrected samples cannot verify every hair strand or motion between samples.

There is no generated still of the character in the scene before the video test. The reference/region review checks preparation; the short generated clip is the actual appearance test. No artificial composite is presented as predicted model output. Face/outfit consistency and final acceptance are human checks, without an invented automated quality score.

This improves visibility, conditioning and rejection handling. Live VACE fidelity, audio, billing and provider-side handling of the timed guide still require a deliberately authorized test. The implementation does not establish that VACE outperforms Kling.

## Technical boundaries

- The web stack remains Next.js, React and TypeScript. One pinned media dependency, **mediabunny 1.64.0**, handles browser decoding/MP4 guide encoding and server-side track inspection. It is loaded dynamically for media work; no model weights, GPU service, inference SDK, external analysis destination or new credential is added.
- Desktop Chrome/Edge with working H.264 WebCodecs are required for preparation. If local decoding/encoding fails, the app reports the recovery and makes no upload. Cloud Chromium is the verified browser; branded Chrome/Edge release validation is still outstanding.
- Inputs remain MP4 up to 3 MiB, 2–5 seconds, at most 1080p and 2048 pixels per dimension. Local review permits at most 60 fps and 310 frames. Exports must start near timestamp zero. The encoded guide is capped at 256 KiB.
- Server admission checks authentication, Origin, provider enablement, explicit paid consent, bounded multipart data, reference/scene/guide signatures, review schema/readiness, dimensions, duration, frame counts and start timestamps before uploading. These are container and contract checks, not pixel-level proof of a correct guide.
- Combined upload allowance is 4 MiB of character/source data plus 256 KiB of guide and 16 KiB of form overhead, below 4.5 MB. No arbitrary storage destination is accepted.
- Preparation, frame thumbnails, review notes, acceptance/rejection and media stay in browser memory. Refreshing loses them. Provider hosting begins only with a paid submission; the existing separate consent/retention rules apply.
- The process-local submission digest now includes the timed guide and review. Changing instructions or the guide under an existing key is rejected. The map is still not durable or cross-instance billing protection.

## Next quality work

The next substantial step is true whole-person video segmentation with correction tools, plus pose/occlusion analysis. This needs a verified model/runtime and a clear media-processing policy. An optional vision model could suggest scene observations and motion descriptions, but those suggestions should stay reviewable and separate from measured geometry.

Benchmark the same permitted pilot against Kling video editing and VACE with a fixed spending cap. Choose on identity/outfit consistency, motion, background stability and total cost per accepted clip. Verify an appearance winner before longer shots, audio restoration or upscaling. Preserve temporal conditioning rather than concatenating unrelated short generations.

## Verification

Regression coverage includes local translation matching and uncertainty, readiness/risk gates, stale/malformed reviews, prompt parity, interpolated regions, matching media metadata, signed-job recovery/cancellation, ambiguous submissions, real H.264 guide encoding/playback and black/white coverage, rejected/accepted output, instruction invalidation and controlled-provider browser flows. Live generation is explicitly excluded.

On October 30, 2026, all 27 unit tests, typecheck and the production build passed. Chromium passed eight browser regressions and skipped one live-generation test. Provider responses were controlled; actual H.264 guide encoding/decoding and pixels were checked.

A separate local compatibility check used the supplied reference image and supplied MOV trimmed/re-encoded to a 4.8-second MP4. With external browser requests blocked and paid generation disabled, the browser decoded 144 frames and prepared a 576 × 932, 4.8-second guide. Playback and `requestVideoFrameCallback` confirmed an advancing guide frame. The check recorded zero paid requests and zero external requests. It exercised the manual confirmations programmatically, so it does not establish visual region accuracy or likeness. Temporary helpers and media remained outside the repository; no screenshots, traces or user media were committed.
