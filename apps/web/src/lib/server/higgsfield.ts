import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { CHARACTER_VIEWS, HIGGSFIELD_MODELS, type CharacterViews, type HiggsfieldJob, type HiggsfieldModel, type HiggsfieldQuote } from "@aiw/core/replacement";
import { ApiError, readBytes, requiredEnv } from "./http";
import { budgetTransaction, HIGGSFIELD_BUDGET_UNITS, publicJob, type BudgetEntry } from "./higgsfield-budget";

const API = "https://api.higgsfield.ai";
const OUTPUT_BYTES = 128 * 1024 * 1024;
type Parameters = { prompt: string; video_url: string; image_urls: string[]; resolution: "720p" | "1080p" };
type Price = { units: number; pricing: "account" | "formula"; explanation: string; description: string };
type Quote = Price & { id: string; model: HiggsfieldModel; parameters: Parameters; duration: number; width: number; height: number; expires: number };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError("upstream_failure", "Higgsfield returned an invalid response.", 502);
  return Object.fromEntries(Object.entries(value));
}

export function higgsfieldModel(value: unknown): HiggsfieldModel {
  if (value !== "genjutsu" && value !== "light") throw new ApiError("invalid_input", "Choose Genjutsu or Genjutsu Light.");
  return value;
}

function mediaUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 8192) throw new ApiError("upstream_failure", "Invalid Higgsfield media location.", 502);
  const url = new URL(value);
  const hosts = ["higgsfield.ai", "higgs.ai", "cloudfront.net", "amazonaws.com", "r2.cloudflarestorage.com", "r2.dev"];
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash || !hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new ApiError("upstream_failure", "Higgsfield returned an unsupported storage host. No automatic provider fallback was made.", 502);
  return url.href;
}

function requestUrl(value: unknown, action: "status" | "cancel"): string {
  if (typeof value !== "string") throw new ApiError("upstream_failure", "Higgsfield did not return recoverable request URLs.", 502);
  const url = new URL(value);
  if (url.origin !== API || url.search || url.hash || url.username || url.password || !new RegExp(`^/requests/[a-f0-9-]{36}/${action}$`, "i").test(url.pathname)) throw new ApiError("upstream_failure", "Higgsfield returned an unsupported request URL.", 502);
  return url.href;
}

