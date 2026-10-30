import { config } from "dotenv";
import { spawn } from "node:child_process";
import path from "node:path";

config({ path: "apps/web/.env.local" });
const missing = ["HF_TOKEN", "MOTION_REFERENCE_PATH"].filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error(`Live motion test blocked. Configure ${missing.join(", ")} using a free account and a permitted, non-sensitive portrait.`);
  process.exitCode = 1;
} else {
  const child = spawn(process.execPath, [path.resolve("node_modules/@playwright/test/cli.js"), "test", "--project=chrome", "--grep", "live free-account motion generation"], {
    stdio: "inherit", env: { ...process.env, RUN_LIVE_MOTION_TESTS: "1" }, shell: false,
  });
  child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
}
