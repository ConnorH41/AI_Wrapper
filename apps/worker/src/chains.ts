import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  addAsset,
  assertWithinBudget,
  clearAssets,
  failGeneration,
  finishGeneration,
  getAssets,
  getProject,
  nextAttempt,
  recordCost,
  setScript,
  setStatus,
  startGeneration,
  storage,
  type Project,
  type Result,
  type Step,
} from "@aiw/core";
import { buildSrt } from "./captions.js";
import { ffmpeg, probeDurationSec } from "./ffmpeg.js";
import { buildRouter } from "./router.js";

const router = buildRouter();

/**
 * Chain A is the cheap half: script, then stills. It ends by parking the
 * project at awaiting_approval and does not continue on its own.
 */
export async function runChainA(projectId: string): Promise<void> {
  const project = await load(projectId);

  try {
    await assertWithinBudget(projectId);

    await setStatus(projectId, "scripting");
    const script = await step(project, "script", () =>
      router.script.generateScript({
        title: project.title,
        prompt: project.prompt,
        targetSeconds: project.target_seconds,
      }),
    );
    await setScript(projectId, script.script);

    await setStatus(projectId, "stills");
    const product = (await getAssets(projectId, "product"))[0];
    if (!product) throw new Error("Project has no product photo");

    await clearAssets(projectId, "still");
    const stills = await step(project, "stills", () =>
      router.stills.renderStills({
        productPath: storage.localPath(product.storage_key),
        width: project.width,
        height: project.height,
        count: 3,
      }),
    );

    for (const [index, still] of stills.stills.entries()) {
      const key = `${projectId}/still-${index}.png`;
      await storage.put(key, still, "image/png");
      await addAsset({
        projectId,
        kind: "still",
        storageKey: key,
        mime: "image/png",
      });
    }

    await setStatus(projectId, "awaiting_approval");
  } catch (error) {
    await setStatus(projectId, "failed", message(error));
    throw error;
  }
}

/**
 * Chain B is the expensive half and only ever runs because a human approved a
 * still. It generates the voiceover, animates the approved frame, and muxes
 * the result with burned-in captions.
 */
export async function runChainB(projectId: string): Promise<void> {
  const project = await load(projectId);

  try {
    await assertWithinBudget(projectId);
    if (!project.approved_still_id) {
      throw new Error("Chain B started without an approved still");
    }
    if (!project.script) throw new Error("Chain B started without a script");

    await setStatus(projectId, "rendering");

    const approved = (await getAssets(projectId, "still")).find(
      (asset) => asset.id === project.approved_still_id,
    );
    if (!approved) throw new Error("Approved still is missing");

    const voice = await step(project, "voice", () =>
      router.voice.synthesize({ text: project.script as string }),
    );
    const voiceKey = `${projectId}/voice.wav`;
    await storage.put(voiceKey, voice.audio, "audio/wav");
    await addAsset({
      projectId,
      kind: "voice",
      storageKey: voiceKey,
      mime: "audio/wav",
      meta: { durationSec: voice.durationSec },
    });

    const animated = await step(project, "video", () =>
      router.video.animate({
        stillPath: storage.localPath(approved.storage_key),
        durationSec: voice.durationSec,
        width: project.width,
        height: project.height,
      }),
    );
    const videoKey = `${projectId}/silent.mp4`;
    await storage.put(videoKey, animated.video, "video/mp4");
    await addAsset({
      projectId,
      kind: "video",
      storageKey: videoKey,
      mime: "video/mp4",
    });

    const finalKey = await assemble(project, {
      videoKey,
      voiceKey,
      script: project.script,
      durationSec: voice.durationSec,
      timings: voice.timings,
    });
    await addAsset({
      projectId,
      kind: "final",
      storageKey: finalKey,
      mime: "video/mp4",
    });

    await setStatus(projectId, "complete");
  } catch (error) {
    await setStatus(projectId, "failed", message(error));
    throw error;
  }
}

