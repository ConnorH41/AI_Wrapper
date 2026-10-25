import {
  getAssets,
  getProject,
  listGenerations,
  projectSpend,
  storage,
} from "@aiw/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Poller } from "@/components/poller";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApprovalGate } from "./approval";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const [stills, finals, generations, spend] = await Promise.all([
    getAssets(id, "still"),
    getAssets(id, "final"),
    listGenerations(id),
    projectSpend(id),
  ]);
  const video = finals.at(-1);
  const failed = generations.find((g) => g.status === "failed");

  return (
    <div className="space-y-8">
      <Poller status={project.status} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Projects
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">{project.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{project.prompt}</p>
        </div>
        <Badge variant="secondary">{project.status.replaceAll("_", " ")}</Badge>
      </div>

      {project.error ? (
        <Card>
          <CardHeader>
            <CardTitle>Failed</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-destructive">
            {project.error}
            {failed?.error && failed.error !== project.error ? (
              <p className="mt-2">{failed.error}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {["scripting", "stills", "rendering"].includes(project.status) ? (
        <p className="text-sm text-muted-foreground">
          Working — this page refreshes every few seconds.
        </p>
      ) : null}

      {project.script ? (
        <Card>
          <CardHeader>
            <CardTitle>Script</CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-relaxed">{project.script}</CardContent>
        </Card>
      ) : null}

      {project.status === "awaiting_approval" && stills.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Approve a still</h2>
          <p className="text-sm text-muted-foreground">
            These are the real packshot, framed three ways. Pick one before any
            video work starts.
          </p>
          <ApprovalGate
            projectId={project.id}
            stills={stills.map((still) => ({
              id: still.id,
              url: storage.publicUrl(still.storage_key),
            }))}
          />
        </section>
      ) : stills.length > 0 ? (
        <section className="grid gap-4 md:grid-cols-3">
          {stills.map((still) => (
            <div key={still.id} className="overflow-hidden rounded-xl border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={storage.publicUrl(still.storage_key)}
                alt=""
                className="aspect-[9/16] w-full object-cover"
              />
            </div>
          ))}
        </section>
      ) : null}

      {video ? (
        <Card>
          <CardHeader>
            <CardTitle>Video</CardTitle>
          </CardHeader>
          <CardContent>
            <video
              controls
              src={storage.publicUrl(video.storage_key)}
              className="aspect-[9/16] w-full max-w-sm rounded-lg bg-black"
            />
          </CardContent>
        </Card>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Recorded spend for this project: ${spend.toFixed(4)}
      </p>
    </div>
  );
}
