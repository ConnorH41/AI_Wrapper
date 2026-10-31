# Full-character replacement: findings and recommended direction

> This document preserves the analysis before implementation. The selected implementation is the explicit-mask VACE route, with paid execution disabled by default. The later [scene-readiness flow](scene-readiness.md) adds local motion measurements, nine corrected regions, exact-prompt review and a timed rectangular guide. See [replacement-setup.md](replacement-setup.md) for exactly what is implemented, the current limits and the remaining live quality/billing validation. References to files gathered in the review workspace are historical evidence locations; the public source links below are the reusable references.

## Decision

Treat the product as **reference-driven replacement of the complete visible person**, preserving the source scene and motion. Face, hairstyle, wardrobe, exposed skin, visible body appearance and silhouette are part of the target. A result keeping the source black top is a failed replacement even if it is playable and the face looks different.

Keep the current web stack. Improve the conditioning and choose an appropriate model service before spending on longer clips, upscaling, a frontend rewrite or a GPU fleet. The best first paid comparison is a correctly configured Wan Animate replacement endpoint versus a reference-guided direct video editor. A scene-prepared reference plus Kling Motion Control is a useful second approach when small background changes are acceptable.

No new generation, paid API call, media upload, account change, deployment or repository change was performed for this analysis. Only public documentation/source/package definitions were read.

## The test is a quality failure, not just a low-resolution preview

Observed output: two seconds of H.264/AAC at 368 × 608, 30 fps, successfully decoded and played. The output largely retains the original black top and straight dark hair, while the target reference has a red cable-knit turtleneck and wavy brown hair. The full-body reference also specifies white trousers and brown boots, but the driving scene is framed around the upper body. Clothes below the camera boundary cannot appear while preserving that framing.

Two separate requirements must therefore stay distinct:

- Replace the **entire visible character** in the existing shot. This is the immediate task.
- Show the target **from head to toe**. This needs a source shot with that framing, or deliberate scene/camera reconstruction. It is a larger task and should not be implied by the words “full-body swap.”

The prior suggestion to try a closer crop could help face detail, but cropping alone does not address the need to replace clothes, hair and body. Keep the full character reference as the master appearance reference; derive extra crops only when the chosen model can use them.

## A concrete weakness in the current free Space

The current public Space source still matches reviewed revision `96e899b7c57220183defee4ce91a79d694b2375d`.

The app submits `Character Swap`, `Low Res` and a null hidden State. The Space maps Character Swap to replacement mode. This is not evidence that the app accidentally selected a face-only mode.

However, its automatic replacement preprocessing differs from upstream:

| Stage | Current public Space | Official Wan Animate source |
|---|---|---|
| No interactive mask hints | Calls `get_mask_from_face_bbox` | Calls `get_mask` |
| SAM2 prompts | Face boxes, falling back to points inside face boxes | Multiple body landmarks |
| What happens outside the mask | Original frame preserved as background conditioning | Original frame preserved as background conditioning |
| Sampling steps | 5 | 20 |
| Model source | Downloads normal `Wan-AI/Wan2.2-Animate-14B` checkpoints | Official Animate checkpoint/configuration |

The edited background is computed as `frame * (1 - edit_mask)`. If the torso is not in the editable area, the original shirt is deliberately retained in the conditioning. A face-seeded segmentation can therefore explain the observed head/face change while the clothes remain.

**Evidence limit:** the completed live job's mask/background diagnostic outputs were not retained. Face prompts can sometimes produce a larger person segment, so source inspection does not prove the exact mask was face-only. This is a strong, specific diagnosis to test, not a confirmed root cause. Likewise, five steps versus twenty is a real configuration difference, not proof that four times as many steps fixes identity or clothing.

The Space's public function returns five outputs: finished video, pose, masked background, mask and face diagnostic video. At the time of the failed live test, the application took only the first result. The implementation now exposes returned mask/background diagnostics for future deliberately authorized review; that does not reconstruct the lost diagnostics from the earlier job.

The free API does not expose an inference-step parameter in its six-input contract. Its hidden State is Gradio session state; do not assume an arbitrary JSON mask dictionary in the sixth position is a supported mask API. Use supported UI/API masking, a service exposing mask inputs, or an owned pipeline. Restoring the normal sampling budget also needs a matching runtime/quota allowance.

## What the correct pipeline should do

