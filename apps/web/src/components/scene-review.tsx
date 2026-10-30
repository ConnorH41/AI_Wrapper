"use client";
/* eslint-disable @next/next/no-img-element -- Local, memory-only review frames. */

import { useEffect, useMemo, useState } from "react";
import { parsePersonRegion, type PersonRegion } from "@aiw/core/replacement";
import { EMPTY_OBSERVATIONS, REVIEW, replacementPrompt, sceneReadiness, type Observations, type SceneReview } from "@aiw/core/scene-review";
import { analyzeScene, encodeRegionGuide, type SceneAnalysis, type ReviewFrame } from "@/lib/scene-review";
import { useObjectUrl } from "@/lib/use-object-url";
import { PersonRegionSelector } from "./person-region";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

export type PreparedReview = { review: SceneReview; analysis: SceneAnalysis; mask: Blob };
type Props = { scene: File; region?: PersonRegion; portrait?: Blob; disabled: boolean; run: (label: string, work: (signal: AbortSignal) => Promise<void>) => Promise<void>; onChange: (review: PreparedReview | undefined) => void };
const questions: { key: keyof Observations; label: string; options: [string, string][] }[] = [
  { key: "people", label: "People in the shot", options: [["one", "One person"], ["multiple", "Multiple people"]] },
  { key: "shot", label: "Shot continuity", options: [["continuous", "One continuous shot"], ["cuts", "Contains cuts"]] },
  { key: "framing", label: "Visible body in source", options: [["whole", "Head to toe is visible"], ["cropped", "Body is partly outside the frame"]] },
  { key: "face", label: "Face during movement", options: [["clear", "Clear throughout"], ["partial", "Turns away or partly hidden"], ["hidden", "Hidden throughout"]] },
  { key: "occlusion", label: "Objects crossing the person", options: [["none", "No significant obstruction"], ["some", "Some hands or objects cross"], ["heavy", "Frequent or large obstructions"]] },
  { key: "reference", label: "Character reference detail", options: [["clear", "Face, hair and desired outfit are clear"], ["unclear", "Details are missing or unclear"]] },
];

