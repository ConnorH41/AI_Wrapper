import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { StillsProvider, VideoProvider } from "@aiw/core";
import { ffmpeg } from "../ffmpeg.js";

/**
 * The free visual path. Stills place the real packshot over a blurred fill of
 * itself, which is the standard vertical-video treatment for a square product
 * photo. Video is a slow pan and zoom over an approved still.
 *
 * `ffmpegVideo` is the seam where a hosted image-to-video provider drops in.
 */

/** Each variant frames the product a little differently so there is a choice. */
const VARIANTS = [0.82, 0.68, 0.94];

export const ffmpegStills: StillsProvider = {
  name: "ffmpeg-packshot",

  async renderStills({ productPath, width, height, count }) {
    const dir = await mkdtemp(path.join(tmpdir(), "aiw-stills-"));
    try {
      const source = `product${path.extname(productPath) || ".jpg"}`;
      await copyFile(productPath, path.join(dir, source));

      const stills: Buffer[] = [];
      for (const scale of VARIANTS.slice(0, count)) {
        const out = `still-${Math.round(scale * 100)}.png`;
        await ffmpeg(
          [
            "-i",
            source,
            "-filter_complex",
            blurredFill(width, height, scale),
            "-frames:v",
            "1",
            out,
          ],
          dir,
        );
        stills.push(await readFile(path.join(dir, out)));
      }

      return {
        data: { stills },
        provider: "ffmpeg-packshot",
        estimatedCostUsd: 0,
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
};

export const ffmpegVideo: VideoProvider = {
  name: "ffmpeg-zoompan",

  async animate({ stillPath, durationSec, width, height }) {
    const dir = await mkdtemp(path.join(tmpdir(), "aiw-video-"));
    try {
      await copyFile(stillPath, path.join(dir, "still.png"));
      const frames = Math.max(1, Math.round(durationSec * 30));

      await ffmpeg(
        [
          "-loop",
          "1",
          "-framerate",
          "30",
          "-i",
          "still.png",
          "-filter_complex",
          // Upscaling before zoompan keeps the zoom from going soft.
          `[0:v]scale=${width * 2}:${height * 2},` +
            `zoompan=z='min(zoom+0.0008,1.4)':d=1:` +
            `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
            `s=${width}x${height}:fps=30[v]`,
          "-map",
          "[v]",
          "-frames:v",
          String(frames),
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-pix_fmt",
          "yuv420p",
          "silent.mp4",
        ],
        dir,
      );

      return {
        data: { video: await readFile(path.join(dir, "silent.mp4")) },
        provider: "ffmpeg-zoompan",
        estimatedCostUsd: 0,
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
};

function blurredFill(width: number, height: number, scale: number): string {
  const fgW = Math.round(width * scale);
  const fgH = Math.round(height * scale);
  return (
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},boxblur=40:3[bg];` +
    `[0:v]scale=${fgW}:${fgH}:force_original_aspect_ratio=decrease[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2`
  );
}