async function provider(url: string, method: string, signal: AbortSignal, body?: unknown, idempotencyKey?: string): Promise<Record<string, unknown>> {
  const credential = requiredEnv("HIGGSFIELD_API_KEY");
  if (/[\r\n]/.test(credential)) throw new ApiError("missing_configuration", "Save the complete Higgsfield API key on one line.", 503);
  const response = await fetch(url, { method, signal, redirect: "error", cache: "no-store", headers: {
    Authorization: `Key ${credential}`, "Content-Type": "application/json", "Hf-Expires-After": "3600",
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new ApiError("missing_configuration", "Higgsfield rejected the saved key or this model's access. Check the API console.", 503);
    if (response.status === 402 || response.status === 429) throw new ApiError("quota_exhausted", "Higgsfield reports insufficient balance or a rate limit. No automatic retry was made.", response.status);
    if (response.status === 400 || response.status === 422) throw new ApiError("provider_refusal", "Higgsfield refused these inputs or parameters. Check this request in the provider console; it was not retried.", response.status);
    throw new ApiError("upstream_failure", `Higgsfield returned HTTP ${response.status}. Check the existing request before starting another.`, 502);
  }
  if (response.status === 204 || (response.status === 202 && url.endsWith("/cancel"))) return {};
  const bytes = await readBytes(response, 64 * 1024, signal);
  try { return object(JSON.parse(new TextDecoder().decode(bytes))); }
  catch { throw new ApiError("upstream_failure", "Higgsfield returned unreadable request data.", 502); }
}

async function upload(bytes: Uint8Array, type: string, signal: AbortSignal): Promise<string> {
  const result = await provider(`${API}/files/generate-upload-url`, "POST", signal, { content_type: type });
  const target = mediaUrl(result.upload_url), publicUrl = mediaUrl(result.public_url);
  const headers = new Headers({ "Content-Type": type });
  for (const [name, value] of Object.entries(object(result.upload_headers))) {
    if (typeof value !== "string" || /^(authorization|proxy-authorization|cookie|host)$/i.test(name) || /[\r\n]/.test(value)) throw new ApiError("upstream_failure", "Higgsfield returned unsafe storage headers.", 502);
    headers.set(name, value);
  }
  const response = await fetch(target, { method: "PUT", headers, body: new Blob([Uint8Array.from(bytes)]), signal, redirect: "error", credentials: "omit" });
  if (!response.ok) throw new ApiError("upstream_failure", "The reference upload failed. Generation was not submitted.", 502);
  return publicUrl;
}

function priceUnits(estimate: Record<string, unknown>): number {
  const value = estimate.usd;
  if (typeof value !== "string" && typeof value !== "number") {
    const fields = Object.keys(estimate).filter((key) => /^[a-zA-Z_][a-zA-Z0-9_]{0,39}$/.test(key)).slice(0, 12).join(", ") || "none";
    throw new ApiError("upstream_failure", `Higgsfield's estimate response has no usable USD price. Returned fields: ${fields}. No generation was submitted or budget reserved. The $5 guard requires a valid price; a published per-second rate is not an account quote.`, 502);
  }
  const text = String(value);
  if (!/^\d+(?:\.\d{1,9})?$/.test(text)) throw new ApiError("upstream_failure", "Higgsfield returned an invalid price.", 502);
  const units = Math.ceil(Number(text) * 1_000_000);
  if (!Number.isSafeInteger(units) || units <= 0) throw new ApiError("upstream_failure", "Higgsfield returned an invalid price.", 502);
  return units;
}

function requestPrice(estimate: Record<string, unknown>, model: HiggsfieldModel, resolution: Parameters["resolution"], duration: number): Price {
  if (estimate.usd !== undefined && estimate.usd !== null) return { units: priceUnits(estimate), pricing: "account", explanation: "Account-specific USD estimate returned by Higgsfield.", description: "" };
  const description = estimate.pricing_description;
  if (typeof description !== "string" || description.length > 5000) throw new ApiError("upstream_failure", "Higgsfield returned neither a USD price nor a supported pricing formula. Generation remains blocked.", 502);
  const text = description.toLowerCase().replace(/\s+/g, " ");
  const matches = [
    ...text.matchAll(new RegExp(`\\$([0-9]+(?:\\.[0-9]+)?)\\s*(?:at\\s+)?${resolution}\\b`, "g")),
    ...text.matchAll(new RegExp(`\\b${resolution}\\s*[:=]?\\s*\\$([0-9]+(?:\\.[0-9]+)?)`, "g")),
  ];
  const rates = new Set(matches.map((match) => match[1]));
  const expectedRate = model === "genjutsu" ? (resolution === "720p" ? "0.681" : "1.632") : (resolution === "720p" ? "0.10" : "0.20");
  const rate = [...rates][0];
  const billingRecognized = model === "genjutsu"
    ? text.includes("each second of input video costs") && text.includes("rounded up to the nearest whole second")
    : text.includes("billable seconds = output duration + the sum of input reference video durations") && text.includes("output duration is rounded up to whole seconds");
  // shortcut: recognize only the reviewed Genjutsu formulas; changed rates or billing rules require operator review.
  if (rates.size !== 1 || Number(rate) !== Number(expectedRate) || !billingRecognized || !text.includes("before any applicable customer discount")) throw new ApiError("upstream_failure", "Higgsfield returned a pricing formula that differs from the reviewed model rates or billing rules. Generation remains blocked until that formula is reviewed.", 502);
  const seconds = Math.ceil(duration);
  const billableSeconds = model === "light" ? 2 * seconds : seconds;
  const units = billableSeconds * priceUnits({ usd: rate });
  return { units, pricing: "formula", description, explanation: `${billableSeconds} billable seconds × $${rate}. ${model === "light" ? "Includes rounded-up output and the one source video's duration." : "Source duration is rounded up to whole seconds."} Uses the returned list-rate formula before customer discounts. This is a conservative calculation, not an account quote or final invoice; the full amount stays reserved after success.` };
}

function mac(payload: string): string {
  const secret = requiredEnv("SESSION_SIGNING_SECRET");
  if (secret.length < 32) throw new ApiError("missing_configuration", "Set a signing secret of at least 32 characters.", 503);
  return createHmac("sha256", secret).update(`higgsfield:${payload}`).digest("base64url");
}

function quoteTicket(quote: Quote): string {
  const payload = Buffer.from(JSON.stringify(quote)).toString("base64url");
  return `${payload}.${mac(payload)}`;
}

function parseQuote(ticket: unknown): Quote {
  if (typeof ticket !== "string" || ticket.length > 14 * 1024) throw new ApiError("invalid_input", "Invalid price approval. Request a new estimate.");
  const [payload, signature, extra] = ticket.split(".");
  if (!payload || !signature || extra || !/^[\w-]{43}$/.test(signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(mac(payload)))) throw new ApiError("invalid_input", "Invalid price approval. Request a new estimate.");
  const value = object(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  const input = object(value.parameters);
  if (typeof value.id !== "string" || !/^[a-f0-9-]{36}$/i.test(value.id) || typeof value.units !== "number" || !Number.isSafeInteger(value.units) || value.units <= 0 || typeof value.duration !== "number" || !Number.isFinite(value.duration) || typeof value.width !== "number" || typeof value.height !== "number" || typeof value.expires !== "number" || value.expires < Date.now() || value.expires > Date.now() + 11 * 60 * 1000 || typeof input.prompt !== "string" || !Array.isArray(input.image_urls) || input.image_urls.length < 1 || input.image_urls.length > 3 || (input.resolution !== "720p" && input.resolution !== "1080p")) throw new ApiError("invalid_input", "The price approval expired or is invalid. Request a new estimate.");
  if ((value.pricing !== "account" && value.pricing !== "formula") || typeof value.explanation !== "string" || value.explanation.length > 1000 || typeof value.description !== "string" || value.description.length > 5000) throw new ApiError("invalid_input", "Request a new price approval.");
  return { id: value.id, units: value.units, model: higgsfieldModel(value.model), parameters: { prompt: input.prompt, video_url: mediaUrl(input.video_url), image_urls: input.image_urls.map(mediaUrl), resolution: input.resolution }, duration: value.duration, width: value.width, height: value.height, expires: value.expires, pricing: value.pricing, explanation: value.explanation, description: value.description };
}

export async function quoteHiggsfield(character: CharacterViews<Uint8Array>, scene: Uint8Array, model: HiggsfieldModel, resolution: "720p" | "1080p", appearance: string, signal: AbortSignal): Promise<HiggsfieldQuote> {
  await budgetTransaction((ledger) => {
    if (ledger.entries.some((entry) => entry.status === "pending")) throw new ApiError("quota_exhausted", "Resolve the existing Higgsfield request before preparing another.", 409);
    if (ledger.entries.reduce((sum, entry) => sum + entry.units, 0) >= HIGGSFIELD_BUDGET_UNITS) throw new ApiError("quota_exhausted", "The $5 local Higgsfield budget is exhausted.", 429);
  });
  const { Input, BufferSource, MP4 } = await import("mediabunny");
  const input = new Input({ source: new BufferSource(scene), formats: [MP4] });
  let duration: number, width: number, height: number;
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new ApiError("invalid_input", "The MP4 has no video track.");
    duration = await track.computeDuration(); width = await track.getDisplayWidth(); height = await track.getDisplayHeight();
    if (!Number.isFinite(duration) || duration < 4 || duration > HIGGSFIELD_MODELS[model].maxSeconds + 0.05 || width * height < 409600 || width * height > 3840 * 2160 || Math.max(width, height) > 3840) throw new ApiError("invalid_input", `Use a 4–${HIGGSFIELD_MODELS[model].maxSeconds}-second MP4, at least 409,600 pixels per frame and no larger than 4K. Longer clips are not silently trimmed.`);
  } finally { input.dispose(); }
  const imageUrls: string[] = [];
  const views: string[] = [];
  for (const view of CHARACTER_VIEWS) {
    const bytes = character[view];
    if (bytes) { imageUrls.push(await upload(bytes, "image/jpeg", signal)); views.push(view); }
  }
  const parameters: Parameters = {
    video_url: await upload(scene, "video/mp4", signal), image_urls: imageUrls, resolution,
    prompt: `Replace the entire visible source person with the same adult character shown in the references (${views.join(", ")} views, in that order). Match the reference face, hair, clothing and visible body appearance throughout the clip. ${appearance} Preserve the source duration, aspect ratio, framing, camera, movement, timing, scene, foreground occlusions and original audio. Do not retain the source person's outfit or hair. Do not add people, cuts or new actions.`,
  };
  signal.throwIfAborted();
  const estimate = await provider(`${API}/estimate/${HIGGSFIELD_MODELS[model].endpoint}`, "POST", signal, parameters);
  const price = requestPrice(estimate, model, resolution, duration);
  const { units } = price;
  const remaining = await budgetTransaction((ledger) => HIGGSFIELD_BUDGET_UNITS - ledger.entries.reduce((sum, entry) => sum + entry.units, 0));
  if (units > remaining) throw new ApiError("quota_exhausted", `This estimate is $${(units / 1_000_000).toFixed(4)}, above the remaining $${(remaining / 1_000_000).toFixed(4)} app budget. No generation was submitted.`, 429);
  const quote: Quote = { id: randomUUID(), model, parameters, ...price, duration, width, height, expires: Date.now() + 10 * 60 * 1000 };
  const ticket = quoteTicket(quote);
  if (ticket.length > 14 * 1024) throw new ApiError("upstream_failure", "The provider returned too much pricing or media metadata for a safe approval. No generation was submitted.", 502);
  return { ticket, usd: units / 1_000_000, duration, expires: quote.expires, pricing: price.pricing, explanation: price.explanation };
}

function findEntry(entries: BudgetEntry[], id: unknown): BudgetEntry {
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)) throw new ApiError("invalid_input", "Invalid local Higgsfield job.");
  const entry = entries.find((item) => item.id === id);
  if (!entry) throw new ApiError("invalid_input", "This job is not in this app's spending ledger.", 404);
  return entry;
}

