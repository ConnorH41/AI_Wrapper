import { MOTION, validateMotionMp4, validateMotionPortrait } from "@aiw/core/motion";
import { generation } from "@/lib/server/generation";
import { ApiError, json, readBytes, readJson } from "@/lib/server/http";
import { cancelMotion, motionDemo, startMotion } from "@/lib/server/motion";

export const runtime = "nodejs";
export const maxDuration = 90;

export function POST(request: Request) {
  return generation(request, async (signal) => {
    const type = request.headers.get("content-type") ?? "";
    if (type.split(";")[0] === "application/json") {
      const body = await readJson(request, signal);
      if (body.action === "preview") return json({ url: await motionDemo(signal) });
      if (body.action === "cancel") {
        await cancelMotion(body.ticket, signal);
        return json({ cancelled: true });
      }
      throw new ApiError("invalid_input", "Unknown motion action.");
    }
    if (!type.startsWith("multipart/form-data;")) throw new ApiError("invalid_input", "Expected a motion media upload.", 415);
    const bytes = await readBytes(request, MOTION.portraitBytes + MOTION.sceneBytes + 16 * 1024, signal);
    let form: FormData;
    try { form = await new Response(bytes, { headers: { "Content-Type": type } }).formData(); }
    catch { throw new ApiError("invalid_input", "Invalid motion upload."); }
    if (form.get("consent") !== "yes") throw new ApiError("invalid_input", "Approve sharing these test assets with the external motion provider first.");
    const portrait = form.get("portrait");
    const scene = form.get("scene");
    if (!(portrait instanceof Blob) || portrait.type !== "image/jpeg" || !(scene === null || scene instanceof Blob)) throw new ApiError("invalid_input", "Choose a portrait and a valid scene.");
    try {
      validateMotionPortrait(new Uint8Array(await portrait.arrayBuffer()));
      if (scene instanceof Blob) {
        if (scene.type !== "video/mp4") throw new Error("The scene must be an MP4.");
        validateMotionMp4(new Uint8Array(await scene.arrayBuffer()), MOTION.sceneBytes);
      }
    } catch (error) { throw new ApiError("invalid_input", error instanceof Error ? error.message : "Invalid motion media."); }
    return json(await startMotion(portrait, scene instanceof Blob ? scene : undefined, signal));
  });
}
