import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { authenticated, authorize, createSession, sessionCookie, SESSION_SECONDS } from "../apps/web/src/lib/server/session";
import { endpoint, readBytes, readJson, sameOrigin, textField, ApiError } from "../apps/web/src/lib/server/http";
import { generateAvatar, MODELS } from "../apps/web/src/lib/server/providers";

const password = "test-password-at-least-sixteen";
const secret = "test-signing-secret-at-least-thirty-two-characters";
const originalEnv = { ...process.env };
test.after(() => { process.env = originalEnv; });
process.env.APP_ACCESS_PASSWORD = password;
process.env.SESSION_SIGNING_SECRET = secret;

test("environment examples contain no credentials and private files are ignored", () => {
  const template = readFileSync("apps/web/.env.local.example", "utf8");
  for (const name of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "HF_TOKEN", "APP_ACCESS_PASSWORD", "SESSION_SIGNING_SECRET"]) {
    assert.equal(new RegExp(`^${name}=\\s*$`, "m").test(template), true, `${name} must be blank in the example`);
  }
  const privatePaths = [".env", ".env.local", ".env.production", "apps/web/.env.preview.local", "apps/web/.vercel/project.json", ".aws/credentials", "private.pem", "private.key", "private.p12", "private.pfx", "private.jks", "private.keystore"];
  const ignored = execFileSync("git", ["check-ignore", "--no-index", "--stdin"], { input: privatePaths.join("\n"), encoding: "utf8" }).trim().split(/\r?\n/);
  assert.deepEqual(ignored, privatePaths);
  const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0");
  assert.equal(tracked.some((file) => /(^|\/)\.env(?:\.|$)/.test(file) && !/\.example$/.test(file)), false, "Private environment files must not be tracked");
});

function request(token = "", origin = "https://app.test") {
  return new Request("https://app.test/api/avatar", { headers: { origin, cookie: `aiw_session=${token}` } });
}

test("shared password, signed cookies, expiry, and logout attributes", () => {
  const token = createSession(password);
  assert.equal(authenticated(request(token)), true);
  assert.equal(authenticated(request(`${token}x`)), false);
  assert.equal(authenticated(request()), false);
  assert.equal(authenticated(request(token), Date.now() + SESSION_SECONDS * 1000 + 1000), false);
  assert.throws(() => createSession("wrong"), /Incorrect password/);
  assert.match(sessionCookie(token), /HttpOnly; SameSite=Strict; Max-Age=43200/);
  assert.match(sessionCookie("", 0), /Max-Age=0/);
});

test("origin and authentication checks cannot be bypassed", () => {
  assert.throws(() => authorize(request()), /shared password/);
  assert.throws(() => authorize(request(createSession(password), "https://attacker.test")), /this app/);
  authorize(request(createSession(password)));
  sameOrigin(new Request("http://localhost:3100/api/avatar", { headers: { host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100" } }));
  assert.throws(() => sameOrigin(new Request("http://localhost:3100/api/avatar", { headers: { host: "127.0.0.1:3100", origin: "http://localhost:3100" } })), /this app/);
});

test("missing or weak authentication configuration fails closed", () => {
  delete process.env.SESSION_SIGNING_SECRET;
  assert.throws(() => authenticated(request()), /SESSION_SIGNING_SECRET/);
  process.env.SESSION_SIGNING_SECRET = "weak";
  assert.throws(() => createSession(password), /at least 32/);
  process.env.SESSION_SIGNING_SECRET = secret;
});

test("bounded bodies and JSON validation", async () => {
  await assert.rejects(readBytes(new Request("https://app.test", { method: "POST", body: "12345" }), 4), /too large/);
  await assert.rejects(readJson(new Request("https://app.test", { method: "POST", body: "{}" })), /application\/json/);
  await assert.rejects(readJson(new Request("https://app.test", { method: "POST", headers: { "content-type": "application/json" }, body: "[1]" })), /JSON object/);
  assert.throws(() => textField({ name: 7 }, "name", 100), /name must/);
  assert.equal(textField({}, "direction", 100, true), "");
  assert.equal(textField({ direction: "   " }, "direction", 100, true), "");
  const response = await endpoint(async () => { throw new ApiError("quota_exhausted", "Quota exhausted", 429); });
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: { code: "quota_exhausted", message: "Quota exhausted" } });
  const timeout = await endpoint(async () => { throw new DOMException("Too slow", "TimeoutError"); });
  assert.equal(timeout.status, 504);
});

test("a stalled request body is cancelled at its deadline", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array<ArrayBuffer>>({ cancel() { cancelled = true; } });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Body deadline exceeded", "TimeoutError")), 10);
  try {
    await assert.rejects(readBytes({ headers: new Headers(), body }, 100, controller.signal), (error: unknown) => error instanceof Error && error.name === "TimeoutError");
    assert.equal(cancelled, true);
  } finally { clearTimeout(timer); }
});

test("portrait provider preserves the free API contract, quota/refusal errors and no automatic retries", async () => {
  const previousFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "a".repeat(32);
  process.env.CLOUDFLARE_API_TOKEN = "fixture";
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.ok(String(url).endsWith(MODELS.avatar));
    const body: unknown = JSON.parse(String(options?.body));
    assert.ok(typeof body === "object" && body !== null && "prompt" in body && "steps" in body);
    assert.match(String(body.prompt), /fictional adult character/);
    assert.equal(body.steps, 4);
    return Response.json({ success: true, result: { image: readFileSync("tests/fixtures/motion-portrait.jpg").toString("base64") } });
  };
  try {
    assert.equal((await generateAvatar("Friendly adult", AbortSignal.timeout(1000))).mime, "image/jpeg");
    assert.equal(calls, 1);
    globalThis.fetch = async () => { calls++; return new Response("quota", { status: 429 }); };
    await assert.rejects(generateAvatar("Friendly adult", AbortSignal.timeout(1000)), (error: unknown) => error instanceof ApiError && error.code === "quota_exhausted");
    assert.equal(calls, 2);
    globalThis.fetch = async () => new Response("Content policy moderation rejection", { status: 403 });
    await assert.rejects(generateAvatar("blocked", AbortSignal.timeout(1000)), (error: unknown) => error instanceof ApiError && error.code === "provider_refusal");
    globalThis.fetch = async () => Response.json({ success: false, errors: [{ message: "Daily allocation exceeded" }] });
    await assert.rejects(generateAvatar("adult", AbortSignal.timeout(1000)), (error: unknown) => error instanceof ApiError && error.code === "quota_exhausted");
    globalThis.fetch = async () => new Response("bad token", { status: 401 });
    await assert.rejects(generateAvatar("adult", AbortSignal.timeout(1000)), (error: unknown) => error instanceof ApiError && error.code === "missing_configuration");
  } finally { globalThis.fetch = previousFetch; }
});
