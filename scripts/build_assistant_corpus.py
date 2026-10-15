#!/usr/bin/env python3
"""Build the document corpus behind the MedSav Assistant's search_documents tool.

Downloads official VHIS documents (FAQs, consumer booklet, Standard Plan policy template,
tax-deduction page) in English and Traditional Chinese and splits them into passages that
keep their source URL and page number, so every answer can cite where it came from.

Run: .venv-spark/bin/python scripts/build_assistant_corpus.py
"""

from __future__ import annotations

import html
import io
import json
import re
from datetime import datetime
from pathlib import Path

import pdfplumber
import requests

BASE = "https://www.vhis.gov.hk"
OUT = Path(__file__).resolve().parent.parent / "lib" / "assistant" / "corpus.json"
CHUNK_CHARS = {"en": 1200, "zh": 500}
OVERLAP = {"en": 150, "zh": 60}

FAQS = [("en", "/public/data/faqs_en.json"), ("zh", "/public/data/faqs_zh-hk.json")]
PDFS = [
    ("en", "Consumer booklet", "/doc/en/information_centre/e_booklet.pdf"),
    ("zh", "自願醫保消費者小冊子", "/doc/tc/information_centre/c_booklet.pdf"),
    ("en", "Standard Plan policy template", "/doc/en/information_centre/e_standard_plan_template.pdf"),
    ("zh", "標準計劃保單範本", "/doc/tc/information_centre/c_standard_plan_template.pdf"),
]
PAGES = [
    ("en", "Tax deduction", "/en/consumer_corner/tax-deduction.html"),
    ("zh", "扣稅", "/tc/consumer_corner/tax-deduction.html"),
]


def get(path: str) -> bytes:
    r = requests.get(BASE + path, timeout=60, headers={"User-Agent": "MedSav corpus builder"})
    r.raise_for_status()
    return r.content


def strip_html(s: str) -> str:
    s = re.sub(r"<(script|style)\b.*?</\1>", " ", s, flags=re.S | re.I)
    s = re.sub(r"<br\s*/?>|</(p|li|tr|h\d|div)>", "\n", s, flags=re.I)
    s = html.unescape(re.sub(r"<[^>]+>", " ", s))
    return clean(s)


def clean(s: str) -> str:
    s = re.sub(r"[ \t\u3000]+", " ", s)
    s = re.sub(r"\s*\n\s*", "\n", s)
    return s.strip()


def split(text: str, lang: str) -> list[str]:
    size, overlap = CHUNK_CHARS[lang], OVERLAP[lang]
    if len(text) <= size:
        return [text]
    parts, start = [], 0
    while start < len(text):
        end = min(len(text), start + size)
        if end < len(text):
            cut = max(text.rfind("\n", start + size // 2, end), text.rfind("。", start + size // 2, end),
                      text.rfind(". ", start + size // 2, end))
            if cut > start:
                end = cut + 1
        parts.append(text[start:end].strip())
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return [p for p in parts if p]


def faq_chunks() -> list[dict]:
    chunks = []
    for lang, path in FAQS:
        data = json.loads(get(path))
        n = 0
        for category in data["categories"]:
            for q in category["questions"]:
                n += 1
                answer = []
                for part in q.get("answer", []):
                    if part.get("type") == "text":
                        answer.append(strip_html(part.get("html", "")))
                    elif part.get("type") == "table":
                        rows = [part.get("headers", [])] + part.get("rows", [])
                        answer.extend(" | ".join(strip_html(c) for c in row) for row in rows)
                        if part.get("footer"):
                            answer.append(strip_html(part["footer"]))
                page = "/en/info_centre/faqs.html" if lang == "en" else "/tc/info_centre/faqs.html"
                chunks.append({
                    "source": "FAQ" if lang == "en" else "常見問題",
                    "title": f"Q{n}. {strip_html(q['question'])}",
                    "lang": lang,
                    "url": BASE + page,
                    "page": None,
                    "section": strip_html(category["title"]),
                    "text": clean("\n".join(a for a in answer if a)),
                })
    return chunks


def pdf_chunks() -> list[dict]:
    chunks = []
    for lang, title, path in PDFS:
        with pdfplumber.open(io.BytesIO(get(path))) as pdf:
            for number, page in enumerate(pdf.pages, start=1):
                text = clean(page.extract_text() or "")
                if len(text) < 40:
                    continue
                for piece in split(text, lang):
                    chunks.append({"source": title, "title": f"{title}, p.{number}", "lang": lang,
                                   "url": f"{BASE}{path}#page={number}", "page": number,
                                   "section": None, "text": piece})
    return chunks


def page_chunks() -> list[dict]:
    chunks = []
    for lang, title, path in PAGES:
        raw = get(path).decode("utf-8", "ignore")
        main = re.search(r'<main\b.*?</main>', raw, flags=re.S | re.I)
        text = strip_html(main.group(0) if main else raw)
        for piece in split(text, lang):
            chunks.append({"source": title, "title": title, "lang": lang, "url": BASE + path,
                           "page": None, "section": None, "text": piece})
    return chunks


def main() -> None:
    chunks = faq_chunks() + pdf_chunks() + page_chunks()
    for i, c in enumerate(chunks):
        c["id"] = f"c{i:04d}"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"built_at": datetime.now().isoformat(timespec="seconds"), "chunks": chunks},
                              ensure_ascii=False), encoding="utf-8")
    by_source: dict[str, int] = {}
    for c in chunks:
        by_source[c["source"]] = by_source.get(c["source"], 0) + 1
    print(f"{len(chunks)} passages -> {OUT.relative_to(OUT.parents[2])}")
    for k, v in by_source.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
