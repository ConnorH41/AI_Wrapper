# Local Higgsfield character replacement

The studio includes an explicitly selected **Higgsfield — Genjutsu / Light (paid)** method. The original fal experiment and free Space remain separate options. Nothing changes provider automatically.

## Credential and first generation

Keep the complete key copied from the Higgsfield API console in the ignored `apps/web/.env.local` file:

```dotenv
HIGGSFIELD_API_KEY=<complete copied API key>
```

Do not split the copied credential, add a `Key` prefix to its value, reuse `HF_TOKEN`, or expose it through a `NEXT_PUBLIC_` variable. The native HTTP adapter sends `Authorization: Key <complete credential>` only to `https://api.higgsfield.ai`. SDK dependencies are not needed. The app reports whether a key is configured; that does not verify the key or model access.

Keep Higgsfield API auto top-up disabled. The user's initial provider funding is $5. The API dollar balance is separate from a Higgsfield website subscription.

1. Restart the dev server if it has not picked up the environment change, then sign in.
2. Upload the front character reference and any optional side/back images. Confirm likeness rights and consistency across views.
3. Choose **Higgsfield — Genjutsu / Light (paid)** under Replacement method.
4. Choose Genjutsu Objects swap or Genjutsu Light Objects swap and 720p or 1080p.
5. Upload one continuous MP4 containing one clearly visible person. Use a 4–30-second source for standard Genjutsu or 4–15 seconds for Light. Sources remain limited to 100 MiB and 4K, with at least 409,600 pixels per frame. Long clips are rejected rather than silently shortened. Output resolution may differ from the input.
6. Describe the face, hair, clothing and body appearance to preserve, watch the source, and confirm the review. This direct edit does not use VACE rectangles or claim semantic person segmentation.
7. Approve external uploading, then choose **Get price estimate**. This uploads references and source before requesting the account-specific estimate; it does not submit generation.
8. Review the estimate and separately approve the charge. **Generate with Higgsfield** rechecks that the price is unchanged, reserves budget durably and submits once.
9. Watch the complete output and compare it with the original source and references. Accept or reject it explicitly. Approved and unapproved downloads have different labels. Rejection never spends again automatically.

The app requests preservation of source duration, aspect ratio, motion, scene and audio while replacing the complete visible appearance. This is an instruction, not a fidelity guarantee. Returned files must be MP4, at most 128 MiB, browser-decodable, close to the source duration and aspect ratio, and no larger than 4K before replacing earlier output. A playable result up to 60 seconds that fails the source-duration or aspect-ratio check is kept separately for an explicitly unapproved preview/download, with actual and expected metadata. It cannot be accepted and never replaces an earlier result. Recover it with **Download existing result**, without generating again.

## The $5 local spending guard

Some model estimates return `type` and `pricing_description` instead of `usd`. The adapter supports only the reviewed Genjutsu list-rate formulas, with an explicit **Calculated budget reservation** label and separate approval. Normal Genjutsu uses rounded-up input duration at $0.681/s for 720p or $1.632/s for 1080p. Light uses $0.10/s or $0.20/s and reserves twice the rounded-up source duration to cover both output and the one input video. The returned description must state the recognized rate, billing rule and before-discount basis; otherwise generation stays blocked. These formulas were read from the official model overview pages on November 1, 2026. Changed rates or descriptions require review rather than a guessed fallback.

Formula reservations are conservative calculations before discounts, not authoritative account quotes or invoice ceilings. A successful job retains the full reservation even if its actual discounted charge is lower. The price/basis is signed into the approval and rechecked before submission. At the reviewed list rate, even four seconds of normal Genjutsu at 1080p exceeds this installation's $5 budget; use a short 720p clip or explicitly choose Light to reduce the calculated reservation. The app never changes models or resolution automatically.

The adapter has a fixed lifetime **$5 app budget**, shared by authenticated testers on this local installation. It reserves the provider's current estimated price, rounded up to millionths of a dollar, before a generation POST. Changed prices require a new quote and approval. Completed requests retain their quoted charge even when the result is visually rejected. Only confirmed failed, moderated or successfully canceled requests release reservations. No automatic generation retries or paid fallback are implemented.

Costs and recoverable request metadata are stored under `apps/web/.local/higgsfield-budget.json`, using an exclusive lock and atomic file replacement. The path is the same for the normal root and web-workspace launch commands. It is ignored by git. It contains job IDs, quoted charges, source dimensions/duration and provider request/output URLs; no API credential, raw images, raw videos or appearance prompt is stored in the ledger. Drafts and downloaded output still live in browser memory. Provider hosting has its own retention policy.

**Do not delete or edit the ledger to reset the budget.** It is the app's spending history. Overlapping requests wait up to two seconds for the exclusive lock rather than immediately failing. A corrupt ledger blocks generation. A crashed writer may leave `higgsfield-budget.json.lock`; stop the server and review both the ledger and provider request history before removing only the stale lock. This is local filesystem coordination, not a distributed or tamper-proof billing service.

This guard accounts for this app's quotes, not authoritative provider invoices or spending from other clients. Keep provider auto top-up off and review the provider account's actual balance. The app cannot control account settings, charges outside this installation, manual deletion of its ledger, or a provider billing differently from its estimate.

## Recovery and cancellation

Higgsfield result review accepts a duration within 0.3 seconds of the source, or a result within 0.1 seconds of the next whole second when it is not shorter than the source. The latter shows the actual duration difference and requires explicit acceptance of the timing change. This recognizes the supplied 8.08-second source / 9.00-second result without assuming that motion speed, ending or audio sync survived. The app does not trim or retime the video. Larger duration differences and aspect-ratio mismatches remain inspection-only.

One pending or ambiguous request blocks new generation and freezes inputs. **Refresh setup and requests** restores local request history after reauthentication or a server/browser restart. **Check existing request** resumes status polling without submitting another generation. Completed jobs can be downloaded again while their provider files remain available.

The provider supports cancellation only before processing starts. Stopping the browser's waiting operation is not remote cancellation. If a submission response is lost before its request URLs are stored, the app leaves its cost reserved and blocks new work. Use the provider request history to resolve it; do not automatically create another job or delete the ledger. The submission carries a stable provider `Idempotency-Key` as an additional safeguard.

All provider calls remain authenticated on the server. Returned status/cancel URLs are restricted to the Higgsfield API request paths. Storage/results require HTTPS on the allowed Higgsfield, AWS, CloudFront or Cloudflare storage domains. Storage PUTs include returned storage headers without the API key. An unfamiliar CDN host fails closed; it must be reviewed before changing the allowlist.

## Documentation and unverified behavior

Contracts were read from the official [Genjutsu Objects swap page](https://open.higgsfield.ai/models/higgsfield/genjutsu/object-swap/v1.0/api-reference), [Light Objects swap page](https://open.higgsfield.ai/models/higgsfield/genjutsu-light/object-swap/v1.0/api-reference), [shared authentication guide](https://docs.higgsfield.ai/docs/authentication), [file uploads](https://docs.higgsfield.ai/docs/concepts/file-uploads), [billing](https://docs.higgsfield.ai/docs/concepts/billing-and-retention), and [request lifecycle](https://docs.higgsfield.ai/docs/concepts/requests).

The Light page contains conflicting SDK/authentication examples. This adapter uses the documented model path and common video/image/prompt/resolution fields, with the shared REST `Key` authentication scheme. Account access, exact model acceptance of the estimate/upload contracts, storage hosts, live media fidelity and billing still require the user's first request.

At the user's explicit request, no tests, type checks, builds, credential checks or live generation requests were run for this integration. Do not describe it as live-verified.
