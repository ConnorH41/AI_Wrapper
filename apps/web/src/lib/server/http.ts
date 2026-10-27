import type { ApiErrorCode } from "@aiw/core/session";

export class ApiError extends Error {
  constructor(public code: ApiErrorCode, message: string, public status = 400) { super(message); }
}

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ApiError("missing_configuration", `The server needs ${name}.`, 503);
  return value;
}

export function sameOrigin(request: Request): void {
  const url = new URL(request.url);
  const origin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
  if (request.headers.get("origin") !== origin) {
    throw new ApiError("forbidden", "This request must come from this app.", 403);
  }
}

export async function readBytes(request: Pick<Request, "headers" | "body">, limit: number, signal = AbortSignal.timeout(85000)): Promise<Uint8Array<ArrayBuffer>> {
  const length = Number(request.headers.get("content-length"));
  if (length > limit) throw new ApiError("invalid_input", "The request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("invalid_input", "A request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    signal.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ApiError("invalid_input", "The request is too large.", 413);
      }
      chunks.push(value);
    }
  } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function readJson(request: Request, signal = AbortSignal.any([request.signal, AbortSignal.timeout(85000)])): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") {
    throw new ApiError("invalid_input", "Expected application/json.", 415);
  }
  const bytes = await readBytes(request, 16 * 1024, signal);
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new ApiError("invalid_input", "Invalid JSON."); }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiError("invalid_input", "Expected a JSON object.");
  }
  return Object.fromEntries(Object.entries(value));
}

export function textField(body: Record<string, unknown>, name: string, max: number, optional = false): string {
  const value = body[name];
  if (optional && (value === undefined || (typeof value === "string" && !value.trim()))) return "";
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new ApiError("invalid_input", `${name} must contain ${optional ? "0" : "1"}–${max} characters.`);
  }
  return value.trim();
}

export function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function endpoint(work: () => Promise<Response>): Promise<Response> {
  try { return await work(); }
  catch (error) {
    if (error instanceof ApiError) return json({ error: { code: error.code, message: error.message } }, error.status);
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
      return json({ error: { code: "timeout", message: "The request timed out or was cancelled. Retry this step." } }, 504);
    }
    console.error(JSON.stringify({ event: "api_failure", type: error instanceof Error ? error.name : "unknown" }));
    return json({ error: { code: "upstream_failure", message: "This step failed. Your existing inputs are preserved; retry this step." } }, 502);
  }
}
