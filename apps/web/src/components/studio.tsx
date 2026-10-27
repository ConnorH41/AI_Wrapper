"use client";
/* eslint-disable @next/next/no-img-element -- Session images use local Blob URLs. */

import { useEffect, useRef, useState } from "react";
import { FREE_COST_LABEL, parseTimings, renderPlan, wavDuration, type ProductInput, type WordTiming } from "@aiw/core/session";
import { api, postJson, RequestError } from "@/lib/client-api";
import { sceneImages, validateImage } from "@/lib/images";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Voice = { blob: Blob; duration: number };
type Preview = { blob: Blob; url: string; label: string };

function useObjectUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) { setUrl(undefined); return; }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

export function Studio() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [product, setProduct] = useState<ProductInput>({ name: "", benefit: "", direction: "" });
  const [packshot, setPackshot] = useState<Blob>();
  const [portrait, setPortrait] = useState<Blob>();
  const [portraitMode, setPortraitMode] = useState<"upload" | "prompt">("upload");
  const [avatarPrompt, setAvatarPrompt] = useState("");
  const [consent, setConsent] = useState(false);
  const [script, setScript] = useState("");
  const [voice, setVoice] = useState<Voice>();
  const [timings, setTimings] = useState<WordTiming[]>([]);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [approved, setApproved] = useState(false);
  const [final, setFinal] = useState<Blob>();
  const [task, setTask] = useState<string>();
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  const active = useRef<AbortController | null>(null);
  const voiceUrl = useObjectUrl(voice?.blob);
  const videoUrl = useObjectUrl(final);
  const productUrl = useObjectUrl(packshot);
  const portraitUrl = useObjectUrl(portrait);
  const dirty = Boolean(packshot || portrait || product.name || script);
  const busy = Boolean(task);
  const canRender = previews.length === 3 && Boolean(voice) && timings.length > 0 &&
    Boolean(product.name.trim() && product.benefit.trim()) && (portraitMode === "prompt" || consent);

  useEffect(() => {
    const controller = new AbortController();
    api("session", {}, controller.signal).then(async (response) => {
      const body: unknown = await response.json();
      setAuthenticated(typeof body === "object" && body !== null && "authenticated" in body && body.authenticated === true);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) { setAuthenticated(false); setError(reason instanceof Error ? reason.message : "Session check failed."); }
    });
    return () => controller.abort();
  }, []);

  useEffect(() => () => active.current?.abort(), []);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigation = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest("a");
      if (link && !link.download && link.target !== "_blank" && !link.href.startsWith("blob:") &&
        new URL(link.href).pathname !== location.pathname && !window.confirm("Leave this page? Your session video and inputs will be lost.")) {
        event.preventDefault(); event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", navigation, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", navigation, true); };
  }, [dirty]);

  useEffect(() => {
    let cancelled = false;
    let urls: string[] = [];
    setPreviews([]);
    if (!packshot || !portrait || !product.name.trim() || !product.benefit.trim()) return;
    const scenes = renderPlan({ name: product.name, benefit: product.benefit, direction: "" });
    sceneImages(packshot, portrait, scenes).then((images) => {
      if (cancelled) return;
      urls = images.map((blob) => URL.createObjectURL(blob));
      setPreviews(images.map((blob, index) => ({ blob, url: urls[index], label: `${scenes[index].start}–${scenes[index].end} seconds` })));
    }).catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Preview failed."); });
    return () => { cancelled = true; urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [packshot, portrait, product.name, product.benefit]);

  function invalidate(kind: "facts" | "script" | "visual") {
    setApproved(false); setFinal(undefined);
    if (kind !== "visual") { setVoice(undefined); setTimings([]); }
    if (kind === "facts") setScript("");
  }

  async function run(label: string, work: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller; setTask(label); setError("");
    try { await work(controller.signal); }
    catch (reason) {
      if (reason instanceof RequestError && reason.status === 401) setAuthenticated(false);
      setError(controller.signal.aborted ? "Cancelled. Your completed inputs are preserved." : reason instanceof Error ? reason.message : "This step failed. Retry it.");
    } finally {
      if (active.current === controller) { active.current = null; setTask(undefined); }
    }
  }

  async function upload(file: File | undefined, kind: "product" | "portrait", signal: AbortSignal) {
    if (!file) return;
    await validateImage(file); signal.throwIfAborted();
    invalidate("visual");
    if (kind === "product") setPackshot(file);
    else { setPortrait(file); setConsent(false); }
  }

  async function generateTimings(blob: Blob, duration: number, signal: AbortSignal) {
    const response = await api("timings", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: blob }, signal);
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null || !("timings" in body)) throw new Error("The timing response was invalid. Retry caption timing.");
    const next = parseTimings(body.timings, duration);
    signal.throwIfAborted(); setTimings(next);
  }

  function reset() {
    setProduct({ name: "", benefit: "", direction: "" }); setPackshot(undefined); setPortrait(undefined);
    setAvatarPrompt(""); setPortraitMode("upload"); setConsent(false); setScript(""); setVoice(undefined);
    setTimings([]); setPreviews([]); setApproved(false); setFinal(undefined); setProgress(0); setError(""); setResetKey((value) => value + 1);
  }

  const factsReady = Boolean(product.name.trim() && product.benefit.trim());
  if (authenticated === null) return <p role="status">Checking session…</p>;

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold">Create a product video</h1><p className="mt-1 text-sm text-muted-foreground">15 seconds · 720p vertical · Desktop Chrome or Edge. Keep this tab open until you download.</p></div>
      {error ? <p role="alert" aria-label="Studio error" className="rounded-lg border border-destructive p-4 text-sm text-destructive">{error}</p> : null}
      {!authenticated ? (
        <Card className="max-w-md"><CardHeader><CardTitle>Tester access</CardTitle><CardDescription>Enter the shared password. Existing session inputs stay here when you sign in again.</CardDescription></CardHeader>
          <CardContent><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void run("Signing in", async (signal) => { await api("session", postJson({ password }), signal); setPassword(""); setAuthenticated(true); }); }}>
            <Label htmlFor="password">Shared password</Label><Input id="password" type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} />
            <Button disabled={busy} type="submit">Sign in</Button>
          </form></CardContent>
        </Card>
      ) : null}
      <div hidden={!authenticated} className="space-y-6">
        <p className="text-sm text-muted-foreground">{FREE_COST_LABEL}. Generation uses shared provider quotas. Nothing is saved after a refresh.</p>
        <Card><CardHeader><CardTitle>1. Product and presenter</CardTitle></CardHeader><CardContent>
          <fieldset disabled={busy} className="space-y-5">
            <div className="space-y-2"><Label htmlFor="product-file">Product photo</Label><input key={`product-${resetKey}`} id="product-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; void run("Checking product image", (signal) => upload(file, "product", signal)); }} className="block w-full text-sm" /><p className="text-xs text-muted-foreground">JPEG, PNG, or WebP, up to 10 MB. Your real product photo stays in the browser.</p>
              {productUrl ? <img src={productUrl} alt="Uploaded product" className="max-h-40 max-w-full object-contain" /> : null}
            </div>
            {([['name', 'Product name', 100], ['benefit', 'Factual product benefit', 300], ['direction', 'Creative direction (optional)', 500]] as const).map(([name, label, max]) => (
              <div key={name} className="space-y-2"><Label htmlFor={name}>{label}</Label><Input id={name} value={product[name]} maxLength={max} onChange={(event) => { setProduct({ ...product, [name]: event.target.value }); invalidate("facts"); }} /></div>
            ))}
            <div className="space-y-2"><Label htmlFor="portrait-mode">Presenter source</Label><select id="portrait-mode" value={portraitMode} onChange={(event) => { setPortraitMode(event.target.value === "prompt" ? "prompt" : "upload"); setPortrait(undefined); setConsent(false); invalidate("visual"); }} className="block h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="upload">Upload a portrait</option><option value="prompt">Describe a fictional presenter</option></select></div>
            {portraitMode === "upload" ? (
              <div className="space-y-3"><Label htmlFor="portrait-file">Presenter portrait</Label><input key={`portrait-${resetKey}`} id="portrait-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; void run("Checking presenter image", (signal) => upload(file, "portrait", signal)); }} className="block w-full text-sm" />
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={(event) => { setConsent(event.target.checked); invalidate("visual"); }} /><span>I have the right to use this person’s likeness and their consent to appear in this video.</span></label>
              </div>
            ) : (
              <div className="space-y-3"><Label htmlFor="avatar-prompt">Presenter description</Label><Textarea id="avatar-prompt" maxLength={1700} value={avatarPrompt} onChange={(event) => { setAvatarPrompt(event.target.value); setPortrait(undefined); invalidate("visual"); }} placeholder="A friendly adult presenter with short dark hair, wearing a blue shirt." />
                <p className="text-xs text-muted-foreground">{FREE_COST_LABEL}. Creates one fictional adult portrait.</p>
                <Button type="button" variant="outline" disabled={!avatarPrompt.trim()} onClick={() => void run("Generating portrait", async (signal) => { const response = await api("avatar", postJson({ prompt: avatarPrompt }), signal); const blob = await response.blob(); await validateImage(blob); signal.throwIfAborted(); invalidate("visual"); setPortrait(blob); })}>{portrait ? "Regenerate portrait" : "Generate portrait"}</Button>
              </div>
            )}
            {portraitUrl ? <img src={portraitUrl} alt="Selected presenter portrait" className="max-h-48 max-w-full object-contain" /> : null}
          </fieldset>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>2. Script and narration</CardTitle><CardDescription>Review the copy before generating speech. Presenter portraits remain still; this version has no lip-sync.</CardDescription></CardHeader><CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">{FREE_COST_LABEL}. Each generation is an explicit request.</p>
          <Button type="button" variant="outline" disabled={busy || !factsReady} onClick={() => void run("Generating script", async (signal) => {
            const response = await api("script", postJson(product), signal); const body: unknown = await response.json();
            if (typeof body !== "object" || body === null || !("script" in body) || typeof body.script !== "string") throw new Error("Invalid script response.");
            signal.throwIfAborted(); invalidate("script"); setScript(body.script);
          })}>{script ? "Regenerate script" : "Generate script"}</Button>
          <div className="space-y-2"><Label htmlFor="script">Editable spoken script</Label><Textarea id="script" maxLength={1200} rows={4} disabled={busy} value={script} onChange={(event) => { setScript(event.target.value); invalidate("script"); }} /><p className="text-xs text-muted-foreground">Aim for about 30 words. Narration over 15 seconds requires shorter copy.</p></div>
          <Button type="button" disabled={busy || !script.trim()} onClick={() => void run("Generating narration", async (signal) => {
            const response = await api("voice", postJson({ script }), signal); const blob = await response.blob();
            const duration = wavDuration(new Uint8Array(await blob.arrayBuffer()));
            if (duration > 15) throw new Error("Narration exceeds 15 seconds. Shorten the script and regenerate.");
            signal.throwIfAborted(); setVoice({ blob, duration }); setTimings([]); setApproved(false); setFinal(undefined);
          })}>{voice ? "Regenerate narration" : "Generate narration"}</Button>
          {voice && voiceUrl ? <div className="space-y-2"><audio controls src={voiceUrl} className="w-full" aria-label="Narration preview" /><p className="text-sm">Narration: {voice.duration.toFixed(1)} seconds. The video will be 15 seconds.</p>
            <p className="text-xs text-muted-foreground">{FREE_COST_LABEL}. Caption timing reuses this audio.</p>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void run("Generating caption timings", async (signal) => { setApproved(false); setFinal(undefined); await generateTimings(voice.blob, voice.duration, signal); })}>{timings.length ? "Regenerate caption timings" : "Generate caption timings"}</Button>
          </div> : null}
          {timings.length ? <div className="rounded-md border p-3"><p className="text-sm font-medium">Caption transcript</p><p className="mt-1 text-sm">{timings.map(({ word }) => word).join(" ")}</p><p className="mt-2 text-xs text-muted-foreground">Check product names before approval.</p></div> : null}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>3. Approve and export</CardTitle><CardDescription>Review every scene and the narration before creating the MP4.</CardDescription></CardHeader><CardContent className="space-y-5">
          {previews.length ? <div className="grid gap-4 md:grid-cols-3">{previews.map((preview) => <figure key={preview.url}><img src={preview.url} alt={`Scene preview, ${preview.label}`} className="aspect-[9/16] w-full rounded-md border" /><figcaption className="mt-2 text-sm">{preview.label}</figcaption></figure>)}</div> : <p className="text-sm text-muted-foreground">Add both images, a product name, and a benefit to prepare the three scene previews.</p>}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={approved} disabled={busy || !canRender} onChange={(event) => setApproved(event.target.checked)} /><span>I approve these scenes, the narration, and the caption transcript.</span></label>
          <p className="text-sm text-muted-foreground">Export cost: $0. Rendering uses this computer’s browser and keeps the actual product photo intact.</p>
          <Button type="button" disabled={busy || !canRender || !approved} onClick={() => void run("Rendering video", async (signal) => {
            if (!voice) return;
            setProgress(0); setFinal(undefined);
            const { renderVideo } = await import("@/lib/render");
            const result = await renderVideo({ scenes: previews.map(({ blob }) => blob), audio: voice.blob, timings }, signal, setProgress);
            signal.throwIfAborted(); setFinal(result);
          })}>Create MP4</Button>
          {videoUrl ? <div className="space-y-3"><video src={videoUrl} controls className="aspect-[9/16] w-full max-w-sm rounded-md border" aria-label="Finished product video" /><a className="inline-block rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground" href={videoUrl} download="product-video.mp4">Download MP4</a></div> : null}
        </CardContent></Card>
        <div className="flex flex-wrap gap-3"><Button type="button" variant="outline" disabled={busy} onClick={reset}>Start over</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => void run("Signing out", async (signal) => { await api("session", { method: "DELETE" }, signal); reset(); setAuthenticated(false); })}>Sign out</Button></div>
      </div>
      {task ? <div role="status" className="sticky bottom-3 space-y-2 rounded-lg border bg-background p-4"><p className="text-sm">{task}{task === "Rendering video" ? ` · ${progress}%` : "…"}</p>{task === "Rendering video" ? <progress aria-label="Video rendering progress" value={progress} max={100} className="w-full" /> : null}<Button type="button" size="sm" variant="outline" onClick={() => active.current?.abort()}>Cancel</Button></div> : null}
    </div>
  );
}