/** Mux the silent clip with the voiceover and burn in captions. */
async function assemble(
  project: Project,
  input: {
    videoKey: string;
    voiceKey: string;
    script: string;
    durationSec: number;
    timings: Awaited<ReturnType<typeof router.voice.synthesize>>["data"]["timings"];
  },
): Promise<string> {
  const generation = await startGeneration({
    projectId: project.id,
    step: "assembly",
    provider: "ffmpeg",
    idempotencyKey: `${project.id}:assembly:${await nextAttempt(project.id, "assembly")}`,
    input: { durationSec: input.durationSec },
  });

  const started = Date.now();
  const dir = await mkdtemp(path.join(tmpdir(), "aiw-assembly-"));

  try {
    const { copyFile, readFile } = await import("node:fs/promises");
    await copyFile(storage.localPath(input.videoKey), path.join(dir, "silent.mp4"));
    await copyFile(storage.localPath(input.voiceKey), path.join(dir, "voice.wav"));

    const srt = buildSrt(input.script, input.durationSec, input.timings);
    await writeFile(path.join(dir, "captions.srt"), srt, "utf8");

    const style =
      "FontName=Arial,FontSize=16,PrimaryColour=&H00FFFFFF," +
      "OutlineColour=&H00000000,BorderStyle=1,Outline=2,Alignment=2,MarginV=90";

    await ffmpeg(
      [
        "-i",
        "silent.mp4",
        "-i",
        "voice.wav",
        "-vf",
        srt ? `subtitles=captions.srt:force_style='${style}'` : "null",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        "final.mp4",
      ],
      dir,
    );

    const duration = await probeDurationSec("final.mp4", dir);
    const key = `${project.id}/final.mp4`;
    await storage.put(key, await readFile(path.join(dir, "final.mp4")), "video/mp4");

    await finishGeneration(generation.id, { key, duration });
    await recordCost({
      projectId: project.id,
      generationId: generation.id,
      provider: "ffmpeg",
      step: "assembly",
      status: "succeeded",
      durationMs: Date.now() - started,
      estimatedCostUsd: 0,
    });

    return key;
  } catch (error) {
    await failGeneration(generation.id, message(error));
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Wraps one provider call: records the attempt, enforces the step deadline,
 * and writes the cost ledger entry whether it succeeds or fails.
 */
async function step<T>(
  project: Project,
  name: Step,
  call: () => Promise<Result<T>>,
): Promise<T> {
  const attempt = await nextAttempt(project.id, name);
  const generation = await startGeneration({
    projectId: project.id,
    step: name,
    provider: "pending",
    idempotencyKey: `${project.id}:${name}:${attempt}`,
  });

  const started = Date.now();
  try {
    const result = await withDeadline(call(), name);

    await finishGeneration(generation.id, { provider: result.provider });
    await recordCost({
      projectId: project.id,
      generationId: generation.id,
      provider: result.provider,
      model: result.model,
      step: name,
      status: "succeeded",
      durationMs: Date.now() - started,
      estimatedCostUsd: result.estimatedCostUsd,
    });

    return result.data;
  } catch (error) {
    await failGeneration(generation.id, message(error));
    await recordCost({
      projectId: project.id,
      generationId: generation.id,
      provider: "unknown",
      step: name,
      status: "failed",
      durationMs: Date.now() - started,
      estimatedCostUsd: 0,
    });
    throw error;
  }
}

/** Provider polling can hang, so no step is allowed to run unbounded. */
function withDeadline<T>(work: Promise<T>, name: Step): Promise<T> {
  const timeout = Number(process.env.STEP_TIMEOUT_MS ?? 5 * 60 * 1000);
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Step ${name} exceeded ${timeout}ms`)),
        timeout,
      ),
    ),
  ]);
}

async function load(projectId: string): Promise<Project> {
  const project = await getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  return project;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
