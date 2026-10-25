import type { Router } from "@aiw/core";
import { ffmpegStills, ffmpegVideo } from "./providers/ffmpeg-visual.js";
import { mockScript, mockStills, mockVideo, mockVoice } from "./providers/mock.js";
import { ollamaScript } from "./providers/ollama.js";
import { piperVoice } from "./providers/piper.js";

/**
 * Defaults are the free local stack. Set PROVIDERS=mock to run the whole
 * pipeline offline with no model and no ffmpeg at all.
 */
export function buildRouter(): Router {
  if (process.env.PROVIDERS === "mock") {
    return {
      script: mockScript,
      voice: mockVoice,
      stills: mockStills,
      video: mockVideo,
    };
  }

  return {
    script: ollamaScript,
    voice: piperVoice,
    stills: ffmpegStills,
    video: ffmpegVideo,
  };
}
