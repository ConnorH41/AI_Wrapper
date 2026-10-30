"use client";

import { useEffect, useRef, useState } from "react";
import { parsePersonRegion, REPLACEMENT, type PersonRegion, type ReplacementJob } from "@aiw/core/replacement";
import { api, postJson, RequestError } from "@/lib/client-api";
import { motionPortrait, validateMotionScene } from "@/lib/motion";
import { receiveReplacement } from "@/lib/replacement";
import { useObjectUrl } from "@/lib/use-object-url";
import { PersonRegionSelector } from "./person-region";
import { Button } from "./ui/button";
import { Label } from "./ui/label";

type Props = { portrait?: Blob; allowed: boolean; busy: boolean; authenticated: boolean; onDirtyChange: (dirty: boolean) => void; onPendingChange: (pending: boolean) => void; run: (label: string, work: (signal: AbortSignal) => Promise<void>) => Promise<void> };

export function FullCharacterTest({ portrait, allowed, busy, authenticated, onDirtyChange, onPendingChange, run }: Props) {
  const [available, setAvailable] = useState<boolean>();
  const [scene, setScene] = useState<File>();
  const [region, setRegion] = useState<PersonRegion>();
  const [consent, setConsent] = useState(false);
  const [output, setOutput] = useState<Blob>();
  const [job, setJob] = useState<ReplacementJob>();
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [notice, setNotice] = useState("");
  const requestKey = useRef("");
  const sceneUrl = useObjectUrl(scene);
  const outputUrl = useObjectUrl(output);
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
  useEffect(() => { setOutput(undefined); setConsent(false); setNotice(""); requestKey.current = crypto.randomUUID(); }, [portrait, allowed, scene, region]);
  useEffect(() => { onDirtyChange(Boolean(scene || output || job || unconfirmed)); }, [scene, output, job, unconfirmed, onDirtyChange]);
  useEffect(() => { onPendingChange(Boolean(job) || unconfirmed); return () => onPendingChange(false); }, [job, unconfirmed, onPendingChange]);

  async function finish(existing: ReplacementJob, signal: AbortSignal) {
    try {
      const video = await receiveReplacement(existing, signal);
      signal.throwIfAborted(); setOutput(video); setJob(undefined); requestKey.current = crypto.randomUUID();
      setNotice("Review the whole character before using the result. A playable file does not prove correct clothing or identity.");
    } catch (error) {
      setNotice("This job is kept here. Check its existing result or request cancellation; do not submit a duplicate while its outcome is unknown.");
      throw error;
    }
  }

  return <div className="space-y-5">
    <p className="max-w-prose text-sm text-muted-foreground">Replace the complete visible character, including hair and clothing. Start with a 2–5-second scene; a cropped source cannot show legs or shoes outside the frame. This experimental preview may omit source audio.</p>
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
      {sceneUrl ? <><video controls preload="auto" src={sceneUrl} aria-label="Full-character source scene" className="max-h-80 w-full rounded-md border" /><PersonRegionSelector key={sceneUrl} src={sceneUrl} value={region} disabled={frozen} onChange={setRegion} /></> : null}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I approve paid processing and hosting of this character, scene and selection guide by <a href="https://fal.ai" target="_blank" rel="noreferrer" className="underline">fal</a>. I have permission to use this media. Provider retention is outside this app’s control.</span></label>
      <Button type="button" disabled={!available || !portrait || !allowed || !scene || !region || !consent} onClick={() => void run("Generating full-character preview", async (signal) => {
        if (!portrait || !scene) return;
        const selection = parsePersonRegion(region);
        setNotice("");
        const form = new FormData();
        form.append("portrait", await motionPortrait(portrait), "character.jpg");
        form.append("scene", scene, "scene.mp4"); form.append("region", JSON.stringify(selection));
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
      setJob(undefined); requestKey.current = crypto.randomUUID(); setNotice("Cancellation requested. Started processing may still be billed.");
    })}>Request job cancellation</Button></> : null}<Button type="button" variant="ghost" disabled={busy} onClick={() => {
      if (!window.confirm("Leave this job? This does not stop or refund remote processing. Check the provider request history before starting another.")) return;
      setJob(undefined); setUnconfirmed(false); setConsent(false); requestKey.current = crypto.randomUUID();
      setNotice("This tab is no longer tracking that job. Remote processing may continue; check provider history before requesting another preview.");
    }}>Leave this job</Button></div> : null}
    {notice ? <p role="status" className="max-w-prose text-sm text-muted-foreground">{notice}</p> : null}
    {outputUrl ? <div className="space-y-3"><h3 className="font-medium">Full-character preview</h3><video controls src={outputUrl} aria-label="Full-character result" className="max-h-96 w-full rounded-md border" /><a href={outputUrl} download="full-character-preview.mp4" className="inline-block rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Download full-character preview</a><p className="max-w-prose text-xs text-muted-foreground">Check face, hair, clothing and the complete visible body. Reject a result that retains the source outfit or changes the surrounding scene unexpectedly.</p></div> : null}
  </div>;
}
