import { generation } from "@/lib/server/generation";
import { readJson, textField } from "@/lib/server/http";
import { generateAvatar } from "@/lib/server/providers";

export const runtime = "nodejs";
export const maxDuration = 90;

export function POST(request: Request) {
  return generation(request, async (signal) => {
    const body = await readJson(request, signal);
    const { bytes, mime } = await generateAvatar(textField(body, "prompt", 1700), signal);
    return new Response(bytes, { headers: { "Content-Type": mime, "Cache-Control": "no-store" } });
  });
}
