import { deflateSync } from "node:zlib";
import { parsePersonRegion, type PersonRegion } from "@aiw/core/replacement";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const name = Buffer.from(type);
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length);
  name.copy(output, 4);
  Buffer.from(data).copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return output;
}

/** A first-frame guide, not a claimed per-frame segmentation or generated image. */
export function personMask(input: PersonRegion): Buffer {
  const region = parsePersonRegion(input);
  const { width, height } = region;
  const pixels = Buffer.alloc((width + 1) * height);
  const left = Math.floor(region.left * width);
  const right = Math.ceil(region.right * width);
  for (let y = Math.floor(region.top * height); y < Math.ceil(region.bottom * height); y++) {
    pixels.fill(255, y * (width + 1) + 1 + left, y * (width + 1) + 1 + right);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // grayscale, 8 bits, no palette/alpha/interlace
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

/** Read bounded ISO-BMFF movie metadata. Does not claim codec validation. */
export function mp4Duration(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  function boxes(start: number, end: number, depth: number): number | undefined {
    if (depth > 2) return;
    for (let pos = start; pos + 8 <= end;) {
      let size = view.getUint32(pos);
      let header = 8;
      if (size === 1) {
        if (pos + 16 > end) return;
        const large = view.getBigUint64(pos + 8);
        if (large > BigInt(bytes.length)) return;
        size = Number(large); header = 16;
      } else if (size === 0) size = end - pos;
      if (size < header || pos + size > end) return;
      const data = pos + header;
      if (type(pos + 4) === "moov") {
        const duration = boxes(data, pos + size, depth + 1);
        if (duration !== undefined) return duration;
      }
      if (type(pos + 4) === "mvhd") {
        const version = bytes[data];
        const offset = version === 1 ? 20 : 12;
        if ((version !== 0 && version !== 1) || data + offset + (version === 1 ? 12 : 8) > pos + size) return;
        const scale = view.getUint32(data + offset);
        const duration = version === 1 ? Number(view.getBigUint64(data + offset + 4)) : view.getUint32(data + offset + 4);
        if (scale && Number.isSafeInteger(duration)) return duration / scale;
      }
      pos += size;
    }
  }
  const duration = boxes(0, bytes.length, 0);
  if (!duration || !Number.isFinite(duration)) throw new Error("The scene has no readable MP4 duration. Export a standard MP4.");
  return duration;
}
