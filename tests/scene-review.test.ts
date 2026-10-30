import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_OBSERVATIONS, frameChange, parseSceneReview, regionAt, replacementPrompt, sceneReadiness, suggestRegion, type GrayFrame, type SceneReview } from "../packages/core/src/scene-review";

const region = { left: 0.2, top: 0.1, right: 0.6, bottom: 0.9, width: 128, height: 224 };
const good: SceneReview = { version: 1, duration: 2, checkpoints: Array.from({ length: 9 }, (_, i) => ({ time: i * 1.9 / 8, region })), observations: { people: "one", shot: "continuous", framing: "cropped", face: "clear", occlusion: "none", reference: "clear" }, appearance: "Red cable-knit sweater, wavy brown hair", motion: "The person turns left and raises a hand", highChange: false, uncertainTracking: false, reviewed: true, acceptRisks: false };

test("readiness requires reviewed coverage, usable reference, scene observations and appearance/movement instructions", () => {
  assert.equal(sceneReadiness(good).ready, true);
  for (const change of [{ reviewed: false }, { appearance: "" }, { motion: "" }, { checkpoints: good.checkpoints.slice(1) }, { observations: EMPTY_OBSERVATIONS }, { observations: { ...good.observations, people: "multiple" as const } }, { observations: { ...good.observations, shot: "cuts" as const } }, { observations: { ...good.observations, reference: "unclear" as const } }]) {
    assert.equal(sceneReadiness({ ...good, ...change }).ready, false);
    assert.throws(() => parseSceneReview({ ...good, ...change }, 2));
  }
});

test("motion/occlusion/crop risks need acknowledgement and do not create invented success scores", () => {
  const risk = { ...good, highChange: true, uncertainTracking: true, appearance: "Red sweater, white trousers and brown boots", observations: { ...good.observations, face: "partial" as const, occlusion: "some" as const } };
  const result = sceneReadiness(risk);
  assert.equal(result.ready, false); assert.equal(result.blockers.length, 0); assert.equal(result.warnings.length, 5);
  assert.equal(sceneReadiness({ ...risk, acceptRisks: true }).ready, true);
  assert.equal("score" in result, false);
});

test("review parsing rejects stale media, malformed timelines, reversed boxes and unbounded instructions", () => {
  assert.deepEqual(parseSceneReview(good, 2), good);
  for (const change of [{ duration: 4 }, { duration: NaN }, { motion: "x".repeat(601) }, { reviewed: "yes" }, { observations: { ...good.observations, face: "invented" } }, { checkpoints: good.checkpoints.map((p) => ({ ...p, time: 0 })) }, { checkpoints: good.checkpoints.map((p) => ({ ...p, region: { ...region, right: 0 } })) }, { checkpoints: good.checkpoints.map((p, i) => ({ ...p, region: { ...region, width: i ? 130 : 128 } })) }]) assert.throws(() => parseSceneReview({ ...good, ...change }, 2));
});

test("the exact prompt uses reviewed appearance and motion, preserves cropped framing and removes the old outfit", () => {
  const prompt = replacementPrompt(good);
  assert.ok(prompt.includes(good.appearance)); assert.ok(prompt.includes(good.motion));
  assert.match(prompt, /Preserve the source crop/); assert.match(prompt, /Do not retain the source person's outfit/);
});

test("mask regions interpolate corrections and clamp at the first/last checkpoint", () => {
  const end = { ...region, left: 0.4, right: 0.8 };
  const points = [{ time: 0, region }, { time: 2, region: end }];
  assert.deepEqual(regionAt(points, -1), region); assert.deepEqual(regionAt(points, 3), end);
  assert.ok(Math.abs(regionAt(points, 1).left - 0.3) < 1e-8);
  assert.ok(Math.abs(regionAt(points, 1).right - 0.7) < 1e-8);
});

test("local tracking measures actual pixel changes, follows a translated textured region and flags flat frames", () => {
  const frame = (shift: number): GrayFrame => {
    const pixels = new Uint8Array(100 * 100);
    for (let y = 10; y < 90; y++) for (let x = 20; x < 60; x++) pixels[y * 100 + x + shift] = (x * 29 + y * 17) % 255;
    return { pixels, width: 100, height: 100 };
  };
  const a = frame(0), b = frame(4);
  assert.equal(frameChange(a, a), 0); assert.ok(frameChange(a, b) > 0);
  const result = suggestRegion(a, b, region);
  assert.ok(Math.abs(result.region.left - 0.24) < 1e-8); assert.equal(result.uncertain, false);
  const flat = { pixels: new Uint8Array(10000), width: 100, height: 100 };
  assert.equal(suggestRegion(flat, flat, region).uncertain, true);
  assert.deepEqual(suggestRegion(flat, flat, region).region, region);
  assert.throws(() => frameChange(a, { ...b, width: 50 }));
});
