import { one, query } from "./db";
import { STEP_TIMEOUT_MS } from "./queue";
import type { Generation, Step } from "./types";

/**
 * Starting a step supersedes any previous attempt at it, keeping exactly one
 * generation current per (project, step) while preserving the history users
 * need when they re-roll.
 */
export async function startGeneration(args: {
  projectId: string;
  step: Step;
  provider: string;
  model?: string;
  input?: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<Generation> {
  await query(
    `update generations set is_current = false
       where project_id = $1 and step = $2 and is_current`,
    [args.projectId, args.step],
  );

  const attempt = await one<{ next: string }>(
    `select coalesce(max(attempt), 0) + 1 as next
       from generations where project_id = $1 and step = $2`,
    [args.projectId, args.step],
  );

  const row = await one<Generation>(
    `insert into generations
       (project_id, step, provider, model, status, attempt, is_current,
        idempotency_key, input, started_at, deadline_at)
     values ($1, $2, $3, $4, 'running', $5, true, $6, $7, now(), now() + ($8 || ' milliseconds')::interval)
     on conflict (idempotency_key) do nothing
     returning *`,
    [
      args.projectId,
      args.step,
      args.provider,
      args.model ?? null,
      Number(attempt?.next ?? 1),
      args.idempotencyKey,
      args.input ?? {},
      String(STEP_TIMEOUT_MS),
    ],
  );

  if (!row) {
    // The key already exists, so this is a retry of work already done.
    const existing = await one<Generation>(
      `select * from generations where idempotency_key = $1`,
      [args.idempotencyKey],
    );
    if (!existing) throw new Error("Generation conflict without a prior row");
    return existing;
  }

  return row;
}

export async function finishGeneration(
  id: string,
  output: Record<string, unknown>,
): Promise<void> {
  await query(
    `update generations
        set status = 'succeeded', output = $2, finished_at = now()
      where id = $1`,
    [id, output],
  );
}

export async function nextAttempt(
  projectId: string,
  step: Step,
): Promise<number> {
  const row = await one<{ next: string }>(
    `select coalesce(max(attempt), 0) + 1 as next
       from generations where project_id = $1 and step = $2`,
    [projectId, step],
  );
  return Number(row?.next ?? 1);
}

export function listGenerations(projectId: string): Promise<Generation[]> {
  return query<Generation>(
    `select * from generations where project_id = $1 order by created_at desc`,
    [projectId],
  );
}

export async function failGeneration(
  id: string,
  error: string,
): Promise<void> {
  await query(
    `update generations
        set status = 'failed', error = $2, finished_at = now()
      where id = $1`,
    [id, error],
  );
}
