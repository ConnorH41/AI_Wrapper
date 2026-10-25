import {
  CHAIN_A,
  CHAIN_B,
  DATABASE_URL,
  waitForDb,
  type ChainJob,
} from "@aiw/core";
import PgBoss from "pg-boss";
import { runChainA, runChainB } from "./chains.js";

async function main() {
  await waitForDb();
  const boss = new PgBoss({ connectionString: DATABASE_URL });

  boss.on("error", (error) => console.error("[queue]", error));

  await boss.start();
  await boss.createQueue(CHAIN_A);
  await boss.createQueue(CHAIN_B);

  // One job at a time: generation is CPU-bound locally and concurrency would
  // only make every project slower.
  await boss.work<ChainJob>(CHAIN_A, { batchSize: 1 }, async ([job]) => {
    console.log(`[chain-a] ${job.data.projectId}`);
    await runChainA(job.data.projectId);
    console.log(`[chain-a] ${job.data.projectId} awaiting approval`);
  });

  await boss.work<ChainJob>(CHAIN_B, { batchSize: 1 }, async ([job]) => {
    console.log(`[chain-b] ${job.data.projectId}`);
    await runChainB(job.data.projectId);
    console.log(`[chain-b] ${job.data.projectId} complete`);
  });

  console.log("Worker ready. Waiting for jobs.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
