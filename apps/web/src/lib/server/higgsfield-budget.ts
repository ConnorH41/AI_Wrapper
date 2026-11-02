import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { parseHiggsfieldJob, type HiggsfieldBudget, type HiggsfieldJob } from "@aiw/core/replacement";
import { ApiError } from "./http";

export const HIGGSFIELD_BUDGET_UNITS = 5_000_000;
export type BudgetEntry = HiggsfieldJob & { units: number; statusUrl?: string; cancelUrl?: string; outputUrl?: string };
type Ledger = { version: 1; entries: BudgetEntry[] };
const webDirectory = existsSync(path.resolve(process.cwd(), "apps/web/package.json")) ? path.resolve(process.cwd(), "apps/web") : process.cwd();
// shortcut: this ledger coordinates one local machine, use transactional storage before multi-host deployment.
const directory = path.resolve(webDirectory, ".local");
const filename = path.join(directory, "higgsfield-budget.json");

function isMissing(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }

async function acquireLock() {
  for (let attempt = 0; ; attempt++) {
    try { return await open(`${filename}.lock`, "wx", 0o600); }
    catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw new ApiError("missing_configuration", "The local spending ledger cannot be locked. Check filesystem access; spending remains blocked.", 503);
      if (attempt >= 40) throw new ApiError("quota_exhausted", "The local spending ledger is still busy. Try refreshing setup in a moment. If the server crashed, stop it and review the ledger before removing its .lock file.", 409);
      await delay(50);
    }
  }
}

export async function budgetTransaction<T>(work: (ledger: Ledger) => T | Promise<T>): Promise<T> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = await acquireLock();
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    let ledger: Ledger = { version: 1, entries: [] };
    try {
      const value: unknown = JSON.parse(await readFile(filename, "utf8"));
      if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("entries" in value) || !Array.isArray(value.entries)) throw new Error("Invalid ledger");
      const entries: BudgetEntry[] = [];
      for (const candidate of value.entries) {
        const item: unknown = candidate;
        const job = parseHiggsfieldJob(item);
        if (!item || typeof item !== "object" || !("units" in item) || typeof item.units !== "number" || !Number.isSafeInteger(item.units) || item.units < 0 || item.units > HIGGSFIELD_BUDGET_UNITS || job.usd !== item.units / 1_000_000) throw new Error("Invalid entry");
        const fields = Object.fromEntries(Object.entries(item));
        const optionalUrl = (name: string) => {
          const url: unknown = fields[name];
          if (url !== undefined && typeof url !== "string") throw new Error("Invalid job URL");
          return url;
        };
        entries.push({ ...job, units: item.units, statusUrl: optionalUrl("statusUrl"), cancelUrl: optionalUrl("cancelUrl"), outputUrl: optionalUrl("outputUrl") });
      }
      if (new Set(entries.map((entry) => entry.id)).size !== entries.length || entries.reduce((sum, entry) => sum + entry.units, 0) > HIGGSFIELD_BUDGET_UNITS) throw new Error("Invalid ledger totals");
      ledger = { version: 1, entries };
    } catch (error) {
      if (!isMissing(error)) throw new ApiError("missing_configuration", "The local spending ledger cannot be read safely. Generation is blocked; do not delete it to reset spending.", 503);
    }
    const result = await work(ledger);
    await writeFile(temporary, JSON.stringify(ledger), { mode: 0o600, flag: "wx" });
    await rename(temporary, filename);
    return result;
  } finally {
    await unlink(temporary).catch(() => {});
    try { await lock.close(); }
    finally { await unlink(`${filename}.lock`); }
  }
}

export function publicJob(entry: BudgetEntry): HiggsfieldJob {
  return { id: entry.id, status: entry.status, usd: entry.usd, duration: entry.duration, width: entry.width, height: entry.height, recoverable: entry.recoverable };
}

export async function higgsfieldBudget(): Promise<HiggsfieldBudget> {
  return budgetTransaction((ledger) => {
    const used = ledger.entries.reduce((sum, entry) => sum + entry.units, 0);
    return { configured: Boolean(process.env.HIGGSFIELD_API_KEY?.trim()), limit: 5, used: used / 1_000_000, remaining: (HIGGSFIELD_BUDGET_UNITS - used) / 1_000_000, jobs: ledger.entries.slice(-30).map(publicJob).reverse() };
  });
}
