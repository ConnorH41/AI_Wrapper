import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { REPLACEMENT, replacementMediaUrl, type PersonRegion, type ReplacementJob, type ReplacementStatus } from "@aiw/core/replacement";
import { ApiError, readBytes, requiredEnv } from "./http";
import { personMask } from "./person-mask";

const QUEUE = "https://queue.fal.run";
const JOB_PATH = "/fal-ai/wan-vace-14b/requests/";
const LIFE = JSON.stringify({ expiration_duration_seconds: 3600 });

export function replacementAvailable(): boolean {
  return process.env.ENABLE_PAID_MOTION === "true" && process.env.PAID_MOTION_BUDGET_REVIEWED === "true" && Boolean(process.env.FAL_KEY?.trim());
}

function requireEnabled() {
  if (!replacementAvailable()) throw new ApiError("missing_configuration", "Full-character generation is not enabled. An operator must configure the paid provider and review its spending controls first.", 503);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError("upstream_failure", "The replacement provider returned an invalid response.", 502);
  return value as Record<string, unknown>;
}

async function providerJson(url: string, method: string, signal: AbortSignal, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method, signal, cache: "no-store", redirect: "error",
    headers: { Authorization: `Key ${requiredEnv("FAL_KEY")}`, "Content-Type": "application/json", "X-Fal-Object-Lifecycle-Preference": LIFE,
      ...(url.startsWith("https://rest.alpha.fal.ai/") ? { "X-Fal-Object-Lifecycle": LIFE } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    if (response.status === 429 || response.status === 402) throw new ApiError("quota_exhausted", "The paid provider declined this request because of its credit or rate limit. No fallback was used.", 429);
    if ([401, 403].includes(response.status)) throw new ApiError("missing_configuration", "The paid provider rejected its credentials or permissions.", 503);
    throw new ApiError("upstream_failure", "The replacement provider could not complete this step. A submission may still have started; no automatic retry was made.", 502);
  }
  if (method === "PUT" && !response.body) return {};
  try {
    const bytes = await readBytes(response, 256 * 1024, signal);
    if (method === "PUT" && !bytes.length) return {};
    return object(JSON.parse(new TextDecoder().decode(bytes)));
  }
  catch (error) { if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw error; throw new ApiError("upstream_failure", "The replacement provider returned an invalid response.", 502); }
}

async function upload(bytes: Uint8Array, filename: string, mime: string, signal: AbortSignal): Promise<string> {
  const info = await providerJson("https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3", "POST", signal, { content_type: mime, file_name: filename });
  let target: string;
  let file: string;
  try { target = replacementMediaUrl(info.upload_url); file = replacementMediaUrl(info.file_url); }
  catch { throw new ApiError("upstream_failure", "The provider returned an unsupported media upload location.", 502); }
  // Signed storage upload: never forward the API credential to a returned URL.
  const response = await fetch(target, { method: "PUT", headers: { "Content-Type": mime }, body: new Blob([Uint8Array.from(bytes)]), signal, redirect: "error" });
  if (!response.ok) throw new ApiError("upstream_failure", "The replacement assets could not be uploaded. No generation retry was made.", 502);
  return file;
}

function sign(payload: string): string {
  const secret = requiredEnv("SESSION_SIGNING_SECRET");
  if (secret.length < 32) throw new ApiError("missing_configuration", "Set a signing secret of at least 32 characters.", 503);
  return createHmac("sha256", secret).update(`replacement:${payload}`).digest("base64url");
}

export function replacementTicket(requestId: string, now = Date.now()): string {
  if (!/^[a-f0-9-]{36}$/i.test(requestId)) throw new ApiError("upstream_failure", "The provider returned an invalid job identifier.", 502);
  const payload = Buffer.from(JSON.stringify({ requestId, expires: now + 30 * 60 * 1000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function parseReplacementTicket(ticket: unknown, now = Date.now()): string {
  if (typeof ticket !== "string" || ticket.length > 1024) throw new ApiError("invalid_input", "Invalid replacement job.");
  const [payload, mac, extra] = ticket.split(".");
  if (!payload || !mac || extra || !/^[\w-]{43}$/.test(mac) || !timingSafeEqual(Buffer.from(mac), Buffer.from(sign(payload)))) throw new ApiError("invalid_input", "Invalid replacement job.");
  let data: Record<string, unknown>;
  try { data = object(JSON.parse(Buffer.from(payload, "base64url").toString())); } catch { throw new ApiError("invalid_input", "Invalid replacement job."); }
  if (typeof data.requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(data.requestId) || typeof data.expires !== "number" || data.expires <= now || data.expires > now + 30 * 60 * 1000) throw new ApiError("invalid_input", "This replacement job is invalid or expired.");
  return data.requestId;
}

// A private-prototype single-flight guard, not a durable/global spending ledger.
const submissions = new Map<string, { expires: number; digest: string; task: Promise<ReplacementJob> }>();
export function submitReplacement(portrait: Uint8Array, scene: Uint8Array, region: PersonRegion, requestKey: string, signal: AbortSignal): Promise<ReplacementJob> {
  requireEnabled();
  if (!/^[a-f0-9-]{36}$/i.test(requestKey)) throw new ApiError("invalid_input", "Invalid submission key.");
  for (const [key, value] of submissions) if (value.expires < Date.now()) submissions.delete(key);
  const digest = createHash("sha256").update(portrait).update(scene).update(JSON.stringify(region)).digest("hex");
  const previous = submissions.get(requestKey);
  if (previous) {
    if (previous.digest !== digest) throw new ApiError("invalid_input", "This submission key belongs to different inputs.");
    return previous.task;
  }
  if (submissions.size >= 100) throw new ApiError("quota_exhausted", "Too many replacement submissions. Wait before requesting another.", 429);
  const task = (async () => {
    const mask = personMask(region);
    const imageUrl = await upload(portrait, "character.jpg", "image/jpeg", signal);
    const sceneUrl = await upload(scene, "scene.mp4", "video/mp4", signal);
    const maskUrl = await upload(mask, "whole-person-guide.png", "image/png", signal);
    const result = await providerJson(`${QUEUE}/${REPLACEMENT.endpoint}`, "POST", signal, {
      video_url: sceneUrl, mask_image_url: maskUrl, ref_image_urls: [imageUrl],
      prompt: "Replace the complete selected person with the character in the reference image, including face, hairstyle, clothing and visible body appearance. Follow the original person's motion. Preserve the surrounding scene and camera. No extra people.",
      resolution: "720p", num_inference_steps: 30, acceleration: "none",
      match_input_num_frames: true, match_input_frames_per_second: true,
      enable_auto_downsample: true, enable_safety_checker: true,
      video_quality: "high", video_write_mode: "balanced",
    });
    if (typeof result.request_id !== "string") throw new ApiError("upstream_failure", "The provider did not return a recoverable job. Check its request history before submitting again.", 502);
    return { ticket: replacementTicket(result.request_id) };
  })();
  // Retain rejected/ambiguous submissions too: the same key must never resubmit.
  submissions.set(requestKey, { task, digest, expires: Date.now() + 30 * 60 * 1000 });
  return task;
}

export async function replacementStatus(ticket: unknown, signal: AbortSignal): Promise<ReplacementStatus> {
  const id = parseReplacementTicket(ticket);
  const status = await providerJson(`${QUEUE}${JOB_PATH}${id}/status`, "GET", signal);
  if (status.status === "IN_QUEUE" || status.status === "IN_PROGRESS") return { status: "waiting" };
  if (status.status !== "COMPLETED") throw new ApiError("upstream_failure", "The replacement job could not finish. Check the provider history before starting another.", 502);
  const result = await providerJson(`${QUEUE}${JOB_PATH}${id}`, "GET", signal);
  let url: string;
  try { url = replacementMediaUrl(object(result.video).url); }
  catch { throw new ApiError("upstream_failure", "The replacement result had an unsupported video location.", 502); }
  return { status: "complete", url };
}

export async function cancelReplacement(ticket: unknown, signal: AbortSignal) {
  const id = parseReplacementTicket(ticket);
  await providerJson(`${QUEUE}${JOB_PATH}${id}/cancel`, "PUT", signal);
}
