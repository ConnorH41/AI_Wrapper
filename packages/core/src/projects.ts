import { one, query } from "./db";
import type { Asset, AssetKind, Project, ProjectStatus } from "./types";

export async function createProject(args: {
  title: string;
  prompt: string;
  consentAttested: boolean;
}): Promise<Project> {
  const row = await one<Project>(
    `insert into projects (title, prompt, consent_attested)
     values ($1, $2, $3) returning *`,
    [args.title, args.prompt, args.consentAttested],
  );
  if (!row) throw new Error("Failed to create project");
  return row;
}

export function listProjects(): Promise<Project[]> {
  return query<Project>(`select * from projects order by created_at desc`);
}

export function getProject(id: string): Promise<Project | undefined> {
  return one<Project>(`select * from projects where id = $1`, [id]);
}

export async function setStatus(
  id: string,
  status: ProjectStatus,
  error?: string,
): Promise<void> {
  await query(
    `update projects set status = $2, error = $3, updated_at = now() where id = $1`,
    [id, status, error ?? null],
  );
}

export async function setScript(id: string, script: string): Promise<void> {
  await query(
    `update projects set script = $2, updated_at = now() where id = $1`,
    [id, script],
  );
}

export async function approveStill(
  projectId: string,
  assetId: string,
): Promise<void> {
  await query(
    `update projects set approved_still_id = $2, updated_at = now() where id = $1`,
    [projectId, assetId],
  );
}

export async function addAsset(args: {
  projectId: string;
  kind: AssetKind;
  storageKey: string;
  mime: string;
  meta?: Record<string, unknown>;
}): Promise<Asset> {
  const row = await one<Asset>(
    `insert into assets (project_id, kind, storage_key, mime, meta)
     values ($1, $2, $3, $4, $5) returning *`,
    [
      args.projectId,
      args.kind,
      args.storageKey,
      args.mime,
      args.meta ?? {},
    ],
  );
  if (!row) throw new Error("Failed to record asset");
  return row;
}

export function getAssets(
  projectId: string,
  kind?: AssetKind,
): Promise<Asset[]> {
  if (kind) {
    return query<Asset>(
      `select * from assets where project_id = $1 and kind = $2 order by created_at`,
      [projectId, kind],
    );
  }
  return query<Asset>(
    `select * from assets where project_id = $1 order by created_at`,
    [projectId],
  );
}

/** Replaces a kind wholesale, used when a step re-runs and supersedes output. */
export async function clearAssets(
  projectId: string,
  kind: AssetKind,
): Promise<void> {
  await query(`delete from assets where project_id = $1 and kind = $2`, [
    projectId,
    kind,
  ]);
}