1. **Validate the shot and reference.** Detect framing, duration, orientation, person count, cuts and obvious occlusion risks. Preserve a high-quality full-character reference. Where supported, also provide a detailed face reference of the same character, rather than relying on a tiny face inside a whole-body image.
2. **Select and track the complete person.** Cover hair, torso, all clothing, arms/hands, legs and shoes when visible. Keep foreground objects separate. Support manual correction for difficult masks.
3. **Give the replacement room to exist.** The target's hair, sleeves or silhouette can extend beyond the old subject. Use a controlled margin or target-aware edit area. A mask fitted tightly to the old body can force the old silhouette and leave garment remnants.
4. **Preserve motion as structure, not appearance.** Extract pose, face expression and contacts. Do not preserve original clothing/skin pixels as if they were immutable background. Large physique changes may require pose retargeting; exact source contacts and target proportions can conflict.
5. **Generate the character throughout the editable region.** Use a reference-conditioned character-replacement or masked video-edit model. Keep appearance and temporal conditioning across windows. Do not perform unrelated frame-by-frame image edits.
6. **Preserve/reconstruct the scene carefully.** Keep original pixels outside the edit area where appropriate. A smaller replacement reveals scene regions the original person hid; those need a clean plate or temporally consistent inpainting. A simple overlay cannot remove the original person's exposed edges or shadows.
7. **Validate before delivery.** Require wardrobe/hair/identity consistency, motion fidelity, no original-body remnants, plausible hands/contacts, acceptable background stability and valid media. Restore source audio with verified synchronization; upscale only an already accepted result.

“Better body proportions” cannot mean simultaneously copying every source joint position and changing limb length freely. The official preprocessing guide explicitly warns about source/reference proportion mismatches in replacement mode. Start with similar framing/proportions and simple single-person shots, then add harder cases.

## Paid API shortlist, grounded in published contracts

The contracts below were checked in the official `@fal-ai/client` **1.10.1** npm package's published `endpoints.d.ts`. Contracts establish exposed inputs, not achieved quality, pricing, uptime or permission to use a particular deployment.

### 1. Managed Wan Animate Replace: first paid baseline

Endpoint: `fal-ai/wan/v2.2-14b/animate/replace`.

The published input type exposes image/video references, 480p/580p/720p profiles, an inference-step field defaulting to 20, a seed and output encoding settings. This makes a useful comparison against the current low-resolution five-step Space.

The current contract does **not** expose a caller-supplied mask. We cannot assume its internal full-person segmentation is correct or controllable. The purchase is worthwhile only if the result passes the whole-character test. Paying another host for the same model does not automatically solve masking.

Use one short source section, explicit non-turbo standard settings for the baseline, known references and a fixed seed where available. Compare wardrobe/hair transfer first, then detail and cost. Keep default safety controls and never change models silently.

### 2. Reference-guided direct video editing: original-scene alternative

Candidate: `fal-ai/kling-video/o3/standard/video-to-video/edit` (with a pro variant available in the published definitions).

The contract supports an input video, reference images/character elements, an editing prompt and original-audio retention. It is a direct way to request the entire character be replaced while preserving the shot.

Important contract limits: the published input description says 3–10-second source clips, 720–2160-pixel resolution and MP4/MOV. The supplied source is 576 × 932 and about 13.23 seconds, so it is not an unchanged drop-in input. Select a five-second pilot segment and meet the exact vendor requirements without pretending resizing creates real detail. Verify current validation and prices before execution.

There is no explicit mask input in this endpoint's published type. Check background/camera drift and garment persistence rather than assuming text instructions guarantee isolation.

### 3. Scene-prepared reference + Kling Motion Control: appearance-first route

Candidates: `fal-ai/kling-video/v3/standard/motion-control`, its pro variant, and the v2.6 variants.

The SDK says characters, backgrounds and other elements are based on the **reference image**, while actions follow the driving video. Sending the supplied grey-background full-body photo directly risks producing a grey-background animation instead of a swap inside the kitchen/room.

A better use is:

`source scene frame + target character → approved edited scene reference → motion-control video using the source driver`

The reference should already show the complete target person in the right place, scale, framing and lighting, wearing the red sweater. Reject an incorrect still before paying for video. An image-edit model can prepare that reference, but its own identity mistakes must not become the foundation for the animation.

The published motion-control contract describes up to 30 seconds with video orientation and 10 seconds with image orientation, and an option to retain source sound. V3 also exposes optional facial consistency elements for video orientation. These are documented limits/options, not tested results. A prepared scene reference helps background consistency but does not guarantee pixel-identical room preservation.

### 4. Explicit masked video editing / owned Wan pipeline: control-first route

Candidate managed contract: `fal-ai/wan-vace-14b/inpainting` (also a Wan 2.2 VACE inpainting variant in the definitions).

It exposes `mask_video_url`, reference images, source video, conditioning frames, sampling and resolution settings. This directly supports “replace the whole selected person, preserve the rest” as an input contract. An inpainting editor still needs to prove identity and temporal consistency; mask support alone is not a quality win.

If the managed replacement/editor cannot provide the required control, an on-demand Wan Animate worker using the official body-aware preprocessing is a sensible later option. It can expose full masks and diagnostics, keep temporal carry and tune the sampler. It adds model loading, GPU memory, worker operations and media lifecycle management, so it is not the first infrastructure investment for a small number of clips.

## Recommended comparison and decision gate

