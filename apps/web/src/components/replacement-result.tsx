"use client";
/* eslint-disable @next/next/no-img-element -- Local, memory-only comparison frames. */

import { useEffect, useState } from "react";
import { sampleResult } from "@/lib/scene-review";
import { useObjectUrl } from "@/lib/use-object-url";
import type { PreparedReview } from "./scene-review";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { MediaPreview } from "./media-preview";

const checks = [
  ["identity", "The face stays consistent with the character reference."],
  ["appearance", "Hair and clothing match; the source outfit is completely replaced."],
  ["motion", "Movement, framing and timing follow the source."],
  ["scene", "The surrounding scene and foreground objects remain acceptable."],
  ["artifacts", "I watched the whole clip and found no unacceptable hands, edges or person remnants."],
] as const;

export function ReplacementResult({ output, prepared, portrait, disabled }: { output: Blob; prepared: PreparedReview; portrait?: Blob; disabled: boolean }) {
  const outputUrl = useObjectUrl(output), portraitUrl = useObjectUrl(portrait);
  const [images, setImages] = useState<string[]>();
  const [frameError, setFrameError] = useState("");
  const [index, setIndex] = useState(0);
  const [checked, setChecked] = useState<string[]>([]);
  const [verdict, setVerdict] = useState<"review" | "accepted" | "rejected">("review");
  const [reason, setReason] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setImages(undefined); setFrameError(""); setChecked([]); setVerdict("review"); setReason(""); setIndex(0);
    sampleResult(output, prepared.review.checkpoints, controller.signal).then((frames) => { if (!controller.signal.aborted) setImages(frames); }).catch(() => { if (!controller.signal.aborted) setFrameError("Frame comparison is unavailable in this browser. Watch the entire preview and source before reviewing the result."); });
    return () => controller.abort();
  }, [output, prepared]);
  return <section aria-label="Replacement quality review" className="space-y-5 border-t pt-5">
    <div className="space-y-2"><h3 className="text-lg font-semibold">Review the result before accepting it</h3><p className="max-w-prose text-sm text-muted-foreground">Passing file checks means the video is playable. Compare the reference, source and result, then watch the entire clip. This is your visual review; no AI likeness score has been assigned.</p></div>
    <MediaPreview controls src={outputUrl} poster={images?.[0]} aria-label="Full-character result" className="max-h-96" />
    <p className="text-xs text-muted-foreground">This appearance test may omit source audio. Audio restoration and synchronization are not verified.</p>
    {images ? <>
      <div role="group" aria-label="Result comparison timeline" className="flex flex-wrap gap-2">{prepared.analysis.frames.map((frame, i) => <Button type="button" size="sm" key={i} variant={index === i ? "default" : "outline"} aria-pressed={index === i} onClick={() => setIndex(i)}><span className="tabular-nums">{frame.time.toFixed(2)}s</span></Button>)}</div>
      <div className="grid items-start gap-4 sm:grid-cols-3">
        {portraitUrl ? <figure><figcaption className="mb-2 text-sm font-medium">Character reference</figcaption><img src={portraitUrl} alt="Quality review character reference" className="h-60 w-full rounded-lg border bg-muted/50 p-2 object-contain" /></figure> : null}
        <figure><figcaption className="mb-2 text-sm font-medium">Source · {prepared.analysis.frames[index].time.toFixed(2)}s</figcaption><img src={prepared.analysis.frames[index].image} alt="Quality review source frame" className="h-60 w-full rounded-lg border bg-muted/50 p-2 object-contain" /></figure>
        <figure><figcaption className="mb-2 text-sm font-medium">Result · matching timestamp</figcaption><img src={images[index]} alt="Quality review generated frame" className="h-60 w-full rounded-lg border bg-muted/50 p-2 object-contain" /></figure>
      </div>
    </> : <p role="status" className="text-sm text-muted-foreground">{frameError || "Preparing local frame comparisons…"}</p>}
    <p className="max-w-prose text-sm"><span className="font-medium">Appearance to match: </span>{prepared.review.appearance}</p>
    <fieldset disabled={disabled} className="space-y-3">
      <div className="divide-y divide-border">{checks.map(([key, label]) => <label key={key} className="flex cursor-pointer items-start gap-3 py-3 text-sm"><input type="checkbox" checked={checked.includes(key)} onChange={(event) => { setVerdict("review"); setChecked((old) => event.target.checked ? [...old, key] : old.filter((v) => v !== key)); }} /><span>{label}</span></label>)}</div>
      <div className="flex flex-wrap items-end gap-3"><Button type="button" disabled={checked.length !== checks.length} onClick={() => setVerdict("accepted")}>Accept this preview</Button><div className="space-y-2"><Label htmlFor="reject-reason">Reason to reject</Label><select id="reject-reason" value={reason} onChange={(event) => setReason(event.target.value)} className="block min-h-10 max-w-full rounded-md border bg-background px-3 text-sm"><option value="">Choose a reason</option><option>Face or identity does not match</option><option>Hair or outfit does not match</option><option>Original person remains visible</option><option>Motion or background changed</option><option>Hands, edges or other artifacts</option></select></div><Button type="button" variant="outline" disabled={!reason} onClick={() => { setVerdict("rejected"); setChecked([]); }}>Reject this preview</Button></div>
    </fieldset>
    <p role="status" className="text-sm font-medium">{verdict === "accepted" ? "Accepted by you after visual review. Longer generation is not started automatically." : verdict === "rejected" ? `Rejected: ${reason}. No automatic paid retry will run.` : "Awaiting your quality review."}</p>
    {verdict === "accepted" ? <a href={outputUrl} download="approved-character-preview.mp4" className="inline-block rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Download approved preview</a> : <a href={outputUrl} download="unreviewed-character-preview.mp4" className="inline-block text-sm underline underline-offset-4">Download unapproved preview for inspection</a>}
  </section>;
}
