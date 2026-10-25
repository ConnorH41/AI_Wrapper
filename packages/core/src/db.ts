import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { Pool } from "pg";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

loadEnv({ path: path.join(repoRoot, ".env") });
loadEnv({ path: path.join(repoRoot, ".env.local") });

export const REPO_ROOT = repoRoot;

// In production the web app must use the pooled connection string and the
// worker the direct one. Locally they are the same embedded server.
export const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@127.0.0.1:54329/ai_wrapper";

let pool: Pool | undefined;

export function db(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: DATABASE_URL, max: 5 });
  }
  return pool;
}

export async function waitForDb(tries = 40): Promise<void> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      await db().query("select 1");
      return;
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw last instanceof Error ? last : new Error("Database is not reachable");
}

export async function query<T = unknown>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await db().query(text, values);
  return result.rows as T[];
}

export async function one<T = unknown>(
  text: string,
  values: unknown[] = [],
): Promise<T | undefined> {
  const rows = await query<T>(text, values);
  return rows[0];
}
