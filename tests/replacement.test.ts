import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { REPLACEMENT, parsePersonRegion, replacementMediaUrl } from "../packages/core/src/replacement";
import { personMask, mp4Duration } from "../apps/web/src/lib/server/person-mask";
import { cancelReplacement, replacementAvailable, replacementStatus, replacementTicket, parseReplacementTicket, submitReplacement } from "../apps/web/src/lib/server/replacement";
import { GET, POST } from "../apps/web/src/app/api/replacement/route";
import { createSession } from "../apps/web/src/lib/server/session";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const portrait = new Uint8Array(readFileSync("tests/fixtures/motion-portrait.jpg"));
const video = new Uint8Array(readFileSync("tests/fixtures/motion-scene.mp4"));
const region = { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75, width: 16, height: 16 };
const id = "12345678-1234-1234-1234-123456789abc";

test.beforeEach(() => {
  process.env.APP_ACCESS_PASSWORD = "test-password-at-least-sixteen";
  process.env.SESSION_SIGNING_SECRET = "replacement-test-signing-secret-at-least-thirty-two";
  process.env.ENABLE_PAID_MOTION = "false";
  delete process.env.PAID_MOTION_BUDGET_REVIEWED;
  process.env.FAL_KEY = "fixture-key-not-a-real-credential";
  globalThis.fetch = async () => { throw new Error("Unexpected provider request"); };
});
test.afterEach(() => { globalThis.fetch = originalFetch; });
test.after(() => { process.env = originalEnv; });

function enabled() { process.env.ENABLE_PAID_MOTION = "true"; process.env.PAID_MOTION_BUDGET_REVIEWED = "true"; }
function request(body?: FormData | Record<string, unknown>, origin = "https://app.test") {
  const token = createSession(process.env.APP_ACCESS_PASSWORD!);
  return new Request("https://app.test/api/replacement", {
    method: body ? "POST" : "GET", headers: { origin, cookie: `aiw_session=${token}`, ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
  });
}
function form() {
  const body = new FormData();
  body.append("portrait", new Blob([portrait], { type: "image/jpeg" }), "character.jpg");
  body.append("scene", new Blob([video], { type: "video/mp4" }), "scene.mp4");
  body.append("region", JSON.stringify(region)); body.append("consent", "fal-paid"); body.append("requestKey", id);
  return body;
}

test("paid mode fails closed until key, deliberate enablement and budget review are all present", async () => {
  assert.equal(replacementAvailable(), false);
  process.env.ENABLE_PAID_MOTION = "true";
  assert.equal(replacementAvailable(), false);
  process.env.PAID_MOTION_BUDGET_REVIEWED = "true";
  assert.equal(replacementAvailable(), true);
  delete process.env.FAL_KEY;
  assert.equal(replacementAvailable(), false);
  assert.equal((await POST(request(form()))).status, 503);
});

test("region and hosted-media validation reject invalid dimensions, tiny/reversed selections and untrusted URLs", () => {
  assert.deepEqual(parsePersonRegion(region), region);
  for (const bad of [null, {}, { ...region, left: NaN }, { ...region, right: -1 }, { ...region, width: 8000 }, { ...region, top: 0.74 }, { ...region, bottom: 0.26 }]) assert.throws(() => parsePersonRegion(bad));
  assert.equal(replacementMediaUrl("https://v3.fal.media/files/clip.mp4"), "https://v3.fal.media/files/clip.mp4");
  for (const url of ["http://fal.media/clip.mp4", "https://fal.media.attacker.test/clip.mp4", "https://fal.media:8443/clip.mp4", "https://user:password@fal.media/clip.mp4", "https://127.0.0.1/clip.mp4"]) assert.throws(() => replacementMediaUrl(url));
});

test("the guide PNG edits the entire selected region rather than just its face", () => {
  const png = personMask(region);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 16);
  assert.equal(png.readUInt32BE(20), 16);
  const chunks: Buffer[] = [];
  for (let p = 8; p < png.length;) {
    const size = png.readUInt32BE(p);
    if (png.toString("ascii", p + 4, p + 8) === "IDAT") chunks.push(png.subarray(p + 8, p + 8 + size));
    p += size + 12;
  }
  const pixels = inflateSync(Buffer.concat(chunks));
  assert.equal(pixels[5 * 17 + 1 + 5], 255);
  assert.equal(pixels[10 * 17 + 1 + 10], 255);
  assert.equal(pixels[2 * 17 + 1 + 5], 0);
  assert.equal(pixels[10 * 17 + 1 + 2], 0);
});

test("server duration inspection reads real MP4 metadata and rejects malformed boxes", () => {
  assert.ok(mp4Duration(video) >= 2 && mp4Duration(video) <= 5.1);
  assert.throws(() => mp4Duration(new Uint8Array(12)), /duration/);
  assert.throws(() => mp4Duration(Uint8Array.from([255, 255, 255, 255, 109, 111, 111, 118])), /duration/);
});

