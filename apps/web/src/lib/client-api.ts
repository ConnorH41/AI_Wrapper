export class RequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
  const response = await fetch(`/api/${path}`, {
    ...init, credentials: "same-origin", cache: "no-store",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000),
  });
  if (!response.ok) {
    let message = `Request failed with HTTP ${response.status}. Retry this step.`;
    try {
      const body: unknown = await response.json();
      if (typeof body === "object" && body !== null && "error" in body &&
        typeof body.error === "object" && body.error !== null && "message" in body.error && typeof body.error.message === "string") message = body.error.message;
    } catch { /* The platform may return a non-JSON error before the route runs. */ }
    throw new RequestError(message, response.status);
  }
  return response;
}

export function postJson(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
