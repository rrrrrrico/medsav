#!/usr/bin/env python3
"""Benchmark LlamaIndex retrieval pipelines on eval/retrieval-cases.ts.

Loads lib/assistant/corpus.json as LlamaIndex nodes, reusing the Qwen text-embedding-v3 vectors
from eval/.cache/embeddings.json (run `npm run embed-corpus` first), so the vector baseline matches
`npm run eval:retrieval`. Pipelines compared:
  vector         top-5 cosine search (same as the production default)
  vector_rerank  top-20 vector hits reordered by DashScope qwen3-rerank (DashScopeRerank)
  hyde           HyDEQueryTransform: DeepSeek drafts a hypothetical answer, and the search embeds
                 the draft together with the question
  hyde_rerank    HyDE retrieval followed by qwen3-rerank

Setup: uv venv .venv-llama --python 3.12 && uv pip install --python .venv-llama/bin/python -r scripts/requirements-llamaindex.txt
Run:   npm run eval:llamaindex
"""

from __future__ import annotations

import json
import os
import re
import statistics
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import dashscope
from dotenv import load_dotenv
from llama_index.core import VectorStoreIndex
from llama_index.core.schema import MetadataMode, QueryBundle, TextNode
from llama_index.core.indices.query.query_transform import HyDEQueryTransform
from llama_index.core.vector_stores import MetadataFilter, MetadataFilters
from llama_index.embeddings.openai_like import OpenAILikeEmbedding
from llama_index.llms.openai_like import OpenAILike
from llama_index.postprocessor.dashscope_rerank import DashScopeRerank

ROOT = Path(__file__).resolve().parent.parent
K = 5
CANDIDATES = 20
CJK = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")
FAQ = re.compile(r"^Q(\d+)\.")
BASE_URL = os.environ.get("QWEN_BASE_URL", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1")
RERANK_MODEL = os.environ.get("RERANK_MODEL", "qwen3-rerank")


def passage_text(c: dict) -> str:
    return "\n".join(x for x in (c["title"], c["section"], c["text"]) if x)


def load_nodes() -> list[TextNode]:
    chunks = json.loads((ROOT / "lib/assistant/corpus.json").read_text(encoding="utf-8"))["chunks"]
    vectors = {r["id"]: r["embedding"] for r in json.loads((ROOT / "eval/.cache/embeddings.json").read_text())}
    missing = [c["id"] for c in chunks if c["id"] not in vectors]
    if missing:
        raise SystemExit(f"{len(missing)} passages have no cached embedding; run `npm run embed-corpus` first")
    keys = ["lang", "title", "source", "url"]
    return [
        TextNode(id_=c["id"], text=passage_text(c), embedding=vectors[c["id"]],
                 metadata={k: c[k] for k in keys}, excluded_embed_metadata_keys=keys, excluded_llm_metadata_keys=keys)
        for c in chunks
    ]


def load_cases() -> list[dict]:
    out = subprocess.run(
        ["npx", "tsx", "-e", "import {RETRIEVAL_CASES} from './eval/retrieval-cases'; console.log(JSON.stringify(RETRIEVAL_CASES))"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


def main() -> None:
    load_dotenv(ROOT / ".env.local")
    key = os.environ["DASHSCOPE_API_KEY"]
    dashscope.base_http_api_url = BASE_URL.replace("/compatible-mode/v1", "/api/v1")

    embed_model = OpenAILikeEmbedding(model_name="text-embedding-v3", api_base=BASE_URL, api_key=key,
                                      dimensions=1024, embed_batch_size=10)
    index = VectorStoreIndex(load_nodes(), embed_model=embed_model)
    reranker = DashScopeRerank(model=RERANK_MODEL, top_n=K, api_key=key)
    llm = OpenAILike(model=os.environ.get("DEEPSEEK_MODEL", "deepseek-chat"), api_base="https://api.deepseek.com",
                     api_key=os.environ["DEEPSEEK_API_KEY"], is_chat_model=True, temperature=0, max_tokens=300)
    hyde = HyDEQueryTransform(llm=llm, include_original=True)
    cases = load_cases()

    def retrieve(query: str, rerank: bool, use_hyde: bool) -> list:
        lang = "zh" if CJK.search(query) else "en"
        filters = MetadataFilters(filters=[MetadataFilter(key="lang", value=lang)])
        retriever = index.as_retriever(similarity_top_k=CANDIDATES if rerank else K, filters=filters)
        bundle = hyde.run(query) if use_hyde else QueryBundle(query)
        hits = retriever.retrieve(bundle)
        return reranker.postprocess_nodes(hits, query_bundle=QueryBundle(query)) if rerank else hits

    summary, misses = {}, {}
    pipelines = {"vector": (False, False), "vector_rerank": (True, False), "hyde": (False, True), "hyde_rerank": (True, True)}
    for mode, (rerank, use_hyde) in pipelines.items():
        hit1 = hit5 = 0
        rr, times, misses[mode] = 0.0, [], []
        for c in cases:
            started = time.perf_counter()
            hits = retrieve(c["q"], rerank, use_hyde)
            times.append((time.perf_counter() - started) * 1000)
            titles = [h.node.metadata["title"] for h in hits[:K]]
            rank = next((i for i, t in enumerate(titles) if (m := FAQ.match(t)) and int(m[1]) in c["relevant"]), -1)
            hit1 += rank == 0
            if rank >= 0:
                hit5 += 1
                rr += 1 / (rank + 1)
            else:
                misses[mode].append(c["q"])
        n = len(cases)
        summary[mode] = {"recall_at_1": round(hit1 / n * 100, 1), "recall_at_5": round(hit5 / n * 100, 1),
                         "mrr": round(rr / n, 3), "median_ms": round(statistics.median(times))}

    for mode, s in summary.items():
        print(f"{mode:14} R@1 {s['recall_at_1']:5}%  R@5 {s['recall_at_5']:5}%  MRR {s['mrr']}  median {s['median_ms']} ms")
    for mode, qs in misses.items():
        if qs:
            print(f"\n{mode} misses:\n  " + "\n  ".join(qs))

    out = ROOT / "eval/results/retrieval-llamaindex.json"
    out.write_text(json.dumps({
        "run_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "store": "llamaindex-in-memory",
        "embedding_model": "text-embedding-v3", "rerank_model": RERANK_MODEL, "hyde_llm": llm.model, "candidates": CANDIDATES,
        "cases": len(cases), "k": K, "summary": summary, "misses": misses,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
