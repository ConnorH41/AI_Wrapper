# Studio interface

## Purpose

Mode: **Operate**. Help a tester choose a character, review a source scene and approve a short preview with minimal visual distraction. This is a refinement of the existing neutral studio, not a new brand or product flow.

## Visual conventions

- Keep the light neutral page, white panels, dark text and restrained grayscale controls. The tokens in [globals.css](../apps/web/src/app/globals.css) are the source of truth.
- Use the shared Card, Button, Input and Textarea components. Panels have subtle borders; focus states remain clear. Primary actions are dark and secondary actions are outlined or quiet.
- Keep one page heading, section headings and smaller review headings. Body copy should explain the task; implementation detail belongs behind an optional disclosure or in documentation.
- Put character settings beside a compact reference preview on desktop. Stack them at narrow widths, with a small empty preview before an image is chosen.
- Show the source and initial selection together when space allows. Use a horizontally scrollable thumbnail strip for the nine review frames; keep the selected frame visible as review advances.
- Use consistent media surfaces and actual decoded first-frame posters. Preserve native video controls. No generated imagery, new font dependency or external visual asset is required.
- Make the current next action explicit, including missing inputs, guide approval, unavailable generation and unresolved requests. Keep original likeness and paid-processing consent separate.

## Behavior retained

All nine frame confirmations, scene/reference observations, risk acknowledgement, guide approval and paid consent remain required. Input changes still invalidate dependent approvals and output. Job recovery, cancellation, ambiguous-submission protection and result acceptance/rejection are preserved. The polish adds no provider, billing enablement, network permission or automatic paid retry.

Drafts remain memory-only. Native media previews and their posters stay in browser memory. Rectangular guides and user-confirmed observations retain their existing quality limits.

## Validation

Use the existing unit, type, build and controlled-provider browser checks. Browser captures cover empty, selected-character, frame-review, guide, job-recovery and result-review states at desktop and narrow widths; intermediate-width empty-state coverage is included. Capture helpers settle only fixture playback, without changing the app's autoplay behavior. No live generation is needed for interface validation.

The completed pass passed 27 unit tests, typechecking, the production build and eight Chromium browser regressions; one live test was explicitly skipped. Empty layouts were checked at 390, 768 and 1280 pixels, with scene and result review captures at desktop and narrow widths. No provider generation calls, new dependencies or configuration changes were required.
