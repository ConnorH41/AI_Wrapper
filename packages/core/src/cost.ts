import { one, query } from "./db";
import type { Step } from "./types";

/** Caps exist so a retry loop against a paid provider cannot run away. */
export const MAX_PROJECTS = 50;
export const MAX_GENERATIONS_PER_PROJECT = 40;
export const MAX_SPEND_PER_PROJECT_USD = 2;

export async function recordCost(entry: {
  projectId: string;
  generationId: string | null;
  provider: string;
  model?: string;
  step: Step;
  status: string;
  durationMs: number;
  estimatedCostUsd: number;
}): Promise<void> {
  await query(
    `insert into cost_ledger
       (project_id, generation_id, provider, model, step, status, duration_ms, estimated_cost_usd)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.projectId,
      entry.generationId,
      entry.provider,
      entry.model ?? null,
      entry.step,
      entry.status,
      entry.durationMs,
      entry.estimatedCostUsd,
    ],
  );
}

export async function projectSpend(projectId: string): Promise<number> {
  const row = await one<{ total: string }>(
    `select coalesce(sum(estimated_cost_usd), 0) as total
       from cost_ledger where project_id = $1`,
    [projectId],
  );
  return Number(row?.total ?? 0);
}

export async function assertCanCreateProject(): Promise<void> {
  const row = await one<{ count: string }>(
    `select count(*) as count from projects`,
  );
  if (Number(row?.count ?? 0) >= MAX_PROJECTS) {
    throw new Error(`Hit the project cap of ${MAX_PROJECTS}`);
  }
}

/** Throws before a step runs if the project is over either cap. */
export async function assertWithinBudget(projectId: string): Promise<void> {
  const counts = await one<{ generations: string }>(
    `select count(*) as generations from generations where project_id = $1`,
    [projectId],
  );

  if (Number(counts?.generations ?? 0) >= MAX_GENERATIONS_PER_PROJECT) {
    throw new Error(
      `Project hit the generation cap of ${MAX_GENERATIONS_PER_PROJECT}`,
    );
  }

  const spend = await projectSpend(projectId);
  if (spend >= MAX_SPEND_PER_PROJECT_USD) {
    throw new Error(
      `Project hit the spend cap of $${MAX_SPEND_PER_PROJECT_USD}`,
    );
  }
}
