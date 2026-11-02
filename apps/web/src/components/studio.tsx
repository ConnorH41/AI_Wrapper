"use client";

import { useEffect, useRef, useState } from "react";
import { ImageIcon, Info, LoaderCircle } from "lucide-react";
import { FREE_COST_LABEL } from "@aiw/core/session";
import { type CharacterView, type CharacterViews } from "@aiw/core/replacement";
import { api, postJson, RequestError } from "@/lib/client-api";
import { validateImage } from "@/lib/images";
import { CharacterReferences } from "@/components/character-references";
import { MotionTest } from "@/components/motion-test";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function Studio() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [character, setCharacter] = useState<CharacterViews<Blob | undefined>>({ front: undefined });
  const portrait = character.front;
  const [viewsReviewed, setViewsReviewed] = useState(false);
  const hasExtraViews = Boolean(character.side || character.back);
  const [portraitMode, setPortraitMode] = useState<"upload" | "prompt">("upload");
  const [avatarPrompt, setAvatarPrompt] = useState("");
  const [consent, setConsent] = useState(false);
  const [task, setTask] = useState<string>();
  const [error, setError] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [motionDirty, setMotionDirty] = useState(false);
  const [replacementPending, setReplacementPending] = useState(false);
  const active = useRef<AbortController | null>(null);
  const dirty = Boolean(portrait || avatarPrompt || motionDirty);
  const busy = Boolean(task);

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
        new URL(link.href).pathname !== location.pathname && !window.confirm("Leave this page? Your character, scene, and video will be lost.")) {
        event.preventDefault(); event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", navigation, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", navigation, true); };
  }, [dirty]);

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

  function reset() {
    setCharacter({ front: undefined }); setViewsReviewed(false); setAvatarPrompt(""); setPortraitMode("upload"); setConsent(false);
    setError(""); setMotionDirty(false); setResetKey((value) => value + 1);
  }

  function changeView(view: CharacterView, image: Blob | undefined) {
    setCharacter((old) => view === "front" ? { front: image } : { ...old, [view]: image });
    setConsent(false); setViewsReviewed(false);
  }

  if (authenticated === null) return <p role="status">Checking session…</p>;

  return <div className="space-y-6 sm:space-y-7">
    <div className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Create a character video</h1><p className="max-w-prose text-sm text-muted-foreground">Choose a character, check the scene, then review a short preview.</p></div>
    {error ? <p role="alert" aria-label="Studio error" className="rounded-lg border border-destructive p-4 text-sm text-destructive">{error}</p> : null}
    {!authenticated ? <Card className="max-w-md"><CardHeader><CardTitle>Tester access</CardTitle><CardDescription>Enter the shared password. Your character and scene stay here when you sign in again.</CardDescription></CardHeader>
      <CardContent><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void run("Signing in", async (signal) => { await api("session", postJson({ password }), signal); setPassword(""); setAuthenticated(true); }); }}>
        <Label htmlFor="password">Shared password</Label><Input id="password" type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} />
        <Button className="w-full" disabled={busy} type="submit">Sign in</Button>
      </form></CardContent>
    </Card> : null}
    <div hidden={!authenticated} className="space-y-6">
      <p className="flex max-w-prose items-start gap-2 text-sm text-muted-foreground"><Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><span>Your draft is not saved. Keep this tab open and download before leaving.</span></p>
      <Card><CardHeader><CardTitle>1. Choose your character</CardTitle><CardDescription>Start with a full-body front view. Add side and back views of the same adult character and outfit if available.</CardDescription></CardHeader><CardContent>
        <fieldset disabled={busy || replacementPending} className="min-w-0 space-y-6">
          <div className="min-w-0 space-y-5">
          <div className="space-y-2"><Label htmlFor="portrait-mode">Character source</Label><select id="portrait-mode" value={portraitMode} onChange={(event) => { setPortraitMode(event.target.value === "prompt" ? "prompt" : "upload"); changeView("front", undefined); }} className="block h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="upload">Upload a character image</option><option value="prompt">Describe a fictional character</option></select></div>
          {portraitMode === "upload" ? <div className="space-y-3"><Label htmlFor="portrait-file">Character reference</Label><input key={`portrait-${resetKey}`} id="portrait-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void run("Checking character image", async (signal) => { await validateImage(file); signal.throwIfAborted(); changeView("front", file); });
          }} className="block w-full text-sm" /><p className="text-xs text-muted-foreground">Required front view. JPEG, PNG, or WebP, up to 10 MB per image. Show the face, hair, outfit and full body clearly. Replacing the front view clears the other views.</p>
          </div> : <div className="space-y-3"><Label htmlFor="avatar-prompt">Character description</Label><Textarea id="avatar-prompt" maxLength={1700} value={avatarPrompt} onChange={(event) => { setAvatarPrompt(event.target.value); changeView("front", undefined); }} placeholder="A friendly adult with short dark hair, wearing a blue shirt." />
            <p className="text-xs text-muted-foreground">{FREE_COST_LABEL}. Creates one fictional adult portrait.</p>
            <Button type="button" variant="outline" disabled={!avatarPrompt.trim()} onClick={() => void run("Generating character", async (signal) => { const response = await api("avatar", postJson({ prompt: avatarPrompt }), signal); const blob = await response.blob(); await validateImage(blob); signal.throwIfAborted(); changeView("front", blob); })}>{portrait ? "Regenerate character" : "Generate character"}</Button>
          </div>}
          </div>
          <div className="grid gap-5 sm:grid-cols-2">{(["side", "back"] as const).map((view) => <div key={`${view}-${resetKey}-${Boolean(portrait)}`} className="space-y-2">
            <Label htmlFor={`character-${view}`}>{view === "side" ? "Side view (optional)" : "Back view (optional)"}</Label>
            <input id={`character-${view}`} type="file" value="" accept="image/jpeg,image/png,image/webp" disabled={!portrait} className="block w-full text-sm" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void run(`Checking ${view} view`, async (signal) => { await validateImage(file); signal.throwIfAborted(); changeView(view, file); });
            }} />
            {character[view] ? <Button type="button" size="sm" variant="ghost" onClick={() => changeView(view, undefined)}>Remove {view} view</Button> : null}
          </div>)}</div>
          <p className="text-xs text-muted-foreground">Upload separate images with the same outfit, hairstyle and body proportions. Extra views may help describe appearance; they do not guarantee replacement quality.</p>
          {portrait ? <CharacterReferences images={character} /> : <div className="flex items-center gap-3 py-3 text-sm text-muted-foreground"><ImageIcon aria-hidden="true" className="size-7 shrink-0" /><span>Your character views will appear here.</span></div>}
          {hasExtraViews ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={viewsReviewed} onChange={(event) => setViewsReviewed(event.target.checked)} /><span>I reviewed all views: they show the same adult character, hairstyle, body proportions and outfit.</span></label> : null}
          {portraitMode === "upload" || hasExtraViews ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I have the right to use this person’s likeness and their consent to appear in this video, for every uploaded view.</span></label> : null}
        </fieldset>
      </CardContent></Card>
      <MotionTest key={`motion-${resetKey}`} character={character} allowed={(portraitMode === "prompt" && !hasExtraViews || consent) && (!hasExtraViews || viewsReviewed)} busy={busy} authenticated={authenticated === true} pending={replacementPending} onPendingChange={setReplacementPending} run={run} onDirtyChange={setMotionDirty} />
      <div className="flex flex-wrap gap-2 border-t pt-5"><Button type="button" variant="outline" disabled={busy || replacementPending} onClick={reset}>Start over</Button><Button type="button" variant="ghost" disabled={busy || replacementPending} onClick={() => void run("Signing out", async (signal) => { await api("session", { method: "DELETE" }, signal); reset(); setAuthenticated(false); })}>Sign out</Button></div>
    </div>
    {task ? <div role="status" className="sticky bottom-3 flex items-center justify-between gap-4 rounded-xl border border-input bg-card p-4"><p className="flex items-center gap-3 text-sm"><LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />{task}…</p><Button type="button" size="sm" variant="outline" onClick={() => active.current?.abort()}>Cancel</Button></div> : null}
  </div>;
}
