import { readFileSync } from "fs";

export interface VectorHit { id: string; similarity: number }
type Lang = "en" | "zh";

export interface VectorStore {
  name: string;
  query(embedding: number[], k: number, lang: Lang | null): Promise<VectorHit[]>;
}

export const supabaseConfigured = () =>
  Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

/** Postgres + pgvector on Supabase, queried through the match_passages SQL function (HNSW, cosine). */
export function supabaseStore(): VectorStore {
  const url = process.env.SUPABASE_URL!.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return {
    name: "supabase-pgvector",
    async query(embedding, k, lang) {
      const res = await fetch(`${url}/rest/v1/rpc/match_passages`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query_embedding: embedding, match_count: k, filter_lang: lang }),
      });
      if (!res.ok) throw new Error(`match_passages failed: ${res.status} ${await res.text()}`);
      return (await res.json()) as VectorHit[];
    },
  };
}

/** Exact cosine search over a local embeddings file; used offline to benchmark before the database exists. */
export function fileStore(file: string): VectorStore {
  const rows = JSON.parse(readFileSync(file, "utf-8")) as { id: string; lang: Lang; embedding: number[] }[];
  const norm = (v: number[]) => Math.sqrt(v.reduce((a, x) => a + x * x, 0));
  const norms = rows.map((r) => norm(r.embedding));
  return {
    name: "local-file",
    async query(embedding, k, lang) {
      const qn = norm(embedding);
      return rows
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => !lang || r.lang === lang)
        .map(({ r, i }) => ({
          id: r.id,
          similarity: r.embedding.reduce((a, x, j) => a + x * embedding[j], 0) / (norms[i] * qn),
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, k);
    },
  };
}
