import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { MOTION, motionFileUrl, motionStreamUrl } from "../../packages/core/src/motion";

async function picture(page: Page, label: string, color: string) {
  const data = await page.evaluate(({ label, color }) => {
    const canvas = document.createElement("canvas"); canvas.width = 300; canvas.height = 400;
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("No canvas");
    ctx.fillStyle = color; ctx.fillRect(0, 0, 300, 400);
    ctx.fillStyle = "white"; ctx.font = "28px Arial"; ctx.fillText(label, 30, 180);
    return canvas.toDataURL("image/png").split(",")[1];
  }, { label, color });
  return Buffer.from(data, "base64");
}

async function login(page: Page, free = true) {
  await page.goto("/studio");
  await page.getByLabel("Shared password", { exact: true }).fill("test-password-at-least-sixteen");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Character source", { exact: true })).toBeVisible();
  if (free) await page.getByLabel("Replacement method", { exact: true }).selectOption("free");
  expect(await page.evaluate(async () => {
    const body: unknown = await (await fetch("/api/session")).json();
    return typeof body === "object" && body !== null && "authenticated" in body && body.authenticated === true;
  })).toBe(true);
}

async function chooseCharacter(page: Page) {
  await page.getByLabel("Character reference", { exact: true }).setInputFiles({ name: "character.png", mimeType: "image/png", buffer: await picture(page, "CHARACTER", "#324c83") });
  await page.getByText("I have the right to use this person", { exact: false }).click();
}

test("the studio has only character and motion controls, and retired product routes are gone", async ({ page, request }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "Create a character video", exact: true })).toBeVisible();
  await expect(page.getByLabel(/Product photo|Product name|Factual product benefit|Editable spoken script/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Generate script|Generate narration|Create MP4/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "2. Scene and motion", exact: true })).toBeVisible();
  for (const path of ["/legacy", "/new", "/projects/00000000-0000-0000-0000-000000000000", "/api/media/example.png"]) {
    expect((await request.get(path)).status()).toBe(404);
  }
  for (const path of ["/api/script", "/api/voice", "/api/timings"]) {
    expect((await request.post(path, { data: {} })).status()).toBe(404);
  }
});

