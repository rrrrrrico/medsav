"""Raw layer: VHIS open data and premium PDFs, loaded as they arrive."""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

import requests
from pyspark.sql import functions as F

from . import config  # sets sys.path for scripts/

import build_plan_csvs as bpc  # noqa: E402


def _fetch_pdf(url: str, cert: str) -> Optional[Path]:
    """Always download: insurers replace premium PDFs under the same file name each year."""
    cache = bpc.PDF_DIRS[0]
    cache.mkdir(parents=True, exist_ok=True)
    dest = cache / (url.rstrip("/").split("/")[-1] or f"{cert}.pdf")
    try:
        resp = requests.get(url, timeout=120)
        resp.raise_for_status()
    except requests.RequestException as exc:
        print(f"  PDF download failed {cert}: {exc}")
        return None
    dest.write_bytes(resp.content)
    return dest


def _resolve_pdfs(catalog: List[Dict[str, str]], download: bool) -> Dict[str, Optional[str]]:
    def one(row: Dict[str, str]) -> tuple:
        cert = row["certification_no"]
        path = None
        if download and row.get("premium_pdf_url"):
            path = _fetch_pdf(row["premium_pdf_url"], cert)
        if path is None:
            path = bpc.find_local_pdf(cert)
        return cert, str(path) if path else None

    with ThreadPoolExecutor(max_workers=8) as pool:
        return dict(pool.map(one, catalog))


def run(limit: int = 0, skip_pdf: bool = False, download: bool = True) -> Dict[str, int]:
    spark = config.spark_session()
    loaded_at = datetime.now().isoformat(timespec="seconds")

    print("[bronze] fetching VHIS open data")
    standard = bpc.fetch_json(bpc.STANDARD_URL)
    flexi = bpc.fetch_json(bpc.FLEXI_URL)
    premium_list = bpc.fetch_premiums()

    raw_dir = config.LAKE / "raw" / loaded_at[:10]
    raw_dir.mkdir(parents=True, exist_ok=True)
    for name, obj in (("standard-plans", standard), ("flexi-plans", flexi), ("plan-premium", premium_list)):
        (raw_dir / f"{name}.json").write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")

    catalog = bpc.flatten_plans(standard, flexi)
    if limit:
        catalog = catalog[:limit]
    certs = {row["certification_no"] for row in catalog}

    pdf_paths = {} if skip_pdf else _resolve_pdfs(catalog, download)
    for row in catalog:
        row["pdf_path"] = pdf_paths.get(row["certification_no"]) or ""

    (spark.createDataFrame(catalog)
        .withColumn("loaded_at", F.lit(loaded_at))
        .write.format("delta").mode("overwrite").option("overwriteSchema", "true")
        .save(str(config.BRONZE_CATALOG)))

    gov_rows = []
    for plan in premium_list:
        cert = plan.get("certification-no")
        if cert not in certs:
            continue
        meta = (
            str(plan.get("prem-date") or ""),
            str(plan.get("currency") or "HKD"),
            str(plan.get("age-counting-method") or ""),
        )
        for status, ages in bpc.gov_age_maps(plan).items():
            for age, premium in ages.items():
                gov_rows.append((cert, *meta, status, int(age), float(premium)))

    (spark.createDataFrame(
            gov_rows,
            "certification_no string, prem_date string, currency string, "
            "age_counting_method string, status string, age int, annual_premium double",
        )
        .withColumn("loaded_at", F.lit(loaded_at))
        .write.format("delta").mode("overwrite").option("overwriteSchema", "true")
        .save(str(config.BRONZE_GOV)))

    found = sorted({p for p in pdf_paths.values() if p})
    if found:
        pdfs = (spark.read.format("binaryFile").load(found)
                .select(F.regexp_replace("path", "^file:", "").alias("pdf_path"), "content", "length"))
    else:
        pdfs = spark.createDataFrame([], "pdf_path string, content binary, length long")
    pdfs.write.format("delta").mode("overwrite").option("overwriteSchema", "true").save(str(config.BRONZE_PDFS))

    stats = {"catalog": len(catalog), "gov_rows": len(gov_rows), "pdfs": len(found)}
    print(f"[bronze] {stats}")
    return stats
