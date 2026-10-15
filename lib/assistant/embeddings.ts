export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "text-embedding-v3";
export const EMBEDDING_DIMS = 1024;
const BASE_URL = process.env.QWEN_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const BATCH = 10;

export const embeddingsAvailable = () => Boolean(process.env.DASHSCOPE_API_KEY);

/** Embeds texts with Qwen's multilingual embedding model (English and Chinese share one vector space). */
export async function embed(texts: string[]): Promise<number[][]> {
  const key = process.env.DASHSCOPE_API_KEY;
  if (!key) throw new Error("DASHSCOPE_API_KEY is not set");
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const res = await fetch(`${BASE_URL}/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts.slice(i, i + BATCH), dimensions: EMBEDDING_DIMS }),
    });
    if (!res.ok) throw new Error(`embedding request failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    out.push(...body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
  }
  return out;
}

export function passageText(p: { title: string; section: string | null; text: string }): string {
  return [p.title, p.section, p.text].filter(Boolean).join("\n");
}
