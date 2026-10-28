import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { localPath, mediaRoot } from "../packages/core/src/storage";
import { buildCaptions, parseTimings, pcmToWav, renderPlan, wavDuration } from "../packages/core/src/session";
import { authenticated, authorize, createSession, sessionCookie, SESSION_SECONDS } from "../apps/web/src/lib/server/session";
import { endpoint, readBytes, readJson, sameOrigin, textField, ApiError } from "../apps/web/src/lib/server/http";
import { generateScript, generateVoice, generateAvatar, transcribe, MODELS } from "../apps/web/src/lib/server/providers";

const password = "test-password-at-least-sixteen";
const secret = "test-signing-secret-at-least-thirty-two-characters";
const originalEnv = { ...process.env };
test.after(() => { process.env = originalEnv; });
process.env.APP_ACCESS_PASSWORD = password;
process.env.SESSION_SIGNING_SECRET = secret;

test("environment examples contain no credentials and private files are ignored", () => {
  const template = readFileSync("apps/web/.env.local.example", "utf8");
  for (const name of ["GEMINI_API_KEY", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "GROQ_API_KEY", "APP_ACCESS_PASSWORD", "SESSION_SIGNING_SECRET"]) {
    assert.equal(new RegExp(`^${name}=\\s*$`, "m").test(template), true, `${name} must be blank in the example`);
  }
  const privatePaths = [".env", ".env.local", ".env.production", "apps/web/.env.preview.local", "apps/web/.vercel/project.json", ".aws/credentials", "private.pem", "private.key", "private.p12", "private.pfx", "private.jks", "private.keystore"];
  const ignored = execFileSync("git", ["check-ignore", "--no-index", "--stdin"], { input: privatePaths.join("\n"), encoding: "utf8" }).trim().split(/\r?\n/);
  assert.deepEqual(ignored, privatePaths);
  const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0");
  assert.equal(tracked.some((file) => /(^|\/)\.env(?:\.|$)/.test(file) && !/\.example$/.test(file)), false, "Private environment files must not be tracked");
});

test("legacy storage rejects traversal including sibling directories sharing the root prefix", () => {
  const root = mediaRoot();
  assert.equal(localPath("project/product.png"), path.join(root, "project", "product.png"));
  for (const key of ["../private.txt", `../${path.basename(root)}-backup/private.txt`, `${root}-backup/private.txt`, path.resolve(root, "../private.txt")]) {
    assert.throws(() => localPath(key), /Invalid storage key/);
  }
  if (path.sep === "\\") assert.throws(() => localPath(`..\\${path.basename(root)}-backup\\private.txt`), /Invalid storage key/);
});

