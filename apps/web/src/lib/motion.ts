import { MOTION, parseMotionEvent, validateMotionMp4, type MotionJob, type MotionDiagnostics } from "@aiw/core/motion";
import { validateImage } from "./images";

export async function motionPortrait(blob: Blob): Promise<Blob> {
  await validateImage(blob);
  const image = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, 768 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare the motion reference.");
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not prepare the motion reference.")), "image/jpeg", 0.9));
    canvas.width = 0; canvas.height = 0;
    if (jpeg.size > MOTION.portraitBytes) throw new Error("Choose a simpler portrait for the 1 MB motion reference limit.");
    return jpeg;
  } finally { image.close(); }
}

export async function validateMotionScene(file: File): Promise<{ width: number; height: number; duration: number }> {
  if (file.type !== "video/mp4" || file.size > MOTION.sceneBytes) throw new Error("Choose an MP4 scene up to 3 MB.");
  validateMotionMp4(new Uint8Array(await file.slice(0, 32).arrayBuffer()), MOTION.sceneBytes);
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  try {
    const info = await new Promise<{ duration: number; pixels: number; width: number; height: number }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The scene could not be decoded in time.")), 10000);
      video.onloadedmetadata = () => { clearTimeout(timer); resolve({ duration: video.duration, pixels: video.videoWidth * video.videoHeight, width: video.videoWidth, height: video.videoHeight }); };
      video.onerror = () => { clearTimeout(timer); reject(new Error("The scene could not be decoded. Use an H.264 MP4.")); };
      video.preload = "metadata"; video.src = url;
    });
    if (!Number.isFinite(info.duration) || info.duration < MOTION.seconds || info.duration > 15 || info.pixels < 1 || info.pixels > 3840 * 2160) throw new Error("Use a decodable 2–15-second scene, no larger than 4K. Only the first 2 seconds are used.");
    return info;
  } finally { video.onloadedmetadata = null; video.onerror = null; video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url); }
}

export async function receiveMotion(job: MotionJob, signal: AbortSignal, onDiagnostics?: (diagnostics: MotionDiagnostics | undefined) => void): Promise<Blob> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(6 * 60 * 1000)]);
  const response = await fetch(job.streamUrl, { signal: deadline, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", redirect: "error" });
  if (!response.ok || !response.body) throw new Error("Could not read the motion job. Your inputs are preserved; no automatic retry was made.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let received = 0;
  let mediaUrl: string | undefined;
  let diagnostics: MotionDiagnostics | undefined;
  try {
    while (!mediaUrl) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > 256 * 1024) throw new Error("The motion response exceeded its supported size.");
      buffer += decoder.decode(value, { stream: true });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer)) !== null) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const event = parseMotionEvent(block);
        if (event.kind === "complete") { mediaUrl = event.url; diagnostics = event.diagnostics; break; }
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (!mediaUrl) throw new Error("The motion stream ended before a video arrived. Your inputs are preserved.");
  const blob = await downloadMotion(mediaUrl, deadline, MOTION.outputBytes);
  await validatePlayableVideo(blob, deadline, MOTION.seconds - 0.2, MOTION.seconds + 0.2);
  onDiagnostics?.(diagnostics);
  return blob;
}

export async function downloadMotion(url: string, signal: AbortSignal, maxBytes: number): Promise<Blob> {
  const output = await fetch(url, { signal, credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", cache: "no-store" });
  if (!output.ok || !output.body) throw new Error("The generated motion video could not be downloaded.");
  if (Number(output.headers.get("content-length")) > maxBytes) { await output.body.cancel(); throw new Error("The generated motion video exceeded the download limit."); }
  const files = output.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await files.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("The generated motion video exceeded the download limit.");
      chunks.push(Uint8Array.from(value));
    }
  } finally { await files.cancel().catch(() => {}); files.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  validateMotionMp4(bytes, maxBytes);
  return new Blob([bytes], { type: "video/mp4" });
}

export async function validatePlayableVideo(blob: Blob, signal: AbortSignal, minimum: number, maximum: number): Promise<void> {
  signal.throwIfAborted();
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => reject(new Error("The generated video could not be decoded in time.")), 15000);
      video.onerror = () => reject(new Error("The provider returned an unplayable video. Your earlier result is preserved."));
      video.onloadeddata = () => {
        if (!Number.isFinite(video.duration) || video.duration < minimum || video.duration > maximum || !video.videoWidth || !video.videoHeight || video.videoWidth * video.videoHeight > 3840 * 2160) reject(new Error("The result has unexpected duration or dimensions. Your earlier result is preserved."));
        else resolve();
      };
      video.preload = "auto"; video.src = url; video.load();
      if (signal.aborted) abort();
    });
  } finally {
    clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
    video.onerror = null; video.onloadeddata = null; video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url);
  }
}
