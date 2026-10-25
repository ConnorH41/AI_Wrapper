import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, DATABASE_URL, waitForDb } from "./db";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function applySchema(): Promise<void> {
  await waitForDb();
  const sql = await readFile(path.join(here, "schema.sql"), "utf8");
  await db().query(sql);
  console.log(`Schema applied to ${DATABASE_URL.replace(/:[^:@]*@/, ":***@")}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).includes("migrate");

if (isMain) {
  applySchema()
    .then(() => db().end())
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
