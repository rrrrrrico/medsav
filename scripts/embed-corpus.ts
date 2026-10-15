/**
 * Embed lib/assistant/corpus.json with Qwen text-embedding-v3 and load it into Supabase pgvector.
 *
 *   npm run embed-corpus             # embed changed passages into eval/.cache/embeddings.json
 *   npm run embed-corpus -- --upload # ...and upsert them into the vhis_passages table
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { embed, EMBEDDING_MODEL, passageText } from "@/lib/assistant/embeddings";
import { allPassages } from "@/lib/assistant/search";
import { supabaseConfigured } from "@/lib/assistant/vector-store";

interface Row { id: string; lang: "en" | "zh"; md5: string; model: string; embedding: number[] }

const CACHE = path.join(process.cwd(), "eval", ".cache", "embeddings.json");
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

async function upload(rows: Row[]) {
  const url = process.env.SUPABASE_URL!.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const byId = new Map(allPassages().map((p) => [p.id, p]));
  const records = rows.map((r) => {
    const p = byId.get(r.id)!;
    return {
      id: p.id, lang: p.lang, source: p.source, title: p.title, url: p.url, page: p.page, section: p.section,
      content: p.text, content_md5: r.md5, model: r.model, embedding: r.embedding, updated_at: new Date().toISOString(),
    };
  });
  for (let i = 0; i < records.length; i += 100) {
    const res = await fetch(`${url}/rest/v1/vhis_passages`, {
      method: "POST",
      headers: {
        apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(records.slice(i, i + 100)),
    });
    if (!res.ok) throw new Error(`upsert failed: ${res.status} ${await res.text()}`);
  }
  const ids = records.map((r) => `"${r.id}"`).join(",");
  const del = await fetch(`${url}/rest/v1/vhis_passages?id=not.in.(${ids})`, {
    method: "DELETE", headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!del.ok) throw new Error(`cleanup failed: ${del.status} ${await del.text()}`);
  console.log(`upserted ${records.length} passages into Supabase`);
}

async function main() {
  const passages = allPassages();
  const cached = new Map<string, Row>(
    existsSync(CACHE) ? (JSON.parse(readFileSync(CACHE, "utf-8")) as Row[]).map((r) => [r.id, r]) : [],
  );
  const wanted = passages.map((p) => ({ p, md5: md5(passageText(p)) }));
  const stale = wanted.filter(({ p, md5: h }) => {
    const c = cached.get(p.id);
    return !c || c.md5 !== h || c.model !== EMBEDDING_MODEL;
  });
  console.log(`${passages.length} passages, ${stale.length} to embed with ${EMBEDDING_MODEL}`);
  const vectors = await embed(stale.map(({ p }) => passageText(p)));
  stale.forEach(({ p, md5: h }, i) => cached.set(p.id, { id: p.id, lang: p.lang, md5: h, model: EMBEDDING_MODEL, embedding: vectors[i] }));

  const rows = wanted.map(({ p }) => cached.get(p.id)!);
  mkdirSync(path.dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(rows));

  if (process.argv.includes("--upload")) {
    if (!supabaseConfigured()) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    await upload(rows);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
