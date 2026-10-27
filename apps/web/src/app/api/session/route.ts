import { authenticated, createSession, sessionCookie } from "@/lib/server/session";
import { endpoint, json, readJson, sameOrigin, textField } from "@/lib/server/http";

export const runtime = "nodejs";
export const maxDuration = 90;
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return endpoint(async () => json({ authenticated: authenticated(request) }));
}

export function POST(request: Request) {
  return endpoint(async () => {
    sameOrigin(request);
    const body = await readJson(request);
    return json({ authenticated: true }, 200, { "Set-Cookie": sessionCookie(createSession(textField(body, "password", 256))) });
  });
}

export function DELETE(request: Request) {
  return endpoint(async () => {
    sameOrigin(request);
    return json({ authenticated: false }, 200, { "Set-Cookie": sessionCookie("", 0) });
  });
}
