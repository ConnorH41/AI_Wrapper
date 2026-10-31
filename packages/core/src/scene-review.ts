import { parsePersonRegion, type PersonRegion } from "./replacement";

export const REVIEW = { samples: 9, maxFrames: 310, maskBytes: 256 * 1024, textLimit: 600 } as const;
export type Checkpoint = { time: number; region: PersonRegion };
export type Observations = {
  people: "unknown" | "one" | "multiple";
  shot: "unknown" | "continuous" | "cuts";
  framing: "unknown" | "whole" | "cropped";
  face: "unknown" | "clear" | "partial" | "hidden";
  occlusion: "unknown" | "none" | "some" | "heavy";
  reference: "unknown" | "clear" | "unclear";
};
export const EMPTY_OBSERVATIONS: Observations = { people: "unknown", shot: "unknown", framing: "unknown", face: "unknown", occlusion: "unknown", reference: "unknown" };
export type SceneReview = {
  version: 1; duration: number; checkpoints: Checkpoint[]; observations: Observations;
  appearance: string; motion: string; highChange: boolean; uncertainTracking: boolean;
  reviewed: boolean; acceptRisks: boolean;
};

/** Readiness is a review gate, never a probability of a successful render. */
export function sceneReadiness(review: SceneReview): { blockers: string[]; warnings: string[]; ready: boolean } {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const o = review.observations;
  if (o.people !== "one") blockers.push("Choose a shot with one person to replace and confirm the person count.");
  if (o.shot !== "continuous") blockers.push("Use one continuous shot. Trim away cuts before this test.");
  if (o.framing === "unknown" || o.face === "unknown" || o.occlusion === "unknown") blockers.push("Confirm framing, face visibility and objects crossing the person.");
  if (o.reference !== "clear") blockers.push("Use a reference with a clear face, hairstyle and the desired visible outfit.");
  if (review.appearance.trim().length < 10) blockers.push("Describe the appearance details that must match the reference.");
  if (review.motion.trim().length < 10) blockers.push("Describe the observed movement so you can check the instructions against the shot.");
  if (!review.reviewed || review.checkpoints.length !== REVIEW.samples) blockers.push("Review the editable region on all nine sampled frames.");
  if (o.face === "hidden") warnings.push("The face is hidden. Facial identity cannot be checked reliably in this shot.");
  if (o.face === "partial") warnings.push("Turns or an obscured face increase the risk of identity drift.");
  if (o.occlusion === "some" || o.occlusion === "heavy") warnings.push("Crossing hands or objects need careful edge review; a rectangular guide also includes background pixels.");
  if (review.highChange) warnings.push("Large frame changes were measured. Check for cuts, fast motion, lighting changes or camera movement.");
  if (review.uncertainTracking) warnings.push("Some region suggestions have weak visual matches. Correct them and watch the source between samples.");
  if (o.framing === "cropped" && /\b(boots|shoes|trousers|head.to.toe|full.body)\b/i.test(review.appearance)) warnings.push("Some described details may be outside the source crop. The test preserves the existing framing.");
  return { blockers, warnings, ready: blockers.length === 0 && (!warnings.length || review.acceptRisks) };
}

export function parseSceneReview(value: unknown, duration: number): SceneReview {
  if (!value || typeof value !== "object") throw new Error("Complete the scene-readiness review first.");
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || typeof v.duration !== "number" || !Number.isFinite(v.duration) || Math.abs(v.duration - duration) > 0.12 || !Array.isArray(v.checkpoints) || v.checkpoints.length !== REVIEW.samples) throw new Error("The review does not match this scene. Analyze it again.");
  const checkpoints: Checkpoint[] = v.checkpoints.map((item: unknown) => {
    if (!item || typeof item !== "object" || !("time" in item) || typeof item.time !== "number" || !Number.isFinite(item.time) || !("region" in item)) throw new Error("Invalid review frame.");
    return { time: item.time, region: parsePersonRegion(item.region) };
  });
  const first = checkpoints[0];
  if (Math.abs(first.time) > 0.05 || checkpoints.at(-1)!.time < duration - 0.25 || checkpoints.some((p, i) => p.time < 0 || p.time >= duration || (i > 0 && p.time <= checkpoints[i - 1].time) || p.region.width !== first.region.width || p.region.height !== first.region.height)) throw new Error("Review frames must cover the same scene from beginning to end.");
  const choices = { people: ["unknown", "one", "multiple"], shot: ["unknown", "continuous", "cuts"], framing: ["unknown", "whole", "cropped"], face: ["unknown", "clear", "partial", "hidden"], occlusion: ["unknown", "none", "some", "heavy"], reference: ["unknown", "clear", "unclear"] };
  if (!v.observations || typeof v.observations !== "object") throw new Error("Confirm the scene observations.");
  const observations = v.observations as Record<string, unknown>;
  for (const [key, options] of Object.entries(choices)) if (typeof observations[key] !== "string" || !options.includes(observations[key] as string)) throw new Error("Invalid scene observation.");
  if (typeof v.appearance !== "string" || typeof v.motion !== "string" || v.appearance.length > REVIEW.textLimit || v.motion.length > REVIEW.textLimit || ["highChange", "uncertainTracking", "reviewed", "acceptRisks"].some((key) => typeof v[key] !== "boolean")) throw new Error("Invalid scene instructions or review approval.");
  const review: SceneReview = { version: 1, duration: v.duration, checkpoints, observations: observations as Observations, appearance: v.appearance.trim(), motion: v.motion.trim(), highChange: v.highChange as boolean, uncertainTracking: v.uncertainTracking as boolean, reviewed: v.reviewed as boolean, acceptRisks: v.acceptRisks as boolean };
  if (!sceneReadiness(review).ready) throw new Error("Finish the scene review and acknowledge its risks before paid generation.");
  return review;
}

