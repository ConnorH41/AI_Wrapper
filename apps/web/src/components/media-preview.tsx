"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Keep an actual decoded first frame visible while a paused preview settles. */
export function MediaPreview({ src, poster, preload = "auto", className, onLoadedData, ...props }: ComponentProps<"video">) {
  const [firstFrame, setFirstFrame] = useState<{ src: string; image: string }>();
  useEffect(() => { setFirstFrame(undefined); }, [src]);
  return <video {...props} src={src} preload={preload} poster={poster ?? (firstFrame && firstFrame.src === src ? firstFrame.image : undefined)} className={cn("w-full rounded-lg border border-border bg-muted object-contain", className)} onLoadedData={(event) => {
    const video = event.currentTarget;
    if (typeof src === "string" && video.videoWidth && video.videoHeight) {
      const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      try {
        const ctx = canvas.getContext("2d");
        if (ctx) { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); setFirstFrame({ src, image: canvas.toDataURL("image/jpeg", 0.85) }); }
      } catch { /* Remote previews may not grant canvas access; native playback remains available. */ }
      finally { canvas.width = 0; canvas.height = 0; }
    }
    onLoadedData?.(event);
  }} />;
}
