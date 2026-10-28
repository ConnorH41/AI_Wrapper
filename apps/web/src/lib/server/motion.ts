import { createHmac, timingSafeEqual } from "node:crypto";
import { MOTION, findMotionDemo, motionFileUrl, motionStreamUrl, type MotionJob } from "@aiw/core/motion";
import { ApiError, readBytes, requiredEnv } from "./http";

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ApiError("upstream_failure", "The motion provider returned an invalid response.", 502);
  return Object.fromEntries(Object.entries(value));
}

async function providerJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, { ...init, cache: "no-store", redirect: "error" });
  if (!response.ok) {
    if (response.status === 429) throw new ApiError("quota_exhausted", "The free motion provider is rate limited or out of quota. Wait before retrying.", 429);
    if ([401, 403].includes(response.status)) throw new ApiError("missing_configuration", "Check HF_TOKEN and the free Hugging Face account's permissions.", 503);
    throw new ApiError("upstream_failure", "The motion provider is unavailable. Your inputs are preserved.", 502);
  }
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = await readBytes(response, 2 * 1024 * 1024, init.signal ?? undefined); }
  catch (error) {
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw error;
    throw new ApiError("upstream_failure", "The motion provider response exceeded its supported size.", 502);
  }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new ApiError("upstream_failure", "The motion provider returned invalid JSON.", 502); }
}

async function configuration(signal: AbortSignal) {
  return object(await providerJson(`${MOTION.host}/config`, { signal }));
}

export async function motionDemo(signal: AbortSignal): Promise<string> {
  const config = await configuration(signal);
  const path = findMotionDemo(config.components);
  if (!path) throw new ApiError("upstream_failure", "The published demo scene is unavailable. Upload your own short scene instead.", 502);
  return motionFileUrl(path, "mp4");
}

function sign(payload: string): string {
  const secret = requiredEnv("SESSION_SIGNING_SECRET");
  if (secret.length < 32) throw new ApiError("missing_configuration", "Set a signing secret of at least 32 characters.", 503);
  return createHmac("sha256", secret).update(`motion:${payload}`).digest("base64url");
}

export function motionTicket(eventId: string, fnIndex: number, now = Date.now()): string {
  motionStreamUrl(eventId);
  const payload = Buffer.from(JSON.stringify({ eventId, fnIndex, expires: now + 20 * 60 * 1000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function parseMotionTicket(ticket: unknown, now = Date.now()): { eventId: string; fnIndex: number } {
  if (typeof ticket !== "string" || ticket.length > 2048) throw new ApiError("invalid_input", "Invalid motion cancellation ticket.");
  const [payload, mac, extra] = ticket.split(".");
  if (!payload || !mac || extra !== undefined || !/^[a-zA-Z0-9_-]{43}$/.test(mac) || !timingSafeEqual(Buffer.from(mac), Buffer.from(sign(payload)))) throw new ApiError("invalid_input", "Invalid motion cancellation ticket.");
  let value: unknown;
  try { value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); }
  catch { throw new ApiError("invalid_input", "Invalid motion cancellation ticket."); }
  const body = object(value);
  if (typeof body.eventId !== "string" || !/^[a-f0-9]{32}$/.test(body.eventId) || typeof body.fnIndex !== "number" || !Number.isInteger(body.fnIndex) || body.fnIndex < 0 || body.fnIndex > 10000 || typeof body.expires !== "number" || body.expires <= now || body.expires > now + 20 * 60 * 1000) throw new ApiError("invalid_input", "The motion cancellation ticket is invalid or expired.");
  return { eventId: body.eventId, fnIndex: body.fnIndex };
}

export async function cancelMotion(ticket: unknown, signal: AbortSignal): Promise<void> {
  const { eventId, fnIndex } = parseMotionTicket(ticket);
  await providerJson(`${MOTION.host}/gradio_api/cancel`, {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${requiredEnv("HF_TOKEN")}` },
    body: JSON.stringify({ event_id: eventId, session_hash: eventId, fn_index: fnIndex }),
  });
}

export async function startMotion(portrait: Blob, scene: Blob | undefined, signal: AbortSignal): Promise<MotionJob> {
  const token = requiredEnv("HF_TOKEN");
  const auth = { Authorization: `Bearer ${token}` };
  const identity = object(await providerJson("https://huggingface.co/api/whoami-v2", { headers: auth, signal }));
  if (identity.isPro !== false) throw new ApiError("missing_configuration", "Motion tests require a verified free Hugging Face account. Paid-account fallback is disabled.", 503);
  const config = await configuration(signal);
  if (!Array.isArray(config.dependencies)) throw new ApiError("upstream_failure", "The motion API configuration changed.", 502);
  const dependency = config.dependencies.map(object).find((entry) => entry.api_name === "animate_scene");
  if (!dependency || typeof dependency.id !== "number" || !Number.isInteger(dependency.id) || dependency.id < 0 || dependency.id > 10000) throw new ApiError("upstream_failure", "The motion API endpoint is unavailable.", 502);
  let video = scene;
  if (!video) {
    const path = findMotionDemo(config.components);
    if (!path) throw new ApiError("upstream_failure", "The published demo scene is unavailable.", 502);
    const response = await fetch(motionFileUrl(path, "mp4"), { signal, redirect: "error", cache: "no-store" });
    if (!response.ok) throw new ApiError("upstream_failure", "The published demo scene could not be loaded.", 502);
    video = new Blob([await readBytes(response, MOTION.sceneBytes, signal)], { type: "video/mp4" });
  }
  const uploaded: { path: string; orig_name: string; meta: { _type: string } }[] = [];
  for (const [blob, name] of [[video, "scene.mp4"], [portrait, "portrait.jpg"]] as const) {
    const form = new FormData(); form.append("files", blob, name);
    const paths = await providerJson(`${MOTION.host}/gradio_api/upload`, { method: "POST", signal, headers: auth, body: form });
    if (!Array.isArray(paths) || typeof paths[0] !== "string" || !/^\/tmp\/gradio\/[a-f0-9]{32,128}\/[a-zA-Z0-9_.-]+$/.test(paths[0])) throw new ApiError("upstream_failure", "The motion input upload failed.", 502);
    uploaded.push({ path: paths[0], orig_name: name, meta: { _type: "gradio.FileData" } });
  }
  // Gradio's published contract omits this demo's hidden State input.
  const job = object(await providerJson(`${MOTION.host}/gradio_api/call/animate_scene`, {
    method: "POST", signal, headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ data: [uploaded[0], MOTION.seconds, uploaded[1], "Character Swap", "Low Res", null] }),
  }));
  if (typeof job.event_id !== "string" || !/^[a-f0-9]{32}$/.test(job.event_id)) throw new ApiError("upstream_failure", "The motion provider returned an invalid job ID.", 502);
  return { eventId: job.event_id, streamUrl: motionStreamUrl(job.event_id), cancelTicket: motionTicket(job.event_id, dependency.id) };
}