export async function submitHiggsfield(ticket: unknown, signal: AbortSignal): Promise<HiggsfieldJob> {
  const quote = parseQuote(ticket);
  const existing = await budgetTransaction((ledger) => ledger.entries.find((entry) => entry.id === quote.id));
  if (existing) return publicJob(existing);
  const estimate = await provider(`${API}/estimate/${HIGGSFIELD_MODELS[quote.model].endpoint}`, "POST", signal, quote.parameters);
  const price = requestPrice(estimate, quote.model, quote.parameters.resolution, quote.duration);
  if (price.units !== quote.units || price.pricing !== quote.pricing || price.description !== quote.description) throw new ApiError("invalid_input", "The provider price or billing formula changed. Request and approve a new estimate.");
  signal.throwIfAborted();
  const reserved = await budgetTransaction((ledger) => {
    const previous = ledger.entries.find((entry) => entry.id === quote.id);
    if (previous) return false;
    if (ledger.entries.some((entry) => entry.status === "pending")) throw new ApiError("quota_exhausted", "An existing request is still running or unresolved.", 409);
    if (quote.units + ledger.entries.reduce((sum, entry) => sum + entry.units, 0) > HIGGSFIELD_BUDGET_UNITS) throw new ApiError("quota_exhausted", "This request exceeds the remaining $5 app budget.", 429);
    ledger.entries.push({ id: quote.id, status: "pending", units: quote.units, usd: quote.units / 1_000_000, duration: quote.duration, width: quote.width, height: quote.height, recoverable: false });
    return true;
  });
  if (!reserved) return budgetTransaction((ledger) => publicJob(findEntry(ledger.entries, quote.id)));
  try {
    const result = await provider(`${API}/${HIGGSFIELD_MODELS[quote.model].endpoint}`, "POST", signal, quote.parameters, quote.id);
    const statusUrl = requestUrl(result.status_url, "status"), cancelUrl = requestUrl(result.cancel_url, "cancel");
    if (typeof result.request_id !== "string" || !/^[a-f0-9-]{36}$/i.test(result.request_id) || !statusUrl.endsWith(`/${result.request_id}/status`) || !cancelUrl.endsWith(`/${result.request_id}/cancel`)) throw new ApiError("upstream_failure", "Higgsfield returned an inconsistent request identifier. Check provider history before any further generation.", 502);
    return await budgetTransaction((ledger) => {
      const entry = findEntry(ledger.entries, quote.id);
      entry.statusUrl = statusUrl; entry.cancelUrl = cancelUrl; entry.recoverable = true;
      return publicJob(entry);
    });
  } catch (error) {
    if (error instanceof ApiError && (error.code === "missing_configuration" || [400, 401, 403, 404, 413, 415].includes(error.status))) {
      await budgetTransaction((ledger) => { const entry = findEntry(ledger.entries, quote.id); entry.status = "failed"; entry.units = 0; entry.usd = 0; });
    }
    throw error;
  }
}

