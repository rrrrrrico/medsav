import { availableProviders, chatModel, defaultProvider, Provider } from "./model";

/** Same prompt as LlamaIndex's HyDEQueryTransform, which this mirrors (see scripts/llamaindex_retrieval.py). */
const HYDE_PROMPT = (question: string) =>
  `Please write a passage to answer the question\nTry to include as many key details as possible.\n\n\n${question}\n\n\nPassage:"""\n`;

/** DeepSeek drafted the passages in the LlamaIndex benchmark; fall back to whichever provider is configured. */
function hydeProvider(): Provider {
  const preferred = (process.env.HYDE_PROVIDER as Provider | undefined) ?? "deepseek";
  return availableProviders().includes(preferred) ? preferred : defaultProvider();
}

export const hydeEnabled = () => process.env.RETRIEVAL_HYDE === "1";

/** Drafts a hypothetical answer to embed alongside the question (HyDE). Returns null if the call fails. */
export async function hypotheticalPassage(question: string): Promise<string | null> {
  try {
    const { llm } = chatModel(hydeProvider());
    const res = await llm.invoke(HYDE_PROMPT(question));
    const text = typeof res.content === "string" ? res.content : res.content.map((c) => ("text" in c ? c.text : "")).join("");
    return text.trim() || null;
  } catch (err) {
    console.error("[hyde] draft failed, searching with the question only", err);
    return null;
  }
}