test("replacement routes enforce auth, Origin, paid consent and short-source metadata before uploads", async () => {
  assert.equal((await GET(new Request("https://app.test/api/replacement"))).status, 401);
  assert.equal((await POST(new Request("https://app.test/api/replacement", { method: "POST", headers: { origin: "https://app.test" } }))).status, 401);
  assert.equal((await POST(request(form(), "https://attacker.test"))).status, 403);
  assert.deepEqual(await (await GET(request())).json(), { available: false, maxSeconds: 5 });
  enabled();
  const noConsent = form(); noConsent.set("consent", "yes");
  assert.equal((await POST(request(noConsent))).status, 400);
  const reversed = form(); reversed.set("region", JSON.stringify({ ...region, right: 0 }));
  assert.equal((await POST(request(reversed))).status, 400);
  const long = Buffer.from(video);
  const mvhd = long.indexOf("mvhd"); assert.ok(mvhd >= 0);
  const scale = long.readUInt32BE(mvhd + 16); long.writeUInt32BE(scale * 15, mvhd + 20);
  const longForm = form(); longForm.set("scene", new Blob([long], { type: "video/mp4" }), "too-long.mp4");
  assert.equal((await POST(request(longForm))).status, 400);
});

test("submission uses an explicit full-region mask, reference and safety checks, with no credential on signed storage PUTs", async () => {
  enabled();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url); calls.push({ url: target, init });
    if (target.includes("/storage/upload/initiate")) return Response.json({ upload_url: "https://v3.fal.media/upload/signed", file_url: `https://v3.fal.media/files/${calls.length}.bin` });
    if (target.includes("/upload/signed")) { assert.equal(new Headers(init?.headers).has("authorization"), false); return new Response(null, { status: 200 }); }
    if (target === `https://queue.fal.run/${REPLACEMENT.endpoint}`) return Response.json({ request_id: id });
    throw new Error("Unexpected URL");
  };
  const key = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const first = submitReplacement(portrait, video, region, key, AbortSignal.timeout(1000));
  const duplicate = submitReplacement(portrait, video, region, key, AbortSignal.timeout(1000));
  assert.equal(first, duplicate);
  const job = await first;
  assert.equal(parseReplacementTicket(job.ticket), id);
  assert.equal(JSON.stringify(job).includes("fixture-key"), false);
  const submit = calls.filter((c) => c.url === `https://queue.fal.run/${REPLACEMENT.endpoint}`);
  assert.equal(submit.length, 1);
  const input = JSON.parse(String(submit[0].init?.body));
  assert.equal(input.resolution, "720p"); assert.equal(input.num_inference_steps, 30);
  assert.equal(input.enable_safety_checker, true); assert.equal(input.acceleration, "none");
  assert.ok(input.mask_image_url); assert.equal(input.ref_image_urls.length, 1);
  const maskPut = calls.filter((c) => c.url.includes("/upload/signed"))[2];
  const mask = new Uint8Array(await (maskPut.init!.body as Blob).arrayBuffer());
  assert.equal(mask[0], 137);
  assert.throws(() => submitReplacement(portrait, video, { ...region, bottom: 0.8 }, key, AbortSignal.timeout(1000)), /different inputs/);
});

test("failed or ambiguous submits are retained for the key and never automatically replayed", async () => {
  enabled(); let count = 0;
  globalThis.fetch = async () => { count++; throw new TypeError("network failure"); };
  const key = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  await assert.rejects(submitReplacement(portrait, video, region, key, AbortSignal.timeout(1000)));
  await assert.rejects(submitReplacement(portrait, video, region, key, AbortSignal.timeout(1000)));
  assert.equal(count, 1);
});

test("signed jobs reject tampering/expiry and status/cancel use fixed API locations", async () => {
  const ticket = replacementTicket(id);
  assert.throws(() => parseReplacementTicket(ticket + "x"));
  assert.throws(() => parseReplacementTicket(ticket, Date.now() + 31 * 60 * 1000));
  assert.throws(() => parseReplacementTicket("https://attacker.test/job"));
  let completed = false; const calls: string[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    assert.ok(String(url).startsWith(`https://queue.fal.run/fal-ai/wan-vace-14b/requests/${id}`));
    if (String(url).endsWith("/status")) return Response.json({ status: completed ? "COMPLETED" : "IN_QUEUE" });
    if (init?.method === "PUT") return new Response(null, { status: 202 });
    return Response.json({ video: { url: "https://v3.fal.media/files/result.mp4" } });
  };
  assert.deepEqual(await replacementStatus(ticket, AbortSignal.timeout(1000)), { status: "waiting" });
  completed = true;
  assert.deepEqual(await replacementStatus(ticket, AbortSignal.timeout(1000)), { status: "complete", url: "https://v3.fal.media/files/result.mp4" });
  await cancelReplacement(ticket, AbortSignal.timeout(1000));
  assert.ok(calls.some((url) => url.endsWith("/cancel")));
});
