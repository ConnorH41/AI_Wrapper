import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const PORT = Number(process.env.DEV_DB_PORT ?? 54329);

const pg = new EmbeddedPostgres({
  databaseDir: path.join(repoRoot, ".data", "postgres"),
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: true,
});

async function main() {
  try {
    await pg.initialise();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already|exist|init/i.test(message)) throw error;
  }

  await pg.start();

  try {
    await pg.createDatabase("ai_wrapper");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already|exist/i.test(message)) throw error;
  }

  const { applySchema } = await import("@aiw/core");
  await applySchema();
  console.log(`Postgres ready on 127.0.0.1:${PORT} (database ai_wrapper)`);

  const stop = async () => {
    try {
      await pg.stop();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