export async function higgsfieldStatus(id: unknown, signal: AbortSignal): Promise<HiggsfieldJob> {
  const entry = await budgetTransaction((ledger) => ({ ...findEntry(ledger.entries, id) }));
  if (entry.status !== "pending") return publicJob(entry);
  if (!entry.statusUrl) throw new ApiError("upstream_failure", "Submission is unresolved. Its budget remains reserved. Check Higgsfield request history; do not submit it again.", 409);
  const result = await provider(requestUrl(entry.statusUrl, "status"), "GET", signal);
  const status = result.status;
  if (status === "queued" || status === "in_progress") return publicJob(entry);
  if (status !== "completed" && status !== "failed" && status !== "nsfw" && status !== "canceled") throw new ApiError("upstream_failure", "Higgsfield returned an unknown status. The existing job and budget reservation are preserved.", 502);
  const outputUrl = status === "completed" ? mediaUrl(object(result.video).url) : undefined;
  return budgetTransaction((ledger) => {
    const job = findEntry(ledger.entries, id);
    job.status = status; job.outputUrl = outputUrl;
    if (status !== "completed") { job.units = 0; job.usd = 0; }
    return publicJob(job);
  });
}

export async function cancelHiggsfield(id: unknown, signal: AbortSignal): Promise<HiggsfieldJob> {
  const entry = await budgetTransaction((ledger) => ({ ...findEntry(ledger.entries, id) }));
  if (entry.status !== "pending" || !entry.cancelUrl) throw new ApiError("invalid_input", "This request cannot be canceled here. Check provider history.");
  await provider(requestUrl(entry.cancelUrl, "cancel"), "POST", signal);
  return budgetTransaction((ledger) => {
    const job = findEntry(ledger.entries, id); job.status = "canceled"; job.units = 0; job.usd = 0;
    return publicJob(job);
  });
}

export async function downloadHiggsfield(id: unknown, signal: AbortSignal): Promise<Response> {
  const entry = await budgetTransaction((ledger) => ({ ...findEntry(ledger.entries, id) }));
  if (entry.status !== "completed" || !entry.outputUrl) throw new ApiError("invalid_input", "The completed video is not available yet.");
  const response = await fetch(mediaUrl(entry.outputUrl), { signal, redirect: "error", credentials: "omit" });
  if (!response.ok) throw new ApiError("upstream_failure", "The completed video could not be downloaded. Its existing job is preserved.", 502);
  const bytes = await readBytes(response, OUTPUT_BYTES, signal);
  const { validateMotionMp4 } = await import("@aiw/core/motion");
  validateMotionMp4(bytes, OUTPUT_BYTES);
  return new Response(bytes, { headers: { "Content-Type": "video/mp4", "Cache-Control": "no-store" } });
}
