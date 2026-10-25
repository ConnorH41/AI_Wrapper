-- Projects move through these states. Chain A ends at awaiting_approval;
-- approving enqueues chain B, which ends at complete.
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  prompt text not null,
  status text not null default 'draft',
  aspect text not null default '9:16',
  width int not null default 1080,
  height int not null default 1920,
  target_seconds int not null default 15,
  consent_attested boolean not null default false,
  script text,
  -- Set when the user approves a still; chain B animates exactly this one.
  approved_still_id uuid,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every file we hold, including the user's uploads and each intermediate.
-- storage_key is opaque to the database; the storage adapter resolves it.
create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null,
  storage_key text not null,
  mime text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists assets_project_kind_idx on assets (project_id, kind);

-- One row per attempt at a pipeline step. Users re-roll, so a project has
-- many generations per step and at most one marked current.
create table if not exists generations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  step text not null,
  provider text not null,
  model text,
  status text not null default 'pending',
  attempt int not null default 1,
  is_current boolean not null default true,
  idempotency_key text unique,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,
  deadline_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists generations_project_step_idx on generations (project_id, step);
create unique index if not exists generations_current_idx
  on generations (project_id, step) where is_current;

-- Append-only record of what every provider call cost. Without this we cannot
-- say what a finished video costs, and pricing depends on that number.
create table if not exists cost_ledger (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  generation_id uuid references generations(id) on delete set null,
  provider text not null,
  model text,
  step text not null,
  status text not null,
  duration_ms int,
  estimated_cost_usd numeric(10, 6) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists cost_ledger_project_idx on cost_ledger (project_id);
