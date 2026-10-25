import { getAssets, listProjects, storage } from "@aiw/core";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const projects = await listProjects();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Product photo in. Short video out.
          </p>
        </div>
        <Link
          href="/new"
          className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          New project
        </Link>
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No projects yet. Create one to run the pipeline.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {await Promise.all(
            projects.map(async (project) => {
              const stills = await getAssets(project.id, "still");
              const products = await getAssets(project.id, "product");
              const thumb = stills[0] ?? products[0];
              return (
                <Link key={project.id} href={`/projects/${project.id}`}>
                  <Card className="overflow-hidden hover:bg-accent/40">
                    <div className="aspect-[9/16] max-h-72 bg-secondary">
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={storage.publicUrl(thumb.storage_key)}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">{project.title}</CardTitle>
                        <Badge variant="secondary">{project.status.replaceAll("_", " ")}</Badge>
                      </div>
                    </CardHeader>
                  </Card>
                </Link>
              );
            }),
          )}
        </div>
      )}
    </div>
  );
}
