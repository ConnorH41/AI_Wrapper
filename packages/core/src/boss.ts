import PgBoss from "pg-boss";
import { DATABASE_URL } from "./db";
import { CHAIN_A, CHAIN_B, type ChainJob } from "./queue";

let boss: PgBoss | undefined;
let starting: Promise<PgBoss> | undefined;

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  if (!starting) {
    starting = (async () => {
      const instance = new PgBoss({ connectionString: DATABASE_URL });
      instance.on("error", (error) => console.error("[queue]", error));
      await instance.start();
      await instance.createQueue(CHAIN_A);
      await instance.createQueue(CHAIN_B);
      boss = instance;
      return instance;
    })();
  }
  return starting;
}

export async function enqueueChainA(projectId: string): Promise<void> {
  const instance = await getBoss();
  await instance.send(CHAIN_A, { projectId } satisfies ChainJob);
}

export async function enqueueChainB(projectId: string): Promise<void> {
  const instance = await getBoss();
  await instance.send(CHAIN_B, { projectId } satisfies ChainJob);
}
