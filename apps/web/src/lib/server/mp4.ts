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
