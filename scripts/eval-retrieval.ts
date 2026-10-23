/**
 * Compare keyword (BM25), vector and hybrid retrieval on eval/retrieval-cases.ts.
 *
 *   npm run eval:retrieval            # vectors from eval/.cache/embeddings.json
 *   npm run eval:retrieval -- db      # vectors from Supabase pgvector
 *   npm run eval:retrieval -- --hyde  # vector and hybrid queries use HyDE
 */
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { RETRIEVAL_CASES } from "@/eval/retrieval-cases";
import { retrieve, RetrievalMode } from "@/lib/assistant/retrieve";
import { fileStore, supabaseStore } from "@/lib/assistant/vector-store";

const K = 5;
const useDb = process.argv.includes("db");
const weightArg = process.argv.find((a) => a.startsWith("--keyword-weight="));
const keywordWeight = weightArg ? Number(weightArg.split("=")[1]) : undefined;
const hyde = process.argv.includes("--hyde");
const store = useDb ? supabaseStore() : fileStore(path.join(process.cwd(), "eval", ".cache", "embeddings.json"));

const faqNumber = (title: string) => Number(/^Q(\d+)\./.exec(title)?.[1] ?? NaN);

async function main() {
  const modes: RetrievalMode[] = ["keyword", "vector", "hybrid"];
  const summary: Record<string, { recall_at_1: number; recall_at_5: number; mrr: number; median_ms: number }> = {};
  const misses: Record<string, string[]> = {};
  for (const mode of modes) {
    let hit1 = 0, hit5 = 0, rr = 0;
    const times: number[] = [];
    misses[mode] = [];
    for (const c of RETRIEVAL_CASES) {
      const started = Date.now();
      const { passages } = await retrieve(c.q, { k: K, mode, store, keywordWeight, hyde });
      times.push(Date.now() - started);
      const rank = passages.findIndex((p) => c.relevant.includes(faqNumber(p.title)));
      if (rank === 0) hit1++;
      if (rank >= 0) { hit5++; rr += 1 / (rank + 1); } else misses[mode].push(c.q);
    }
    const n = RETRIEVAL_CASES.length;
    const pct = (x: number) => Math.round((x / n) * 1000) / 10;
    times.sort((a, b) => a - b);
    summary[mode] = {
      recall_at_1: pct(hit1), recall_at_5: pct(hit5), mrr: Math.round((rr / n) * 1000) / 1000,
      median_ms: times[Math.floor(n / 2)],
    };
  }
  console.table(summary);
  for (const mode of modes) if (misses[mode].length) console.log(`\n${mode} misses:\n  ${misses[mode].join("\n  ")}`);

  const dir = path.join(process.cwd(), "eval", "results");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `retrieval-${store.name}${hyde ? "-hyde" : ""}.json`),
    JSON.stringify({ run_at: new Date().toISOString(), store: store.name, hyde, cases: RETRIEVAL_CASES.length, k: K, summary, misses }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
