export const VIDEO = { width: 720, height: 1280, fps: 30, seconds: 15 } as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 1024 * 1024;
export const FREE_COST_LABEL = "$0 within available free quotas";

export type WordTiming = { word: string; start: number; end: number };
export type ProductInput = { name: string; benefit: string; direction: string };
export type ApiErrorCode =
  | "invalid_input" | "unauthorized" | "forbidden" | "missing_configuration"
  | "quota_exhausted" | "provider_refusal" | "timeout" | "upstream_failure";
export type ApiErrorBody = { error: { code: ApiErrorCode; message: string } };
export type Scene = { start: number; end: number; kind: "presenter" | "product" | "cta"; text: string };

export function renderPlan(product: ProductInput): Scene[] {
  return [
    { start: 0, end: 3, kind: "presenter", text: product.name },
    { start: 3, end: 11, kind: "product", text: product.benefit },
    { start: 11, end: 15, kind: "cta", text: "Learn more" },
  ];
}

export function parseTimings(value: unknown, duration: number): WordTiming[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) {
    throw new Error("The provider did not return word timestamps. Retry caption timing.");
  }
  let previousStart = 0;
  return value.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null || !("word" in entry) ||
      !("start" in entry) || !("end" in entry) ||
      typeof entry.word !== "string" || !entry.word.trim() || entry.word.length > 100 ||
      typeof entry.start !== "number" || typeof entry.end !== "number" ||
      !Number.isFinite(entry.start) || !Number.isFinite(entry.end) ||
      entry.start < previousStart || entry.start < 0 || entry.start >= duration || entry.end <= entry.start ||
      entry.end > duration + 0.1) {
      throw new Error("The provider returned invalid word timestamps. Retry caption timing.");
    }
    previousStart = entry.start;
    return { word: entry.word.trim(), start: entry.start, end: Math.min(entry.end, duration) };
  });
}

export function buildCaptions(timings: WordTiming[]): string {
  const cues: string[] = [];
  for (let i = 0; i < timings.length; i += 4) {
    const words = timings.slice(i, i + 4);
    const text = words.map(({ word }) => word.replace(/<[^>]*>/g, "").replace(/[<>\\{}\r\n]/g, "")).join(" ");
    cues.push(`${cues.length + 1}\n${stamp(words[0].start)} --> ${stamp(words[words.length - 1].end)}\n${text}\n`);
  }
  return cues.join("\n");
}

function stamp(seconds: number): string {
  const milliseconds = Math.round(seconds * 1000);
  return `00:00:${String(Math.floor(milliseconds / 1000)).padStart(2, "0")},${String(milliseconds % 1000).padStart(3, "0")}`;
}

export function pcmToWav(pcm: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!pcm.length || pcm.length % 2 !== 0) throw new Error("Invalid PCM audio from the voice provider.");
  const bytes = new Uint8Array(44 + pcm.length);
  const view = new DataView(bytes.buffer);
  for (const [offset, value] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]] as const) {
    bytes.set(new TextEncoder().encode(value), offset);
  }
  view.setUint32(4, 36 + pcm.length, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true);
  view.setUint32(28, 48000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, pcm.length, true);
  bytes.set(pcm, 44);
  return bytes;
}

export function wavDuration(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const label = (offset: number, length: number) => new TextDecoder().decode(bytes.subarray(offset, offset + length));
  if (bytes.length < 44 || label(0, 4) !== "RIFF" || label(8, 4) !== "WAVE" ||
    view.getUint32(4, true) + 8 !== bytes.length) throw new Error("Expected a complete PCM WAV file.");
  let byteRate = 0;
  let dataSize = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = view.getUint32(offset + 4, true);
    if (offset + 8 + size > bytes.length) throw new Error("The WAV file is truncated.");
    const kind = label(offset, 4);
    if (kind === "fmt ") {
      if (size < 16 || view.getUint16(offset + 8, true) !== 1 ||
        view.getUint16(offset + 10, true) !== 1 || view.getUint16(offset + 22, true) !== 16 ||
        view.getUint16(offset + 20, true) !== 2) throw new Error("Expected mono 16-bit PCM audio.");
      const rate = view.getUint32(offset + 12, true);
      byteRate = view.getUint32(offset + 16, true);
      if (rate < 8000 || rate > 48000 || byteRate !== rate * 2) throw new Error("Invalid WAV sample rate.");
    }
    if (kind === "data") dataSize = size;
    offset += 8 + size + size % 2;
  }
  if (!byteRate || !dataSize || dataSize % 2) throw new Error("The WAV file has no valid audio.");
  return dataSize / byteRate;
}
