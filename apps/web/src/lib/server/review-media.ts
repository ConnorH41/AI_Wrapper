import { REVIEW, type SceneReview } from "@aiw/core/scene-review";

/** Container/track checks, not pixel-level mask or codec-quality verification. */
export async function validateReviewedMedia(scene: Uint8Array, mask: Uint8Array, review: SceneReview, signal: AbortSignal): Promise<void> {
  const { Input, BufferSource, MP4 } = await import("mediabunny");
  async function inspect(bytes: Uint8Array) {
    const input = new Input({ source: new BufferSource(bytes), formats: [MP4] });
    try {
      signal.throwIfAborted();
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error("A reviewed asset is missing its video track.");
      const width = await track.getDisplayWidth(), height = await track.getDisplayHeight();
      const stats = await track.computePacketStats(REVIEW.maxFrames + 1);
      const duration = await track.computeDuration(), start = await track.getFirstTimestamp();
      signal.throwIfAborted();
      if (!Number.isFinite(duration) || duration < 1.95 || duration > 5.1 || !Number.isFinite(start) || Math.abs(start) > 0.1 || stats.packetCount > REVIEW.maxFrames || stats.packetCount < REVIEW.samples || stats.averagePacketRate > 61) throw new Error("Use a standard 2–5-second video at 60 fps or less, starting at zero.");
      return { width, height, count: stats.packetCount, duration };
    } finally { input.dispose(); }
  }
  const source = await inspect(scene), guide = await inspect(mask);
  const region = review.checkpoints[0].region;
  if (source.width !== region.width || source.height !== region.height || guide.width !== source.width || guide.height !== source.height || guide.count !== source.count || Math.abs(source.duration - guide.duration) > 0.12 || Math.abs(review.duration - source.duration) > 0.12) throw new Error("The scene, review and timed edit guide do not match. Prepare the guide again.");
}
