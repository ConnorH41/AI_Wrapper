export const MOTION = {
  host: "https://alexnasa-wan2-2-animate-zerogpu.hf.space",
  space: "alexnasa/Wan2.2-Animate-ZEROGPU",
  seconds: 2,
  portraitBytes: 1024 * 1024,
  sceneBytes: 3 * 1024 * 1024,
  outputBytes: 4 * 1024 * 1024,
} as const;

export type MotionJob = { eventId: string; streamUrl: string; cancelTicket: string };
export type MotionDiagnostics = { mask?: string; background?: string };

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid motion provider response.");
  return Object.fromEntries(Object.entries(value));
}

export function motionFileUrl(path: unknown, extension: "mp4" | "png"): string {
  if (typeof path !== "string" || !new RegExp(`^/tmp/gradio/[a-f0-9]{32,128}/[a-zA-Z0-9_.-]+\\.${extension}$`).test(path)) {
    throw new Error("Invalid motion media location.");
  }
  return `${MOTION.host}/gradio_api/file=${path}`;
}

export function motionStreamUrl(eventId: unknown): string {
  if (typeof eventId !== "string" || !/^[a-f0-9]{32}$/.test(eventId)) throw new Error("Invalid motion job ID.");
  return `${MOTION.host}/gradio_api/call/animate_scene/${eventId}`;
}

export function motionMediaUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid motion media location.");
  const url = new URL(value);
  const prefix = "/gradio_api/file=";
  if (url.origin !== MOTION.host || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(prefix)) throw new Error("Invalid motion media location.");
  return motionFileUrl(url.pathname.slice(prefix.length), "mp4");
}

export function parseMotionJob(value: unknown): MotionJob {
  const body = object(value);
  if (typeof body.eventId !== "string" || body.streamUrl !== motionStreamUrl(body.eventId) ||
    typeof body.cancelTicket !== "string" || body.cancelTicket.length > 2048 || !body.cancelTicket) {
    throw new Error("Invalid motion job response.");
  }
  return { eventId: body.eventId, streamUrl: body.streamUrl, cancelTicket: body.cancelTicket };
}

export function parseMotionEvent(block: string): { kind: "pending" } | { kind: "complete"; url: string; diagnostics?: MotionDiagnostics } {
  const lines = block.split(/\r?\n/);
  const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
  if (!event || event === "heartbeat" || event === "generating") return { kind: "pending" };
  const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
  if (event === "error") {
    if (/quota|allocation|GPU.{0,40}(?:duration|time|limit)|seconds left/i.test(data)) throw new Error("The free GPU quota is exhausted or unavailable. Wait for it to reset; no paid fallback was used.");
    if (/(?:file|upload|video|payload).{0,40}(?:size|large|limit)|size.{0,30}exceed/i.test(data)) throw new Error("The provider rejected the media size. Choose a smaller scene or reference.");
    if (/safety|moderat|refus|content.policy/i.test(data)) throw new Error("The motion provider refused this content. Choose another character or scene.");
    throw new Error("Character replacement failed at the provider. Your inputs are preserved. No automatic retry was made.");
  }
  if (event !== "complete") return { kind: "pending" };
  const payload: unknown = JSON.parse(data);
  if (!Array.isArray(payload) || !payload.length) throw new Error("The provider returned no motion video.");
  const first = object(payload[0]);
  const file = "video" in first ? object(first.video) : first;
  const diagnostics: MotionDiagnostics = {};
  for (const [key, index] of [["background", 2], ["mask", 3]] as const) {
    if (payload[index] !== null && payload[index] !== undefined) {
      const item = object(payload[index]);
      const media = "video" in item ? object(item.video) : item;
      diagnostics[key] = motionFileUrl(media.path, "mp4");
    }
  }
  return { kind: "complete", url: motionFileUrl(file.path, "mp4"), ...(Object.keys(diagnostics).length ? { diagnostics } : {}) };
}

export function validateMotionMp4(bytes: Uint8Array, maxBytes: number): void {
  if (bytes.length < 12 || bytes.length > maxBytes || new TextDecoder().decode(bytes.subarray(4, 8)) !== "ftyp") {
    throw new Error("Choose a valid MP4 within the displayed size limit.");
  }
}

export function validateMotionPortrait(bytes: Uint8Array): void {
  if (bytes.length < 12 || bytes.length > MOTION.portraitBytes || bytes[0] !== 255 || bytes[1] !== 216) throw new Error("The motion portrait must be a JPEG up to 1 MB.");
  let position = 2;
  while (position + 4 <= bytes.length) {
    if (bytes[position++] !== 255) break;
    while (bytes[position] === 255) position++;
    const marker = bytes[position++];
    if (marker === 218 || marker === 217) break;
    const length = (bytes[position] << 8) | bytes[position + 1];
    if (length < 2 || position + length > bytes.length) break;
    if ([192, 193, 194].includes(marker) && length >= 8) {
      const height = (bytes[position + 3] << 8) | bytes[position + 4];
      const width = (bytes[position + 5] << 8) | bytes[position + 6];
      if (width > 0 && height > 0 && width <= 1024 && height <= 1024) return;
      break;
    }
    position += length;
  }
  throw new Error("The motion portrait has invalid or excessive dimensions.");
}

export function findMotionDemo(value: unknown, depth = 0): string | undefined {
  if (depth > 20) return;
  if (typeof value === "string" && /^\/tmp\/gradio\/[a-f0-9]{32,128}\/okay\.mp4$/.test(value)) return value;
  const children = Array.isArray(value) ? value : typeof value === "object" && value !== null ? Object.values(value) : [];
  for (const child of children) {
    const found = findMotionDemo(child, depth + 1);
    if (found) return found;
  }
}