function request(token = "", origin = "https://app.test") {
  return new Request("https://app.test/api/script", { headers: { origin, cookie: `aiw_session=${token}` } });
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
  sameOrigin(new Request("http://localhost:3100/api/script", { headers: { host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100" } }));
  assert.throws(() => sameOrigin(new Request("http://localhost:3100/api/script", { headers: { host: "127.0.0.1:3100", origin: "http://localhost:3100" } })), /this app/);
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

test("WAV parser measures audio and rejects malformed or incompatible audio", () => {
  const wav = pcmToWav(new Uint8Array(24000 * 2 * 3));
  assert.equal(wavDuration(wav), 3);
  assert.throws(() => wavDuration(wav.slice(0, -1)), /complete|truncated/);
  const stereo = wav.slice();
  new DataView(stereo.buffer).setUint16(22, 2, true);
  assert.throws(() => wavDuration(stereo), /mono/);
  assert.throws(() => pcmToWav(new Uint8Array(3)), /Invalid PCM/);
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

test("captions use actual ordered timings, tolerate different transcript word counts, and remove styling controls", () => {
  const words = parseTimings([{ word: "<b>{Hello}\\", start: 0.2, end: 0.8 }, { word: "product", start: 1.1, end: 1.8 }], 2);
  assert.equal(buildCaptions(words), "1\n00:00:00,200 --> 00:00:01,800\nHello product\n");
  assert.throws(() => parseTimings([], 2), /did not return/);
  assert.throws(() => parseTimings([{ word: "late", start: 2, end: 3 }], 2), /invalid/);
  assert.throws(() => parseTimings([{ word: "x", start: NaN, end: 1 }], 2), /invalid/);
  assert.throws(() => parseTimings([{ word: "a", start: 1, end: 1.5 }, { word: "b", start: 0, end: 0.5 }], 2), /invalid/);
});

test("render plan covers exactly 15 seconds with the approved three scenes", () => {
  const plan = renderPlan({ name: "Bottle", benefit: "Reusable", direction: "Friendly" });
  assert.deepEqual(plan.map(({ start, end }) => [start, end]), [[0, 3], [3, 11], [11, 15]]);
  assert.deepEqual(plan.map(({ text }) => text), ["Bottle", "Reusable", "Learn more"]);
});

test("provider adapters use documented REST shapes, no retries, and bounded WAV output", async () => {
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "fixture";
  process.env.CLOUDFLARE_ACCOUNT_ID = "a".repeat(32);
  process.env.CLOUDFLARE_API_TOKEN = "fixture";
  process.env.GROQ_API_KEY = "fixture";
  const calls: string[] = [];
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    if (String(url).includes(":generateContent")) {
      assert.match(String(options?.body), /product facts/);
      return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Meet your reusable bottle." }] } }] });
    }
    if (String(url).endsWith("/interactions")) {
      assert.match(String(options?.body), /audio\/l16/);
      return Response.json({ steps: [{ type: "model_output", content: [{ type: "audio", data: Buffer.alloc(48000).toString("base64") }] }] });
    }
    if (String(url).includes("cloudflare")) return Response.json({ success: true, result: { image: Buffer.from([255, 216, 255, 217]).toString("base64") } });
    assert.equal(options?.body instanceof FormData, true);
    return Response.json({ words: [{ word: "Hello", start: 0, end: 0.8 }] });
  };
  try {
    assert.equal(await generateScript({ name: "Bottle", benefit: "Reusable", direction: "" }, AbortSignal.timeout(1000)), "Meet your reusable bottle.");
    const voice = await generateVoice("Hello", AbortSignal.timeout(1000));
    assert.equal(wavDuration(voice.audio), 1);
    assert.equal((await generateAvatar("Friendly adult", AbortSignal.timeout(1000))).mime, "image/jpeg");
    assert.equal((await transcribe(voice.audio, 1, AbortSignal.timeout(1000)))[0].word, "Hello");
    assert.equal(calls.length, 4);
    assert.match(calls[0], new RegExp(MODELS.script));
    globalThis.fetch = async () => new Response("quota", { status: 429 });
    await assert.rejects(generateVoice("Hello", AbortSignal.timeout(1000)), (error: unknown) => error instanceof ApiError && error.code === "quota_exhausted");
    globalThis.fetch = async () => new Response("Content policy moderation rejection", { status: 403 });
    await assert.rejects(generateAvatar("blocked", AbortSignal.timeout(1000)), (error: unknown) => error instanceof ApiError && error.code === "provider_refusal");
    globalThis.fetch = async () => Response.json({ success: false, errors: [{ message: "Daily allocation exceeded" }] });
    await assert.rejects(generateAvatar("adult", AbortSignal.timeout(1000)), (error: unknown) => error instanceof ApiError && error.code === "quota_exhausted");
    globalThis.fetch = async () => Response.json({ candidates: [{ finishReason: "SAFETY" }] });
    await assert.rejects(generateScript({ name: "x", benefit: "x", direction: "" }, AbortSignal.timeout(1000)), (error: unknown) => error instanceof ApiError && error.code === "provider_refusal");
    globalThis.fetch = async () => Response.json({ steps: [{ type: "model_output", content: [{ type: "audio", data: Buffer.alloc(48000 * 16).toString("base64") }] }] });
    await assert.rejects(generateVoice("Too long", AbortSignal.timeout(1000)), /Shorten the script/);
  } finally { globalThis.fetch = previousFetch; }
});
