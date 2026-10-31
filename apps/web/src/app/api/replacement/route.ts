import { MOTION, validateMotionMp4, validateMotionPortrait } from "@aiw/core/motion";
import { REPLACEMENT } from "@aiw/core/replacement";
import { REVIEW, parseSceneReview } from "@aiw/core/scene-review";
import { generation } from "@/lib/server/generation";
import { ApiError, endpoint, json, readBytes, readJson } from "@/lib/server/http";
import { authenticated } from "@/lib/server/session";
import { cancelReplacement, replacementAvailable, replacementStatus, submitReplacement } from "@/lib/server/replacement";
import { mp4Duration } from "@/lib/server/mp4";
import { validateReviewedMedia } from "@/lib/server/review-media";

export const runtime = "nodejs";
export const maxDuration = 90;

export function GET(request: Request) {
  return endpoint(async () => {
    if (!authenticated(request)) throw new ApiError("unauthorized", "Enter the shared password to continue.", 401);
    return json({ available: replacementAvailable(), maxSeconds: REPLACEMENT.maxSeconds });
  });
}

export function POST(request: Request) {
  return generation(request, async (signal) => {
    const type = request.headers.get("content-type") ?? "";
    if (type.split(";")[0] === "application/json") {
      const body = await readJson(request, signal);
      if (body.action === "status") return json(await replacementStatus(body.ticket, signal));
      if (body.action === "cancel") { await cancelReplacement(body.ticket, signal); return json({ cancelled: true }); }
      throw new ApiError("invalid_input", "Unknown replacement action.");
    }
    // Fail before reading media or making uploads if paid setup is unavailable.
    if (!replacementAvailable()) throw new ApiError("missing_configuration", "Full-character generation is not enabled. Configure its paid provider and spending controls first.", 503);
    if (!type.startsWith("multipart/form-data;")) throw new ApiError("invalid_input", "Expected a character and scene upload.", 415);
    const bytes = await readBytes(request, MOTION.portraitBytes + MOTION.sceneBytes + REVIEW.maskBytes + 16 * 1024, signal);
    let form: FormData;
    try { form = await new Response(bytes, { headers: { "Content-Type": type } }).formData(); }
    catch { throw new ApiError("invalid_input", "Invalid replacement upload."); }
    if (form.get("consent") !== "fal-paid") throw new ApiError("invalid_input", "Approve paid processing and hosting of these assets by fal first.");
    const portrait = form.get("portrait");
    const scene = form.get("scene");
    const reviewText = form.get("review");
    const mask = form.get("mask");
    const requestKey = form.get("requestKey");
    if (!(portrait instanceof Blob) || portrait.type !== "image/jpeg" || !(scene instanceof Blob) || scene.type !== "video/mp4" || !(mask instanceof Blob) || mask.type !== "video/mp4" || mask.size > REVIEW.maskBytes || typeof reviewText !== "string" || reviewText.length > 12 * 1024 || typeof requestKey !== "string") throw new ApiError("invalid_input", "Choose a valid character, scene and reviewed timed edit guide.");
    const portraitBytes = new Uint8Array(await portrait.arrayBuffer());
    const sceneBytes = new Uint8Array(await scene.arrayBuffer());
    const maskBytes = new Uint8Array(await mask.arrayBuffer());
    let review;
    try {
      validateMotionPortrait(portraitBytes); validateMotionMp4(sceneBytes, MOTION.sceneBytes);
      const duration = mp4Duration(sceneBytes);
      if (duration < REPLACEMENT.minSeconds || duration > REPLACEMENT.maxSeconds + 0.1) throw new Error("Trim the source to 2–5 seconds for this full-character preview.");
      validateMotionMp4(maskBytes, REVIEW.maskBytes);
      if (Math.abs(mp4Duration(maskBytes) - duration) > 0.15) throw new Error("The guide duration does not match the scene.");
      review = parseSceneReview(JSON.parse(reviewText), duration);
      await validateReviewedMedia(sceneBytes, maskBytes, review, signal);
    } catch (error) { throw new ApiError("invalid_input", error instanceof Error ? error.message : "Invalid replacement assets."); }
    return json(await submitReplacement(portraitBytes, sceneBytes, maskBytes, review, requestKey, signal));
  });
}
