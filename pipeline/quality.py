"""Quality gate: a release that fails any check is never published."""

from __future__ import annotations

import csv
import json
from datetime import datetime
from typing import Dict, List

from pyspark.sql import functions as F

from . import config

STATUSES = ("SFN", "SFY", "SMN", "SMY", "RFN", "RFY", "RMN", "RMY")
MAX_DROP = 0.05


def _previous_release() -> Dict[str, int]:
    manifest = config.PUBLIC_DATA / "premiums-manifest.json"
    if not manifest.exists():
        return {}
    data = json.loads(manifest.read_text(encoding="utf-8"))
    prev = {
        "plans": int(data.get("plan_count") or 0),
        "pdf_extended": int((data.get("stats") or {}).get("pdf_extended") or 0),
    }
    if "row_count" in data:
        prev["rows"] = int(data["row_count"])
    else:
        rows = 0
        for path in (config.PUBLIC_DATA / "premiums").glob("*.csv"):
            with path.open(encoding="utf-8") as f:
                rows += sum(1 for _ in csv.reader(f)) - 1
        prev["rows"] = rows
    return prev


def run(limit: int = 0) -> bool:
    spark = config.spark_session()
    prem = spark.read.format("delta").load(str(config.SILVER_PREMIUMS))
    plans = spark.read.format("delta").load(str(config.SILVER_PLAN_STATUS))
    gov = spark.read.format("delta").load(str(config.BRONZE_GOV))

    rows = prem.count()
    plan_count = plans.count()
    extended = plans.where(F.col("pdf_outcome") == "extended").count()
    checks: List[Dict] = []

    def check(name: str, passed: bool, detail) -> None:
        checks.append({"check": name, "passed": bool(passed), "detail": detail})

    bad_values = prem.where(
        F.col("annual_premium").isNull() | (F.col("annual_premium") <= 0)
        | F.col("age").isNull() | (F.col("age") < 0) | (F.col("age") > 130)
        | ~F.col("status").isin(*STATUSES) | F.col("currency").isNull()
    ).count()
    check("valid values (premium > 0, age 0-130, known status, currency)", bad_values == 0,
          {"bad_rows": bad_values})

    dupes = prem.groupBy("certification_no", "status", "age").count().where("count > 1").count()
    check("one premium per plan, status and age", dupes == 0, {"duplicate_keys": dupes})

    changed_gov = (gov.alias("g")
        .join(prem.alias("p"), ["certification_no", "status", "age"], "left")
        .where(F.col("p.annual_premium").isNull()
               | (F.abs(F.col("g.annual_premium") - F.col("p.annual_premium")) > 0.005))
        .count())
    check("every gov premium kept unchanged (PDF only adds older ages)", changed_gov == 0,
          {"gov_cells_missing_or_changed": changed_gov})

    gov_plans = gov.select("certification_no").distinct().count()
    check("every plan with gov data is in the output", plan_count == gov_plans,
          {"gov_plans": gov_plans, "output_plans": plan_count})

    errors = plans.where(F.col("pdf_outcome") == "error").count()
    check("no PDF parse errors", errors == 0, {"errors": errors})

    prev = _previous_release() if not limit else {}
    for name, now, key in (("plan count", plan_count, "plans"), ("row count", rows, "rows"),
                           ("PDF-extended plans", extended, "pdf_extended")):
        before = prev.get(key)
        if before:
            check(f"{name} did not drop more than {int(MAX_DROP * 100)}%", now >= before * (1 - MAX_DROP),
                  {"previous": before, "now": now})

    passed = all(c["passed"] for c in checks)
    report = {
        "run_at": datetime.now().isoformat(timespec="seconds"),
        "passed": passed,
        "rows": rows,
        "plans": plan_count,
        "pdf_extended": extended,
        "checks": checks,
    }
    config.REPORTS.mkdir(parents=True, exist_ok=True)
    (config.REPORTS / "quality-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    for c in checks:
        print(f"[quality] {'PASS' if c['passed'] else 'FAIL'}  {c['check']}  {c['detail']}")
    return passed
