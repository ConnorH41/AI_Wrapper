import { MAX_AUDIO_BYTES, wavDuration } from "@aiw/core/session";
import { generation } from "@/lib/server/generation";
import { ApiError, json, readBytes } from "@/lib/server/http";
import { transcribe } from "@/lib/server/providers";

export const runtime = "nodejs";
export const maxDuration = 90;

export function POST(request: Request) {
  return generation(request, async (signal) => {
    if (request.headers.get("content-type") !== "audio/wav") throw new ApiError("invalid_input", "Expected audio/wav.", 415);
    const audio = await readBytes(request, MAX_AUDIO_BYTES, signal);
    let duration: number;
    try { duration = wavDuration(audio); }
    catch (error) { throw new ApiError("invalid_input", error instanceof Error ? error.message : "Invalid WAV."); }
    if (duration > 15) throw new ApiError("invalid_input", "Narration must fit within 15 seconds.");
    return json({ timings: await transcribe(audio, duration, signal) });
  });
}
