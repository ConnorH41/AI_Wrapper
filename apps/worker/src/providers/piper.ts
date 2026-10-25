import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { VoiceProvider } from "@aiw/core";
import { probeDurationSec } from "../ffmpeg.js";

const PIPER = process.env.PIPER_PATH ?? "C:\\Users\\hardi\\tools\\piper\\piper.exe";
const VOICE =
  process.env.PIPER_VOICE ??
  "C:\\Users\\hardi\\tools\\piper\\voices\\en_US-lessac-medium.onnx";

export const piperVoice: VoiceProvider = {
  name: "piper",

  async synthesize({ text }) {
    const dir = await mkdtemp(path.join(tmpdir(), "aiw-voice-"));
    try {
      await synth(text, path.join(dir, "voice.wav"));
      const audio = await readFile(path.join(dir, "voice.wav"));
      const durationSec = await probeDurationSec("voice.wav", dir);

      return {
        // Piper reports no word timings, so captions fall back to even
        // distribution across the measured duration.
        data: { audio, durationSec, timings: [] },
        provider: "piper",
        model: path.basename(VOICE),
        estimatedCostUsd: 0,
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
};

function synth(text: string, outFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(PIPER, ["--model", VOICE, "--output_file", outFile], {
      shell: false,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`piper exited ${code}: ${stderr.trim()}`));
    });
    child.stdin.end(text);
  });
}
