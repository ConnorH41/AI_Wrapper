import type { WordTiming } from "./types";

/**
 * One narrow interface per capability, so a step's provider can change without
 * the pipeline knowing. Hosted providers are submit-then-poll; adapters own
 * that polling internally and expose the same synchronous-looking call.
 */

export type ProviderMeta = {
  provider: string;
  model?: string;
  /** Best-effort cost of this single call, recorded in the ledger. */
  estimatedCostUsd: number;
};

export type Result<T> = { data: T } & ProviderMeta;

export type ScriptInput = {
  title: string;
  prompt: string;
  targetSeconds: number;
};

export type ScriptProvider = {
  name: string;
  generateScript(input: ScriptInput): Promise<Result<{ script: string }>>;
};

export type VoiceProvider = {
  name: string;
  synthesize(input: { text: string }): Promise<
    Result<{
      audio: Buffer;
      durationSec: number;
      /** Empty when the provider cannot report timings; captions then fall back. */
      timings: WordTiming[];
    }>
  >;
};

export type StillsProvider = {
  name: string;
  renderStills(input: {
    productPath?: string;
    title: string;
    width: number;
    height: number;
    count: number;
  }): Promise<Result<{ stills: Buffer[] }>>;
};

export type VideoProvider = {
  name: string;
  animate(input: {
    stillPath: string;
    durationSec: number;
    width: number;
    height: number;
  }): Promise<Result<{ video: Buffer }>>;
};

export type Router = {
  script: ScriptProvider;
  voice: VoiceProvider;
  stills: StillsProvider;
  video: VideoProvider;
};
