import { config } from "dotenv";
import { spawn } from "node:child_process";
import path from "node:path";

config({ path: "apps/web/.env.local" });
const motion = process.argv.includes("--motion");
const names = motion ? ["HF_TOKEN", "MOTION_REFERENCE_PATH"] : ["GEMINI_API_KEY", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "GROQ_API_KEY"];
const missing = names.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error(`Live provider test blocked. Configure ${missing.join(", ")} in apps/web/.env.local using free-tier accounts with paid billing disabled.`);
  process.exitCode = 1;
} else {
  const child = spawn(process.execPath, [path.resolve("node_modules/@playwright/test/cli.js"), "test", "--project=chrome", "--grep", motion ? "live free-account motion generation" : "live provider smoke"], {
    stdio: "inherit", env: { ...process.env, RUN_LIVE_PROVIDER_TESTS: motion ? "0" : "1", RUN_LIVE_MOTION_TESTS: motion ? "1" : "0" }, shell: false,
  });
  child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
}
