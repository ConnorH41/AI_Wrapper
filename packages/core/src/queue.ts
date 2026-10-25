/**
 * Chain A is cheap and ends at awaiting_approval. Approving enqueues chain B,
 * which is where the money is spent. Neither chain ever waits on a human, so
 * no worker sits blocked on an approval.
 */
export const CHAIN_A = "chain-a:script-and-stills";
export const CHAIN_B = "chain-b:video-and-assembly";

export type ChainJob = { projectId: string };

/** Hard ceiling on a single step, so provider polling cannot hang forever. */
export const STEP_TIMEOUT_MS = 5 * 60 * 1000;