export function SceneReviewPanel({ scene, region, portrait, disabled, run, onChange }: Props) {
  const [analysis, setAnalysis] = useState<SceneAnalysis>();
  const [frames, setFrames] = useState<ReviewFrame[]>([]);
  const [index, setIndex] = useState(0);
  const [observations, setObservations] = useState<Observations>({ ...EMPTY_OBSERVATIONS });
  const [appearance, setAppearance] = useState("");
  const [motion, setMotion] = useState("");
  const [acceptRisks, setAcceptRisks] = useState(false);
  const portraitUrl = useObjectUrl(portrait);
  useEffect(() => { setAnalysis(undefined); setFrames([]); setIndex(0); }, [scene, region]);
  useEffect(() => { setAppearance(""); setObservations((old) => ({ ...old, reference: "unknown" })); }, [portrait]);
  const review = useMemo<SceneReview | undefined>(() => analysis ? {
    version: 1, duration: analysis.duration, checkpoints: frames.map((frame) => ({ time: frame.time, region: frame.region })),
    observations, appearance, motion, highChange: analysis.maxChange > 0.18, uncertainTracking: analysis.uncertainFrames > 0,
    reviewed: frames.length === REVIEW.samples && frames.every((frame) => frame.reviewed), acceptRisks,
  } : undefined, [analysis, frames, observations, appearance, motion, acceptRisks]);
  useEffect(() => { onChange(undefined); }, [review, portrait, onChange]);
  useEffect(() => { setAcceptRisks(false); }, [frames, observations, appearance, motion]);
  const readiness = review ? sceneReadiness(review) : undefined;
  const selected = frames[index];
  let validRegion = false;
  try { if (selected) { parsePersonRegion(selected.region); validRegion = true; } } catch { /* Correct before confirming. */ }

  function changeFrame(next: PersonRegion | undefined) {
    setFrames((old) => old.map((frame, i) => i === index ? { ...frame, region: next ?? { ...frame.region, right: frame.region.left }, reviewed: false } : frame));
  }
  return <section aria-label="Scene readiness review" className="space-y-6 border-t pt-5">
    <div className="space-y-2"><h3 className="text-lg font-semibold">Check whether this shot is a good fit</h3><p className="max-w-prose text-sm text-muted-foreground">This review stays in your browser and costs nothing. It measures frame changes and suggests moving rectangles. You confirm what is happening in the shot; action recognition and a success probability are not provided.</p></div>
    <Button type="button" variant="outline" disabled={disabled || !region} onClick={() => void run("Analyzing motion locally", async (signal) => {
      if (!region) return;
      const result = await analyzeScene(scene, parsePersonRegion(region), signal);
      signal.throwIfAborted(); setAnalysis(result); setFrames(result.frames); setIndex(0);
    })}>{analysis ? "Analyze scene again" : "Analyze scene locally"}</Button>
    {!region ? <p className="text-sm text-muted-foreground">Mark the person on the first frame above to begin.</p> : null}
    {analysis && selected && review && readiness ? <>
      <details open={!review.reviewed} className="space-y-3">
        <summary className="cursor-pointer text-lg font-semibold">Review movement and editable area{review.reviewed ? " — 9 frames confirmed" : ""}</summary>
        <p className="text-sm tabular-nums">{analysis.duration.toFixed(2)} seconds · {analysis.timings.length} decoded frames · {frames.filter((frame) => frame.reviewed).length} of {REVIEW.samples} review frames confirmed</p>
        <p className="max-w-prose text-sm text-muted-foreground">Suggestions use visual block matching. They can follow the background or miss a moving arm. Correct each frame and watch the source between samples. The final guide interpolates rectangles between your corrections.</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Review timeline">{frames.map((frame, i) => <Button key={i} type="button" size="sm" variant={index === i ? "default" : "outline"} aria-pressed={index === i} disabled={disabled} onClick={() => setIndex(i)} aria-label={`Review frame ${i + 1}${frame.reviewed ? ", confirmed" : ""}`}><span className="tabular-nums">{frame.time.toFixed(2)}s{frame.reviewed ? " · checked" : ""}</span></Button>)}</div>
        <p className="text-sm font-medium">Frame {index + 1} of {REVIEW.samples}{selected.uncertain ? " — weak tracking match; inspect carefully" : ""}</p>
        <PersonRegionSelector frame={{ image: selected.image, width: analysis.width, height: analysis.height }} value={selected.region} disabled={disabled} onChange={changeFrame} />
        <Button type="button" variant="outline" disabled={disabled || !validRegion} onClick={() => { setFrames((old) => old.map((frame, i) => i === index ? { ...frame, reviewed: true } : frame)); setIndex((i) => Math.min(REVIEW.samples - 1, i + 1)); }}>Confirm frame and continue</Button>
      </details>
      <div className="space-y-4 border-t pt-5">
        <h3 className="text-lg font-semibold">Confirm the scene and character</h3>
        <p className="max-w-prose text-sm text-muted-foreground">These observations come from you. Use a short, single-person shot first. A cropped shot can replace the visible person, but cannot reveal clothing outside the camera view.</p>
        <div className="grid items-start gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          {portraitUrl ? <figure className="space-y-2"><img src={portraitUrl} alt="Character appearance reference" className="max-h-72 max-w-full rounded-md object-contain" /><figcaption className="text-xs text-muted-foreground">Match this face, hairstyle and outfit.</figcaption></figure> : <p className="text-sm">Choose a character image above.</p>}
          <div className="grid gap-4 sm:grid-cols-2">{questions.map(({ key, label, options }) => <div key={key} className="space-y-2"><Label htmlFor={`review-${key}`}>{label}</Label><select id={`review-${key}`} value={observations[key]} disabled={disabled} onChange={(event) => setObservations((old) => ({ ...old, [key]: event.target.value }))} className="block min-h-10 w-full rounded-md border border-input bg-background px-2 text-sm"><option value="unknown">Choose an observation</option>{options.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></div>)}</div>
        </div>
        <div className="space-y-2"><Label htmlFor="review-appearance">Appearance that must match</Label><Textarea id="review-appearance" maxLength={REVIEW.textLimit} value={appearance} disabled={disabled} onChange={(event) => setAppearance(event.target.value)} placeholder="Wavy brown hair, red cable-knit sweater. Keep these details throughout the shot." /></div>
        <div className="space-y-2"><Label htmlFor="review-motion">Movement observed in this scene</Label><Textarea id="review-motion" maxLength={REVIEW.textLimit} value={motion} disabled={disabled} onChange={(event) => setMotion(event.target.value)} placeholder="The person turns slightly left and raises their right hand. Camera stays still." /><p className="text-xs text-muted-foreground">Describe what the video actually shows. Changing these words does not create a new action.</p></div>
      </div>
      <div className="space-y-3 border-t pt-5" aria-live="polite">
        <h3 className="text-lg font-semibold">{readiness.blockers.length ? "Scene check: needs review" : readiness.ready ? "Scene check: ready for a short test" : "Scene check: review the risks"}</h3>
        {readiness.blockers.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{readiness.blockers.map((text) => <li key={text}>{text}</li>)}</ul> : null}
        {readiness.warnings.length ? <><ul className="list-disc space-y-1 pl-5 text-sm">{readiness.warnings.map((text) => <li key={text}>{text}</li>)}</ul><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={acceptRisks} disabled={disabled || readiness.blockers.length > 0} onChange={(event) => setAcceptRisks(event.target.checked)} /><span>I reviewed these risks and want a short test.</span></label></> : null}
        <details className="space-y-2"><summary className="cursor-pointer text-sm underline underline-offset-4">Exact generation instructions</summary><p className="max-w-prose whitespace-pre-wrap pt-2 text-sm">{replacementPrompt(review)}</p></details>
        <p className="max-w-prose text-xs text-muted-foreground">Readiness confirms that this preparation is complete. Model quality, facial likeness, background preservation and tracking between reviewed frames remain unverified.</p>
        <Button type="button" variant="outline" disabled={disabled || !portrait || !readiness.ready} onClick={() => void run("Preparing the reviewed edit guide locally", async (signal) => {
          const mask = await encodeRegionGuide(review, analysis.timings, signal);
          signal.throwIfAborted(); onChange({ review, analysis: { ...analysis, frames }, mask });
        })}>Approve scene and prepare guide</Button>
      </div>
    </> : null}
  </section>;
}
