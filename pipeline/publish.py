"""Write the site's CSV files from the cleaned layer, in the format lib/data.ts reads."""

from __future__ import annotations

import csv
import json
import shutil
from pathlib import Path

from pyspark.sql import functions as F

from . import config  # sets sys.path for scripts/

import build_plan_csvs as bpc  # noqa: E402

CATALOG_FIELDS = ["certification_no", "company_name_en", "company_name_zh", "plan_name_en",
                  "plan_name_zh", "type_en", "type_zh", "premium_pdf_url"]
STATUS_ORDER = {s: i for i, s in enumerate(bpc.STATUSES)}


def run(out_dir: Path) -> dict:
    spark = config.spark_session()
    catalog = (spark.read.format("delta").load(str(config.BRONZE_CATALOG))
               .select(*CATALOG_FIELDS).orderBy("certification_no").toPandas())
    prem = spark.read.format("delta").load(str(config.SILVER_PREMIUMS)).toPandas()
    plans = spark.read.format("delta").load(str(config.SILVER_PLAN_STATUS)).toPandas()

    out_dir.mkdir(parents=True, exist_ok=True)
    with (out_dir / "plans.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CATALOG_FIELDS)
        writer.writeheader()
        writer.writerows(catalog.fillna("").to_dict("records"))

    staging = out_dir / ".premiums-staging"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir()
    prem["status_order"] = prem["status"].map(STATUS_ORDER)
    prem = prem.sort_values(["certification_no", "age", "status_order"])
    for cert, rows in prem.groupby("certification_no", sort=False):
        with (staging / f"{cert}.csv").open("w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["certification_no", "prem_date", "currency", "age_counting_method",
                             "max_age", "pdf_extended_cells", "age", "status", "annual_premium"])
            for r in rows.itertuples(index=False):
                writer.writerow([cert, r.prem_date, r.currency, r.age_counting_method, int(r.max_age),
                                 int(r.pdf_extended_cells), int(r.age), r.status, float(r.annual_premium)])

    target = out_dir / "premiums"
    if target.exists():
        shutil.rmtree(target)
    staging.rename(target)

    outcomes = plans["pdf_outcome"].value_counts().to_dict()
    stats = {
        "written": int(len(plans)),
        "pdf_extended": int(outcomes.get("extended", 0)),
        "pdf_failed_validate": int(outcomes.get("failed_validate", 0)),
        "pdf_missing": int(outcomes.get("missing", 0)),
        "no_gov": int(len(catalog) - len(plans)),
        "max_age_gt_80": int((plans["max_age"] > 80).sum()),
    }
    manifest = {
        "plan_count": stats["written"],
        "catalog_count": int(len(catalog)),
        "row_count": int(len(prem)),
        "premium_source": bpc.PREMIUM_ZIP,
        "built_by": "pipeline (PySpark + Delta Lake)",
        "stats": stats,
    }
    (out_dir / "premiums-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"[publish] {stats['written']} plan files → {target}")
    return manifest
