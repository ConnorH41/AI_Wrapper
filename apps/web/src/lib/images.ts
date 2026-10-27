import { MAX_IMAGE_BYTES, VIDEO, type Scene } from "@aiw/core/session";

export async function validateImage(file: Blob): Promise<void> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size === 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error("Choose a JPEG, PNG, or WebP image no larger than 10 MB.");
  }
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  const valid = file.type === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 :
    file.type === "image/png" ? bytes[0] === 137 && text.slice(1, 4) === "PNG" :
    text.slice(0, 4) === "RIFF" && text.slice(8, 12) === "WEBP";
  if (!valid) throw new Error("The image contents do not match its JPEG, PNG, or WebP type.");
  let image: ImageBitmap;
  try { image = await createImageBitmap(file); }
  catch { throw new Error("This image could not be decoded. Choose another file."); }
  try {
    if (image.width * image.height > 40000000) throw new Error("Choose an image with at most 40 million pixels.");
  } finally { image.close(); }
}

function fit(ctx: CanvasRenderingContext2D, image: ImageBitmap, x: number, y: number, width: number, height: number) {
  const scale = Math.min(width / image.width, height / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, y: number) {
  let lines: string[] = [];
  let fontSize = 38;
  for (; fontSize >= 18; fontSize -= 2) {
    ctx.font = `600 ${fontSize}px Arial, sans-serif`;
    lines = [];
    let line = "";
    for (const word of text.split(/\s+/)) {
      if (line && ctx.measureText(`${line} ${word}`).width > 620) { lines.push(line); line = ""; }
      line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
    if (lines.length * fontSize * 1.25 <= 260 || fontSize === 18) break;
  }
  for (const line of lines) { ctx.fillText(line, VIDEO.width / 2, y, 620); y += fontSize * 1.25; }
}

export async function sceneImages(product: Blob, portrait: Blob, scenes: Scene[]): Promise<Blob[]> {
  const productImage = await createImageBitmap(product);
  let presenter: ImageBitmap | undefined;
  try {
    presenter = await createImageBitmap(portrait);
    const images: Blob[] = [];
    for (const scene of scenes) {
      const canvas = document.createElement("canvas");
      canvas.width = VIDEO.width; canvas.height = VIDEO.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Your browser could not create the video preview.");
      ctx.fillStyle = "#f4f4f5"; ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);
      ctx.fillStyle = "#18181b"; ctx.font = "600 38px Arial, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      wrap(ctx, scene.text, 90);
      if (scene.kind === "product") fit(ctx, productImage, 60, 420, 600, 600);
      else {
        fit(ctx, presenter, 30, 330, 315, 680);
        fit(ctx, productImage, 375, 330, 315, 680);
      }
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not prepare scene image.")), "image/png"));
      images.push(blob);
      canvas.width = 0; canvas.height = 0;
    }
    return images;
  } finally { productImage.close(); presenter?.close(); }
}
