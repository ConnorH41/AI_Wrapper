"use client";

import { useEffect, useRef, useState } from "react";
import { REPLACEMENT, type PersonRegion, type ReplacementJob } from "@aiw/core/replacement";
import { api, postJson, RequestError } from "@/lib/client-api";
import { motionPortrait, validateMotionScene } from "@/lib/motion";
import { receiveReplacement } from "@/lib/replacement";
import { useObjectUrl } from "@/lib/use-object-url";
import { PersonRegionSelector } from "./person-region";
import { SceneReviewPanel, type PreparedReview } from "./scene-review";
import { ReplacementResult } from "./replacement-result";
import { Button } from "./ui/button";
import { Label } from "./ui/label";

type Props = { portrait?: Blob; allowed: boolean; busy: boolean; authenticated: boolean; onDirtyChange: (dirty: boolean) => void; onPendingChange: (pending: boolean) => void; run: (label: string, work: (signal: AbortSignal) => Promise<void>) => Promise<void> };

export function FullCharacterTest({ portrait, allowed, busy, authenticated, onDirtyChange, onPendingChange, run }: Props) {
  const [available, setAvailable] = useState<boolean>();
  const [scene, setScene] = useState<File>();
  const [region, setRegion] = useState<PersonRegion>();
  const [prepared, setPrepared] = useState<PreparedReview>();
  const [approved, setApproved] = useState(false);
  const [consent, setConsent] = useState(false);
  const [output, setOutput] = useState<Blob>();
  const [job, setJob] = useState<ReplacementJob>();
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [notice, setNotice] = useState("");
  const requestKey = useRef("");
  const sceneUrl = useObjectUrl(scene);
  const guideUrl = useObjectUrl(prepared?.mask);
  const frozen = busy || Boolean(job) || unconfirmed;

  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    api("replacement", {}, controller.signal).then(async (response) => {
      const config: unknown = await response.json();
      setAvailable(Boolean(config && typeof config === "object" && "available" in config && config.available === true));
    }).catch(() => { if (!controller.signal.aborted) setAvailable(false); });
    return () => controller.abort();
  }, [authenticated]);
  useEffect(() => { setOutput(undefined); setConsent(false); setApproved(false); setNotice(""); requestKey.current = crypto.randomUUID(); }, [portrait, allowed, scene, region, prepared]);
  useEffect(() => { onDirtyChange(Boolean(scene || output || job || unconfirmed)); }, [scene, output, job, unconfirmed, onDirtyChange]);
  useEffect(() => { onPendingChange(Boolean(job) || unconfirmed); return () => onPendingChange(false); }, [job, unconfirmed, onPendingChange]);

  async function finish(existing: ReplacementJob, signal: AbortSignal) {
    try {
      const video = await receiveReplacement(existing, signal);
      signal.throwIfAborted(); setOutput(video); setJob(undefined); setConsent(false); requestKey.current = crypto.randomUUID();
      setNotice("Review the whole character before using the result. A playable file does not prove correct clothing or identity.");
    } catch (error) {
      setNotice("This job is kept here. Check its existing result or request cancellation; do not submit a duplicate while its outcome is unknown.");
      throw error;
    }
  }

  return <div className="space-y-5">
    <p className="max-w-prose text-sm text-muted-foreground">Review the scene locally, confirm the character and movement, then generate a 2–5-second test. Accuracy comes before longer clips. This experimental preview may omit source audio.</p>
    {available === false ? <p role="status" className="rounded-md border p-4 text-sm">Full-character generation is not enabled on this server yet. Paid-provider credentials and spending controls must be configured first. You can prepare your selection below or explicitly choose the experimental free preview.</p> : available === undefined ? <p role="status" className="text-sm">Checking full-character availability…</p> : <p className="text-sm font-medium">Paid processing by fal. Provider charges apply; no free fallback.</p>}
    <fieldset disabled={frozen} className="space-y-4">
      <div className="space-y-2"><Label htmlFor="replacement-scene">Short scene for full-character replacement</Label><input id="replacement-scene" type="file" accept="video/mp4" className="block w-full text-sm" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void run("Checking replacement scene", async (signal) => {
          const info = await validateMotionScene(file);
          if (info.duration > REPLACEMENT.maxSeconds + 0.1 || info.width > REPLACEMENT.maxDimension || info.height > REPLACEMENT.maxDimension || info.width * info.height > 1920 * 1080) throw new Error("Choose a 2–5-second MP4 up to 3 MB and no larger than 1080p. Trim longer scenes first.");
          signal.throwIfAborted(); setScene(file); setRegion(undefined);
        });
      }} /><p className="text-xs text-muted-foreground">MP4 up to 3 MB. One clearly visible person, 2–5 seconds, at most 1080p.</p></div>
      {sceneUrl && scene ? <details open={!prepared} className="space-y-4"><summary className="cursor-pointer text-base font-semibold underline underline-offset-4">{prepared ? "Scene preparation — approved; open to edit" : "Review scene preparation"}</summary><video controls preload="auto" src={sceneUrl} aria-label="Full-character source scene" className="max-h-80 w-full rounded-md border" /><details className="space-y-3" open={!prepared}><summary className="cursor-pointer text-sm font-medium">Mark the person on the first frame</summary><PersonRegionSelector key={sceneUrl} src={sceneUrl} value={region} disabled={frozen} onChange={setRegion} /></details><SceneReviewPanel key={`review-${sceneUrl}`} scene={scene} region={region} portrait={portrait} disabled={frozen} run={run} onChange={setPrepared} /></details> : null}
      {prepared && guideUrl ? <div className="space-y-3 border-t pt-5"><h3 className="text-lg font-semibold">Inspect the prepared edit guide</h3><video controls src={guideUrl} aria-label="Prepared whole-person edit guide" className="max-h-80 w-full rounded-md border" /><p className="max-w-prose text-sm text-muted-foreground">White is editable; black guides scene preservation. This timed guide uses your reviewed rectangles and source-frame timing. It does not isolate hair strands, hands or foreground objects.</p><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={approved} onChange={(event) => { setApproved(event.target.checked); setConsent(false); }} /><span>I reviewed the scene, edit guide and generation instructions for this short test.</span></label></div> : null}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I approve paid processing and hosting of this character, scene, reviewed instructions and edit guide by <a href="https://fal.ai" target="_blank" rel="noreferrer" className="underline">fal</a>. I have permission to use this media. Provider retention is outside this app’s control.</span></label>
      <Button type="button" disabled={!available || !portrait || !allowed || !scene || !prepared || !approved || !consent} onClick={() => void run("Generating full-character preview", async (signal) => {
        if (!portrait || !scene || !prepared || !approved) return;
        setNotice("");
        const form = new FormData();
        form.append("portrait", await motionPortrait(portrait), "character.jpg");
        form.append("scene", scene, "scene.mp4"); form.append("review", JSON.stringify(prepared.review));
        form.append("mask", prepared.mask, "reviewed-edit-guide.mp4");
        form.append("consent", "fal-paid"); form.append("requestKey", requestKey.current);
        signal.throwIfAborted();
        let next: ReplacementJob;
        try {
          const response = await api("replacement", { method: "POST", body: form }, signal);
          const body: unknown = await response.json();
          if (!body || typeof body !== "object" || !("ticket" in body) || typeof body.ticket !== "string" || body.ticket.length > 1024) throw new Error("The provider did not return a recoverable job.");
          next = { ticket: body.ticket };
        } catch (error) {
          const rejectedBeforeSubmission = error instanceof RequestError && [400, 401, 403, 413, 415].includes(error.status);
          if (!rejectedBeforeSubmission) {
            setUnconfirmed(true);
            setNotice("Submission was not confirmed, but work may already have started. Inputs are held. Check provider history before explicitly leaving this request; no automatic retry will be made.");
          }
          throw error;
        }
        setJob(next); await finish(next, signal);
      })}>Generate full-character preview</Button>
    </fieldset>
    {job || unconfirmed ? <div className="flex flex-wrap gap-3">{job ? <><Button type="button" variant="outline" disabled={busy} onClick={() => void run("Checking existing replacement", (signal) => finish(job, signal))}>Check existing job</Button><Button type="button" variant="outline" disabled={busy} onClick={() => void run("Requesting cancellation", async (signal) => {
      await api("replacement", postJson({ action: "cancel", ticket: job.ticket }), signal);
      setJob(undefined); setConsent(false); requestKey.current = crypto.randomUUID(); setNotice("Cancellation requested. Started processing may still be billed.");
    })}>Request job cancellation</Button></> : null}<Button type="button" variant="ghost" disabled={busy} onClick={() => {
      if (!window.confirm("Leave this job? This does not stop or refund remote processing. Check the provider request history before starting another.")) return;
      setJob(undefined); setUnconfirmed(false); setConsent(false); requestKey.current = crypto.randomUUID();
      setNotice("This tab is no longer tracking that job. Remote processing may continue; check provider history before requesting another preview.");
    }}>Leave this job</Button></div> : null}
    {notice ? <p role="status" className="max-w-prose text-sm text-muted-foreground">{notice}</p> : null}
    {output && prepared ? <ReplacementResult output={output} prepared={prepared} portrait={portrait} disabled={frozen} /> : null}
  </div>;
}