Do not buy a subscription, change the active provider or build a GPU backend on the assumption that any paid API is better.

1. Inspect a full-person mask over the source before another diagnosis render. It must cover the black top, cardigan, hair and hands where they should change. If the top remains in the masked background, fix preprocessing first.
2. Prepare one five-second pilot segment and keep the exact target reference. This is long enough to expose motion/hair/wardrobe drift while keeping spend limited.
3. Compare a standard managed Wan replacement and a direct reference-guided editor. Add the staged-keyframe/motion-control route if their fidelity is inadequate or a lightly reconstructed scene is acceptable.
4. Use a fixed maximum spend chosen before requests. Read live provider prices and failure/cancellation billing rules; no price was verified in this review.
5. Choose a winner only after checking a second scene and a harder motion case. “One great sample” is a promising result, not a reliability claim.
6. Extend the winner to roughly 10–15 seconds, then longer shot-wise work. Preserve temporal conditioning; independent two-second generations pasted together are a poor default.

For this example, reject any result that keeps the original black top instead of a consistent red knit top. Hair and face should follow the reference through movement; white trousers/brown boots are scored only when visible. Also reject obvious source-person remnants, duplicated hands, tearing, severe identity drift or scene changes outside the agreed edit region. Report original scene/audio preservation separately from target appearance.

## Cost strategy

Track **total spend divided by accepted clips**, including image preparation, charged failures, rejected outputs and delivery costs. A cheap render with poor wardrobe fidelity has no product value for this requirement.

For example, under a purely hypothetical quote of $0.08/generated second, a ten-second attempt costs $0.80. At 50% accepted outputs, the expected video cost per accepted clip is $1.60 before image preparation or other fees. This is an illustration, not a current vendor price.

Prefer on-demand APIs at low volume. Make a cheap appearance/mask check before expensive motion; avoid automatic paid fallbacks, duplicate submissions and retries of ambiguous create-job requests. Do not charge for repeated source inference just to find the correct sweater. Do not pay for 1080p output while the model still renders the wrong person.

Self-hosting is justified when actual volume and accepted-output economics support it, or mask/control requirements cannot be met by services. Evaluate utilization, startup and maintenance costs, not just a low GPU hourly headline. Standard five-to-twenty-step or resolution changes can materially change compute demand; current free quota estimates are not a budget for a different quality configuration.

## Future application structure

Keep Next.js/TypeScript for upload/review, authentication and orchestration. Put providers behind a small server-side capability interface rather than a universal proxy. Capabilities must distinguish character replacement, direct video editing and motion transfer; each has different input framing, durations, cost and scene preservation behavior.

Paid work needs server-side cost admission, idempotency, bounded job status, cancellation semantics and result recovery. Browser disconnection must not silently cause a second billable job. No provider token belongs in the browser. Do not remove the current free-account check to unlock paid work; add a deliberately separate paid path.

The earlier broken file delivery is a product requirement too. Users need a normal HTTPS result/download flow, not a filesystem path or a raw job ID. Use an authenticated app result page and supported, expiring download URLs. Any new private object storage or job persistence needs explicit retention rules and an updated privacy promise; none was added in this analysis. Preserve the current memory-only draft unless that product decision changes.

## Sources

- Reviewed Space source: https://huggingface.co/spaces/alexnasa/Wan2.2-Animate-ZEROGPU/blob/96e899b7c57220183defee4ce91a79d694b2375d/wan/modules/animate/preprocess/process_pipepline.py
- Reviewed Space sampling configuration: https://huggingface.co/spaces/alexnasa/Wan2.2-Animate-ZEROGPU/blob/96e899b7c57220183defee4ce91a79d694b2375d/wan/configs/wan_animate_14B.py
- Official preprocessing: https://github.com/Wan-Video/Wan2.2/blob/main/wan/modules/animate/preprocess/process_pipepline.py
- Official sampling configuration: https://github.com/Wan-Video/Wan2.2/blob/main/wan/configs/wan_animate_14B.py
- Preprocessing guide, including body-proportion/mask warnings: https://huggingface.co/spaces/alexnasa/Wan2.2-Animate-ZEROGPU/blob/96e899b7c57220183defee4ce91a79d694b2375d/wan/modules/animate/preprocess/UserGuider.md
- Official Diffusers Wan Animate documentation: https://github.com/huggingface/diffusers/blob/main/docs/source/en/api/pipelines/wan.md
- Official fal SDK: https://github.com/fal-ai/fal-js ; the reviewed public npm package is `@fal-ai/client` 1.10.1. No SDK dependency was added to this app.
- VACE reference/masked-editing design: https://github.com/ali-vilab/VACE
- SAM2 video segmentation: https://github.com/facebookresearch/sam2

Current paid endpoint contracts were inspected, not invoked. Current paid prices, output quality, latency, billing and commercial account permissions remain unverified. The user's media was not sent to an additional provider during this analysis.
