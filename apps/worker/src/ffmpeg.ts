import { spawn } from "node:child_process";

/**
 * ffmpeg runs with cwd set to the job's scratch directory and is given bare
 * relative filenames. Windows absolute paths contain a drive colon, which
 * collides with filter-graph syntax and is miserable to escape.
 */
export function ffmpeg(args: string[], cwd: string): Promise<void> {
  return run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], cwd);
}

export async function probeDurationSec(
  file: string,
  cwd: string,
): Promise<number> {
  const out = await capture(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ],
    cwd,
  );
  const seconds = Number.parseFloat(out.trim());
  if (!Number.isFinite(seconds)) {
    throw new Error(`Could not read duration of ${file}`);
  }
  return seconds;
}

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell: false });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim()}`));
    });
  });
}

function capture(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim()}`));
    });
  });
}
