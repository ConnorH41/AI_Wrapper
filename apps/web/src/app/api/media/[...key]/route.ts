import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { localPath, mediaRoot } from "@aiw/core";
import { NextResponse } from "next/server";
import path from "node:path";
import { Readable } from "node:stream";
import { requireLegacyDevelopment } from "@/lib/server/legacy";

export async function GET(
  _request: Request,
  context: { params: Promise<{ key: string[] }> },
) {
  requireLegacyDevelopment();
  const { key } = await context.params;
  const storageKey = key.join("/");

  try {
    const file = localPath(storageKey);
    if (!file.startsWith(path.resolve(mediaRoot()))) {
      return new NextResponse("Not found", { status: 404 });
    }
    const info = await stat(file);
    if (!info.isFile()) return new NextResponse("Not found", { status: 404 });

    const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
    const ext = path.extname(file).toLowerCase();
    const type =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".mp4"
            ? "video/mp4"
            : ext === ".wav"
              ? "audio/wav"
              : "image/jpeg";

    return new NextResponse(stream, {
      headers: {
        "Content-Type": type,
        "Content-Length": String(info.size),
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
