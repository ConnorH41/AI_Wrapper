import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { pcmToWav } from "../../packages/core/src/session";

const words = ["Meet", "your", "new", "reusable", "bottle.", "Take", "it", "with", "you."];
const audio = pcmToWav(Uint8Array.from({ length: 48000 * 4 }, (_, i) => {
  const sample = Math.round(Math.sin(Math.floor(i / 2) * 2 * Math.PI * 220 / 24000) * 5000);
  return i % 2 === 0 ? sample & 255 : (sample >> 8) & 255;
}));

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

async function login(page: Page) {
  await page.goto("/studio");
  await page.getByLabel("Shared password", { exact: true }).fill("test-password-at-least-sixteen");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Product name", { exact: true })).toBeVisible();
  expect(await page.evaluate(async () => {
    const body: unknown = await (await fetch("/api/session")).json();
    return typeof body === "object" && body !== null && "authenticated" in body && body.authenticated === true;
  })).toBe(true);
}

async function fixtureApis(page: Page) {
  await page.route("**/api/script", (route) => route.fulfill({ json: { script: words.join(" ") } }));
  await page.route("**/api/voice", (route) => route.fulfill({ contentType: "audio/wav", body: Buffer.from(audio), headers: { "X-Audio-Duration": "4" } }));
  await page.route("**/api/timings", (route) => route.fulfill({ json: { timings: words.map((word, i) => ({ word, start: i * 0.4, end: i * 0.4 + 0.35 })) } }));
}

async function inputs(page: Page) {
  await page.getByLabel("Product photo", { exact: true }).setInputFiles({ name: "product.png", mimeType: "image/png", buffer: await picture(page, "REAL PRODUCT", "#156c3a") });
  await page.getByLabel("Product name", { exact: true }).fill("Reusable bottle");
  await page.getByLabel("Factual product benefit", { exact: true }).fill("Use it again and again");
  await page.getByLabel("Presenter portrait", { exact: true }).setInputFiles({ name: "presenter.png", mimeType: "image/png", buffer: await picture(page, "PRESENTER", "#324c83") });
  await page.getByText("I have the right to use this person", { exact: false }).click();
}

