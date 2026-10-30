"use client";

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { parsePersonRegion, type PersonRegion } from "@aiw/core/replacement";
import { Button } from "./ui/button";

type Props = { src?: string; frame?: { image: string; width: number; height: number }; disabled: boolean; value?: PersonRegion; onChange: (region: PersonRegion | undefined) => void };

export function PersonRegionSelector({ src, frame, disabled, value, onChange }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [start, setStart] = useState<{ x: number; y: number }>();
  const helpId = useId();
  const frameImage = frame?.image, frameWidth = frame?.width, frameHeight = frame?.height;
  useEffect(() => {
    if (!frameImage || !frameWidth || !frameHeight) return;
    const image = new Image(); let current = true;
    image.onload = () => {
      if (!current || !canvas.current) return;
      canvas.current.width = frameWidth; canvas.current.height = frameHeight;
      canvas.current.getContext("2d")?.drawImage(image, 0, 0, frameWidth, frameHeight);
      setSize({ width: frameWidth, height: frameHeight });
    };
    image.src = frameImage;
    return () => { current = false; image.onload = null; };
  }, [frameImage, frameWidth, frameHeight]);
  let valid = false;
  try { if (value) { parsePersonRegion(value); valid = true; } } catch { /* Keep the invalid box editable. */ }

  function point(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!start || !size || disabled) return;
    const end = point(event);
    onChange({ ...size, left: Math.min(start.x, end.x), top: Math.min(start.y, end.y), right: Math.max(start.x, end.x), bottom: Math.max(start.y, end.y) });
  }
  return <div className="space-y-3">
    <p id={helpId} className="max-w-prose text-sm">Include the whole visible person: hair, clothes, arms and legs, with room for the new silhouette. The rectangle also includes background; it is an editable region, not a person-shaped mask.</p>
    {src ? <video src={src} preload="auto" muted className="hidden" onLoadedData={(event) => {
      const video = event.currentTarget;
      const target = canvas.current;
      if (!target) return;
      target.width = video.videoWidth; target.height = video.videoHeight;
      target.getContext("2d")?.drawImage(video, 0, 0);
      setSize({ width: video.videoWidth, height: video.videoHeight });
    }} /> : null}
    <div role="group" aria-label="Whole-person region" aria-describedby={helpId} style={{ width: size ? Math.min(480, 320 * size.width / size.height) : 240 }} className={`relative max-w-full touch-none overflow-hidden rounded-md ${disabled ? "opacity-60" : "cursor-crosshair"}`}
      onPointerDown={(event) => { if (!disabled && size) { event.currentTarget.setPointerCapture(event.pointerId); const p = point(event); setStart(p); onChange(undefined); } }}
      onPointerMove={move} onPointerUp={(event) => { move(event); setStart(undefined); }} onPointerCancel={() => setStart(undefined)}>
      <canvas ref={canvas} className="block h-auto w-full" />
      {value ? <div className="pointer-events-none absolute border-2 border-primary bg-primary/20" style={{ left: `${value.left * 100}%`, top: `${value.top * 100}%`, width: `${(value.right - value.left) * 100}%`, height: `${(value.bottom - value.top) * 100}%` }} /> : null}
    </div>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" disabled={disabled || !size} onClick={() => size && onChange({ ...size, left: 0.1, right: 0.9, top: 0.02, bottom: 0.98 })}>Select centered person</Button>
      <Button type="button" variant="ghost" size="sm" disabled={disabled || !value} onClick={() => onChange(undefined)}>Clear selection</Button>
    </div>
    {value ? <details className="text-sm"><summary className="cursor-pointer underline underline-offset-4">Adjust selection with keyboard</summary><div className="mt-3 grid max-w-md grid-cols-2 gap-3">
      {(["left", "top", "right", "bottom"] as const).map((side) => <label key={side} className="space-y-1 capitalize">{side} (%)<input type="number" min={0} max={100} step={1} disabled={disabled} value={Math.round(value[side] * 100)} onChange={(event) => onChange({ ...value, [side]: Number(event.target.value) / 100 })} className="block h-10 w-full rounded-md border border-input bg-background px-3" /></label>)}
    </div></details> : null}
    <p role="status" className="text-sm text-muted-foreground">{value ? valid ? "Selection marked. Check that clothing and hair are inside the box." : "The selection is too small or reversed. Adjust its edges." : "Draw a selection or use the centered-person button."}</p>
  </div>;
}
