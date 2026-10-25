import type { WordTiming } from "@aiw/core";

const WORDS_PER_CUE = 4;

/**
 * Builds SRT from the voiceover. Real word timings are used when the provider
 * reports them; otherwise words are distributed evenly across the measured
 * duration, which drifts on pauses but stays readable.
 */
export function buildSrt(
  script: string,
  durationSec: number,
  timings: WordTiming[],
): string {
  const words = script.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";

  const resolved: WordTiming[] =
    timings.length === words.length
      ? timings
      : words.map((word, index) => ({
          word,
          start: (index / words.length) * durationSec,
          end: ((index + 1) / words.length) * durationSec,
        }));

  const cues: string[] = [];
  for (let i = 0; i < resolved.length; i += WORDS_PER_CUE) {
    const group = resolved.slice(i, i + WORDS_PER_CUE);
    const index = cues.length + 1;
    const text = group.map((g) => g.word).join(" ");
    cues.push(
      `${index}\n${stamp(group[0].start)} --> ${stamp(
        group[group.length - 1].end,
      )}\n${text}\n`,
    );
  }

  return cues.join("\n");
}

function stamp(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = String(Math.floor(ms / 3_600_000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0");
  const milli = String(ms % 1000).padStart(3, "0");
  return `${h}:${m}:${s},${milli}`;
}
