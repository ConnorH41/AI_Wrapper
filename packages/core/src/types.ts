export const PROJECT_STATUSES = [
  "draft",
  "scripting",
  "stills",
  "awaiting_approval",
  "rendering",
  "complete",
  "failed",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type Project = {
  id: string;
  title: string;
  prompt: string;
  status: ProjectStatus;
  aspect: string;
  width: number;
  height: number;
  target_seconds: number;
  consent_attested: boolean;
  script: string | null;
  approved_still_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type AssetKind =
  | "product"
  | "reference"
  | "still"
  | "voice"
  | "video"
  | "final";

export type Asset = {
  id: string;
  project_id: string;
  kind: AssetKind;
  storage_key: string;
  mime: string;
  meta: Record<string, unknown>;
  created_at: string;
};

export type Step = "script" | "stills" | "voice" | "video" | "assembly";

export type Generation = {
  id: string;
  project_id: string;
  step: Step;
  provider: string;
  model: string | null;
  status: "pending" | "running" | "succeeded" | "failed";
  attempt: number;
  is_current: boolean;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  deadline_at: string | null;
  created_at: string;
};

/** A single spoken word and when it is said, used to keep captions aligned. */
export type WordTiming = {
  word: string;
  start: number;
  end: number;
};
