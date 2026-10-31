import { REVIEW, frameChange, regionAt, suggestRegion, type Checkpoint, type GrayFrame, type SceneReview } from "@aiw/core/scene-review";
import type { PersonRegion } from "@aiw/core/replacement";

export type ReviewFrame = { time: number; image: string; region: PersonRegion; uncertain: boolean; reviewed: boolean };
export type SceneAnalysis = { frames: ReviewFrame[]; timings: { time: number; duration: number }[]; duration: number; maxChange: number; uncertainFrames: number; width: number; height: number };

function thumbnail(source: HTMLCanvasElement | OffscreenCanvas): { image: string; gray: GrayFrame } {
  const canvas = document.createElement("canvas");
  canvas.width = source.width; canvas.height = source.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Frame previews are unavailable in this browser.");
  ctx.drawImage(source, 0, 0);
  const image = canvas.toDataURL("image/jpeg", 0.85);
  const scale = Math.min(1, 128 / Math.max(canvas.width, canvas.height));
  canvas.width = Math.max(1, Math.round(canvas.width * scale)); canvas.height = Math.max(1, Math.round(canvas.height * scale));
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const bytes = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const pixels = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = Math.round(bytes[i * 4] * 0.299 + bytes[i * 4 + 1] * 0.587 + bytes[i * 4 + 2] * 0.114);
  const gray = { pixels, width: canvas.width, height: canvas.height };
  canvas.width = 0; canvas.height = 0;
  return { image, gray };
}

export async function analyzeScene(blob: Blob, selection: PersonRegion, signal: AbortSignal): Promise<SceneAnalysis> {
  signal.throwIfAborted();
  const { Input, BlobSource, MP4, CanvasSink } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(blob), formats: [MP4] });
  const abort = () => input.dispose();
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    const track = await input.getPrimaryVideoTrack();
    if (!track || !await track.canDecode()) throw new Error("Local motion analysis needs a browser that can decode this MP4. Try desktop Chrome or Edge with an H.264 export.");
    const stats = await track.computePacketStats(REVIEW.maxFrames + 1);
    if (stats.packetCount > REVIEW.maxFrames || stats.averagePacketRate > 61) throw new Error("Use a scene at 60 fps or less for local review.");
    const start = await track.getFirstTimestamp();
    if (Math.abs(start) > 0.1) throw new Error("Export a standard MP4 starting at zero before reviewing this scene.");
    const width = selection.width, height = selection.height;
    const scale = Math.min(1, 320 / Math.max(width, height));
    const sink = new CanvasSink(track, { width: Math.round(width * scale), height: Math.round(height * scale), fit: "fill", poolSize: 2 });
    const all: ReviewFrame[] = [], timings: SceneAnalysis["timings"] = [];
    let previous: GrayFrame | undefined, region = selection, maxChange = 0, uncertainFrames = 0;
    for await (const frame of sink.canvases()) {
      signal.throwIfAborted();
      if (all.length >= REVIEW.maxFrames) throw new Error("This scene has too many frames for a short preview.");
      const { image, gray } = thumbnail(frame.canvas);
      let uncertain = false;
      if (previous) {
        maxChange = Math.max(maxChange, frameChange(previous, gray));
        const estimate = suggestRegion(previous, gray, region);
        region = estimate.region; uncertain = estimate.uncertain;
        if (uncertain) uncertainFrames++;
      }
      const time = Math.max(0, frame.timestamp - start);
      if (!Number.isFinite(time) || !Number.isFinite(frame.duration) || frame.duration <= 0 || (timings.length && time <= timings.at(-1)!.time)) throw new Error("The scene has unsupported frame timing. Export a standard H.264 MP4.");
      all.push({ time, image, region, uncertain, reviewed: false });
      timings.push({ time, duration: frame.duration });
      previous = gray;
      if (all.length % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    signal.throwIfAborted();
    if (all.length < REVIEW.samples) throw new Error("The scene has too few decodable frames to review.");
    const duration = timings.at(-1)!.time + timings.at(-1)!.duration;
    if (duration < 1.95 || duration > 5.1) throw new Error("Trim the video track to 2–5 seconds before review.");
    const frames = Array.from({ length: REVIEW.samples }, (_, i) => all[Math.round(i * (all.length - 1) / (REVIEW.samples - 1))]);
    return { frames, timings, duration, maxChange, uncertainFrames, width, height };
  } finally { signal.removeEventListener("abort", abort); input.dispose(); }
}

/** A true timed MP4 of interpolated rectangles, not a person-shaped alpha matte. */
export async function encodeRegionGuide(review: SceneReview, timings: SceneAnalysis["timings"], signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, canEncodeVideo } = await import("mediabunny");
  const { width, height } = review.checkpoints[0].region;
  const options = { width, height, bitrate: 180_000, hardwareAcceleration: "prefer-software" as const };
  if (!await canEncodeVideo("avc", options)) throw new Error("This browser cannot prepare an H.264 edit guide. Try desktop Chrome or Edge. Nothing has been uploaded.");
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The edit guide could not be prepared.");
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
  const source = new CanvasSource(canvas, { codec: "avc", bitrate: options.bitrate, hardwareAcceleration: options.hardwareAcceleration, keyFrameInterval: 1 });
  output.addVideoTrack(source);
  try {
    await output.start();
    for (const frame of timings) {
      signal.throwIfAborted();
      const region = regionAt(review.checkpoints, frame.time);
      ctx.fillStyle = "black"; ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "white";
      const left = Math.floor(region.left * width), top = Math.floor(region.top * height);
      ctx.fillRect(left, top, Math.ceil(region.right * width) - left, Math.ceil(region.bottom * height) - top);
      await source.add(frame.time, frame.duration);
    }
    await output.finalize(); signal.throwIfAborted();
    if (!target.buffer || target.buffer.byteLength > REVIEW.maskBytes) throw new Error("The edit guide exceeded 256 KB. Try a simpler, shorter shot. Nothing has been uploaded.");
    return new Blob([target.buffer], { type: "video/mp4" });
  } finally { if (output.state !== "finalized" && output.state !== "canceled") await output.cancel(); canvas.width = 0; canvas.height = 0; }
}

export async function sampleResult(blob: Blob, checkpoints: Checkpoint[], signal: AbortSignal): Promise<string[]> {
  const { Input, BlobSource, MP4, CanvasSink } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(blob), formats: [MP4] });
  const abort = () => input.dispose(); signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    const track = await input.getPrimaryVideoTrack();
    if (!track || !await track.canDecode()) throw new Error("Frame comparison could not be decoded. Watch the entire preview before reviewing it.");
    const first = await track.getFirstTimestamp(), end = await track.computeDuration();
    const sink = new CanvasSink(track, { width: 320, poolSize: 2 });
    const images: string[] = [];
    for await (const frame of sink.canvasesAtTimestamps(checkpoints.map((p) => Math.max(first, Math.min(end - 0.05, p.time + first))))) {
      signal.throwIfAborted();
      if (!frame) throw new Error("A comparison frame is missing. Watch the entire preview before reviewing it.");
      images.push(thumbnail(frame.canvas).image);
    }
    return images;
  } finally { signal.removeEventListener("abort", abort); input.dispose(); }
}