export function replacementPrompt(review: SceneReview): string {
  return [
    "Replace the complete selected person with the character in the reference image, including face, hairstyle, clothing and visible body appearance.",
    `Appearance details to match: ${review.appearance.trim()}`,
    `Observed source movement to follow: ${review.motion.trim()}`,
    "Use the source video for movement, timing, camera and scene. Use the reference image for character appearance. Preserve the surrounding scene and camera. No extra people.",
    review.observations.framing === "cropped" ? "Preserve the source crop. Replace only the visible body; do not invent a wider camera view or reveal unseen legs or shoes." : "Keep the complete visible character within the original framing.",
    "Keep hair, clothing and identity consistent through movement. Do not retain the source person's outfit.",
  ].join("\n");
}

/** Interpolated editable rectangles, not semantic person segmentation. */
export function regionAt(checkpoints: Checkpoint[], time: number): PersonRegion {
  const after = checkpoints.findIndex((p) => p.time >= time);
  if (after <= 0) return checkpoints[after === 0 ? 0 : checkpoints.length - 1].region;
  const a = checkpoints[after - 1], b = checkpoints[after];
  const t = (time - a.time) / (b.time - a.time);
  const region = { ...a.region };
  for (const key of ["left", "right", "top", "bottom"] as const) region[key] = a.region[key] + (b.region[key] - a.region[key]) * t;
  return region;
}

export type GrayFrame = { pixels: Uint8Array; width: number; height: number };
export function frameChange(a: GrayFrame, b: GrayFrame): number {
  if (a.pixels.length !== b.pixels.length || a.width !== b.width || a.height !== b.height) throw new Error("Frame dimensions changed.");
  let difference = 0;
  for (let i = 0; i < a.pixels.length; i++) difference += Math.abs(a.pixels[i] - b.pixels[i]);
  return difference / (255 * a.pixels.length);
}

/** Bounded translation-only block matching. Suggestions require human correction. */
export function suggestRegion(a: GrayFrame, b: GrayFrame, region: PersonRegion): { region: PersonRegion; uncertain: boolean } {
  const width = region.right - region.left, height = region.bottom - region.top;
  let best = Infinity, dx = 0, dy = 0, sum = 0, squared = 0;
  const at = (frame: GrayFrame, x: number, y: number) => frame.pixels[Math.min(frame.height - 1, Math.max(0, Math.floor(y * frame.height))) * frame.width + Math.min(frame.width - 1, Math.max(0, Math.floor(x * frame.width)))];
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) { const p = at(a, region.left + width * (x + 0.5) / 12, region.top + height * (y + 0.5) / 12); sum += p; squared += p * p; }
  for (let yi = -4; yi <= 4; yi++) for (let xi = -4; xi <= 4; xi++) {
    const sx = xi * 0.02, sy = yi * 0.02;
    if (region.left + sx < 0 || region.right + sx > 1 || region.top + sy < 0 || region.bottom + sy > 1) continue;
    let score = 0;
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
      const px = region.left + width * (x + 0.5) / 12, py = region.top + height * (y + 0.5) / 12;
      score += Math.abs(at(a, px, py) - at(b, px + sx, py + sy));
    }
    // Prefer no movement in ties; avoid arbitrary drift in uniform frames.
    score = score / (144 * 255) + (Math.abs(xi) + Math.abs(yi)) * 0.0001;
    if (score < best) { best = score; dx = sx; dy = sy; }
  }
  return { region: { ...region, left: region.left + dx, right: region.right + dx, top: region.top + dy, bottom: region.bottom + dy }, uncertain: best > 0.12 || squared / 144 - (sum / 144) ** 2 < 60 || Math.abs(dx) >= 0.08 || Math.abs(dy) >= 0.08 };
}
