"use client";
/* eslint-disable @next/next/no-img-element -- Character references stay in browser memory. */

import { CHARACTER_VIEWS, type CharacterView, type CharacterViews } from "@aiw/core/replacement";
import { useObjectUrl } from "@/lib/use-object-url";

function CharacterReference({ image, view }: { image: Blob; view: CharacterView }) {
  const url = useObjectUrl(image);
  return <figure className="min-w-0 space-y-2">
    <img src={url} alt={view === "front" ? "Selected character" : `Selected character ${view} view`} className="h-48 w-full rounded-lg border bg-muted/50 p-2 object-contain" />
    <figcaption className="text-center text-xs capitalize text-muted-foreground">{view} view</figcaption>
  </figure>;
}

export function CharacterReferences({ images }: { images: CharacterViews<Blob | undefined> }) {
  return <div role="group" aria-label="Character views" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
    {CHARACTER_VIEWS.map((view) => {
      const image = images[view];
      return image ? <CharacterReference key={view} image={image} view={view} /> : null;
    })}
  </div>;
}
