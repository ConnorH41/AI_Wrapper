# Mask-guided full-character preview

## Choice and scope

The selected implementation uses `fal-ai/wan-vace-14b/inpainting` because its published contract accepts both an explicit mask guide and character references. The managed Wan Animate replacement contract does not expose a custom mask, and the current free Space seeds its automatic selection from face boxes. That was consistent with the failed outfit/hair transfer in the supplied-media test, but the exact live mask was not captured.

This is an **experimental, opt-in private-prototype integration**. It is not an independently benchmarked best-quality model or a production billing system. No paid generation or live provider validation was run while implementing it.

## Implemented behavior

- Full-character mode is the default in the studio. Missing configuration keeps generation disabled, with a useful setup message. The user may explicitly select the existing experimental free preview.
- Upload a permitted JPEG/PNG/WebP character reference showing the desired clothing/hair and a 2–5-second MP4 up to 3 MiB, at most 1080p with each dimension at most 2048.
- Select a rectangle covering the complete visible person on the first frame, including clothing and hair with some margin. Pointer drawing and keyboard-accessible percentage controls are provided. The centered-person button is a convenience, not automatic detection.
- The server validates the region and generates a bounded grayscale PNG. White marks the editable region. `mask_image_url` guides the provider's salient mask tracking. This is **not** per-frame SAM2 segmentation or a guarantee that the whole character is replaced correctly. Inspect real results before trusting tracking.
- Reference image, scene and guide are uploaded through native HTTPS. The API key is used only on fixed fal API hosts, never forwarded to signed storage-upload URLs or returned to the browser.
- Generation uses reference conditioning, 720p, 30 inference steps, no acceleration and an enabled safety checker. Input frame count/rate are requested, with provider auto-downsampling available. Exact quality, length, interpolation behavior and source-audio retention require live validation. The UI warns that this appearance preview may omit source audio.
- Paid processing/hosting requires separate explicit consent. The free quota label is not shown as a promise about paid video work. There is no automatic provider fallback or automatic create-job retry.
- Signed job tickets expire after 30 minutes. Status and cancellation use fixed server-side queue routes. Read-only status polling can resume an existing job after a connection failure without creating a new job.
- The server retains submission keys, input digests and promises for 30 minutes within one process. Duplicate keys with identical inputs share the same operation, including failures; reusing a key for different inputs is rejected. This is **not durable or cross-instance idempotency**.
- A job with an unknown result is retained in the UI. This includes an ambiguous submission where no job ticket reached the browser. Character/source editing, method switching, reset and sign-out are frozen until the job completes, cancellation is accepted or the user explicitly leaves the job. A missing-ticket request must be checked in provider history rather than automatically resubmitted. Stopping local waiting does not stop billing. Leaving requires confirmation and clears paid consent.
- Final downloads are bounded to 16 MiB, restricted to HTTPS fal media hosts, checked for MP4 signature and decoded in the browser before replacing an earlier result. Duration/dimension checks preserve earlier output on invalid results. A file passing these checks still needs visual quality review.
- The old free path remains limited to two seconds. Its mask/background diagnostic outputs are parsed with the existing strict host/path restrictions and shown when supplied. Generic “size exceeded” errors are no longer mislabeled as GPU quota exhaustion.
- Generated fictional references now request full-body appearance, visible clothing and feet rather than only a head-and-shoulders portrait. This does not guarantee portrait-provider quality.

## Enable only after choosing to spend

The feature does not require paid settings for installation, builds or mocked tests. It remains disabled unless all three conditions hold:

```dotenv
FAL_KEY=<set securely, never commit>
ENABLE_PAID_MOTION=true
PAID_MOTION_BUDGET_REVIEWED=true
```

`PAID_MOTION_BUDGET_REVIEWED` is an **operator acknowledgement**, not an enforced dollar cap. Before setting it, verify current model-specific prices, failed/cancelled-job charges and a suitable provider-account budget/spending limit. Keep it false until that is done. No quote or maximum bill is invented by this app.

Use ignored `apps/web/.env.local` or secure server environment settings. Do not edit or expose existing user credentials. For the managed cloud, future network configuration will need the fixed API hosts `rest.alpha.fal.ai` and `queue.fal.run`, plus the actual supported `fal.media` storage/CDN subdomains returned by the service. The adapter deliberately rejects unfamiliar storage/result hosts. No network permissions, new credentials or paid account settings were configured in this implementation.

On the verified Node 24 cloud image, use the configured proxy with `NODE_USE_ENV_PROXY=1` when starting the server. Preserve the environment's CA trust. Do not disable TLS checks to make provider calls work.

## Before public or production paid use

Do not rely on the in-process map or acknowledgement flags for public spending control. First add a durable job/budget store, atomic cross-instance idempotency, concurrency/rate limits and authenticated ownership/result recovery. Define behavior for an ambiguous submission before any automatic retry. Review account billing limits directly with the provider.

The current draft/media remains browser-memory-only. Provider uploads are external media hosting; the app requests a one-hour lifecycle preference but cannot guarantee the provider's deletion or retention. New app object storage or persisted drafts require an explicit retention/privacy decision. No media is written into the repository.

Before claiming full-character quality, use permitted test media and an explicit spending cap to verify:

1. The whole original outfit and hair are within the generated edit region, with no source-person remnants.
2. Reference face, hair, clothing and visible body appearance remain consistent during motion and occlusion.
3. Background/camera/contact behavior meets the intended scene-preservation standard.
4. Duration, frame rate, audio and actual bill match expectations. Upgrading output pixels does not prove identity fidelity.
5. Provider file-upload shape, queue behavior, signed-URL/CDN hosts and retention preferences work with the real account.

Only then expand to longer scenes, richer per-frame masks or another model. A real full-body driver is needed to show legs/shoes that the original shot crops out.

## Validation

```bash
npm test
npm run typecheck
npm run build
# In this cloud image, using existing external Chromium configuration:
AIW_TEST_PRODUCTION=1 RUN_LIVE_MOTION_TESTS=0 npm exec playwright -- test --config=/workspace/.aiw-cloud/playwright.config.ts
```

Run browser regressions without real provider/auth variables in the runner environment; the suite supplies fixture auth and mocks providers. Tests cover disabled paid configuration, consent/auth/Origin, region and media guards, PNG pixel coverage, signed-ticket tampering/expiry, no credential forwarding to uploads, duplicate/ambiguous submissions, job recovery, cancellation, invalid output and preservation of an earlier result. Chromium is the verified cloud browser; branded Chrome/Edge release coverage remains required.

On October 30, 2026, all 21 unit tests, typecheck and the production build passed. The Chromium regression run passed seven tests and explicitly skipped one live-generation test. Desktop captures confirmed the disabled configuration, whole-person selection, existing-job recovery and unconfirmed-submission states within the existing studio design. These checks used controlled provider responses; they do not verify live full-character fidelity, audio, billing or deployment behavior. No paid/live provider calls, credential changes or network-permission changes were made.

The research is in [full-character-replacement.md](full-character-replacement.md). Endpoint contracts were inspected in official `@fal-ai/client` 1.10.1; no SDK dependency was added. The repository's lockfile remains unchanged.
