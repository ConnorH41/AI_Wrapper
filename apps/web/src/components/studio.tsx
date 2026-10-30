"use client";
/* eslint-disable @next/next/no-img-element -- Session images use local Blob URLs. */

import { useEffect, useRef, useState } from "react";
import { FREE_COST_LABEL } from "@aiw/core/session";
import { api, postJson, RequestError } from "@/lib/client-api";
import { validateImage } from "@/lib/images";
import { useObjectUrl } from "@/lib/use-object-url";
import { MotionTest } from "@/components/motion-test";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function Studio() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [portrait, setPortrait] = useState<Blob>();
  const [portraitMode, setPortraitMode] = useState<"upload" | "prompt">("upload");
  const [avatarPrompt, setAvatarPrompt] = useState("");
  const [consent, setConsent] = useState(false);
  const [task, setTask] = useState<string>();
  const [error, setError] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [motionDirty, setMotionDirty] = useState(false);
  const active = useRef<AbortController | null>(null);
  const portraitUrl = useObjectUrl(portrait);
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
    setPortrait(undefined); setAvatarPrompt(""); setPortraitMode("upload"); setConsent(false);
    setError(""); setMotionDirty(false); setResetKey((value) => value + 1);
  }

  if (authenticated === null) return <p role="status">Checking session…</p>;

  return <div className="space-y-6">
    <div><h1 className="text-2xl font-semibold">Create a character video</h1><p className="mt-1 text-sm text-muted-foreground">Choose a character and a scene to create a moving clip. Keep this tab open until you download.</p></div>
    {error ? <p role="alert" aria-label="Studio error" className="rounded-lg border border-destructive p-4 text-sm text-destructive">{error}</p> : null}
    {!authenticated ? <Card className="max-w-md"><CardHeader><CardTitle>Tester access</CardTitle><CardDescription>Enter the shared password. Your character and scene stay here when you sign in again.</CardDescription></CardHeader>
      <CardContent><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void run("Signing in", async (signal) => { await api("session", postJson({ password }), signal); setPassword(""); setAuthenticated(true); }); }}>
        <Label htmlFor="password">Shared password</Label><Input id="password" type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} />
        <Button disabled={busy} type="submit">Sign in</Button>
      </form></CardContent>
    </Card> : null}
    <div hidden={!authenticated} className="space-y-6">
      <p className="text-sm text-muted-foreground">{FREE_COST_LABEL}. Generation uses shared provider quotas. Your draft is not saved in this app. Refreshing clears it.</p>
      <Card><CardHeader><CardTitle>1. Choose your character</CardTitle><CardDescription>Upload a clear portrait or describe a fictional adult character.</CardDescription></CardHeader><CardContent>
        <fieldset disabled={busy} className="space-y-5">
          <div className="space-y-2"><Label htmlFor="portrait-mode">Character source</Label><select id="portrait-mode" value={portraitMode} onChange={(event) => { setPortraitMode(event.target.value === "prompt" ? "prompt" : "upload"); setPortrait(undefined); setConsent(false); }} className="block h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="upload">Upload a portrait</option><option value="prompt">Describe a fictional character</option></select></div>
          {portraitMode === "upload" ? <div className="space-y-3"><Label htmlFor="portrait-file">Character portrait</Label><input key={`portrait-${resetKey}`} id="portrait-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void run("Checking character image", async (signal) => { await validateImage(file); signal.throwIfAborted(); setPortrait(file); setConsent(false); });
          }} className="block w-full text-sm" /><p className="text-xs text-muted-foreground">JPEG, PNG, or WebP, up to 10 MB. Use a clear, front-facing portrait.</p>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I have the right to use this person’s likeness and their consent to appear in this video.</span></label>
          </div> : <div className="space-y-3"><Label htmlFor="avatar-prompt">Character description</Label><Textarea id="avatar-prompt" maxLength={1700} value={avatarPrompt} onChange={(event) => { setAvatarPrompt(event.target.value); setPortrait(undefined); }} placeholder="A friendly adult with short dark hair, wearing a blue shirt." />
            <p className="text-xs text-muted-foreground">{FREE_COST_LABEL}. Creates one fictional adult portrait.</p>
            <Button type="button" variant="outline" disabled={!avatarPrompt.trim()} onClick={() => void run("Generating character", async (signal) => { const response = await api("avatar", postJson({ prompt: avatarPrompt }), signal); const blob = await response.blob(); await validateImage(blob); signal.throwIfAborted(); setPortrait(blob); })}>{portrait ? "Regenerate character" : "Generate character"}</Button>
          </div>}
          {portraitUrl ? <img src={portraitUrl} alt="Selected character" className="max-h-64 max-w-full rounded-md object-contain" /> : null}
        </fieldset>
      </CardContent></Card>
      <MotionTest key={`motion-${resetKey}`} portrait={portrait} allowed={portraitMode === "prompt" || consent} busy={busy} run={run} onDirtyChange={setMotionDirty} />
      <div className="flex flex-wrap gap-3"><Button type="button" variant="outline" disabled={busy} onClick={reset}>Start over</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => void run("Signing out", async (signal) => { await api("session", { method: "DELETE" }, signal); reset(); setAuthenticated(false); })}>Sign out</Button></div>
    </div>
    {task ? <div role="status" className="sticky bottom-3 space-y-2 rounded-lg border bg-background p-4"><p className="text-sm">{task}…</p><Button type="button" size="sm" variant="outline" onClick={() => active.current?.abort()}>Cancel</Button></div> : null}
  </div>;
}
