import type { ScriptProvider } from "@aiw/core";

const HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "llama3.2:3b";

/** Spoken English lands near this rate, which is how we size the script. */
const WORDS_PER_SECOND = 2.5;

export const ollamaScript: ScriptProvider = {
  name: "ollama",

  async generateScript({ title, prompt, targetSeconds }) {
    const wordBudget = Math.round(targetSeconds * WORDS_PER_SECOND);

    const instruction = [
      `Write the spoken voiceover for a ${targetSeconds}-second vertical product video.`,
      `Product: ${title}.`,
      `Creative direction: ${prompt}`,
      ``,
      `Rules:`,
      `- Around ${wordBudget} words. This is a hard limit.`,
      `- Plain spoken sentences only. No scene directions, no labels, no markdown, no quotes.`,
      `- Open with a hook, then one concrete benefit, then a short call to action.`,
      `- Output only the words to be spoken.`,
    ].join("\n");

    const response = await fetch(`${HOST}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt: instruction,
        stream: false,
        options: { temperature: 0.8 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}`);
    }

    const body = (await response.json()) as { response?: string };
    const script = clean(body.response ?? "");
    if (!script) throw new Error("Ollama returned an empty script");
    if (/^\s*i (can'?t|cannot|won'?t|am unable to)\b/i.test(script)) {
      throw new Error(`Provider refused: ${script}`);
    }

    return {
      data: { script },
      provider: "ollama",
      model: MODEL,
      estimatedCostUsd: 0,
    };
  },
};

/** Small models like to wrap output in quotes or prefix it with a label. */
function clean(raw: string): string {
  return raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(voiceover|script|narration)\s*:\s*/i, "")
    .replace(/\s*\n+\s*/g, " ")
    .trim();
}
