import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ApiError, requiredEnv, sameOrigin } from "./http";

export const SESSION_COOKIE = "aiw_session";
export const SESSION_SECONDS = 12 * 60 * 60;

function configuration() {
  const password = requiredEnv("APP_ACCESS_PASSWORD");
  const secret = requiredEnv("SESSION_SIGNING_SECRET");
  if (password.length < 16 || secret.length < 32) {
    throw new ApiError("missing_configuration", "Set a password of at least 16 characters and a signing secret of at least 32 characters.", 503);
  }
  return { password, secret };
}

function equal(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSession(password: string, now = Date.now()): string {
  const config = configuration();
  if (!equal(password, config.password)) throw new ApiError("unauthorized", "Incorrect password.", 401);
  const payload = `${Math.floor(now / 1000) + SESSION_SECONDS}.${randomBytes(24).toString("base64url")}`;
  return `${payload}.${signature(payload, config.secret)}`;
}

export function authenticated(request: Request, now = Date.now()): boolean {
  const { secret } = configuration();
  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  const token = cookie?.slice(SESSION_COOKIE.length + 1);
  if (!token || token.length > 200) return false;
  const [expires, nonce, mac, extra] = token.split(".");
  if (extra !== undefined || !/^\d{10}$/.test(expires) || !/^[\w-]{32}$/.test(nonce ?? "") || !mac) return false;
  const remaining = Number(expires) - Math.floor(now / 1000);
  return remaining > 0 && remaining <= SESSION_SECONDS && equal(mac, signature(`${expires}.${nonce}`, secret));
}

export function authorize(request: Request): void {
  sameOrigin(request);
  if (!authenticated(request)) throw new ApiError("unauthorized", "Enter the shared password to continue. Your draft is still here.", 401);
}

export function sessionCookie(token: string, maxAge = SESSION_SECONDS): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}
