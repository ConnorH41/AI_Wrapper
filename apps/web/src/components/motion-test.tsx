"use client";

import { useEffect, useState } from "react";
import { MOTION, motionMediaUrl, parseMotionJob, type MotionDiagnostics } from "@aiw/core/motion";
import { api, postJson } from "@/lib/client-api";
import { motionPortrait, receiveMotion, validateMotionScene } from "@/lib/motion";
import { useObjectUrl } from "@/lib/use-object-url";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { FullCharacterTest } from "./full-character-test";

type Props = {
  portrait: Blob | undefined;
  allowed: boolean;
  busy: boolean;
  authenticated: boolean;
  pending: boolean;
  onPendingChange: (pending: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
  run: (label: string, work: (signal: AbortSignal) => Promise<void>) => Promise<void>;
};

export function MotionTest({ portrait, allowed, busy, authenticated, pending, onPendingChange, run, onDirtyChange }: Props) {
  const [engine, setEngine] = useState<"full-character" | "free">("full-character");
  const [mode, setMode] = useState<"demo" | "upload">("demo");
  const [scene, setScene] = useState<File>();
  const [demo, setDemo] = useState<string>();
  const [consent, setConsent] = useState(false);
  const [output, setOutput] = useState<Blob>();
  const [notice, setNotice] = useState("");
  const [diagnostics, setDiagnostics] = useState<MotionDiagnostics>();
  const sceneUrl = useObjectUrl(scene);
  const outputUrl = useObjectUrl(output);
  useEffect(() => { setOutput(undefined); setDiagnostics(undefined); setConsent(false); setNotice(""); }, [portrait, allowed, scene, mode, engine]);
  useEffect(() => { if (engine === "free") onDirtyChange(Boolean(scene || demo || output)); }, [scene, demo, output, engine, onDirtyChange]);

  return <Card>
    <CardHeader><CardTitle>2. Scene and motion</CardTitle><CardDescription>Change the whole visible character while following the source motion. Review clothing, hair and body appearance as well as the face.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <div className="space-y-2"><Label htmlFor="replacement-method">Replacement method</Label><select id="replacement-method" value={engine} disabled={busy || pending} onChange={(event) => { setEngine(event.target.value === "free" ? "free" : "full-character"); setScene(undefined); setDemo(undefined); onDirtyChange(false); }} className="block h-10 max-w-full rounded-md border border-input bg-background px-3 text-sm"><option value="full-character">Full character — mask-guided (paid)</option><option value="free">Experimental free preview</option></select></div>
      {engine === "full-character" ? <FullCharacterTest portrait={portrait} allowed={allowed} busy={busy} authenticated={authenticated} run={run} onDirtyChange={onDirtyChange} onPendingChange={onPendingChange} /> : <>
      <p className="max-w-prose text-sm text-muted-foreground">Experimental 2-second, low-resolution preview. Its automatic selection may preserve the source clothing. Use the returned mask to check what was actually editable; full-character quality is not guaranteed.</p>
      <fieldset disabled={busy} className="space-y-4">
        {!portrait || !allowed ? <p className="text-sm">Choose a character above and confirm likeness consent for an uploaded portrait.</p> : <p className="text-sm">Review your character and the source scene before generating.</p>}
        <div className="space-y-2"><Label htmlFor="motion-scene-source">Motion scene source</Label><select id="motion-scene-source" value={mode} onChange={(event) => { setMode(event.target.value === "upload" ? "upload" : "demo"); setScene(undefined); setDemo(undefined); }} className="block h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="demo">Outdoor conversation (provider demo, testing only)</option><option value="upload">Upload my own short scene</option></select></div>
        {mode === "demo" ? <Button type="button" variant="outline" onClick={() => void run("Loading motion scene", async (signal) => {
          const response = await api("motion", postJson({ action: "preview" }), signal);
          const body: unknown = await response.json();
          if (typeof body !== "object" || body === null || !("url" in body)) throw new Error("Invalid motion scene response.");
          signal.throwIfAborted(); setDemo(motionMediaUrl(body.url)); setOutput(undefined); setConsent(false);
        })}>{demo ? "Reload demo scene" : "Load demo scene"}</Button> : <div className="space-y-2"><Label htmlFor="motion-scene-file">Scene video</Label><input id="motion-scene-file" type="file" accept="video/mp4" className="block w-full text-sm" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void run("Checking motion scene", async (signal) => { await validateMotionScene(file); signal.throwIfAborted(); setScene(file); });
        }} /><p className="text-xs text-muted-foreground">MP4 up to 3 MB, 2–15 seconds. Use one clearly visible person and a steady camera. Only the first 2 seconds are generated.</p></div>}
        {(mode === "demo" ? demo : sceneUrl) ? <video controls preload="metadata" src={mode === "demo" ? demo : sceneUrl} aria-label="Source motion scene" className="max-h-80 w-full rounded-md border" /> : null}
        <p className="text-sm text-muted-foreground">$0 within available free quotas. Generation uses the shared Hugging Face free GPU allowance and may queue for several minutes. Source-scene audio is retained; custom speech and lip-sync are not available.</p>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I have permission to use this media and approve sending the character and scene to the public <a href={`https://huggingface.co/spaces/${MOTION.space}`} target="_blank" rel="noreferrer" className="underline">Hugging Face motion demo</a>. I will use non-sensitive media; the provider processes and temporarily hosts these files.</span></label>
        <Button type="button" disabled={!portrait || !allowed || !consent || !(mode === "demo" ? demo : scene)} onClick={() => void run("Generating character replacement", async (signal) => {
          if (!portrait) return;
          setNotice("");
          const form = new FormData();
          form.append("portrait", await motionPortrait(portrait), "portrait.jpg");
          if (mode === "upload" && scene) form.append("scene", scene, "scene.mp4");
          form.append("consent", "yes");
          signal.throwIfAborted();
          const response = await api("motion", { method: "POST", body: form }, signal);
          const job = parseMotionJob(await response.json());
          let completed = false;
          try {
            const video = await receiveMotion(job, signal, setDiagnostics);
            signal.throwIfAborted(); setOutput(video); completed = true;
          } catch (reason) {
            const message = signal.aborted ? "Cancelled. Your inputs are preserved." : reason instanceof Error ? reason.message : "The video could not finish.";
            setNotice(`${message} Remote cancellation is best-effort; a started job may still consume free GPU time.`);
            throw reason;
          } finally {
            if (!completed) {
              await api("motion", postJson({ action: "cancel", ticket: job.cancelTicket }), AbortSignal.timeout(10000)).catch(() => {});
            }
          }
        })}>Generate video</Button>
      </fieldset>
      {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
      {outputUrl ? <div className="space-y-3"><h3 className="font-medium">Your character video</h3><video controls src={outputUrl} aria-label="Generated character replacement" className="max-h-96 w-full rounded-md border" /><a href={outputUrl} download="character-video.mp4" className="inline-block rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Download video</a><p className="text-xs text-muted-foreground">Review identity, facial movement, edges, and scene consistency before using the clip.</p></div> : null}
      {diagnostics ? <details className="space-y-3"><summary className="cursor-pointer text-sm underline underline-offset-4">Review the provider’s edit mask</summary><p className="max-w-prose text-sm text-muted-foreground">White areas should cover the whole person. If the original shirt remains in the background guide, reject the result as a full-character swap. These diagnostics come from the provider.</p><div className="grid gap-4 sm:grid-cols-2">
        {diagnostics.mask ? <div><h4 className="mb-2 text-sm font-medium">Editable region</h4><video controls preload="metadata" src={diagnostics.mask} aria-label="Provider edit mask" className="max-h-72 w-full rounded-md border" /></div> : null}
        {diagnostics.background ? <div><h4 className="mb-2 text-sm font-medium">Preserved background guide</h4><video controls preload="metadata" src={diagnostics.background} aria-label="Provider background guide" className="max-h-72 w-full rounded-md border" /></div> : null}
      </div></details> : null}
      </>}
    </CardContent>
  </Card>;
}
