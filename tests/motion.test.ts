import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MOTION, findMotionDemo, motionFileUrl, motionMediaUrl, motionStreamUrl, parseMotionEvent, parseMotionJob, validateMotionMp4, validateMotionPortrait } from "../packages/core/src/motion";
import { motionTicket, parseMotionTicket, startMotion, cancelMotion } from "../apps/web/src/lib/server/motion";
import { ApiError } from "../apps/web/src/lib/server/http";
import { createSession } from "../apps/web/src/lib/server/session";
import { POST } from "../apps/web/src/app/api/motion/route";

const portrait = readFileSync("tests/fixtures/motion-portrait.jpg");
const video = readFileSync("tests/fixtures/motion-scene.mp4");
const eventId = "a".repeat(32);
const hash = "b".repeat(64);
const path = `/tmp/gradio/${hash}/clip.mp4`;
const previousEnv = { ...process.env };
process.env.APP_ACCESS_PASSWORD = "test-password-at-least-sixteen";
process.env.SESSION_SIGNING_SECRET = "motion-test-signing-secret-at-least-thirty-two";
process.env.HF_TOKEN = "hf_fixture_for_tests_only";
test.after(() => { process.env = previousEnv; });

test("motion job and media locations cannot redirect the browser to arbitrary hosts or paths", () => {
  assert.equal(motionFileUrl(path, "mp4"), `${MOTION.host}/gradio_api/file=${path}`);
  assert.equal(motionMediaUrl(motionFileUrl(path, "mp4")), motionFileUrl(path, "mp4"));
  for (const invalid of ["/etc/private.mp4", `/tmp/gradio/${hash}/../private.mp4`, `/tmp/gradio/${hash}/clip.mp4?token=secret`]) assert.throws(() => motionFileUrl(invalid, "mp4"));
  for (const invalid of ["https://attacker.test/clip.mp4", `${MOTION.host}/gradio_api/file=${path}?token=secret`, `${MOTION.host}/gradio_api/file=${path}#fragment`]) assert.throws(() => motionMediaUrl(invalid));
  const job = { eventId, streamUrl: motionStreamUrl(eventId), cancelTicket: "signed-ticket" };
  assert.deepEqual(parseMotionJob(job), job);
  assert.throws(() => parseMotionJob({ ...job, streamUrl: "https://attacker.test" }));
  assert.throws(() => motionStreamUrl("../../other"));
});

test("motion SSE parser distinguishes real completion, refusals, quota and generic null errors", () => {
  assert.deepEqual(parseMotionEvent("event: heartbeat\ndata: null"), { kind: "pending" });
  assert.deepEqual(parseMotionEvent(`event: complete\ndata: ${JSON.stringify([{ path }])}`), { kind: "complete", url: motionFileUrl(path, "mp4") });
  assert.throws(() => parseMotionEvent('event: error\ndata: {"error":null}'), /failed at the provider/);
  assert.throws(() => parseMotionEvent('event: error\ndata: {"error":"GPU quota exceeded"}'), /free GPU quota/);
  assert.throws(() => parseMotionEvent('event: error\ndata: {"error":"content policy refusal"}'), /refused/);
  assert.throws(() => parseMotionEvent('event: error\ndata: {"error":"maximum file size exceeded"}'), /media size/);
  assert.throws(() => parseMotionEvent('event: complete\ndata: []'), /no motion video/);
  assert.throws(() => parseMotionEvent('event: complete\ndata: [{"path":"https://attacker.test"}]'));
  const diagnostics = parseMotionEvent(`event: complete\ndata: ${JSON.stringify([{ path }, null, { path }, { video: { path } }, null])}`);
  assert.equal(diagnostics.kind, "complete");
  if (diagnostics.kind === "complete") assert.equal(diagnostics.diagnostics?.mask, motionFileUrl(path, "mp4"));
});

test("motion media guards bound real JPEG dimensions and MP4 bytes", () => {
  validateMotionPortrait(portrait);
  validateMotionMp4(video, MOTION.sceneBytes);
  assert.throws(() => validateMotionPortrait(new Uint8Array([255, 216, 1, 2])), /JPEG/);
  const huge = Uint8Array.from(portrait);
  const frame = huge.findIndex((value, index) => value === 255 && [192, 193, 194].includes(huge[index + 1]));
  assert.ok(frame >= 0);
  huge[frame + 7] = 16;
  assert.throws(() => validateMotionPortrait(huge), /dimensions/);
  assert.throws(() => validateMotionMp4(video, video.length - 1), /MP4/);
  assert.throws(() => validateMotionMp4(new Uint8Array(16), MOTION.sceneBytes), /MP4/);
  assert.equal(findMotionDemo({ components: [{ data: [`/tmp/gradio/${hash}/okay.mp4`] }] }), `/tmp/gradio/${hash}/okay.mp4`);
  assert.equal(findMotionDemo([`https://attacker.test/okay.mp4`]), undefined);
});

