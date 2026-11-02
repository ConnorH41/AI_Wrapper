import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REPLACEMENT, parsePersonRegion, replacementMediaUrl } from "../packages/core/src/replacement";
import { mp4Duration } from "../apps/web/src/lib/server/mp4";
import { cancelReplacement, replacementAvailable, replacementStatus, replacementTicket, parseReplacementTicket, submitReplacement } from "../apps/web/src/lib/server/replacement";
import { GET, POST } from "../apps/web/src/app/api/replacement/route";
import { createSession } from "../apps/web/src/lib/server/session";
import { type SceneReview } from "../packages/core/src/scene-review";
import { validateReviewedMedia } from "../apps/web/src/lib/server/review-media";
import { requestId } from "../apps/web/src/lib/request-id";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const portrait = new Uint8Array(readFileSync("tests/fixtures/motion-portrait.jpg"));
const video = new Uint8Array(readFileSync("tests/fixtures/motion-scene.mp4"));
const region = { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75, width: 16, height: 16 };
const id = "12345678-1234-1234-1234-123456789abc";
const review: SceneReview = { version: 1, duration: 2, checkpoints: Array.from({ length: 9 }, (_, i) => ({ time: i * 1.9 / 8, region: { ...region, width: 128, height: 224 } })), observations: { people: "one", shot: "continuous", framing: "cropped", face: "clear", occlusion: "none", reference: "clear" }, appearance: "Red sweater and wavy brown hair", motion: "The person raises their right hand", highChange: false, uncertainTracking: false, reviewed: true, acceptRisks: false };

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
  body.append("review", JSON.stringify(review)); body.append("mask", new Blob([video], { type: "video/mp4" }), "guide.mp4"); body.append("consent", "fal-paid"); body.append("requestKey", id);
  return body;
}

test("request IDs remain secure UUIDs without the secure-context randomUUID API", () => {
  const descriptor = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
  Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
  try {
    const ids = Array.from({ length: 100 }, () => requestId());
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  } finally {
    if (descriptor) Object.defineProperty(crypto, "randomUUID", descriptor);
    else Reflect.deleteProperty(crypto, "randomUUID");
  }
});

test("all character views are validated and share the original upload budget before provider requests", async () => {
  enabled();
  const invalid = form(); invalid.set("side", new Blob(["not a JPEG"], { type: "image/jpeg" }));
  assert.equal((await POST(request(invalid))).status, 400);
  const wrongType = form(); wrongType.set("back", new Blob([portrait], { type: "image/png" }));
  assert.equal((await POST(request(wrongType))).status, 400);
  const duplicate = form();
  duplicate.append("side", new Blob([portrait], { type: "image/jpeg" }));
  duplicate.append("side", new Blob([portrait], { type: "image/jpeg" }));
  assert.equal((await POST(request(duplicate))).status, 400);
  const tooLarge = form();
  const padded = new Uint8Array(400 * 1024); padded.set(portrait);
  for (const view of ["portrait", "side", "back"]) tooLarge.set(view, new Blob([padded], { type: "image/jpeg" }));
  const response = await POST(request(tooLarge));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error.message, /total at most 1 MB/);
});

