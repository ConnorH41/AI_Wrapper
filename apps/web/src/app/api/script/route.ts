import { generation } from "@/lib/server/generation";
import { json, readJson, textField } from "@/lib/server/http";
import { generateScript } from "@/lib/server/providers";

export const runtime = "nodejs";
export const maxDuration = 90;

export function POST(request: Request) {
  return generation(request, async (signal) => {
    const body = await readJson(request, signal);
    const script = await generateScript({ name: textField(body, "name", 100), benefit: textField(body, "benefit", 300), direction: textField(body, "direction", 500, true) }, signal);
    return json({ script });
  });
}