test("password and direct provider API protection", async ({ page, request }) => {
  for (const path of ["/api/avatar", "/api/motion"]) {
    expect((await request.post(path, { headers: { origin: "http://127.0.0.1:3100" }, data: {} })).status()).toBe(401);
  }
  await page.goto("/studio");
  await page.getByLabel("Shared password", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Studio error" })).toContainText("Incorrect password");
  expect((await request.post("/api/session", { headers: { origin: "https://attacker.test" }, data: { password: "test-password-at-least-sixteen" } })).status()).toBe(403);
});

test("prompted characters preserve the scene through errors and reauthentication", async ({ page, context }, testInfo) => {
  const scene = await readFile("tests/fixtures/motion-scene.mp4");
  const mediaPath = `/tmp/gradio/${"b".repeat(64)}/clip.mp4`;
  await page.route("**/api/motion", (route) => route.fulfill({ json: { url: motionFileUrl(mediaPath, "mp4") } }));
  await page.route(`${MOTION.host}/gradio_api/file=**`, (route) => route.fulfill({ contentType: "video/mp4", headers: { "Access-Control-Allow-Origin": "*" }, body: scene }));
  await login(page);
  await page.getByRole("button", { name: "Load demo scene", exact: true }).click();
  await expect(page.getByLabel("Source motion scene", { exact: true })).toBeVisible();
  await page.getByLabel("Character source", { exact: true }).selectOption("prompt");
  await page.getByLabel("Character description", { exact: true }).fill("Friendly fictional adult with short dark hair");
  const image = await picture(page, "GENERATED", "#74448a");
  let fail = true;
  let calls = 0;
  await page.route("**/api/avatar", (route) => {
    calls++;
    return route.fulfill(fail ? { status: 429, json: { error: { code: "quota_exhausted", message: "Free portrait quota exhausted" } } } : { contentType: "image/png", body: image });
  });
  await page.getByRole("button", { name: "Generate character", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Studio error" })).toContainText("Free portrait quota exhausted");
  await expect(page.getByLabel("Character description", { exact: true })).toHaveValue("Friendly fictional adult with short dark hair");
  expect(calls).toBe(1);
  fail = false;
  await page.getByRole("button", { name: "Generate character", exact: true }).click();
  await expect(page.getByAltText("Selected character", { exact: true })).toBeVisible();
  const share = page.getByRole("checkbox", { name: /approve sending the character and scene/ });
  await share.check();
  await expect(page.getByRole("button", { name: "Generate video", exact: true })).toBeEnabled();
  await page.screenshot({ path: `test-results/${testInfo.project.name}-character-scene-studio.png`, fullPage: true });
  await page.getByLabel("Character description", { exact: true }).fill("Another fictional adult character");
  await expect(share).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Generate video", exact: true })).toBeDisabled();
  await page.unroute("**/api/avatar");
  await context.clearCookies();
  await page.getByRole("button", { name: "Generate character", exact: true }).click();
  await expect(page.getByLabel("Shared password", { exact: true })).toBeVisible();
  await page.getByLabel("Shared password", { exact: true }).fill("test-password-at-least-sixteen");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Character description", { exact: true })).toHaveValue("Another fictional adult character");
  await expect(page.getByLabel("Source motion scene", { exact: true })).toBeVisible();
  await page.route("**/api/avatar", async (route) => { await new Promise((resolve) => setTimeout(resolve, 1500)); await route.fulfill({ contentType: "image/png", body: image }).catch(() => {}); });
  await page.getByRole("button", { name: "Generate character", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Studio error" })).toContainText("Cancelled");
  await page.getByRole("button", { name: "Start over", exact: true }).click();
  await expect(page.getByLabel("Source motion scene", { exact: true })).toHaveCount(0);
  await expect(page.getByAltText("Selected character", { exact: true })).toHaveCount(0);
});

test("invalid portrait uploads preserve the selected character and excessive API inputs are rejected", async ({ page }) => {
  await login(page); await chooseCharacter(page);
  const upload = page.getByLabel("Character reference", { exact: true });
  await upload.setInputFiles({ name: "fake.png", mimeType: "image/png", buffer: Buffer.from("This is not an image") });
  await expect(page.getByRole("alert", { name: "Studio error" })).toContainText("contents do not match");
  await expect(page.getByAltText("Selected character", { exact: true })).toBeVisible();
  await upload.setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) });
  await expect(page.getByRole("alert", { name: "Studio error" })).toContainText("could not be decoded");
  await upload.setInputFiles({ name: "oversized.png", mimeType: "image/png", buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await expect(page.getByRole("alert", { name: "Studio error" })).toContainText("10 MB");
  await expect(page.getByText("I have the right to use this person", { exact: false }).locator("..").getByRole("checkbox")).toBeChecked();
  const headers = { origin: "http://127.0.0.1:3100", cookie: (await page.context().cookies()).map(({ name, value }) => `${name}=${value}`).join("; ") };
  expect((await page.context().request.post("/api/avatar", { headers, data: { prompt: "x".repeat(17000) } })).status()).toBe(413);
  expect((await page.context().request.post("/api/avatar", { headers: { ...headers, origin: "https://attacker.test" }, data: { prompt: "adult" } })).status()).toBe(403);
});

test("motion test reviews consent, preserves an earlier clip on quota failure, supports uploads and cancels", async ({ page }, testInfo) => {
  const fixture = await readFile("tests/fixtures/motion-scene.mp4");
  const path = `/tmp/gradio/${"b".repeat(64)}/clip.mp4`;
  const eventId = "a".repeat(32);
  let submitted = 0;
  let cancelled = 0;
  let streams = 0;
  let failQuota = false;
  let hold = false;
  await page.route("**/api/motion", async (route) => {
    if (route.request().headers()["content-type"]?.includes("application/json")) {
      const body: unknown = route.request().postDataJSON();
      if (typeof body === "object" && body !== null && "action" in body && body.action === "cancel") { cancelled++; return route.fulfill({ json: { cancelled: true } }); }
      return route.fulfill({ json: { url: motionFileUrl(path, "mp4") } });
    }
    submitted++;
    return route.fulfill({ json: { eventId, streamUrl: motionStreamUrl(eventId), cancelTicket: "fixture-ticket" } });
  });
  await page.route(`${MOTION.host}/gradio_api/file=**`, (route) => route.fulfill({ contentType: "video/mp4", headers: { "Access-Control-Allow-Origin": "*" }, body: fixture }));
  await page.route(`${MOTION.host}/gradio_api/call/animate_scene/*`, async (route) => {
    streams++;
    if (hold) await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({ contentType: "text/event-stream", headers: { "Access-Control-Allow-Origin": "*" }, body: failQuota ? 'event: error\ndata: {"error":"GPU quota exceeded"}\n\n' : `event: heartbeat\ndata: null\n\nevent: complete\ndata: ${JSON.stringify([{ path }, null, { path }, { video: { path } }, null])}\n\n` }).catch(() => {});
  });
  await login(page);
  const generate = page.getByRole("button", { name: "Generate video", exact: true });
  const share = page.getByRole("checkbox", { name: /approve sending the character and scene/ });
  await expect(generate).toBeDisabled();
  await page.getByRole("button", { name: "Load demo scene", exact: true }).click();
  await expect(page.getByLabel("Source motion scene", { exact: true })).toBeVisible();
  await expect(generate).toBeDisabled();
  const warning = page.waitForEvent("dialog", { timeout: 10000 });
  await page.close({ runBeforeUnload: true });
  const dialog = await warning;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  await expect(page.getByLabel("Source motion scene", { exact: true })).toBeVisible();
  await chooseCharacter(page);
  const likeness = page.getByRole("checkbox", { name: /right to use this person/ });
  await likeness.uncheck(); await share.check();
  await expect(generate).toBeDisabled();
  await likeness.check();
  await expect(share).not.toBeChecked();
  await share.check(); await generate.click();
  await expect(page.getByRole("link", { name: "Download video", exact: true })).toBeVisible();
  const video = page.getByLabel("Generated character replacement", { exact: true });
  await expect(video).toBeVisible();
  await video.evaluate(async (element) => { if (!(element instanceof HTMLVideoElement)) throw new Error("Expected video"); element.muted = true; await element.play(); });
  await expect.poll(() => video.evaluate((element) => element instanceof HTMLVideoElement ? element.currentTime : 0)).toBeGreaterThan(0.1);
  await video.evaluate((element) => { if (element instanceof HTMLVideoElement) element.pause(); });
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download video", exact: true }).click();
  const saved = `test-results/${testInfo.project.name}-motion-download.mp4`;
  await (await download).saveAs(saved);
  expect(await readFile(saved)).toEqual(fixture);
  await page.getByText("Review the provider’s edit mask", { exact: true }).click();
  await expect(page.getByLabel("Provider edit mask", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Provider background guide", { exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/${testInfo.project.name}-motion-test.png`, fullPage: true });
  failQuota = true;
  await generate.click();
  await expect(page.getByRole("alert", { name: "Studio error" })).toContainText("free GPU quota");
  await expect(page.getByRole("status").filter({ hasText: "free GPU quota" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download video", exact: true })).toBeVisible();
  expect(submitted).toBe(2);
  await page.getByLabel("Motion scene source", { exact: true }).selectOption("upload");
  await expect(share).not.toBeChecked();
  await expect(page.getByRole("link", { name: "Download video", exact: true })).toHaveCount(0);
  await page.getByLabel("Scene video", { exact: true }).setInputFiles({ name: "bad.mp4", mimeType: "video/mp4", buffer: Buffer.from("not a movie") });
  await expect(page.getByRole("alert", { name: "Studio error" })).toContainText("valid MP4");
  await page.getByLabel("Scene video", { exact: true }).setInputFiles({ name: "scene.mp4", mimeType: "video/mp4", buffer: fixture });
  await share.check();
  failQuota = false; hold = true;
  await generate.click();
  await expect.poll(() => streams).toBe(3);
  await expect(generate).toBeDisabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Studio error" })).toContainText("Cancelled");
  await expect.poll(() => cancelled).toBe(2);
  await expect(page.getByAltText("Selected character")).toBeVisible();
  hold = false;
  await generate.click();
  await expect(page.getByRole("link", { name: "Download video", exact: true })).toBeVisible();
  expect(submitted).toBe(4);
  await chooseCharacter(page);
  await expect(page.getByRole("link", { name: "Download video", exact: true })).toHaveCount(0);
  await expect(share).not.toBeChecked();
  await page.getByRole("button", { name: "Start over", exact: true }).click();
  await expect(page.getByLabel("Replacement method", { exact: true })).toHaveValue("full-character");
  await expect(page.getByRole("button", { name: "Generate full-character preview", exact: true })).toBeDisabled();
  await page.getByLabel("Replacement method", { exact: true }).selectOption("free");
  await expect(share).not.toBeChecked(); await expect(generate).toBeDisabled();
});

test("full-character mode is the default and stays unavailable without paid setup, with no automatic fallback", async ({ page }, testInfo) => {
  let paidSubmissions = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/replacement") && request.method() === "POST") paidSubmissions++; });
  await login(page, false);
  await expect(page.getByLabel("Replacement method", { exact: true })).toHaveValue("full-character");
  await expect(page.getByRole("status").filter({ hasText: "Full-character generation is not enabled" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate full-character preview", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Load demo scene", exact: true })).toHaveCount(0);
  expect(paidSubmissions).toBe(0);
  await page.screenshot({ path: `test-results/${testInfo.project.name}-full-character-disabled.png`, fullPage: true });
});

test("full-character selection, paid consent, existing-job recovery, output validation and cancellation", async ({ page }, testInfo) => {
  const fixture = await readFile("tests/fixtures/motion-scene.mp4");
  const resultUrl = "https://v3.fal.media/files/replacement.mp4";
  let submitted = 0;
  let failStatus = true;
  let invalidOutput = false;
  let loseSubmission = false;
  let cancellations = 0;
  await page.route("**/api/replacement", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { available: true, maxSeconds: 5 } });
    if (route.request().headers()["content-type"]?.includes("multipart/form-data")) {
      submitted++;
      const upload = route.request().postDataBuffer()!.toString();
      expect(upload).toContain("fal-paid"); expect(upload).toContain('name="region"');
      if (loseSubmission) return route.fulfill({ status: 502, json: { error: { message: "Submission response lost" } } });
      return route.fulfill({ json: { ticket: "fixture-job-ticket" } });
    }
    const body = route.request().postDataJSON();
    if (body.action === "cancel") { cancellations++; return route.fulfill({ json: { cancelled: true } }); }
    if (failStatus) return route.fulfill({ status: 503, json: { error: { message: "Temporary status connection failure" } } });
    return route.fulfill({ json: { status: "complete", url: resultUrl } });
  });
  await page.route(resultUrl, (route) => route.fulfill({ contentType: "video/mp4", headers: { "Access-Control-Allow-Origin": "*" }, body: invalidOutput ? Buffer.from([0, 0, 0, 12, 102, 116, 121, 112, 0, 0, 0, 0]) : fixture }));
  await login(page, false); await chooseCharacter(page);
  await page.getByLabel("Short scene for full-character replacement", { exact: true }).setInputFiles({ name: "short-scene.mp4", mimeType: "video/mp4", buffer: fixture });
  await expect(page.getByLabel("Full-character source scene", { exact: true })).toBeVisible();
  await expect.poll(() => page.getByLabel("Full-character source scene", { exact: true }).evaluate((video) => (video as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
  const generate = page.getByRole("button", { name: "Generate full-character preview", exact: true });
  const consent = page.getByRole("checkbox", { name: /approve paid processing/ });
  await consent.check(); await expect(generate).toBeDisabled();
  await page.getByRole("button", { name: "Select centered person", exact: true }).click();
  await expect(consent).not.toBeChecked(); await consent.check();
  await expect(generate).toBeEnabled();
  await page.screenshot({ path: `test-results/${testInfo.project.name}-whole-person-selection.png`, fullPage: true });
  await generate.click();
  await expect(page.getByRole("alert", { name: "Studio error" })).toContainText("Temporary status");
  expect(submitted).toBe(1);
  await expect(page.getByLabel("Character reference", { exact: true })).toBeDisabled();
  await page.screenshot({ path: `test-results/${testInfo.project.name}-recover-existing-job.png`, fullPage: true });
  failStatus = false;
  await page.getByRole("button", { name: "Check existing job", exact: true }).click();
  const download = page.getByRole("link", { name: "Download full-character preview", exact: true });
  await expect(download).toBeVisible(); expect(submitted).toBe(1);
  await expect(page.getByLabel("Character reference", { exact: true })).toBeEnabled();
  const saved = page.waitForEvent("download"); await download.click();
  const file = await saved; const path = `test-results/${testInfo.project.name}-full-character.mp4`;
  await file.saveAs(path); expect(await readFile(path)).toEqual(fixture);
  invalidOutput = true; await generate.click();
  await expect(page.getByRole("alert", { name: "Studio error" })).toContainText("unplayable");
  await expect(download).toBeVisible(); expect(submitted).toBe(2);
  await page.getByRole("button", { name: "Request job cancellation", exact: true }).click();
  await expect.poll(() => cancellations).toBe(1);
  await expect(page.getByLabel("Character reference", { exact: true })).toBeEnabled();
  loseSubmission = true;
  await generate.click();
  await expect(page.getByRole("alert", { name: "Studio error" })).toContainText("Submission response lost");
  await expect(page.getByLabel("Character reference", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Replacement method", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Start over", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Check existing job", exact: true })).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Inputs are held" })).toBeVisible();
  await page.screenshot({ path: `test-results/${testInfo.project.name}-unconfirmed-submission.png`, fullPage: true });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Leave this job", exact: true }).click();
  await expect(page.getByLabel("Character reference", { exact: true })).toBeEnabled();
  await expect(consent).not.toBeChecked(); expect(submitted).toBe(3);
  await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  await expect(download).toHaveCount(0); await expect(consent).not.toBeChecked();
  await expect(generate).toBeDisabled();
});

test("live free-account motion generation through the app", async ({ page }) => {
  test.setTimeout(480000);
  test.skip(process.env.RUN_LIVE_MOTION_TESTS !== "1", "Explicit opt-in and a verified free HF account are required.");
  const referencePath = process.env.MOTION_REFERENCE_PATH;
  if (!referencePath) throw new Error("Set MOTION_REFERENCE_PATH to a non-sensitive test portrait.");
  await login(page);
  await page.getByLabel("Character reference", { exact: true }).setInputFiles(referencePath);
  await page.getByText("I have the right to use this person", { exact: false }).click();
  await page.getByRole("button", { name: "Load demo scene", exact: true }).click();
  await expect(page.getByLabel("Source motion scene", { exact: true })).toBeVisible({ timeout: 90000 });
  await page.getByRole("checkbox", { name: /approve sending the character and scene/ }).check();
  await page.getByRole("button", { name: "Generate video", exact: true }).click();
  const result = page.getByRole("link", { name: "Download video", exact: true });
  const failure = page.getByRole("alert", { name: "Studio error" });
  await result.or(failure).first().waitFor({ state: "visible", timeout: 400000 });
  if (await failure.isVisible()) throw new Error(`Live motion generation failed: ${await failure.innerText()}`);
  await expect(result).toBeVisible();
  const video = page.getByLabel("Generated character replacement", { exact: true });
  await expect.poll(() => video.evaluate((element) => element instanceof HTMLVideoElement ? element.duration : 0)).toBeGreaterThan(1.5);
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download video", exact: true }).click();
  await (await download).saveAs("test-results/live-motion-export.mp4");
  await page.screenshot({ path: "test-results/live-motion-studio.png", fullPage: true });
});