test("front, side and back plus a larger local scene reach the provider and bind the submission key", async () => {
  enabled();
  const names: string[] = [];
  let references: string[] = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.includes("/storage/upload/initiate")) {
      const { file_name } = JSON.parse(String(init?.body)); names.push(file_name);
      return Response.json({ upload_url: "https://v3.fal.media/upload/signed", file_url: `https://v3.fal.media/files/${file_name}` });
    }
    if (target.includes("/upload/signed")) {
      assert.equal(new Headers(init?.headers).has("authorization"), false);
      return new Response(null, { status: 200 });
    }
    if (target === `https://queue.fal.run/${REPLACEMENT.endpoint}`) {
      references = JSON.parse(String(init?.body)).ref_image_urls;
      return Response.json({ request_id: id });
    }
    throw new Error("Unexpected URL");
  };
  const key = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const body = form(); body.set("requestKey", key);
  const largerScene = Buffer.alloc(4 * 1024 * 1024);
  largerScene.set(video);
  largerScene.writeUInt32BE(largerScene.length - video.length, video.length);
  largerScene.write("free", video.length + 4);
  body.set("scene", new Blob([largerScene], { type: "video/mp4" }), "scene.mp4");
  for (const view of ["side", "back"]) body.append(view, new Blob([portrait], { type: "image/jpeg" }), `${view}.jpg`);
  assert.equal((await POST(request(body))).status, 200);
  assert.deepEqual(names.slice(0, 3), ["character-front.jpg", "character-side.jpg", "character-back.jpg"]);
  assert.deepEqual(references, names.slice(0, 3).map((name) => `https://v3.fal.media/files/${name}`));
  assert.throws(() => submitReplacement({ front: portrait, back: portrait }, video, video, review, key, AbortSignal.timeout(1000)), /different inputs/);
});

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
  const reversed = form(); reversed.set("review", JSON.stringify({ ...review, checkpoints: review.checkpoints.map((p) => ({ ...p, region: { ...p.region, right: 0 } })) }));
  assert.equal((await POST(request(reversed))).status, 400);
  const notReviewed = form(); notReviewed.set("review", JSON.stringify({ ...review, reviewed: false }));
  assert.equal((await POST(request(notReviewed))).status, 400);
  const missingMask = form(); missingMask.delete("mask");
  assert.equal((await POST(request(missingMask))).status, 400);
  const wrongDimensions = form(); wrongDimensions.set("review", JSON.stringify({ ...review, checkpoints: review.checkpoints.map((p) => ({ ...p, region })) }));
  assert.equal((await POST(request(wrongDimensions))).status, 400);
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
  const first = submitReplacement({ front: portrait }, video, video, review, key, AbortSignal.timeout(1000));
  const duplicate = submitReplacement({ front: portrait }, video, video, review, key, AbortSignal.timeout(1000));
  assert.equal(first, duplicate);
  const job = await first;
  assert.equal(parseReplacementTicket(job.ticket), id);
  assert.equal(JSON.stringify(job).includes("fixture-key"), false);
  const submit = calls.filter((c) => c.url === `https://queue.fal.run/${REPLACEMENT.endpoint}`);
  assert.equal(submit.length, 1);
  const input = JSON.parse(String(submit[0].init?.body));
  assert.equal(input.resolution, "720p"); assert.equal(input.num_inference_steps, 30);
  assert.equal(input.enable_safety_checker, true); assert.equal(input.acceleration, "none");
  assert.ok(input.mask_video_url); assert.equal(input.mask_image_url, undefined); assert.equal(input.ref_image_urls.length, 1);
  assert.match(input.prompt, /Red sweater and wavy brown hair/); assert.match(input.prompt, /raises their right hand/); assert.match(input.prompt, /Preserve the source crop/);
  const maskPut = calls.filter((c) => c.url.includes("/upload/signed"))[2];
  const mask = new Uint8Array(await (maskPut.init!.body as Blob).arrayBuffer());
  assert.deepEqual(mask, video);
  assert.throws(() => submitReplacement({ front: portrait }, video, video, { ...review, appearance: "Different character outfit" }, key, AbortSignal.timeout(1000)), /different inputs/);
  assert.throws(() => submitReplacement({ front: portrait }, video, video.slice(0, -1), review, key, AbortSignal.timeout(1000)), /different inputs/);
});

test("failed or ambiguous submits are retained for the key and never automatically replayed", async () => {
  enabled(); let count = 0;
  globalThis.fetch = async () => { count++; throw new TypeError("network failure"); };
  const key = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  await assert.rejects(submitReplacement({ front: portrait }, video, video, review, key, AbortSignal.timeout(1000)));
  await assert.rejects(submitReplacement({ front: portrait }, video, video, review, key, AbortSignal.timeout(1000)));
  assert.equal(count, 1);
});

test("review media checks bind the guide to source dimensions, frame count and duration", async () => {
  await validateReviewedMedia(video, video, review, AbortSignal.timeout(2000));
  await assert.rejects(validateReviewedMedia(video, video, { ...review, checkpoints: review.checkpoints.map((p) => ({ ...p, region })) }, AbortSignal.timeout(2000)), /do not match/);
  await assert.rejects(validateReviewedMedia(video, video, { ...review, duration: 3 }, AbortSignal.timeout(2000)), /do not match/);
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