test("motion cancellation tickets reject tampering and expiry", () => {
  const ticket = motionTicket(eventId, 7);
  assert.deepEqual(parseMotionTicket(ticket), { eventId, fnIndex: 7 });
  assert.throws(() => parseMotionTicket(`${ticket}x`), /Invalid/);
  assert.throws(() => parseMotionTicket(`${ticket}.`), /Invalid/);
  assert.throws(() => parseMotionTicket(ticket, Date.now() + 21 * 60 * 1000), /expired/);
  assert.throws(() => parseMotionTicket("not-signed"), /Invalid/);
});

test("motion submission enforces a free account, six-input REST shape and no automatic retry", async () => {
  const previousFetch = globalThis.fetch;
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("whoami-v2")) return Response.json({ isPro: false });
    if (String(url).endsWith("/config")) return Response.json({ dependencies: [{ api_name: "animate_scene", id: 7 }] });
    if (String(url).endsWith("/upload")) return Response.json([`/tmp/gradio/${hash}/input.dat`]);
    if (String(url).endsWith("/cancel")) return Response.json({ success: true });
    return Response.json({ event_id: eventId });
  };
  try {
    const job = await startMotion(new Blob([portrait], { type: "image/jpeg" }), new Blob([video], { type: "video/mp4" }), AbortSignal.timeout(1000));
    assert.equal(job.streamUrl, motionStreamUrl(eventId));
    const submitted = calls.find(({ url }) => url.endsWith("/call/animate_scene"));
    assert.ok(submitted);
    const body: unknown = JSON.parse(String(submitted.init?.body));
    assert.ok(typeof body === "object" && body !== null && "data" in body && Array.isArray(body.data));
    assert.equal(body.data.length, 6);
    assert.equal(body.data[1], 2);
    assert.equal(body.data[3], "Character Swap");
    assert.equal(body.data[5], null);
    assert.equal(JSON.stringify(job).includes("hf_fixture"), false);
    await cancelMotion(job.cancelTicket, AbortSignal.timeout(1000));
    assert.equal(calls.filter(({ url }) => url.endsWith("/call/animate_scene")).length, 1);
    globalThis.fetch = async () => Response.json({ isPro: true });
    await assert.rejects(startMotion(new Blob([portrait]), new Blob([video]), AbortSignal.timeout(1000)), /verified free/);
    let count = 0;
    globalThis.fetch = async () => { count++; return new Response("quota", { status: 429 }); };
    await assert.rejects(startMotion(new Blob([portrait]), new Blob([video]), AbortSignal.timeout(1000)), (error: unknown) => error instanceof ApiError && error.code === "quota_exhausted");
    assert.equal(count, 1);
  } finally { globalThis.fetch = previousFetch; }
});

test("motion API authenticates and validates origin, consent, media and upload limits before provider calls", async () => {
  const previousFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("No upstream call expected"); };
  const token = createSession(process.env.APP_ACCESS_PASSWORD ?? "");
  const headers = { origin: "https://app.test", cookie: `aiw_session=${token}` };
  try {
    assert.equal((await POST(new Request("https://app.test/api/motion", { method: "POST", headers: { origin: "https://app.test" } }))).status, 401);
    assert.equal((await POST(new Request("https://app.test/api/motion", { method: "POST", headers: { ...headers, origin: "https://attacker.test" } }))).status, 403);
    const form = new FormData();
    form.append("portrait", new Blob([portrait], { type: "image/jpeg" }), "portrait.jpg");
    assert.equal((await POST(new Request("https://app.test/api/motion", { method: "POST", headers, body: form }))).status, 400);
    form.append("consent", "yes");
    form.set("portrait", new Blob([new Uint8Array(20)], { type: "image/jpeg" }), "bad.jpg");
    assert.equal((await POST(new Request("https://app.test/api/motion", { method: "POST", headers, body: form }))).status, 400);
    const oversized = new Request("https://app.test/api/motion", { method: "POST", headers: { ...headers, "content-type": "multipart/form-data; boundary=fixture", "content-length": String(5 * 1024 * 1024) }, body: "too big" });
    assert.equal((await POST(oversized)).status, 413);
    assert.equal(called, false);
  } finally { globalThis.fetch = previousFetch; }
});
