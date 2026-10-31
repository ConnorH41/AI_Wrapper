import { ApiError, readBytes, requiredEnv } from "./http";

export const MODELS = { avatar: "@cf/black-forest-labs/flux-1-schnell" } as const;

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiError("upstream_failure", "The provider returned an unexpected response.", 502);
  }
  return Object.fromEntries(Object.entries(value));
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new ApiError("upstream_failure", "The provider returned an unexpected response.", 502);
  return value;
}

async function providerJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  if (!response.ok) {
    const status = response.status;
    let detail = "";
    try { detail = new TextDecoder().decode(await readBytes(response, 16 * 1024, init.signal ?? undefined)); }
    catch (error) { if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw error; }
    if (status === 429) throw new ApiError("quota_exhausted", "The provider's free quota is exhausted. Wait before retrying; no paid fallback was used.", 429);
    if (/safety|moderat|content.policy|prohibited.content/i.test(detail)) throw new ApiError("provider_refusal", "The provider refused this content. Edit the character description.", 422);
    if (status === 401 || status === 403) throw new ApiError("missing_configuration", "The provider rejected its credentials or model permissions. Check the server's free-tier account configuration.", 503);
    throw new ApiError("upstream_failure", `The provider returned HTTP ${status}. Retry this step.`, 502);
  }
  let data: Uint8Array<ArrayBuffer>;
  try { data = await readBytes(response, 3 * 1024 * 1024, init.signal ?? undefined); }
  catch (error) {
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw error;
    throw new ApiError("upstream_failure", "The provider response exceeded the supported size.", 502);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(data)); }
  catch { throw new ApiError("upstream_failure", "The provider returned invalid JSON.", 502); }
  return object(parsed);
}

export async function generateAvatar(prompt: string, signal: AbortSignal): Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string }> {
  const account = requiredEnv("CLOUDFLARE_ACCOUNT_ID");
  if (!/^[a-f\d]{32}$/i.test(account)) throw new ApiError("missing_configuration", "CLOUDFLARE_ACCOUNT_ID must be the 32-character account ID.", 503);
  const body = await providerJson(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${MODELS.avatar}`, {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${requiredEnv("CLOUDFLARE_API_TOKEN")}` },
    body: JSON.stringify({ prompt: `Full-body reference photograph of one fictional adult character, centered, head to toe with feet visible, unobstructed face, neutral pose, clearly defined clothing, plain background. No text or logos. ${prompt}`, steps: 4 }),
  });
  if (body.success === false) {
    const errors = array(body.errors).map((value) => object(value).message).join(" ");
    if (/quota|daily allocation|rate.limit/i.test(errors)) throw new ApiError("quota_exhausted", "Cloudflare's free allocation is exhausted. Wait before retrying.", 429);
    if (/moderat|safety|refus|content policy/i.test(errors)) throw new ApiError("provider_refusal", "Cloudflare refused this portrait prompt. Edit the description.", 422);
    throw new ApiError("upstream_failure", "Cloudflare could not generate this portrait. Retry this step.", 502);
  }
  const image = object(body.result).image;
  if (typeof image !== "string" || image.length > 2800000) throw new ApiError("upstream_failure", "Cloudflare returned an invalid or oversized portrait.", 502);
  const decoded = Buffer.from(image, "base64");
  const mime = decoded[0] === 0xff && decoded[1] === 0xd8 ? "image/jpeg" :
    decoded.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png" : "";
  if (!mime) throw new ApiError("upstream_failure", "Cloudflare did not return a supported image.", 502);
  return { bytes: Uint8Array.from(decoded), mime };
}
