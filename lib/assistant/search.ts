import { readFileSync } from "fs";
import path from "path";

export interface Passage {
  id: string; source: string; title: string; lang: "en" | "zh"; url: string;
  page: number | null; section: string | null; text: string;
}

interface Index {
  passages: Passage[];
  docTerms: Map<string, number>[];
  lengths: number[];
  avgLength: number;
  df: Map<string, number>;
}

const K1 = 1.2;
const B = 0.75;
const STOPWORDS = new Set(("a an and are as at be by can do does for from has have how i if in is it its my of on or " +
  "that the this to under what when where which who will with you your").split(" "));
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

/** English words plus overlapping character pairs for Chinese, so neither language needs a segmenter. */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();
  for (const word of lower.match(/[a-z0-9]+(?:[.'-][a-z0-9]+)*/g) ?? []) {
    if (!STOPWORDS.has(word) && word.length > 1) tokens.push(word.replace(/s$/, ""));
  }
  for (const run of lower.match(/[\u3400-\u9fff\uf900-\ufaff]+/g) ?? []) {
    if (run.length === 1) tokens.push(run);
    for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2));
  }
  return tokens;
}

let cached: Index | null = null;

function index(): Index {
  if (cached) return cached;
  const file = path.join(process.cwd(), "lib", "assistant", "corpus.json");
  const passages = (JSON.parse(readFileSync(file, "utf-8")) as { chunks: Passage[] }).chunks;
  const df = new Map<string, number>();
  const docTerms = passages.map((p) => {
    const tf = new Map<string, number>();
    for (const t of tokenize(`${p.title}\n${p.section ?? ""}\n${p.text}`)) tf.set(t, (tf.get(t) ?? 0) + 1);
    tf.forEach((_, t) => df.set(t, (df.get(t) ?? 0) + 1));
    return tf;
  });
  const lengths = docTerms.map((tf) => Array.from(tf.values()).reduce((a, b) => a + b, 0));
  cached = { passages, docTerms, lengths, avgLength: lengths.reduce((a, b) => a + b, 0) / lengths.length, df };
  return cached;
}

export function search(query: string, opts: { k?: number; lang?: "en" | "zh" | "any" } = {}) {
  const idx = index();
  const n = idx.passages.length;
  const terms = Array.from(new Set(tokenize(query)));
  const lang = opts.lang && opts.lang !== "any" ? opts.lang : (CJK.test(query) ? "zh" : "en");
  const scored = idx.passages.map((p, i) => {
    if (opts.lang !== "any" && p.lang !== lang) return { p, score: 0 };
    const tf = idx.docTerms[i];
    let score = 0;
    for (const t of terms) {
      const f = tf.get(t);
      if (!f) continue;
      const df = idx.df.get(t) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      score += idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * idx.lengths[i] / idx.avgLength));
    }
    if (p.source === "FAQ" || p.source === "常見問題") score *= 1.15;
    return { p, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, Math.min(opts.k ?? 5, 8))
    .map(({ p, score }) => ({ ...p, score: Math.round(score * 100) / 100 }));
}

export function passage(id: string): Passage | undefined {
  return index().passages.find((p) => p.id === id);
}
