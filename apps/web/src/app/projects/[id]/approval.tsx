"use client";

import { useState } from "react";
import { approveAction, rejectAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

const COST =
  process.env.NEXT_PUBLIC_CHAIN_B_COST_LABEL ?? "$0.00 — local Piper + ffmpeg";

export function ApprovalGate({
  projectId,
  stills,
}: {
  projectId: string;
  stills: { id: string; url: string }[];
}) {
  const [selected, setSelected] = useState(stills[0]?.id ?? "");

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        {stills.map((still) => {
          const active = still.id === selected;
          return (
            <button
              key={still.id}
              type="button"
              onClick={() => setSelected(still.id)}
              className={`overflow-hidden rounded-xl border-2 bg-secondary ${
                active ? "border-primary" : "border-transparent"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={still.url}
                alt="Generated still"
                className="aspect-[9/16] w-full object-cover"
              />
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border bg-card p-4">
        <p className="text-sm font-medium">Next step cost</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Approving starts voiceover and ffmpeg assembly. {COST}. No hosted
          video model is called.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <form action={approveAction}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="stillId" value={selected} />
          <Button type="submit" disabled={!selected}>
            Approve selected still
          </Button>
        </form>
        <form action={rejectAction}>
          <input type="hidden" name="projectId" value={projectId} />
          <Button type="submit" variant="outline">
            Reject and try again
          </Button>
        </form>
      </div>
    </div>
  );
}
