import { generation } from "@/lib/server/generation";
import { readJson, textField } from "@/lib/server/http";
import { generateVoice } from "@/lib/server/providers";

export const runtime = "nodejs";
export const maxDuration = 90;

export function POST(request: Request) {
  return generation(request, async (signal) => {
    const body = await readJson(request, signal);
    const { audio, durationSec } = await generateVoice(textField(body, "script", 1200), signal);
    return new Response(audio, { headers: { "Content-Type": "audio/wav", "X-Audio-Duration": String(durationSec), "Cache-Control": "no-store" } });
  });
}
