import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { buildCaptions, VIDEO, type WordTiming } from "@aiw/core/session";

export type RenderInput = { scenes: Blob[]; audio: Blob; timings: WordTiming[] };

export async function renderVideo(input: RenderInput, signal: AbortSignal, progress: (percent: number) => void): Promise<Blob> {
  signal.throwIfAborted();
  const { FFmpeg: Engine } = await import("@ffmpeg/ffmpeg");
  const engine: FFmpeg = new Engine();
  const cancel = () => engine.terminate();
  signal.addEventListener("abort", cancel, { once: true });
  const logs: string[] = [];
  engine.on("log", ({ message }) => { logs.push(message); if (logs.length > 12) logs.shift(); });
  engine.on("progress", ({ time }) => progress(Math.min(99, Math.max(0, Math.round(time / 150000)))));
  try {
    signal.throwIfAborted();
    await engine.load({ coreURL: "/vendor/ffmpeg/ffmpeg-core.js", wasmURL: "/vendor/ffmpeg/ffmpeg-core.wasm" }, { signal });
    const font = await fetch("/fonts/Abel-Regular.ttf", { signal });
    if (!font.ok) throw new Error("Caption font is missing. Run npm run assets -w @aiw/web.");
    await engine.writeFile("Abel-Regular.ttf", new Uint8Array(await font.arrayBuffer()));
    for (const [index, blob] of input.scenes.entries()) {
      signal.throwIfAborted();
      await engine.writeFile(`scene-${index}.png`, new Uint8Array(await blob.arrayBuffer()));
    }
    await engine.writeFile("voice.wav", new Uint8Array(await input.audio.arrayBuffer()));
    await engine.writeFile("captions.srt", buildCaptions(input.timings));
    const inputs = [3, 8, 4].flatMap((seconds, index) => ["-loop", "1", "-framerate", "30", "-t", String(seconds), "-i", `scene-${index}.png`]);
    const filters = [
      "[0:v]setsar=1[a]",
      `[1:v]zoompan=z='1+0.025*on/239':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${VIDEO.width}x${VIDEO.height}:fps=30,setsar=1[b]`,
      "[2:v]setsar=1[c]",
      "[a][b][c]concat=n=3:v=1:a=0,subtitles=captions.srt:fontsdir=.:force_style='FontName=Abel,FontSize=12,Outline=1,Shadow=0,MarginV=22'[out]",
    ].join(";");
    const result = await engine.exec([
      "-hide_banner", "-loglevel", "warning", "-filter_complex_threads", "1", ...inputs, "-i", "voice.wav",
      "-filter_complex", filters, "-map", "[out]", "-map", "3:a", "-af", "apad",
      "-t", "15", "-r", "30", "-c:v", "libx264", "-threads", "1", "-preset", "ultrafast", "-crf", "23",
      "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "final.mp4",
    ], 300000, { signal });
    signal.throwIfAborted();
    if (result !== 0) throw new Error(`Browser rendering failed. ${logs.slice(-2).join(" ").slice(0, 300)}`);
    const data = await engine.readFile("final.mp4");
    if (typeof data === "string") throw new Error("The renderer did not return an MP4.");
    progress(100);
    return new Blob([Uint8Array.from(data)], { type: "video/mp4" });
  } catch (error) {
    if (signal.aborted) throw new DOMException("Rendering cancelled. Your inputs are preserved.", "AbortError");
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    engine.terminate();
  }
}
