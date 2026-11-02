export const REPLACEMENT = {
  maxSeconds: 5,
  minSeconds: 2,
  maxDimension: 2048,
  outputBytes: 16 * 1024 * 1024,
  endpoint: "fal-ai/wan-vace-14b/inpainting",
} as const;

export const CHARACTER_VIEWS = ["front", "side", "back"] as const;
export type CharacterView = typeof CHARACTER_VIEWS[number];
export type CharacterViews<T> = { front: T; side?: T; back?: T };

export const HIGGSFIELD_MODELS = {
  genjutsu: { name: "Genjutsu Objects swap", endpoint: "higgsfield/genjutsu/object-swap/v1.0", maxSeconds: 30 },
  light: { name: "Genjutsu Light Objects swap", endpoint: "higgsfield/genjutsu-light/object-swap/v1.0", maxSeconds: 15 },
} as const;
export type HiggsfieldModel = keyof typeof HIGGSFIELD_MODELS;
export type HiggsfieldQuote = { ticket: string; usd: number; duration: number; expires: number; pricing: "account" | "formula"; explanation: string };
export type HiggsfieldJob = { id: string; status: "pending" | "completed" | "failed" | "nsfw" | "canceled"; usd: number; duration: number; width: number; height: number; recoverable: boolean };
export type HiggsfieldBudget = { configured: boolean; limit: number; used: number; remaining: number; jobs: HiggsfieldJob[] };

function higgsfieldObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Higgsfield response.");
  return Object.fromEntries(Object.entries(value));
}

export function parseHiggsfieldJob(value: unknown): HiggsfieldJob {
  const data = higgsfieldObject(value);
  const status = data.status;
  if (status !== "pending" && status !== "completed" && status !== "failed" && status !== "nsfw" && status !== "canceled") throw new Error("Invalid Higgsfield job status.");
  if (typeof data.id !== "string" || !/^[a-f0-9-]{36}$/i.test(data.id) || typeof data.usd !== "number" || !Number.isFinite(data.usd) || data.usd < 0 || data.usd > 5 || typeof data.duration !== "number" || !Number.isFinite(data.duration) || data.duration < 4 || data.duration > 30.1 || typeof data.width !== "number" || !Number.isInteger(data.width) || data.width < 1 || data.width > 3840 || typeof data.height !== "number" || !Number.isInteger(data.height) || data.height < 1 || data.height > 3840 || typeof data.recoverable !== "boolean") throw new Error("Invalid Higgsfield job.");
  return { id: data.id, status, usd: data.usd, duration: data.duration, width: data.width, height: data.height, recoverable: data.recoverable };
}

export function parseHiggsfieldBudget(value: unknown): HiggsfieldBudget {
  const data = higgsfieldObject(value);
  if (typeof data.configured !== "boolean" || data.limit !== 5 || typeof data.used !== "number" || !Number.isFinite(data.used) || data.used < 0 || data.used > 5 || typeof data.remaining !== "number" || !Number.isFinite(data.remaining) || data.remaining < 0 || data.remaining > 5 || !Array.isArray(data.jobs)) throw new Error("Invalid Higgsfield budget response.");
  return { configured: data.configured, limit: 5, used: data.used, remaining: data.remaining, jobs: data.jobs.map(parseHiggsfieldJob) };
}

export function parseHiggsfieldQuote(value: unknown): HiggsfieldQuote {
  const data = higgsfieldObject(value);
  if ((data.pricing !== "account" && data.pricing !== "formula") || typeof data.explanation !== "string" || data.explanation.length > 1000) throw new Error("Invalid Higgsfield pricing basis.");
  if (typeof data.ticket !== "string" || data.ticket.length > 14 * 1024 || typeof data.usd !== "number" || !Number.isFinite(data.usd) || data.usd <= 0 || data.usd > 5 || typeof data.duration !== "number" || !Number.isFinite(data.duration) || data.duration < 4 || data.duration > 30.1 || typeof data.expires !== "number" || !Number.isFinite(data.expires)) throw new Error("Invalid Higgsfield price estimate.");
  return { ticket: data.ticket, usd: data.usd, duration: data.duration, expires: data.expires, pricing: data.pricing, explanation: data.explanation };
}

export type PersonRegion = { left: number; top: number; right: number; bottom: number; width: number; height: number };
export type ReplacementJob = { ticket: string };
export type ReplacementStatus = { status: "waiting" | "complete"; url?: string };

export function parsePersonRegion(value: unknown): PersonRegion {
  if (!value || typeof value !== "object") throw new Error("Select the whole visible person in the scene.");
  const input = value as Record<string, unknown>;
  const keys = ["left", "top", "right", "bottom", "width", "height"] as const;
  if (keys.some((key) => typeof input[key] !== "number" || !Number.isFinite(input[key]))) throw new Error("Invalid person selection.");
  const region = Object.fromEntries(keys.map((key) => [key, input[key]])) as PersonRegion;
  if (region.left < 0 || region.top < 0 || region.right > 1 || region.bottom > 1 ||
    region.right - region.left < 0.05 || region.bottom - region.top < 0.05 ||
    !Number.isInteger(region.width) || !Number.isInteger(region.height) ||
    region.width < 16 || region.height < 16 || region.width > REPLACEMENT.maxDimension || region.height > REPLACEMENT.maxDimension ||
    region.width * region.height > 1920 * 1080) throw new Error("Select a larger person region in a scene no larger than 1080p.");
  return region;
}

export function replacementMediaUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid replacement video location.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash ||
    !(url.hostname === "fal.media" || url.hostname.endsWith(".fal.media"))) throw new Error("Invalid replacement video location.");
  return url.href;
}
