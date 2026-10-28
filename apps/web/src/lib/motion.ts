import { MOTION, parseMotionEvent, validateMotionMp4, type MotionJob } from "@aiw/core/motion";
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

export async function validateMotionScene(file: File): Promise<void> {
  if (file.type !== "video/mp4" || file.size > MOTION.sceneBytes) throw new Error("Choose an MP4 scene up to 3 MB.");
  validateMotionMp4(new Uint8Array(await file.slice(0, 32).arrayBuffer()), MOTION.sceneBytes);
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  try {
    const info = await new Promise<{ duration: number; pixels: number }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The scene could not be decoded in time.")), 10000);
      video.onloadedmetadata = () => { clearTimeout(timer); resolve({ duration: video.duration, pixels: video.videoWidth * video.videoHeight }); };
      video.onerror = () => { clearTimeout(timer); reject(new Error("The scene could not be decoded. Use an H.264 MP4.")); };
      video.preload = "metadata"; video.src = url;
    });
    if (!Number.isFinite(info.duration) || info.duration < MOTION.seconds || info.duration > 15 || info.pixels < 1 || info.pixels > 3840 * 2160) throw new Error("Use a decodable 2–15-second scene, no larger than 4K. Only the first 2 seconds are used.");
  } finally { video.onloadedmetadata = null; video.onerror = null; video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url); }
}

export async function receiveMotion(job: MotionJob, signal: AbortSignal): Promise<Blob> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(6 * 60 * 1000)]);
  const response = await fetch(job.streamUrl, { signal: deadline, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", redirect: "error" });
  if (!response.ok || !response.body) throw new Error("Could not read the motion job. Your inputs are preserved; no automatic retry was made.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let received = 0;
  let mediaUrl: string | undefined;
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
        if (event.kind === "complete") { mediaUrl = event.url; break; }
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (!mediaUrl) throw new Error("The motion stream ended before a video arrived. Your inputs are preserved.");
  const output = await fetch(mediaUrl, { signal: deadline, credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", cache: "no-store" });
  if (!output.ok || !output.body) throw new Error("The generated motion video could not be downloaded.");
  const files = output.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await files.read();
      if (done) break;
      size += value.byteLength;
      if (size > MOTION.outputBytes) throw new Error("The generated motion video exceeded the download limit.");
      chunks.push(Uint8Array.from(value));
    }
  } finally { await files.cancel().catch(() => {}); files.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  validateMotionMp4(bytes, MOTION.outputBytes);
  return new Blob([bytes], { type: "video/mp4" });
}
