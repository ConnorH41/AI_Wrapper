"use client";

import { useEffect, useState } from "react";
import { CHARACTER_VIEWS, HIGGSFIELD_MODELS, parseHiggsfieldBudget, parseHiggsfieldJob, parseHiggsfieldQuote, type CharacterViews, type HiggsfieldBudget, type HiggsfieldJob, type HiggsfieldModel, type HiggsfieldQuote } from "@aiw/core/replacement";
import { MOTION } from "@aiw/core/motion";
import { api, postJson } from "@/lib/client-api";
import { motionPortrait, validateMotionScene, validatePlayableVideo } from "@/lib/motion";
import { useObjectUrl } from "@/lib/use-object-url";
import { CharacterReferences } from "./character-references";
import { MediaPreview } from "./media-preview";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

type Props = {
  character: CharacterViews<Blob | undefined>; allowed: boolean; busy: boolean; authenticated: boolean;
  onPendingChange: (pending: boolean) => void; onDirtyChange: (dirty: boolean) => void;
  run: (label: string, work: (signal: AbortSignal) => Promise<void>) => Promise<void>;
};

const dollars = (value: number) => `$${value.toFixed(4)}`;

export function HiggsfieldTest({ character, allowed, busy, authenticated, onPendingChange, onDirtyChange, run }: Props) {
  const [model, setModel] = useState<HiggsfieldModel>("genjutsu");
  const [resolution, setResolution] = useState<"720p" | "1080p">("720p");
  const [scene, setScene] = useState<File>();
  const [appearance, setAppearance] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [uploadConsent, setUploadConsent] = useState(false);
  const [paidConsent, setPaidConsent] = useState(false);
  const [quote, setQuote] = useState<HiggsfieldQuote>();
  const [budget, setBudget] = useState<HiggsfieldBudget>();
  const [job, setJob] = useState<HiggsfieldJob>();
  const [output, setOutput] = useState<Blob>();
  const [timingWarning, setTimingWarning] = useState("");
  const [inspection, setInspection] = useState<{ blob: Blob; reason: string }>();
  const [accepted, setAccepted] = useState(false);
  const [qualityReviewed, setQualityReviewed] = useState(false);
  const [notice, setNotice] = useState("");
  const [setupError, setSetupError] = useState("");
  const sceneUrl = useObjectUrl(scene), outputUrl = useObjectUrl(output);
  const inspectionUrl = useObjectUrl(inspection?.blob);
  const pending = job?.status === "pending" || Boolean(budget?.jobs.some((entry) => entry.status === "pending"));
  const frozen = busy || pending;

  async function refresh(signal: AbortSignal) {
    const response = await api("higgsfield", {}, signal);
    const next = parseHiggsfieldBudget(await response.json());
    signal.throwIfAborted(); setBudget(next); setSetupError("");
    const existing = next.jobs.find((entry) => entry.status === "pending");
    if (existing) setJob(existing);
    else setJob((old) => old ? next.jobs.find((entry) => entry.id === old.id) : undefined);
    return next;
  }

  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    refresh(controller.signal).catch((error: unknown) => { if (!controller.signal.aborted) setSetupError(error instanceof Error ? error.message : "Could not read Higgsfield setup."); });
    return () => controller.abort();
    // refresh only uses stable setters and the response from this request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);
  useEffect(() => {
    setQuote(undefined); setPaidConsent(false); setUploadConsent(false); setReviewed(false); setOutput(undefined); setTimingWarning(""); setInspection(undefined); setAccepted(false); setQualityReviewed(false);
  }, [character, allowed, scene, model, resolution, appearance]);
  useEffect(() => { onPendingChange(pending); return () => onPendingChange(false); }, [pending, onPendingChange]);
  useEffect(() => { onDirtyChange(Boolean(scene || quote || output || inspection || pending)); }, [scene, quote, output, inspection, pending, onDirtyChange]);

  async function download(existing: HiggsfieldJob, signal: AbortSignal) {
    const response = await api("higgsfield", postJson({ action: "download", id: existing.id }), signal);
    const blob = await response.blob();
    const info = await validatePlayableVideo(blob, signal, 0.01, 60);
    signal.throwIfAborted();
    const matchesDuration = Math.abs(info.duration - existing.duration) <= 0.3;
    const roundsUpToWholeSecond = info.duration >= existing.duration && Math.abs(info.duration - Math.ceil(existing.duration)) <= 0.1;
    if ((!matchesDuration && !roundsUpToWholeSecond) || Math.abs(info.width / info.height - existing.width / existing.height) > 0.02) {
      const reason = `Higgsfield returned ${info.duration.toFixed(2)} seconds at ${info.width} × ${info.height}; the source was ${existing.duration.toFixed(2)} seconds at ${existing.width} × ${existing.height}. The duration or aspect ratio differs from the source. This file is available below for unapproved inspection; the earlier result is preserved. No new generation is needed to download it.`;
      setInspection({ blob, reason });
      throw new Error(reason);
    }
    setTimingWarning(matchesDuration ? "" : `Timing differs: the source is ${existing.duration.toFixed(2)} seconds and the result is ${info.duration.toFixed(2)} seconds, consistent with rounding up to a whole second. Review movement speed, the ending and audio synchronization before accepting. The app has not trimmed or retimed the result.`);
    setOutput(blob); setInspection(undefined); setAccepted(false); setQualityReviewed(false);
  }

  async function follow(existing: HiggsfieldJob, signal: AbortSignal) {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(20 * 60 * 1000)]);
    let current = existing;
    while (current.status === "pending") {
      const response = await api("higgsfield", postJson({ action: "status", id: current.id }), deadline);
      current = parseHiggsfieldJob(await response.json()); setJob(current);
      if (current.status !== "pending") break;
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(deadline.reason); };
        const timer = setTimeout(() => { deadline.removeEventListener("abort", abort); resolve(); }, 3000);
        deadline.addEventListener("abort", abort, { once: true });
        if (deadline.aborted) abort();
      });
    }
    await refresh(deadline);
    setQuote(undefined); setPaidConsent(false);
    if (current.status === "completed") {
      await download(current, deadline);
      setNotice("Generation completed. Review the entire clip against the original inputs. Rejecting it will not start another paid request.");
    } else setNotice(current.status === "nsfw" ? "Higgsfield refused the content. Its confirmed reservation was released; no retry was made." : `Higgsfield marked this request ${current.status}. Its confirmed reservation was released.`);
  }

  return <div className="space-y-5">
    <p className="max-w-prose text-sm text-muted-foreground">Replace the complete visible character while asking to preserve the source shot, duration, motion and audio. This direct editing method does not use the VACE rectangle guide. Live quality is unverified.</p>
    {setupError ? <p role="alert" className="text-sm text-destructive">{setupError}</p> : !budget ? <p role="status">Reading local spending controls…</p> : <div className="space-y-2 rounded-lg border p-4 text-sm">
      <p>{budget.configured ? "Higgsfield key is configured. Provider access has not been verified." : "Set HIGGSFIELD_API_KEY in apps/web/.env.local, then restart the server."}</p>
      <p>App budget: $5 total. Reserved or completed: {dollars(budget.used)}. Remaining: {dollars(budget.remaining)}.</p>
      <p className="text-muted-foreground">This local ledger tracks this app's approved quotes or formula reservations, not your provider balance or spending elsewhere. Keep provider auto top-up off. Completed clips can be charged even when their quality is unsuitable.</p>
    </div>}
    <Button type="button" variant="outline" disabled={busy} onClick={() => void run("Reading existing Higgsfield requests", (signal) => refresh(signal).then(() => {}))}>Refresh setup and requests</Button>
    <fieldset disabled={frozen} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="higgs-model">Choose normal Genjutsu or Light</Label><select id="higgs-model" aria-describedby="higgs-model-help" value={model} onChange={(event) => { setModel(event.target.value === "light" ? "light" : "genjutsu"); setScene(undefined); }} className="block min-h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="genjutsu">Genjutsu (normal, default) · 4 to 30 seconds</option><option value="light">Genjutsu Light · 4 to 15 seconds</option></select><p id="higgs-model-help" className="text-xs text-muted-foreground">Selected: {model === "genjutsu" ? "normal Genjutsu" : "Genjutsu Light"}. Both replace the character in your video. Review the price estimate before paying.</p></div><div className="space-y-2"><Label htmlFor="higgs-resolution">Output quality</Label><select id="higgs-resolution" value={resolution} onChange={(event) => setResolution(event.target.value === "1080p" ? "1080p" : "720p")} className="block min-h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="720p">720p</option><option value="1080p">1080p</option></select></div></div>
      <div className="space-y-2"><Label htmlFor="higgs-scene">Source video for Higgsfield</Label><input key={model} id="higgs-scene" type="file" accept="video/mp4" className="block w-full text-sm" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void run("Reading source video", async (signal) => {
          const info = await validateMotionScene(file, HIGGSFIELD_MODELS[model].maxSeconds);
          if (info.duration < 4 || info.width * info.height < 409600) throw new Error("Use a clip at least 4 seconds long with at least 409,600 pixels per frame, such as 720 × 1280.");
          signal.throwIfAborted(); setScene(file);
        });
      }} /><p className="text-xs text-muted-foreground">MP4 up to 100 MB, 4–{HIGGSFIELD_MODELS[model].maxSeconds} seconds, at least 409,600 pixels per frame and at most 4K. Longer clips are rejected rather than silently shortened. Resolution may differ from the source.</p></div>
      {sceneUrl ? <MediaPreview controls src={sceneUrl} aria-label="Higgsfield source scene" className="max-h-80" /> : null}
      <CharacterReferences images={character} />
      <div className="space-y-2"><Label htmlFor="higgs-appearance">Character appearance to preserve</Label><Textarea id="higgs-appearance" maxLength={1700} value={appearance} onChange={(event) => setAppearance(event.target.value)} placeholder="Describe the face, hair, outfit and body appearance that must replace the original person." /></div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={(event) => { setReviewed(event.target.checked); setQuote(undefined); setPaidConsent(false); }} /><span>I watched the source and reviewed the character views and appearance instructions. The source has one clearly visible person in one continuous shot.</span></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={uploadConsent} onChange={(event) => { setUploadConsent(event.target.checked); setQuote(undefined); setPaidConsent(false); }} /><span>I have permission to use all media and approve uploading the selected character views, scene and instructions to Higgsfield to prepare a price estimate. Provider hosting is external; the app cannot guarantee deletion.</span></label>
      <Button type="button" variant="outline" disabled={!budget?.configured || !character.front || !allowed || !scene || appearance.trim().length < 10 || !reviewed || !uploadConsent || budget.remaining <= 0} onClick={() => void run("Uploading references and requesting a price", async (signal) => {
        if (!scene || !character.front) return;
        setQuote(undefined); setPaidConsent(false); setNotice("");
        const form = new FormData();
        const count = CHARACTER_VIEWS.filter((view) => character[view]).length;
        for (const view of CHARACTER_VIEWS) {
          const image = character[view];
          if (image) form.append(view, await motionPortrait(image, Math.floor(MOTION.portraitBytes / count)), `character-${view}.jpg`);
        }
        form.append("scene", scene, "scene.mp4"); form.append("model", model); form.append("resolution", resolution); form.append("appearance", appearance); form.append("consent", "higgsfield-upload");
        signal.throwIfAborted();
        const response = await api("higgsfield", { method: "POST", body: form }, signal);
        const next = parseHiggsfieldQuote(await response.json());
        signal.throwIfAborted(); setQuote(next); await refresh(signal);
      })}>Get price estimate</Button>
      {quote ? <div className="space-y-4 rounded-lg border p-4 text-sm"><p className="font-medium">{quote.pricing === "formula" ? "Calculated budget reservation" : "Account price estimate"}: {dollars(quote.usd)} for the full {quote.duration.toFixed(2)}-second clip at {resolution}.</p><p>{quote.explanation}</p><p>Approval expires at {new Date(quote.expires).toLocaleTimeString()}. The server rechecks the price and billing basis before reserving budget. A change requires a new approval.</p><label className="flex items-start gap-2"><input type="checkbox" checked={paidConsent} onChange={(event) => setPaidConsent(event.target.checked)} /><span>I approve this paid Higgsfield generation and the displayed budget reservation. Formula calculations use list rates before discounts and are not account quotes. Charges apply. Stopping local waiting does not cancel remote work.</span></label><Button type="button" disabled={!paidConsent || !allowed || !reviewed || !uploadConsent || quote.expires <= Date.now()} onClick={() => void run("Generating with Higgsfield", async (signal) => {
        try {
          const response = await api("higgsfield", postJson({ action: "submit", ticket: quote.ticket, consent: "higgsfield-paid" }), signal);
          const next = parseHiggsfieldJob(await response.json()); setJob(next);
          await refresh(signal); await follow(next, signal);
        } catch (error) {
          setPaidConsent(false); setNotice("No automatic retry was made. Refresh requests to recover the existing job. Unresolved submissions keep their budget reserved.");
          await refresh(AbortSignal.timeout(10000)).catch(() => {});
          throw error;
        }
      })}>Generate with Higgsfield</Button></div> : null}
    </fieldset>
    {pending ? <p role="status" className="text-sm">An existing Higgsfield request is running or unresolved. Its budget is reserved and inputs are held. Check that request before starting another.</p> : null}
    {budget?.jobs.length ? <div className="space-y-3 border-t pt-4"><h3 className="font-medium">Existing Higgsfield requests</h3>{budget.jobs.map((entry) => <div key={entry.id} className="flex flex-wrap items-center gap-3 text-sm"><span>{entry.id.slice(0, 8)} · {entry.status} · {dollars(entry.usd)}</span>{entry.recoverable ? <Button type="button" size="sm" variant="outline" disabled={busy || (pending && entry.status !== "pending")} onClick={() => void run("Reading existing Higgsfield result", async (signal) => { setJob(entry); await follow(entry, signal); })}>{entry.status === "completed" ? "Download existing result" : "Check existing request"}</Button> : entry.status === "pending" ? <span>Submission unconfirmed. Check Higgsfield's request history; its reservation is not released automatically.</span> : null}{entry.status === "pending" && entry.recoverable ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run("Requesting Higgsfield cancellation", async (signal) => {
        const response = await api("higgsfield", postJson({ action: "cancel", id: entry.id }), signal);
        setJob(parseHiggsfieldJob(await response.json())); setQuote(undefined); setPaidConsent(false); await refresh(signal);
        setNotice("Queued request canceled. Higgsfield only permits cancellation before processing starts.");
      })}>Cancel queued request</Button> : null}</div>)}</div> : null}
    {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
    {inspection && inspectionUrl ? <section aria-label="Higgsfield mismatched result" className="space-y-4 border-t pt-5"><h3 className="font-medium">Unapproved result: source mismatch</h3><p className="text-sm" role="alert">{inspection.reason}</p><MediaPreview controls src={inspectionUrl} aria-label="Higgsfield mismatched video for inspection" className="max-h-96" /><a href={inspectionUrl} download="unapproved-higgsfield-mismatched.mp4" className="inline-block text-sm underline">Download unapproved mismatched video</a></section> : null}
    {outputUrl ? <section aria-label="Higgsfield result review" className="space-y-4 border-t pt-5"><h3 className="font-medium">Review the complete result</h3>{timingWarning ? <p role="status" className="text-sm">{timingWarning}</p> : null}<MediaPreview controls src={outputUrl} aria-label="Higgsfield generated video" className="max-h-96" /><p className="max-w-prose text-sm text-muted-foreground">Compare against the original source and character references used for this job, especially when recovering an older request. A playable download does not prove appearance or scene fidelity.</p><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={qualityReviewed} disabled={busy} onChange={(event) => { setQualityReviewed(event.target.checked); setAccepted(false); }} /><span>I watched the entire result. Face, hair, clothing and visible body match the original character references; motion, framing, scene and audio match the source without unacceptable artifacts. I reviewed and accept any timing difference described above.</span></label><div className="flex flex-wrap gap-3"><Button type="button" disabled={busy || !qualityReviewed} onClick={() => setAccepted(true)}>Accept this result</Button><Button type="button" variant="outline" disabled={busy} onClick={() => { setAccepted(false); setQualityReviewed(false); setNotice("Result rejected. No paid retry will run automatically."); }}>Reject this result</Button></div><a href={outputUrl} download={accepted ? "approved-higgsfield-character.mp4" : "unapproved-higgsfield-character.mp4"} className="inline-block text-sm underline">{accepted ? "Download approved video" : "Download unapproved video for inspection"}</a></section> : null}
  </div>;
}
