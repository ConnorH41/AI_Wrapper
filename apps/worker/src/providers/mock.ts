import type {
  ScriptProvider,
  StillsProvider,
  VideoProvider,
  VoiceProvider,
} from "@aiw/core";

/**
 * Stubs that sleep and return canned output. They keep tests free and offline,
 * and they are how the pipeline was built before any real provider existed.
 * Keep them: they are permanently useful, not scaffolding.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mockScript: ScriptProvider = {
  name: "mock",
  async generateScript({ title }) {
    await sleep(500);
    return {
      data: {
        script: `This is a placeholder voiceover for ${title}. It exists so the pipeline can run without touching a provider.`,
      },
      provider: "mock",
      estimatedCostUsd: 0,
    };
  },
};

export const mockVoice: VoiceProvider = {
  name: "mock",
  async synthesize() {
    await sleep(500);
    return {
      data: { audio: silentWav(5), durationSec: 5, timings: [] },
      provider: "mock",
      estimatedCostUsd: 0,
    };
  },
};

export const mockStills: StillsProvider = {
  name: "mock",
  async renderStills({ count }) {
    await sleep(500);
    return {
      data: { stills: Array.from({ length: count }, () => Buffer.alloc(0)) },
      provider: "mock",
      estimatedCostUsd: 0,
    };
  },
};

export const mockVideo: VideoProvider = {
  name: "mock",
  async animate() {
    await sleep(1000);
    return {
      data: { video: Buffer.alloc(0) },
      provider: "mock",
      estimatedCostUsd: 0,
    };
  },
};

/** A valid silent WAV, so downstream ffmpeg steps have something real to read. */
function silentWav(seconds: number): Buffer {
  const sampleRate = 22050;
  const samples = sampleRate * seconds;
  const data = Buffer.alloc(samples * 2);
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
}
