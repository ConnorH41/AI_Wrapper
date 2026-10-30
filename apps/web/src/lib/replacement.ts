import { REPLACEMENT, replacementMediaUrl, type ReplacementJob } from "@aiw/core/replacement";
import { api, postJson } from "./client-api";
import { downloadMotion, validatePlayableVideo } from "./motion";

export async function receiveReplacement(job: ReplacementJob, signal: AbortSignal): Promise<Blob> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(10 * 60 * 1000)]);
  while (true) {
    deadline.throwIfAborted();
    const response = await api("replacement", postJson({ action: "status", ticket: job.ticket }), deadline);
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || !("status" in result)) throw new Error("Invalid replacement status.");
    if (result.status === "complete") {
      const url = replacementMediaUrl("url" in result ? result.url : undefined);
      const blob = await downloadMotion(url, deadline, REPLACEMENT.outputBytes);
      await validatePlayableVideo(blob, deadline, REPLACEMENT.minSeconds, REPLACEMENT.maxSeconds + 0.2);
      return blob;
    }
    if (result.status !== "waiting") throw new Error("Unknown replacement status.");
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(deadline.reason); };
      const timer = setTimeout(() => { deadline.removeEventListener("abort", abort); resolve(); }, 2000);
      deadline.addEventListener("abort", abort, { once: true });
      if (deadline.aborted) abort();
    });
  }
}
