import { CHARACTER_VIEWS, type CharacterViews } from "@aiw/core/replacement";
import { MOTION, validateMotionMp4, validateMotionPortrait } from "@aiw/core/motion";
import { generation } from "@/lib/server/generation";
import { ApiError, endpoint, json, readBytes, readJson } from "@/lib/server/http";
import { authenticated } from "@/lib/server/session";
import { higgsfieldBudget } from "@/lib/server/higgsfield-budget";
import { cancelHiggsfield, downloadHiggsfield, higgsfieldModel, higgsfieldStatus, quoteHiggsfield, submitHiggsfield } from "@/lib/server/higgsfield";

export const runtime = "nodejs";
export const maxDuration = 90;

export function GET(request: Request) {
  return endpoint(async () => {
    if (!authenticated(request)) throw new ApiError("unauthorized", "Enter the shared password to continue.", 401);
    return json(await higgsfieldBudget());
  });
}

export function POST(request: Request) {
  return generation(request, async (signal) => {
    const type = request.headers.get("content-type") ?? "";
    if (type.split(";")[0] === "application/json") {
      const body = await readJson(request, signal);
      if (body.action === "submit") {
        if (body.consent !== "higgsfield-paid") throw new ApiError("invalid_input", "Approve this quoted paid generation first.");
        return json(await submitHiggsfield(body.ticket, signal));
      }
      if (body.action === "status") return json(await higgsfieldStatus(body.id, signal));
      if (body.action === "cancel") return json(await cancelHiggsfield(body.id, signal));
      if (body.action === "download") return downloadHiggsfield(body.id, signal);
      throw new ApiError("invalid_input", "Unknown Higgsfield action.");
    }
    if (!type.startsWith("multipart/form-data;")) throw new ApiError("invalid_input", "Upload the character views and source scene.", 415);
    const bytes = await readBytes(request, MOTION.sceneBytes + MOTION.portraitBytes + 16 * 1024, signal);
    let form: FormData;
    try { form = await new Response(bytes, { headers: { "Content-Type": type } }).formData(); }
    catch { throw new ApiError("invalid_input", "Invalid Higgsfield upload."); }
    if (form.get("consent") !== "higgsfield-upload") throw new ApiError("invalid_input", "Approve sending these assets to Higgsfield before requesting a price.");
    const model = higgsfieldModel(form.get("model"));
    const resolution = form.get("resolution");
    const appearance = form.get("appearance");
    if (resolution !== "720p" && resolution !== "1080p") throw new ApiError("invalid_input", "Choose 720p or 1080p.");
    if (typeof appearance !== "string" || appearance.trim().length < 10 || appearance.length > 1700) throw new ApiError("invalid_input", "Describe the appearance to match in 10–1700 characters.");
    const scene = form.get("scene"), front = form.get("front");
    if (!(scene instanceof Blob) || scene.type !== "video/mp4" || !(front instanceof Blob)) throw new ApiError("invalid_input", "A front image and MP4 scene are required.");
    const character: CharacterViews<Uint8Array> = { front: new Uint8Array() };
    const sceneBytes = new Uint8Array(await scene.arrayBuffer());
    try {
      let size = 0;
      for (const view of CHARACTER_VIEWS) {
        const images = form.getAll(view);
        if (images.length > 1) throw new Error(`Upload only one ${view} view.`);
        const image = images[0];
        if (image === undefined) continue;
        if (!(image instanceof Blob) || image.type !== "image/jpeg") throw new Error(`The ${view} image must be a JPEG.`);
        const data = new Uint8Array(await image.arrayBuffer());
        validateMotionPortrait(data); character[view] = data; size += data.byteLength;
      }
      validateMotionPortrait(character.front);
      if (size > MOTION.portraitBytes) throw new Error("Prepared character images must total at most 1 MB.");
      validateMotionMp4(sceneBytes, MOTION.sceneBytes);
    } catch (error) { throw new ApiError("invalid_input", error instanceof Error ? error.message : "Invalid character or scene media."); }
    return json(await quoteHiggsfield(character, sceneBytes, model, resolution, appearance.trim(), signal));
  });
}
