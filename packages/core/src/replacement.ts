export const REPLACEMENT = {
  maxSeconds: 5,
  minSeconds: 2,
  maxDimension: 2048,
  outputBytes: 16 * 1024 * 1024,
  endpoint: "fal-ai/wan-vace-14b/inpainting",
} as const;

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
