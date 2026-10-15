import { embed, embeddingsAvailable } from "./embeddings";
import { keywordSearch, LangOption, Passage, passage, queryLang } from "./search";
import { supabaseConfigured, supabaseStore, VectorStore } from "./vector-store";

export type RetrievalMode = "keyword" | "vector" | "hybrid";
export type Retrieved = Passage & { score: number };

const CANDIDATES = 20;
const RRF_K = 60;
const KEYWORD_WEIGHT = 1;
/** Vector alone beat both BM25 and fusion on eval/retrieval-cases.ts (see eval/results/retrieval-*.json). */
const DEFAULT_MODE: RetrievalMode = (process.env.RETRIEVAL_MODE as RetrievalMode | undefined) ?? "vector";

let defaultStore: VectorStore | null | undefined;

function storeFromEnv(): VectorStore | null {
  if (defaultStore === undefined) defaultStore = supabaseConfigured() && embeddingsAvailable() ? supabaseStore() : null;
  return defaultStore;
}

async function vectorSearch(query: string, k: number, lang: LangOption | undefined, store: VectorStore) {
  const [embedding] = await embed([query]);
  const hits = await store.query(embedding, k, queryLang(query, lang));
  return hits.flatMap((h) => {
    const p = passage(h.id);
    return p ? [{ ...p, score: Math.round(h.similarity * 1000) / 1000 }] : [];
  });
}

/**
 * Vector search by default; "hybrid" merges BM25 and vector results by reciprocal rank fusion.
 * Falls back to keyword search alone when no vector store is configured or the embedding call fails.
 */
export async function retrieve(
  query: string,
  opts: {
    k?: number; lang?: LangOption; mode?: RetrievalMode; store?: VectorStore | null; keywordWeight?: number;
  } = {},
): Promise<{ mode: RetrievalMode; passages: Retrieved[] }> {
  const k = Math.min(opts.k ?? 5, 8);
  const mode = opts.mode ?? DEFAULT_MODE;
  const store = opts.store === undefined ? storeFromEnv() : opts.store;
  if (mode === "keyword" || !store) return { mode: "keyword", passages: keywordSearch(query, { k, lang: opts.lang }) };

  let vector: Retrieved[];
  try {
    vector = await vectorSearch(query, mode === "vector" ? k : CANDIDATES, opts.lang, store);
  } catch (err) {
    console.error("[retrieve] vector search failed, using keyword only", err);
    return { mode: "keyword", passages: keywordSearch(query, { k, lang: opts.lang }) };
  }
  if (mode === "vector") return { mode, passages: vector };

  const keyword = keywordSearch(query, { k: CANDIDATES, lang: opts.lang });
  const fused = new Map<string, { p: Retrieved; score: number }>();
  const weighted: [Retrieved[], number][] = [[keyword, opts.keywordWeight ?? KEYWORD_WEIGHT], [vector, 1]];
  for (const [list, weight] of weighted) {
    list.forEach((p, rank) => {
      const entry = fused.get(p.id) ?? { p, score: 0 };
      entry.score += weight / (RRF_K + rank + 1);
      fused.set(p.id, entry);
    });
  }
  const passages = Array.from(fused.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ p, score }) => ({ ...p, score: Math.round(score * 10000) / 10000 }));
  return { mode, passages };
}