async function narration(page: Page) {
  await page.getByRole("button", { name: "Generate script", exact: true }).click();
  await expect(page.getByLabel("Editable spoken script")).toHaveValue(words.join(" "));
  await page.getByRole("button", { name: "Generate narration", exact: true }).click();
  await expect(page.getByRole("button", { name: "Generate caption timings", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Generate caption timings", exact: true }).click();
  await expect(page.getByText("Caption transcript", { exact: true })).toBeVisible();
}

test("password, direct API protection, and missing origin", async ({ page, request }) => {
  const direct = await request.post("/api/script", { headers: { origin: "http://127.0.0.1:3100" }, data: { name: "x", benefit: "x" } });
  expect(direct.status()).toBe(401);
  await page.goto("/studio");
  await page.getByLabel("Shared password", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Studio error" })).toContainText("Incorrect password");
  const cross = await request.post("/api/session", { headers: { origin: "https://attacker.test" }, data: { password: "test-password-at-least-sixteen" } });
  expect(cross.status()).toBe(403);
  if (process.env.AIW_TEST_PRODUCTION === "1") {
    for (const path of ["/legacy", "/new", "/projects/00000000-0000-0000-0000-000000000000", "/api/media/example.png"]) {
      expect((await request.get(path)).status()).toBe(404);
    }
  }
});

test("real browser MP4 export, replay, and second render with controlled provider responses", async ({ page }, testInfo) => {
  await fixtureApis(page);
  await login(page); await inputs(page); await narration(page);
  await expect(page.getByAltText(/Scene preview/)).toHaveCount(3);
  await page.getByText("I approve these scenes", { exact: false }).click();
  await page.getByRole("button", { name: "Create MP4", exact: true }).click();
  await expect(page.getByRole("button", { name: "Create MP4", exact: true })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Download MP4", exact: true })).toBeVisible({ timeout: 300000 });
  const downloadPromise = page.waitForEvent("download"); await page.getByRole("link", { name: "Download MP4" }).click();
  const download = await downloadPromise; await mkdir("test-results", { recursive: true });
  await download.saveAs(`test-results/${testInfo.project.name}-export.mp4`);
  await page.locator("video").scrollIntoViewIfNeeded();
  await page.locator("video").evaluate(async (element) => { if (!(element instanceof HTMLVideoElement)) throw new Error("Expected video"); element.muted = true; await element.play(); });
  await expect.poll(() => page.locator("video").evaluate((element) => { if (!(element instanceof HTMLVideoElement)) throw new Error("Expected video"); return element.currentTime; }), { timeout: 15000 }).toBeGreaterThan(0.1);
  const info = await page.locator("video").evaluate((element) => { if (!(element instanceof HTMLVideoElement)) throw new Error("Expected video"); element.pause(); return { duration: element.duration, width: element.videoWidth, height: element.videoHeight }; });
  expect(info.duration).toBeCloseTo(15, 1); expect(info.width).toBe(720); expect(info.height).toBe(1280);
  await page.locator("video").evaluate((element) => { if (!(element instanceof HTMLVideoElement)) throw new Error("Expected video"); element.currentTime = 1; });
  await page.screenshot({ path: `test-results/${testInfo.project.name}-studio.png`, fullPage: true });
  await page.getByRole("button", { name: "Create MP4", exact: true }).click();
  await expect(page.getByLabel("Video rendering progress")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Studio error" })).toContainText("Cancelled");
  await expect(page.getByRole("link", { name: "Download MP4" })).toHaveCount(0);
  await page.getByRole("button", { name: "Create MP4", exact: true }).click();
  await expect(page.getByRole("link", { name: "Download MP4" })).toBeVisible({ timeout: 300000 });
});

test("prompted portrait, invalidation, timing retry, expired session, cancellation, and reset", async ({ page, context }) => {
  await fixtureApis(page); await login(page); await inputs(page); await narration(page);
  const portrait = await picture(page, "GENERATED", "#74448a");
  await page.route("**/api/avatar", (route) => route.fulfill({ contentType: "image/png", body: portrait }));
  await page.getByLabel("Presenter source").selectOption("prompt");
  await page.getByLabel("Presenter description").fill("Friendly adult presenter");
  await page.getByRole("button", { name: "Generate portrait", exact: true }).click();
  await expect(page.getByText("Caption transcript", { exact: true })).toBeVisible();
  await expect(page.getByAltText(/Scene preview/)).toHaveCount(3);
  await page.unroute("**/api/timings");
  let calls = 0;
  await page.route("**/api/timings", (route) => {
    calls++;
    return route.fulfill(calls === 1 ? { status: 429, json: { error: { code: "quota_exhausted", message: "Free quota exhausted" } } } : { json: { timings: words.map((word, i) => ({ word, start: i * 0.4, end: i * 0.4 + 0.35 })) } });
  });
  await page.getByRole("button", { name: "Regenerate caption timings" }).click();
  await expect(page.getByRole("alert", { name: "Studio error" })).toContainText("Free quota exhausted");
  await expect(page.locator("audio")).toBeVisible();
  await page.getByRole("button", { name: "Regenerate caption timings" }).click();
  await expect(page.getByRole("alert", { name: "Studio error" })).toHaveCount(0);
  await page.getByLabel("Editable spoken script").fill("Changed spoken copy.");
  await expect(page.locator("audio")).toHaveCount(0);
  await expect(page.getByText("Caption transcript", { exact: true })).toHaveCount(0);
  await page.unroute("**/api/script"); await context.clearCookies();
  await page.getByRole("button", { name: "Regenerate script" }).click();
  await expect(page.getByLabel("Shared password", { exact: true })).toBeVisible();
  await page.getByLabel("Shared password", { exact: true }).fill("test-password-at-least-sixteen");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Editable spoken script")).toHaveValue("Changed spoken copy.");
  await page.route("**/api/voice", async (route) => { await new Promise((resolve) => setTimeout(resolve, 1500)); await route.fulfill({ contentType: "audio/wav", body: Buffer.from(audio) }).catch(() => {}); });
  await page.getByRole("button", { name: "Generate narration", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Studio error" })).toContainText("Cancelled");
  await page.getByRole("button", { name: "Start over", exact: true }).click();
  await expect(page.getByLabel("Product name", { exact: true })).toHaveValue("");
  await expect(page.getByAltText(/Scene preview/)).toHaveCount(0);
});

test("live provider smoke with real portrait, narration, word timings, and browser MP4", async ({ page }) => {
  test.skip(process.env.RUN_LIVE_PROVIDER_TESTS !== "1", "Explicit opt-in and free-tier provider credentials are required.");
  await login(page);
  await page.getByLabel("Product photo", { exact: true }).setInputFiles({ name: "bottle.png", mimeType: "image/png", buffer: await picture(page, "REAL PRODUCT", "#156c3a") });
  await page.getByLabel("Product name", { exact: true }).fill("Reusable bottle");
  await page.getByLabel("Factual product benefit", { exact: true }).fill("Reusable for everyday drinks");
  await page.getByLabel("Presenter source").selectOption("prompt");
  await page.getByLabel("Presenter description").fill("Friendly fictional adult presenter wearing a plain blue shirt, simple studio portrait");
  await page.getByRole("button", { name: "Generate portrait", exact: true }).click();
  await expect(page.getByAltText("Selected presenter portrait")).toBeVisible({ timeout: 95000 });
  await page.getByRole("button", { name: "Generate script", exact: true }).click();
  await expect(page.getByLabel("Editable spoken script")).not.toHaveValue("", { timeout: 95000 });
  await page.getByRole("button", { name: "Generate narration", exact: true }).click();
  await expect(page.getByRole("button", { name: "Generate caption timings", exact: true })).toBeVisible({ timeout: 95000 });
  await page.getByRole("button", { name: "Generate caption timings", exact: true }).click();
  await expect(page.getByText("Caption transcript", { exact: true })).toBeVisible({ timeout: 95000 });
  await page.getByText("I approve these scenes", { exact: false }).click();
  await page.getByRole("button", { name: "Create MP4", exact: true }).click();
  await expect(page.getByRole("link", { name: "Download MP4" })).toBeVisible({ timeout: 300000 });
  const pending = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download MP4" }).click();
  await (await pending).saveAs("test-results/live-provider-export.mp4");
});

test("invalid image inputs and oversized API requests preserve the draft", async ({ page }) => {
  await fixtureApis(page); await login(page); await inputs(page);
  await page.getByLabel("Product photo", { exact: true }).setInputFiles({ name: "fake.png", mimeType: "image/png", buffer: Buffer.from("This is not an image") });
  await expect(page.getByRole("alert", { name: "Studio error" })).toContainText("contents do not match");
  await expect(page.getByAltText("Uploaded product", { exact: true })).toBeVisible();
  await page.getByLabel("Product photo", { exact: true }).setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) });
  await expect(page.getByRole("alert", { name: "Studio error" })).toContainText("could not be decoded");
  await page.getByLabel("Product photo", { exact: true }).setInputFiles({ name: "oversized.png", mimeType: "image/png", buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await expect(page.getByRole("alert", { name: "Studio error" })).toContainText("10 MB");
  await expect(page.getByLabel("Product name", { exact: true })).toHaveValue("Reusable bottle");
  const headers = { origin: "http://127.0.0.1:3100", cookie: (await page.context().cookies()).map(({ name, value }) => `${name}=${value}`).join("; ") };
  const oversizedJson = await page.context().request.post("/api/script", { headers, data: { name: "x".repeat(17000), benefit: "Reusable" } });
  expect(oversizedJson.status()).toBe(413);
  const oversizedAudio = await page.context().request.post("/api/timings", { headers: { ...headers, "content-type": "audio/wav" }, data: Buffer.alloc(1024 * 1024 + 1) });
  expect(oversizedAudio.status()).toBe(413);
  await page.getByLabel("Factual product benefit", { exact: true }).fill("WWWWW ".repeat(50).trim());
  await expect(page.getByAltText(/Scene preview/)).toHaveCount(3);
  const overlap = await page.getByAltText(/Scene preview, 3–11/).evaluate(async (element) => {
    if (!(element instanceof HTMLImageElement)) throw new Error("Expected scene image");
    const image = await createImageBitmap(await (await fetch(element.src)).blob());
    const canvas = document.createElement("canvas"); canvas.width = 720; canvas.height = 1280;
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("No canvas");
    ctx.drawImage(image, 0, 0); image.close();
    const pixels = ctx.getImageData(0, 370, 720, 50).data;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 60 && pixels[i + 1] < 60 && pixels[i + 2] < 60) return true;
    return false;
  });
  expect(overlap).toBe(false);
});
