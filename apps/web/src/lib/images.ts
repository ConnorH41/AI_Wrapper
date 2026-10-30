import { MAX_IMAGE_BYTES } from "@aiw/core/session";


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
