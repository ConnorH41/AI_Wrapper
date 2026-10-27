import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const core = path.dirname(require.resolve("@ffmpeg/core"));
const target = path.resolve("public/vendor/ffmpeg");
async function main() {
  await mkdir(target, { recursive: true });
  for (const name of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) await copyFile(path.join(core, name), path.join(target, name));
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
